import { LanIceConfig, CallStatsMonitor } from '@ipm/calling/client';
import { CallSignalInput, ScreenShareOptions, CallStats } from '@ipm/shared';

export interface WebRtcCallbacks {
  onRemoteStream: (stream: MediaStream) => void;
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void;
  onCallEnded: () => void;
  onScreenShareEnded?: () => void;
}

export class WebRtcService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private callId: string | null = null;
  private targetDeviceId: string | null = null;
  private callbacks: WebRtcCallbacks | null = null;
  private statsMonitor: CallStatsMonitor = new CallStatsMonitor();
  private originalCallType: 'voice' | 'video' | 'screen' = 'voice';

  public initialize(
    callId: string,
    targetDeviceId: string,
    callbacks: WebRtcCallbacks
  ): RTCPeerConnection {
    this.callId = callId;
    this.targetDeviceId = targetDeviceId;
    this.callbacks = callbacks;
    this.statsMonitor.reset();

    // Pure LAN ICE configuration without external STUN/TURN
    const config = LanIceConfig.getConfiguration();
    this.peerConnection = new RTCPeerConnection(config);

    this.remoteStream = new MediaStream();

    this.peerConnection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
      if (this.remoteStream) {
        this.callbacks?.onRemoteStream(this.remoteStream);
      }
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.callId && this.targetDeviceId) {
        window.api.sendCallSignal({
          callId: this.callId,
          targetDeviceId: this.targetDeviceId,
          signalType: 'ice-candidate',
          data: event.candidate.toJSON(),
        });
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      if (this.peerConnection) {
        this.callbacks?.onIceConnectionStateChange(this.peerConnection.iceConnectionState);
        if (
          this.peerConnection.iceConnectionState === 'disconnected' ||
          this.peerConnection.iceConnectionState === 'failed' ||
          this.peerConnection.iceConnectionState === 'closed'
        ) {
          this.callbacks?.onCallEnded();
        }
      }
    };

    return this.peerConnection;
  }

  public async startLocalStream(
    callType: 'voice' | 'video' | 'screen',
    desktopSourceId?: string
  ): Promise<MediaStream> {
    this.stopLocalStream();
    this.originalCallType = callType;

    if (callType === 'screen' && desktopSourceId) {
      // Electron desktopCapturer screen stream
      this.screenStream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: desktopSourceId,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
            maxFrameRate: 30,
          },
        },
      });

      // Also get mic audio
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioStream.getAudioTracks().forEach((track) => this.screenStream?.addTrack(track));
      } catch {
        // mic might not be available; continue with screen video
      }

      this.localStream = this.screenStream;
    } else {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    }

    if (!this.localStream) {
      throw new Error('Failed to acquire local media stream');
    }

    // Add tracks to PeerConnection
    if (this.peerConnection) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });
    }

    return this.localStream;
  }

  /**
   * Smoothly replaces video track with screen capture during an active call.
   */
  public async replaceVideoTrackWithScreen(
    desktopSourceId: string,
    options?: Partial<ScreenShareOptions>
  ): Promise<MediaStream> {
    const preset = options?.preset || 'balanced';
    let maxFps = options?.maxFrameRate || (preset === 'smooth' ? 60 : preset === 'crisp' ? 15 : 30);
    const contentHint = options?.contentHint || (preset === 'smooth' ? 'motion' : 'detail');

    const constraints: any = {
      audio: options?.withAudio
        ? {
            mandatory: {
              chromeMediaSource: 'desktop',
            },
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: desktopSourceId,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080,
          maxFrameRate: maxFps,
        },
      },
    };

    const newScreenStream = await (navigator.mediaDevices as any).getUserMedia(constraints);
    const newVideoTrack = newScreenStream.getVideoTracks()[0];
    if (!newVideoTrack) {
      throw new Error('Failed to acquire screen capture video track');
    }

    newVideoTrack.contentHint = contentHint;

    // Handle OS-level window closure or user stopping share
    newVideoTrack.onended = () => {
      this.callbacks?.onScreenShareEnded?.();
    };

    if (this.peerConnection) {
      const videoSender = this.peerConnection
        .getSenders()
        .find((s) => s.track && s.track.kind === 'video');

      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
      } else {
        // If initial call was voice-only (no video sender), add track
        this.peerConnection.addTrack(newVideoTrack, newScreenStream);
        await this.createOffer();
      }
    }

    // Stop previous screen stream if any
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
    }
    this.screenStream = newScreenStream;

    return newScreenStream;
  }

  /**
   * Restores original camera video track after screen sharing stops.
   */
  public async restoreCameraVideoTrack(): Promise<MediaStream | null> {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    if (!this.peerConnection) return null;

    const videoSender = this.peerConnection
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');

    if (this.originalCallType === 'video') {
      try {
        const camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const camTrack = camStream.getVideoTracks()[0];
        if (videoSender && camTrack) {
          await videoSender.replaceTrack(camTrack);
        }
        return camStream;
      } catch (err) {
        console.warn('[WebRtcService] Could not restore camera track:', err);
      }
    } else {
      // Voice call: remove video track
      if (videoSender) {
        await videoSender.replaceTrack(null);
      }
    }

    return null;
  }

  public async getCallStats(): Promise<CallStats | null> {
    if (!this.peerConnection) return null;
    try {
      const statsReport = await this.peerConnection.getStats();
      return this.statsMonitor.parseStatsReport(statsReport);
    } catch {
      return null;
    }
  }

  public async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.peerConnection.setLocalDescription(offer);

    if (this.callId && this.targetDeviceId) {
      await window.api.sendCallSignal({
        callId: this.callId,
        targetDeviceId: this.targetDeviceId,
        signalType: 'offer',
        data: offer,
      });
    }

    return offer;
  }

  public async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    if (this.callId && this.targetDeviceId) {
      await window.api.sendCallSignal({
        callId: this.callId,
        targetDeviceId: this.targetDeviceId,
        signalType: 'answer',
        data: answer,
      });
    }

    return answer;
  }

  public async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  public async handleIceCandidate(candidateInit: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) return;
    try {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit));
    } catch (err) {
      console.warn('[WebRtcService] Failed to add ICE candidate:', err);
    }
  }

  public toggleAudio(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }

  public toggleVideo(enabled: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = enabled;
      });
    }
  }

  public stopLocalStream(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
  }

  public close(): void {
    this.stopLocalStream();

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((t) => t.stop());
      this.remoteStream = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.callId = null;
    this.targetDeviceId = null;
    this.callbacks = null;
    this.statsMonitor.reset();
  }
}

export const webrtcService = new WebRtcService();
