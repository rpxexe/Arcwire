import { create } from 'zustand';
import {
  CallItem,
  CallType,
  CallStatus,
  DesktopSourceItem,
  DeviceInfo,
  CallSignalInput,
} from '@ipm/shared';
import { webrtcService } from '../services/webrtcService';
import { useDeviceStore } from './deviceStore';

interface CallState {
  activeCall: CallItem | null;
  incomingCall: CallItem | null;
  callStatus: 'idle' | 'ringing' | 'connected' | 'ended';
  callType: CallType;
  durationSeconds: number;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
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
  startScreenSharing: (sourceId: string) => Promise<void>;
  stopScreenSharing: () => Promise<void>;
  fetchDesktopSources: () => Promise<void>;
  fetchCallHistory: (conversationId?: string) => Promise<void>;
  initListeners: () => () => void;
}

let timerInterval: NodeJS.Timeout | null = null;

export const useCallStore = create<CallState>((set, get) => ({
  activeCall: null,
  incomingCall: null,
  callStatus: 'idle',
  callType: 'voice',
  durationSeconds: 0,
  isMuted: false,
  isVideoEnabled: true,
  isScreenSharing: false,
  localStream: null,
  remoteStream: null,
  desktopSources: [],
  callHistory: [],
  isLoading: false,
  error: null,

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
          }
        },
        onCallEnded: () => {
          get().endActiveCall();
        },
      });

      // Start local audio/video/screen capture
      const stream = await webrtcService.startLocalStream(callType, desktopSourceId);

      set({
        activeCall: call,
        callStatus: 'ringing',
        callType,
        localStream: stream,
        durationSeconds: 0,
        isMuted: false,
        isVideoEnabled: callType !== 'voice',
        isScreenSharing: callType === 'screen',
        isLoading: false,
      });
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to initiate call' });
      webrtcService.close();
    }
  },

  acceptIncomingCall: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    try {
      if (!window.api?.acceptCall) throw new Error('Accept call API not available');
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
          }
        },
        onCallEnded: () => {
          get().endActiveCall();
        },
      });

      const stream = await webrtcService.startLocalStream(incomingCall.callType);

      set({
        activeCall: incomingCall,
        incomingCall: null,
        callStatus: 'ringing',
        callType: incomingCall.callType,
        localStream: stream,
        durationSeconds: 0,
        isMuted: false,
        isVideoEnabled: incomingCall.callType !== 'voice',
        isScreenSharing: incomingCall.callType === 'screen',
      });
    } catch (err: any) {
      set({ error: err.message || 'Failed to accept incoming call' });
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
    }
  },

  endActiveCall: async () => {
    const { activeCall } = get();

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    try {
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

  startScreenSharing: async (sourceId: string) => {
    try {
      const stream = await webrtcService.startLocalStream('screen', sourceId);
      set({
        localStream: stream,
        isScreenSharing: true,
        callType: 'screen',
      });
      // Renegotiate with peer
      await webrtcService.createOffer();
    } catch (err: any) {
      set({ error: err.message || 'Failed to start screen sharing' });
    }
  },

  stopScreenSharing: async () => {
    try {
      const stream = await webrtcService.startLocalStream('video');
      set({
        localStream: stream,
        isScreenSharing: false,
        callType: 'video',
      });
      // Renegotiate with peer
      await webrtcService.createOffer();
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

    get().fetchCallHistory();

    return () => {
      unsubIncoming?.();
      unsubAccepted?.();
      unsubRejected?.();
      unsubEnded?.();
      unsubSignal?.();
    };
  },
}));
