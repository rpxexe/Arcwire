import { create } from 'zustand';
import {
  CallItem,
  CallType,
  CallSignalInput,
  DesktopSourceItem,
  ScreenShareOptions,
  ScreenSharePreset,
  CallStats,
} from '@ipm/shared';
import { webrtcService } from '../services/webrtcService';

export interface CallState {
  activeCall: CallItem | null;
  incomingCall: CallItem | null;
  callStatus: 'idle' | 'outgoing-ringing' | 'incoming-ringing' | 'connected' | 'ended';
  callType: CallType;
  durationSeconds: number;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isRemoteScreenSharing: boolean;
  sharedSourceName: string | null;
  remoteSourceName: string | null;
  screenPreset: ScreenSharePreset;
  isFitToWindow: boolean;
  stats: CallStats | null;
  isScreenPickerOpen: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  desktopSources: DesktopSourceItem[];
  callHistory: CallItem[];
  isLoading: boolean;
  error: string | null;

  startCall: (
    conversationId: string,
    receiverDeviceId: string,
    callType: CallType,
    desktopSourceId?: string
  ) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endActiveCall: () => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => void;
  startScreenSharing: (sourceId: string, options?: Partial<ScreenShareOptions>) => Promise<void>;
  switchScreenSource: (sourceId: string, options?: Partial<ScreenShareOptions>) => Promise<void>;
  stopScreenSharing: () => Promise<void>;
  setScreenPickerOpen: (open: boolean) => void;
  toggleFitToWindow: () => void;
  fetchDesktopSources: () => Promise<void>;
  fetchCallHistory: (conversationId?: string) => Promise<void>;
  initListeners: () => () => void;
}

let timerInterval: NodeJS.Timeout | null = null;
let statsInterval: NodeJS.Timeout | null = null;

export const useCallStore = create<CallState>((set, get) => ({
  activeCall: null,
  incomingCall: null,
  callStatus: 'idle',
  callType: 'voice',
  durationSeconds: 0,
  isMuted: false,
  isVideoEnabled: true,
  isScreenSharing: false,
  isRemoteScreenSharing: false,
  sharedSourceName: null,
  remoteSourceName: null,
  screenPreset: 'balanced',
  isFitToWindow: true,
  stats: null,
  isScreenPickerOpen: false,
  localStream: null,
  remoteStream: null,
  desktopSources: [],
  callHistory: [],
  isLoading: false,
  error: null,

  setScreenPickerOpen: (open: boolean) => set({ isScreenPickerOpen: open }),
  toggleFitToWindow: () => set((s) => ({ isFitToWindow: !s.isFitToWindow })),

  startCall: async (
    conversationId: string,
    receiverDeviceId: string,
    callType: CallType,
    desktopSourceId?: string
  ) => {
    set({ isLoading: true, error: null });
    try {
      if (!window.api?.initiateCall) throw new Error('Calling API not available');

      const call = await window.api.initiateCall({
        conversationId,
        receiverDeviceId,
        callType,
      });

      // Initialize WebRTC
      webrtcService.initialize(call.id, receiverDeviceId, {
        onRemoteStream: (stream) => {
          set({ remoteStream: stream });
        },
        onIceConnectionStateChange: (iceState) => {
          if (iceState === 'connected' || iceState === 'completed') {
            set({ callStatus: 'connected' });
            if (!timerInterval) {
              timerInterval = setInterval(() => {
                set((s) => ({ durationSeconds: s.durationSeconds + 1 }));
              }, 1000);
            }
            if (!statsInterval) {
              statsInterval = setInterval(async () => {
                const liveStats = await webrtcService.getCallStats();
                if (liveStats) set({ stats: liveStats });
              }, 2000);
            }
          }
        },
        onCallEnded: () => {
          get().endActiveCall();
        },
        onScreenShareEnded: () => {
          get().stopScreenSharing();
        },
      });

      // Acquire initial local media
      const stream = await webrtcService.startLocalStream(callType, desktopSourceId);

      set({
        activeCall: call,
        callStatus: 'outgoing-ringing',
        callType,
        localStream: stream,
        isScreenSharing: callType === 'screen',
        sharedSourceName: callType === 'screen' ? 'Primary Display' : null,
        durationSeconds: 0,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to initiate call', isLoading: false });
      webrtcService.close();
    }
  },

  acceptIncomingCall: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    set({ isLoading: true, error: null });
    try {
      if (!window.api?.acceptCall) throw new Error('Calling API not available');

      await window.api.acceptCall(incomingCall.id);

      // Initialize WebRTC
      webrtcService.initialize(incomingCall.id, incomingCall.callerDeviceId, {
        onRemoteStream: (stream) => {
          set({ remoteStream: stream });
        },
        onIceConnectionStateChange: (iceState) => {
          if (iceState === 'connected' || iceState === 'completed') {
            set({ callStatus: 'connected' });
            if (!timerInterval) {
              timerInterval = setInterval(() => {
                set((s) => ({ durationSeconds: s.durationSeconds + 1 }));
              }, 1000);
            }
            if (!statsInterval) {
              statsInterval = setInterval(async () => {
                const liveStats = await webrtcService.getCallStats();
                if (liveStats) set({ stats: liveStats });
              }, 2000);
            }
          }
        },
        onCallEnded: () => {
          get().endActiveCall();
        },
        onScreenShareEnded: () => {
          get().stopScreenSharing();
        },
      });

      // Acquire media based on call type
      const stream = await webrtcService.startLocalStream(incomingCall.callType);

      set({
        activeCall: incomingCall,
        incomingCall: null,
        callStatus: 'connected',
        callType: incomingCall.callType,
        localStream: stream,
        isRemoteScreenSharing: incomingCall.callType === 'screen',
        remoteSourceName: incomingCall.callType === 'screen' ? 'Remote Screen' : null,
        durationSeconds: 0,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to accept call', isLoading: false });
      webrtcService.close();
    }
  },

  rejectIncomingCall: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    try {
      if (window.api?.rejectCall) {
        await window.api.rejectCall(incomingCall.id);
      }
    } finally {
      set({ incomingCall: null });
      get().fetchCallHistory();
    }
  },

  endActiveCall: async () => {
    const { activeCall, isScreenSharing } = get();

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }

    try {
      if (activeCall && isScreenSharing && window.api?.stopScreenShare) {
        await window.api.stopScreenShare(activeCall.id);
      }
      if (activeCall && window.api?.endCall) {
        await window.api.endCall(activeCall.id);
      }
    } finally {
      webrtcService.close();
      set({
        activeCall: null,
        incomingCall: null,
        callStatus: 'idle',
        localStream: null,
        remoteStream: null,
        durationSeconds: 0,
        isMuted: false,
        isVideoEnabled: true,
        isScreenSharing: false,
        isRemoteScreenSharing: false,
        sharedSourceName: null,
        remoteSourceName: null,
        isScreenPickerOpen: false,
        stats: null,
      });
      get().fetchCallHistory();
    }
  },

  toggleMute: () => {
    const nextMuted = !get().isMuted;
    webrtcService.toggleAudio(!nextMuted);
    set({ isMuted: nextMuted });
  },

  toggleVideo: () => {
    const nextVideo = !get().isVideoEnabled;
    webrtcService.toggleVideo(nextVideo);
    set({ isVideoEnabled: nextVideo });
  },

  startScreenSharing: async (sourceId: string, options?: Partial<ScreenShareOptions>) => {
    const { activeCall, desktopSources } = get();
    try {
      const source = desktopSources.find((s) => s.id === sourceId);
      const sourceName = options?.sourceName || source?.name || 'Screen';
      const preset = options?.preset || 'balanced';

      const screenStream = await webrtcService.replaceVideoTrackWithScreen(sourceId, {
        sourceId,
        sourceName,
        preset,
        ...options,
      });

      if (activeCall && window.api?.startScreenShare) {
        await window.api.startScreenShare(activeCall.id, sourceName);
      }

      set({
        localStream: screenStream,
        isScreenSharing: true,
        sharedSourceName: sourceName,
        screenPreset: preset,
        callType: 'screen',
        isScreenPickerOpen: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to start screen sharing' });
    }
  },

  switchScreenSource: async (sourceId: string, options?: Partial<ScreenShareOptions>) => {
    const { activeCall, desktopSources } = get();
    try {
      const source = desktopSources.find((s) => s.id === sourceId);
      const sourceName = options?.sourceName || source?.name || 'Screen';

      const screenStream = await webrtcService.replaceVideoTrackWithScreen(sourceId, {
        sourceId,
        sourceName,
        ...options,
      });

      if (activeCall && window.api?.startScreenShare) {
        await window.api.startScreenShare(activeCall.id, sourceName);
      }

      set({
        localStream: screenStream,
        sharedSourceName: sourceName,
        isScreenPickerOpen: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to switch screen source' });
    }
  },

  stopScreenSharing: async () => {
    const { activeCall } = get();
    try {
      if (activeCall && window.api?.stopScreenShare) {
        await window.api.stopScreenShare(activeCall.id);
      }

      const restoredStream = await webrtcService.restoreCameraVideoTrack();

      set({
        localStream: restoredStream,
        isScreenSharing: false,
        sharedSourceName: null,
        callType: restoredStream ? 'video' : 'voice',
        isScreenPickerOpen: false,
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to stop screen sharing' });
    }
  },

  fetchDesktopSources: async () => {
    try {
      if (window.api?.getDesktopSources) {
        const sources = await window.api.getDesktopSources();
        set({ desktopSources: sources });
      }
    } catch (err: any) {
      console.warn('Failed to fetch desktop sources:', err);
    }
  },

  fetchCallHistory: async (conversationId?: string) => {
    try {
      if (window.api?.getCalls) {
        const history = await window.api.getCalls(conversationId);
        set({ callHistory: history });
      }
    } catch (err: any) {
      console.warn('Failed to fetch call history:', err);
    }
  },

  initListeners: () => {
    if (!window.api) return () => {};

    // 1. Incoming Call Prompt
    const unsubIncoming = window.api.onCallIncoming?.((call: CallItem) => {
      set({ incomingCall: call });
    });

    // 2. Call Accepted by Peer
    const unsubAccepted = window.api.onCallAccepted?.(async () => {
      set({ callStatus: 'connected' });
      if (!timerInterval) {
        timerInterval = setInterval(() => {
          set((s) => ({ durationSeconds: s.durationSeconds + 1 }));
        }, 1000);
      }
      if (!statsInterval) {
        statsInterval = setInterval(async () => {
          const liveStats = await webrtcService.getCallStats();
          if (liveStats) set({ stats: liveStats });
        }, 2000);
      }
      // Create and send SDP Offer
      await webrtcService.createOffer();
    });

    // 3. Call Rejected by Peer
    const unsubRejected = window.api.onCallRejected?.(() => {
      get().endActiveCall();
    });

    // 4. Call Ended by Peer
    const unsubEnded = window.api.onCallEnded?.(() => {
      get().endActiveCall();
    });

    // 5. Incoming WebRTC Signaling (Offer, Answer, ICE Candidates)
    const unsubSignal = window.api.onCallSignal?.(async (signal: CallSignalInput) => {
      if (signal.signalType === 'offer') {
        await webrtcService.handleOffer(signal.data);
      } else if (signal.signalType === 'answer') {
        await webrtcService.handleAnswer(signal.data);
      } else if (signal.signalType === 'ice-candidate') {
        await webrtcService.handleIceCandidate(signal.data);
      }
    });

    // 6. Remote Screen Share Started
    const unsubScreenStarted = window.api.onScreenShareStarted?.((data) => {
      set({
        isRemoteScreenSharing: true,
        remoteSourceName: data.sourceName || 'Remote Screen',
        callType: 'screen',
      });
    });

    // 7. Remote Screen Share Stopped
    const unsubScreenStopped = window.api.onScreenShareStopped?.(() => {
      set({
        isRemoteScreenSharing: false,
        remoteSourceName: null,
      });
    });

    get().fetchCallHistory();

    return () => {
      unsubIncoming?.();
      unsubAccepted?.();
      unsubRejected?.();
      unsubEnded?.();
      unsubSignal?.();
      unsubScreenStarted?.();
      unsubScreenStopped?.();
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
    };
  },
}));
