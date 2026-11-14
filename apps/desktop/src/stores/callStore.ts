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

export type CallStatus = 'idle' | 'outgoing-ringing' | 'incoming-ringing' | 'connecting' | 'connected' | 'ended';

interface PendingScreenCall {
  conversationId: string;
  receiverDeviceId: string;
}

export interface CallState {
  activeCall: CallItem | null;
  incomingCall: CallItem | null;
  callStatus: CallStatus;
  callType: CallType;
  durationSeconds: number;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  isRemoteScreenSharing: boolean;
  hasRemoteVideo: boolean;
  sharedSourceName: string | null;
  remoteSourceName: string | null;
  screenPreset: ScreenSharePreset;
  isFitToWindow: boolean;
  stats: CallStats | null;
  isScreenPickerOpen: boolean;
  /** Set when the user starts a "screen" call: the picker must choose a source first. */
  pendingScreenCall: PendingScreenCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  desktopSources: DesktopSourceItem[];
  callHistory: CallItem[];
  isLoading: boolean;
  error: string | null;
  warning: string | null;

  startCall: (
    conversationId: string,
    receiverDeviceId: string,
    callType: CallType,
    desktopSourceId?: string,
    screenOptions?: Partial<ScreenShareOptions>
  ) => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  rejectIncomingCall: () => Promise<void>;
  endActiveCall: (reason?: string) => Promise<void>;
  toggleMute: () => void;
  toggleVideo: () => Promise<void>;
  startScreenSharing: (sourceId: string, options?: Partial<ScreenShareOptions>) => Promise<void>;
  switchScreenSource: (sourceId: string, options?: Partial<ScreenShareOptions>) => Promise<void>;
  stopScreenSharing: () => Promise<void>;
  setScreenPickerOpen: (open: boolean) => void;
  cancelPendingScreenCall: () => void;
  toggleFitToWindow: () => void;
  fetchDesktopSources: () => Promise<void>;
  fetchCallHistory: (conversationId?: string) => Promise<void>;
  clearError: () => void;
  initListeners: () => () => void;
}

let timerInterval: ReturnType<typeof setInterval> | null = null;
let statsInterval: ReturnType<typeof setInterval> | null = null;
let isEnding = false;

const stopTimers = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
};

export const useCallStore = create<CallState>((set, get) => {
  const startTimers = () => {
    if (!timerInterval) {
      timerInterval = setInterval(() => {
        set((s) => ({ durationSeconds: s.durationSeconds + 1 }));
      }, 1000);
    }
    if (!statsInterval) {
      const poll = async () => {
        const liveStats = await webrtcService.getCallStats();
        if (liveStats) set({ stats: liveStats });
      };
      void poll();
      statsInterval = setInterval(poll, 1000);
    }
  };

  const refreshLocalPreview = () => set({ localStream: webrtcService.getLocalPreviewStream() });

  const buildCallbacks = () => ({
    onRemoteStream: (stream: MediaStream, hasLiveVideo: boolean) => {
      set({ remoteStream: stream, hasRemoteVideo: hasLiveVideo });
    },
    onIceConnectionStateChange: (iceState: RTCIceConnectionState) => {
      if (iceState === 'connected' || iceState === 'completed') {
        set({ callStatus: 'connected' });
        startTimers();
      }
    },
    onCallEnded: (reason: string) => {
      void get().endActiveCall(reason);
    },
    onScreenShareEnded: () => {
      void get().stopScreenSharing();
    },
  });

  return {
    activeCall: null,
    incomingCall: null,
    callStatus: 'idle',
    callType: 'voice',
    durationSeconds: 0,
    isMuted: false,
    isVideoEnabled: true,
    isScreenSharing: false,
    isRemoteScreenSharing: false,
    hasRemoteVideo: false,
    sharedSourceName: null,
    remoteSourceName: null,
    screenPreset: 'balanced',
    isFitToWindow: true,
    stats: null,
    isScreenPickerOpen: false,
    pendingScreenCall: null,
    localStream: null,
    remoteStream: null,
    desktopSources: [],
    callHistory: [],
    isLoading: false,
    error: null,
    warning: null,

    setScreenPickerOpen: (open: boolean) => set({ isScreenPickerOpen: open }),
    cancelPendingScreenCall: () => set({ pendingScreenCall: null, isScreenPickerOpen: false }),
    toggleFitToWindow: () => set((s) => ({ isFitToWindow: !s.isFitToWindow })),
    clearError: () => set({ error: null, warning: null }),

    startCall: async (conversationId, receiverDeviceId, callType, desktopSourceId, screenOptions) => {
      if (get().activeCall) {
        set({ error: 'You are already in a call.' });
        return;
      }

      // A screen call needs a source first: open the picker and come back here.
      if (callType === 'screen' && !desktopSourceId) {
        set({ pendingScreenCall: { conversationId, receiverDeviceId }, isScreenPickerOpen: true, error: null });
        return;
      }

      set({ isLoading: true, error: null, warning: null, pendingScreenCall: null, isScreenPickerOpen: false });
      try {
        if (!window.api?.initiateCall) throw new Error('Calling API not available');

        // 1. Acquire local media BEFORE ringing the peer, so permission errors surface early.
        const { warning } = await webrtcService.acquireLocalMedia(callType === 'video' ? 'video' : 'voice');

        // 2. Ring the peer
        const call = await window.api.initiateCall({ conversationId, receiverDeviceId, callType });

        // 3. Peer connection with fixed audio+video transceivers
        webrtcService.initialize(call.id, receiverDeviceId, true, buildCallbacks());

        let sharedSourceName: string | null = null;
        if (callType === 'screen' && desktopSourceId) {
          await webrtcService.startScreenShare(desktopSourceId, screenOptions);
          const source = get().desktopSources.find((s) => s.id === desktopSourceId);
          sharedSourceName = screenOptions?.sourceName || source?.name || 'Screen';
        }

        isEnding = false;
        set({
          activeCall: call,
          callStatus: 'outgoing-ringing',
          callType,
          localStream: webrtcService.getLocalPreviewStream(),
          remoteStream: null,
          hasRemoteVideo: false,
          isVideoEnabled: callType === 'video' && webrtcService.hasCamera(),
          isMuted: false,
          isScreenSharing: callType === 'screen',
          sharedSourceName,
          screenPreset: screenOptions?.preset || 'balanced',
          durationSeconds: 0,
          stats: null,
          isLoading: false,
          warning: warning ?? null,
        });
      } catch (err: any) {
        webrtcService.close();
        set({ error: err?.message || 'Failed to start the call', isLoading: false });
      }
    },

    acceptIncomingCall: async () => {
      const { incomingCall } = get();
      if (!incomingCall) return;

      set({ isLoading: true, error: null, warning: null });
      try {
        if (!window.api?.acceptCall) throw new Error('Calling API not available');

        // 1. Media first (callee may join receive-only if the mic is unavailable)
        const { warning } = await webrtcService.acquireLocalMedia(
          incomingCall.callType === 'video' ? 'video' : 'voice',
          { allowReceiveOnly: true }
        );

        // 2. Peer connection ready BEFORE telling the caller, so the offer can't be missed
        webrtcService.initialize(incomingCall.id, incomingCall.callerDeviceId, false, buildCallbacks());

        // 3. Accept → caller sends the SDP offer
        await window.api.acceptCall(incomingCall.id);

        isEnding = false;
        set({
          activeCall: incomingCall,
          incomingCall: null,
          callStatus: 'connecting',
          callType: incomingCall.callType,
          localStream: webrtcService.getLocalPreviewStream(),
          isVideoEnabled: incomingCall.callType === 'video' && webrtcService.hasCamera(),
          isMuted: !webrtcService.hasMicrophone(),
          isRemoteScreenSharing: incomingCall.callType === 'screen',
          remoteSourceName: incomingCall.callType === 'screen' ? 'Remote screen' : null,
          durationSeconds: 0,
          stats: null,
          isLoading: false,
          warning: warning ?? null,
        });
      } catch (err: any) {
        webrtcService.close();
        try {
          await window.api?.rejectCall?.(incomingCall.id);
        } catch {
          // ignore
        }
        set({ error: err?.message || 'Failed to accept call', isLoading: false, incomingCall: null });
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

    endActiveCall: async (reason?: string) => {
      if (isEnding) return;
      isEnding = true;
      const { activeCall, isScreenSharing } = get();
      stopTimers();

      try {
        if (activeCall && isScreenSharing && window.api?.stopScreenShare) {
          await window.api.stopScreenShare(activeCall.id).catch(() => {});
        }
        if (activeCall && window.api?.endCall) {
          await window.api.endCall(activeCall.id).catch(() => {});
        }
      } finally {
        webrtcService.close();
        set({
          activeCall: null,
          incomingCall: null,
          callStatus: 'idle',
          localStream: null,
          remoteStream: null,
          hasRemoteVideo: false,
          durationSeconds: 0,
          isMuted: false,
          isVideoEnabled: true,
          isScreenSharing: false,
          isRemoteScreenSharing: false,
          sharedSourceName: null,
          remoteSourceName: null,
          isScreenPickerOpen: false,
          pendingScreenCall: null,
          stats: null,
          warning: null,
          error: reason && reason !== 'hangup' ? `Call ended: ${reason}` : null,
        });
        get().fetchCallHistory();
        isEnding = false;
      }
    },

    toggleMute: () => {
      if (!webrtcService.hasMicrophone()) {
        set({ warning: 'No microphone is available for this call.' });
        return;
      }
      const nextMuted = !get().isMuted;
      webrtcService.toggleAudio(!nextMuted);
      set({ isMuted: nextMuted });
    },

    toggleVideo: async () => {
      const next = !get().isVideoEnabled;
      try {
        const enabled = await webrtcService.setCameraEnabled(next);
        set({ isVideoEnabled: enabled, callType: enabled && get().callType === 'voice' ? 'video' : get().callType });
        refreshLocalPreview();
      } catch (err: any) {
        set({ error: err?.message || 'Could not turn on the camera' });
      }
    },

    startScreenSharing: async (sourceId: string, options?: Partial<ScreenShareOptions>) => {
      const { activeCall, desktopSources } = get();
      if (!activeCall) return;
      try {
        const source = desktopSources.find((s) => s.id === sourceId);
        const sourceName = options?.sourceName || source?.name || 'Screen';
        const preset = options?.preset || 'balanced';

        await webrtcService.startScreenShare(sourceId, { sourceId, sourceName, preset, ...options });
        await window.api?.startScreenShare?.(activeCall.id, sourceName);

        set({
          localStream: webrtcService.getLocalPreviewStream(),
          isScreenSharing: true,
          sharedSourceName: sourceName,
          screenPreset: preset,
          isScreenPickerOpen: false,
        });
      } catch (err: any) {
        set({ error: err?.message || 'Failed to start screen sharing', isScreenPickerOpen: false });
      }
    },

    switchScreenSource: async (sourceId: string, options?: Partial<ScreenShareOptions>) => {
      const { activeCall, desktopSources } = get();
      if (!activeCall) return;
      try {
        const source = desktopSources.find((s) => s.id === sourceId);
        const sourceName = options?.sourceName || source?.name || 'Screen';
        await webrtcService.startScreenShare(sourceId, { sourceId, sourceName, ...options });
        await window.api?.startScreenShare?.(activeCall.id, sourceName);
        set({
          localStream: webrtcService.getLocalPreviewStream(),
          sharedSourceName: sourceName,
          screenPreset: options?.preset || get().screenPreset,
          isScreenPickerOpen: false,
        });
      } catch (err: any) {
        set({ error: err?.message || 'Failed to switch screen source', isScreenPickerOpen: false });
      }
    },

    stopScreenSharing: async () => {
      const { activeCall, isScreenSharing } = get();
      if (!isScreenSharing) return;
      try {
        await webrtcService.stopScreenShare();
        if (activeCall) await window.api?.stopScreenShare?.(activeCall.id);
      } catch (err: any) {
        set({ error: err?.message || 'Failed to stop screen sharing' });
      } finally {
        set((s) => ({
          localStream: webrtcService.getLocalPreviewStream(),
          isScreenSharing: false,
          sharedSourceName: null,
          isScreenPickerOpen: false,
          callType: s.callType === 'screen' ? (webrtcService.hasCamera() && s.isVideoEnabled ? 'video' : 'voice') : s.callType,
        }));
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
        set({ error: 'Could not list screens and windows to share.' });
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

      // 1. Incoming call — auto-decline when already busy
      const unsubIncoming = window.api.onCallIncoming?.((call: CallItem) => {
        if (get().activeCall || get().incomingCall) {
          window.api.rejectCall?.(call.id).catch(() => {});
          return;
        }
        set({ incomingCall: call });
      });

      // 2. Peer accepted → caller sends the offer
      const unsubAccepted = window.api.onCallAccepted?.(async (data) => {
        if (get().activeCall?.id !== data.callId) return;
        set({ callStatus: 'connecting' });
        try {
          await webrtcService.createOffer();
        } catch (err: any) {
          set({ error: err?.message || 'Failed to negotiate the call' });
        }
      });

      // 3. Peer rejected
      const unsubRejected = window.api.onCallRejected?.((data) => {
        if (get().incomingCall?.id === data.callId) {
          set({ incomingCall: null });
          return;
        }
        if (get().activeCall?.id === data.callId) void get().endActiveCall('declined');
      });

      // 4. Peer ended (also dismisses a ringing incoming prompt the caller cancelled)
      const unsubEnded = window.api.onCallEnded?.((data) => {
        if (get().incomingCall?.id === data.callId) {
          set({ incomingCall: null });
          get().fetchCallHistory();
          return;
        }
        if (get().activeCall?.id === data.callId) void get().endActiveCall();
      });

      // 5. WebRTC signaling (queued inside the service until ready)
      const unsubSignal = window.api.onCallSignal?.((signal: CallSignalInput) => {
        webrtcService.handleSignal(signal);
      });

      // 6/7. Remote screen share state
      const unsubScreenStarted = window.api.onScreenShareStarted?.((data) => {
        if (get().activeCall && get().activeCall?.id !== data.callId) return;
        set({ isRemoteScreenSharing: true, remoteSourceName: data.sourceName || 'Remote screen' });
      });

      const unsubScreenStopped = window.api.onScreenShareStopped?.((data) => {
        if (get().activeCall && get().activeCall?.id !== data.callId) return;
        set({ isRemoteScreenSharing: false, remoteSourceName: null });
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
        stopTimers();
      };
    },
  };
});
