import { LanIceConfig, CallStatsMonitor } from '@ipm/calling/client';
import { CallSignalInput, ScreenShareOptions, CallStats } from '@ipm/shared';

export type CallMediaKind = 'voice' | 'video' | 'screen';

export interface WebRtcCallbacks {
  /** Fired with a fresh MediaStream object whenever remote tracks change or (un)mute. */
  onRemoteStream: (stream: MediaStream, hasLiveVideo: boolean) => void;
  onIceConnectionStateChange: (state: RTCIceConnectionState) => void;
  onCallEnded: (reason: string) => void;
  onScreenShareEnded?: () => void;
}

/** Converts getUserMedia failures into actionable messages. */
export function describeMediaError(err: unknown, kind: 'microphone' | 'camera' | 'screen' | 'media' = 'media'): string {
  const name = (err as { name?: string })?.name;
  const label = kind === 'media' ? 'microphone/camera' : kind;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Access to the ${label} was blocked. Allow it in Windows Settings › Privacy & security › ${
        kind === 'camera' ? 'Camera' : 'Microphone'
      } (enable "Let desktop apps access…").`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${label} was found. Connect a device and try again.`;
    case 'NotReadableError':
    case 'AbortError':
      return `The ${label} is in use by another application. Close it and try again.`;
    default:
      return (err as Error)?.message || `Could not access the ${label}.`;
  }
}

export class WebRtcService {
  private peerConnection: RTCPeerConnection | null = null;
  private callId: string | null = null;
  private targetDeviceId: string | null = null;
  private callbacks: WebRtcCallbacks | null = null;
  private statsMonitor: CallStatsMonitor = new CallStatsMonitor();
  private isPolite = false;

  // Local media
  private micStream: MediaStream | null = null;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenStream: MediaStream | null = null;
  private audioMixContext: AudioContext | null = null;
  private mixedAudioTrack: MediaStreamTrack | null = null;
  private audioSender: RTCRtpSender | null = null;
  private videoSender: RTCRtpSender | null = null;
  private cameraEnabled = true;

  // Remote media
  private remoteTracks = new Map<string, MediaStreamTrack>();

  // Signaling robustness
  private signalChain: Promise<void> = Promise.resolve();
  private pendingSignals: CallSignalInput[] = [];
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private makingOffer = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // ==========================================
  // Media acquisition
  // ==========================================

  /**
   * Acquires microphone (+ camera for video calls). Camera failure degrades to audio-only;
   * microphone failure is fatal for the caller but the callee may still join receive-only.
   */
  public async acquireLocalMedia(kind: CallMediaKind, opts: { allowReceiveOnly?: boolean } = {}): Promise<{ warning?: string }> {
    this.stopLocalMedia();
    let warning: string | undefined;

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      if (!opts.allowReceiveOnly) throw new Error(describeMediaError(err, 'microphone'));
      warning = `${describeMediaError(err, 'microphone')} You joined without a microphone.`;
    }

    if (kind === 'video') {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
        this.cameraTrack = cam.getVideoTracks()[0] ?? null;
        this.cameraEnabled = true;
      } catch (err) {
        warning = `${describeMediaError(err, 'camera')} Continuing with audio only.`;
        this.cameraTrack = null;
      }
    }

    return { warning };
  }

  public async acquireScreen(desktopSourceId: string, options?: Partial<ScreenShareOptions>): Promise<MediaStream> {
    const preset = options?.preset || 'balanced';
    const maxFps = options?.maxFrameRate || (preset === 'smooth' ? 60 : preset === 'crisp' ? 15 : 30);

    const constraints: any = {
      audio: options?.withAudio ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: desktopSourceId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: maxFps,
        },
      },
    };

    let stream: MediaStream;
    try {
      stream = await (navigator.mediaDevices as any).getUserMedia(constraints);
    } catch (err) {
      if (options?.withAudio) {
        // System audio capture can fail on some drivers; retry video-only.
        constraints.audio = false;
        stream = await (navigator.mediaDevices as any).getUserMedia(constraints);
      } else {
        throw new Error(describeMediaError(err, 'screen'));
      }
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('Failed to capture the selected screen or window');
    videoTrack.contentHint = options?.contentHint || (preset === 'smooth' ? 'motion' : 'detail');
    return stream;
  }

  // ==========================================
  // Peer connection lifecycle
  // ==========================================

  /**
   * @param isCaller the caller creates offers; the callee is the "polite" peer during glare.
   */
  public initialize(callId: string, targetDeviceId: string, isCaller: boolean, callbacks: WebRtcCallbacks): RTCPeerConnection {
    this.closePeerOnly();
    this.callId = callId;
    this.targetDeviceId = targetDeviceId;
    this.callbacks = callbacks;
    this.isPolite = !isCaller;
    this.statsMonitor.reset();
    this.remoteTracks.clear();
    this.pendingCandidates = [];

    const pc = new RTCPeerConnection(LanIceConfig.getConfiguration());
    this.peerConnection = pc;

    if (isCaller) {
      // Fixed transceivers: audio + video always exist, so screen sharing never needs renegotiation.
      const audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
      this.audioSender = audioTx.sender;
      this.videoSender = videoTx.sender;
      void this.applyLocalTracks();
    }

    pc.ontrack = (event) => {
      const track = event.track;
      this.remoteTracks.set(track.id, track);
      const refresh = () => this.emitRemoteStream();
      track.onunmute = refresh;
      track.onmute = refresh;
      track.onended = () => {
        this.remoteTracks.delete(track.id);
        refresh();
      };
      refresh();
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && this.callId && this.targetDeviceId) {
        window.api
          .sendCallSignal({
            callId: this.callId,
            targetDeviceId: this.targetDeviceId,
            signalType: 'ice-candidate',
            data: event.candidate.toJSON(),
          })
          .catch(() => {});
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      this.callbacks?.onIceConnectionStateChange(state);

      if (state === 'connected' || state === 'completed') {
        if (this.disconnectTimer) {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = null;
        }
      } else if (state === 'disconnected') {
        // Often transient on Wi-Fi; give it a moment to recover.
        if (!this.disconnectTimer) {
          this.disconnectTimer = setTimeout(() => {
            this.disconnectTimer = null;
            if (this.peerConnection?.iceConnectionState === 'disconnected') {
              this.callbacks?.onCallEnded('Connection lost');
            }
          }, 10_000);
        }
      } else if (state === 'failed') {
        this.callbacks?.onCallEnded('Connection failed');
      }
    };

    // Flush signals that arrived before the peer connection existed
    const early = this.pendingSignals.filter((s) => s.callId === callId);
    this.pendingSignals = [];
    for (const signal of early) this.handleSignal(signal);

    return pc;
  }

  private emitRemoteStream(): void {
    const tracks = Array.from(this.remoteTracks.values()).filter((t) => t.readyState === 'live');
    const stream = new MediaStream(tracks);
    const hasLiveVideo = tracks.some((t) => t.kind === 'video' && !t.muted);
    this.callbacks?.onRemoteStream(stream, hasLiveVideo);
  }

  /** Puts the current local tracks on the fixed senders. */
  private async applyLocalTracks(): Promise<void> {
    const micTrack = this.micStream?.getAudioTracks()[0] ?? null;
    try {
      await this.audioSender?.replaceTrack(this.mixedAudioTrack ?? micTrack);
    } catch (err) {
      console.warn('[WebRtcService] Could not attach audio track:', err);
    }
    try {
      await this.videoSender?.replaceTrack(this.currentOutgoingVideoTrack());
    } catch (err) {
      console.warn('[WebRtcService] Could not attach video track:', err);
    }
  }

  private currentOutgoingVideoTrack(): MediaStreamTrack | null {
    const screenTrack = this.screenStream?.getVideoTracks()[0];
    if (screenTrack && screenTrack.readyState === 'live') return screenTrack;
    return this.cameraTrack && this.cameraEnabled ? this.cameraTrack : null;
  }

  // ==========================================
  // Signaling
  // ==========================================

  /** Serialises all incoming signals so offers/answers/candidates apply in order. */
  public handleSignal(signal: CallSignalInput): void {
    if (!this.peerConnection || signal.callId !== this.callId) {
      // Not initialised yet (e.g. callee still acquiring media) — keep for later.
      if (this.pendingSignals.length < 200) this.pendingSignals.push(signal);
      return;
    }
    this.signalChain = this.signalChain
      .then(() => this.processSignal(signal))
      .catch((err) => console.warn('[WebRtcService] Signal handling error:', err));
  }

  private async processSignal(signal: CallSignalInput): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) return;

    if (signal.signalType === 'offer') {
      const offerCollision = this.makingOffer || pc.signalingState !== 'stable';
      if (offerCollision && !this.isPolite) return; // impolite peer ignores the colliding offer

      if (offerCollision) {
        await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(signal.data));

      if (!this.audioSender || !this.videoSender) {
        // Callee: adopt the caller's transceivers and make them bidirectional
        for (const tx of pc.getTransceivers()) {
          const kind = tx.receiver.track?.kind;
          if (kind === 'audio' && !this.audioSender) {
            tx.direction = 'sendrecv';
            this.audioSender = tx.sender;
          } else if (kind === 'video' && !this.videoSender) {
            tx.direction = 'sendrecv';
            this.videoSender = tx.sender;
          }
        }
        await this.applyLocalTracks();
      }

      await this.flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.sendSignal('answer', pc.localDescription?.toJSON() ?? answer);
    } else if (signal.signalType === 'answer') {
      if (pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal.data));
      await this.flushCandidates();
    } else if (signal.signalType === 'ice-candidate') {
      if (!signal.data) return;
      if (!pc.remoteDescription) {
        this.pendingCandidates.push(signal.data);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.data));
      } catch (err) {
        console.warn('[WebRtcService] Failed to add ICE candidate:', err);
      }
    }
  }

  private async flushCandidates(): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn('[WebRtcService] Failed to add queued ICE candidate:', err);
      }
    }
  }

  private async sendSignal(signalType: 'offer' | 'answer', data: unknown): Promise<void> {
    if (!this.callId || !this.targetDeviceId) return;
    await window.api.sendCallSignal({
      callId: this.callId,
      targetDeviceId: this.targetDeviceId,
      signalType,
      data,
    });
  }

  public async createOffer(): Promise<void> {
    const pc = this.peerConnection;
    if (!pc) throw new Error('PeerConnection not initialized');
    try {
      this.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.sendSignal('offer', pc.localDescription?.toJSON() ?? offer);
    } finally {
      this.makingOffer = false;
    }
  }

  // ==========================================
  // Screen sharing
  // ==========================================

  public isSharingScreen(): boolean {
    return Boolean(this.screenStream?.getVideoTracks()[0]?.readyState === 'live');
  }

  /** Starts (or switches) screen sharing by swapping the outgoing video track. */
  public async startScreenShare(desktopSourceId: string, options?: Partial<ScreenShareOptions>): Promise<MediaStream> {
    const newStream = await this.acquireScreen(desktopSourceId, options);
    const newTrack = newStream.getVideoTracks()[0]!;

    newTrack.onended = () => {
      // User closed the window being shared or revoked capture at OS level
      if (this.screenStream === newStream) this.callbacks?.onScreenShareEnded?.();
    };

    const previous = this.screenStream;
    this.screenStream = newStream;

    if (this.videoSender) {
      await this.videoSender.replaceTrack(newTrack);
      await this.tuneScreenEncoding(options);
    }

    // Mix system audio with the microphone if it was captured
    const systemAudio = newStream.getAudioTracks()[0];
    this.teardownAudioMix();
    if (systemAudio) {
      this.setupAudioMix(systemAudio);
      await this.audioSender?.replaceTrack(this.mixedAudioTrack ?? this.micStream?.getAudioTracks()[0] ?? null);
    } else if (this.audioSender) {
      await this.audioSender.replaceTrack(this.micStream?.getAudioTracks()[0] ?? null);
    }

    previous?.getTracks().forEach((t) => t.stop());
    return newStream;
  }

  private async tuneScreenEncoding(options?: Partial<ScreenShareOptions>): Promise<void> {
    if (!this.videoSender) return;
    try {
      const params = this.videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      const preset = options?.preset || 'balanced';
      params.encodings[0]!.maxBitrate = preset === 'smooth' ? 6_000_000 : preset === 'crisp' ? 4_000_000 : 3_500_000;
      (params as any).degradationPreference = preset === 'smooth' ? 'maintain-framerate' : 'maintain-resolution';
      await this.videoSender.setParameters(params);
    } catch (err) {
      console.warn('[WebRtcService] Could not tune screen encoding:', err);
    }
  }

  private setupAudioMix(systemAudio: MediaStreamTrack): void {
    try {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([systemAudio])).connect(dest);
      const mic = this.micStream?.getAudioTracks()[0];
      if (mic) ctx.createMediaStreamSource(new MediaStream([mic])).connect(dest);
      this.audioMixContext = ctx;
      this.mixedAudioTrack = dest.stream.getAudioTracks()[0] ?? null;
    } catch (err) {
      console.warn('[WebRtcService] Could not mix system audio:', err);
      this.teardownAudioMix();
    }
  }

  private teardownAudioMix(): void {
    this.mixedAudioTrack?.stop();
    this.mixedAudioTrack = null;
    this.audioMixContext?.close().catch(() => {});
    this.audioMixContext = null;
  }

  /** Stops screen sharing and puts the camera (if any and enabled) back on the wire. */
  public async stopScreenShare(): Promise<void> {
    const stream = this.screenStream;
    this.screenStream = null;
    this.teardownAudioMix();
    await this.applyLocalTracks();
    if (this.videoSender) {
      try {
        const params = this.videoSender.getParameters();
        if (params.encodings?.[0]) {
          delete params.encodings[0].maxBitrate;
          await this.videoSender.setParameters(params);
        }
      } catch {
        // ignore
      }
    }
    stream?.getTracks().forEach((t) => t.stop());
  }

  // ==========================================
  // Controls & accessors
  // ==========================================

  /** Stream to show in the local preview tile (screen while sharing, otherwise camera). */
  public getLocalPreviewStream(): MediaStream | null {
    const screenTrack = this.screenStream?.getVideoTracks()[0];
    if (screenTrack && screenTrack.readyState === 'live') return new MediaStream([screenTrack]);
    if (this.cameraTrack && this.cameraEnabled) return new MediaStream([this.cameraTrack]);
    return null;
  }

  public hasCamera(): boolean {
    return Boolean(this.cameraTrack);
  }

  public hasMicrophone(): boolean {
    return Boolean(this.micStream?.getAudioTracks()[0]);
  }

  public toggleAudio(enabled: boolean): void {
    this.micStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
  }

  /** Turns the camera on/off. Turning it on in a voice call acquires the camera. */
  public async setCameraEnabled(enabled: boolean): Promise<boolean> {
    this.cameraEnabled = enabled;
    if (enabled && !this.cameraTrack) {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        this.cameraTrack = cam.getVideoTracks()[0] ?? null;
      } catch (err) {
        this.cameraEnabled = false;
        throw new Error(describeMediaError(err, 'camera'));
      }
    }
    if (this.cameraTrack) this.cameraTrack.enabled = enabled;
    if (!this.isSharingScreen()) {
      await this.videoSender?.replaceTrack(this.currentOutgoingVideoTrack());
    }
    return this.cameraEnabled && Boolean(this.cameraTrack);
  }

  public async getCallStats(): Promise<CallStats | null> {
    if (!this.peerConnection) return null;
    try {
      const statsReport = await this.peerConnection.getStats();
      const stats = this.statsMonitor.parseStatsReport(statsReport);
      if (stats.outbound) stats.outbound.isScreen = this.isSharingScreen();
      return stats;
    } catch {
      return null;
    }
  }

  private stopLocalMedia(): void {
    this.teardownAudioMix();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  private closePeerOnly(): void {
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.audioSender = null;
    this.videoSender = null;
    this.remoteTracks.clear();
    this.pendingCandidates = [];
    this.signalChain = Promise.resolve();
  }

  public close(): void {
    this.closePeerOnly();
    this.stopLocalMedia();
    this.pendingSignals = [];
    this.callId = null;
    this.targetDeviceId = null;
    this.callbacks = null;
    this.statsMonitor.reset();
  }
}

export const webrtcService = new WebRtcService();
