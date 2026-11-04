import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  CallType,
  CallSignalInput,
} from '@ipm/shared';
import type { LanTransportAdapter } from '@ipm/networking';

export interface SignalingEvents {
  callRequest: (data: { callId: string; conversationId: string; callerDeviceId: string; callType: CallType }) => void;
  callAccept: (data: { callId: string; responderDeviceId: string }) => void;
  callReject: (data: { callId: string; responderDeviceId: string }) => void;
  callEnd: (data: { callId: string; senderDeviceId: string; reason?: string }) => void;
  callSignal: (signal: CallSignalInput) => void;
}

export class WebRtcSignalingManager extends EventEmitter {
  constructor(
    private localDeviceId: string,
    private getLanAdapter: () => LanTransportAdapter | null
  ) {
    super();
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  /**
   * Dispatches a CALL_REQUEST to the peer device.
   */
  public async sendCallRequest(
    peerDeviceId: string,
    conversationId: string,
    callType: CallType,
    callId: string = crypto.randomUUID()
  ): Promise<string> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('LAN transport adapter not available for call signaling');

    await adapter.sendPayload(
      peerDeviceId,
      IpmEventType.CALL_REQUEST,
      {
        callId,
        conversationId,
        callerDeviceId: this.localDeviceId,
        callType,
      },
      conversationId
    );

    return callId;
  }

  /**
   * Accepts an incoming call.
   */
  public async sendCallAccept(peerDeviceId: string, callId: string, conversationId: string): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('LAN transport adapter not available for call signaling');

    await adapter.sendPayload(
      peerDeviceId,
      IpmEventType.CALL_ACCEPT,
      { callId, responderDeviceId: this.localDeviceId },
      conversationId
    );
  }

  /**
   * Rejects an incoming call.
   */
  public async sendCallReject(peerDeviceId: string, callId: string, conversationId: string): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('LAN transport adapter not available for call signaling');

    await adapter.sendPayload(
      peerDeviceId,
      IpmEventType.CALL_REJECT,
      { callId, responderDeviceId: this.localDeviceId },
      conversationId
    );
  }

  /**
   * Ends an active or ongoing call.
   */
  public async sendCallEnd(
    peerDeviceId: string,
    callId: string,
    conversationId: string,
    reason?: string
  ): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) return;

    await adapter.sendPayload(
      peerDeviceId,
      IpmEventType.CALL_END,
      { callId, senderDeviceId: this.localDeviceId, reason },
      conversationId
    );
  }

  /**
   * Transports WebRTC SDP offers/answers and ICE candidates over the authenticated LAN transport.
   */
  public async sendSignal(
    peerDeviceId: string,
    callId: string,
    signalType: 'offer' | 'answer' | 'ice-candidate',
    data: any,
    conversationId: string = 'global'
  ): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('LAN transport adapter not available for call signaling');

    await adapter.sendPayload(
      peerDeviceId,
      IpmEventType.CALL_SIGNAL,
      {
        callId,
        targetDeviceId: peerDeviceId,
        signalType,
        data,
      },
      conversationId
    );
  }

  /**
   * Routes incoming network envelopes to high-level call events.
   */
  public handleIncomingEnvelope(envelope: NetworkEnvelope): void {
    switch (envelope.type) {
      case IpmEventType.CALL_REQUEST: {
        const payload = envelope.payload as {
          callId: string;
          conversationId: string;
          callerDeviceId: string;
          callType: CallType;
        };
        this.emit('callRequest', payload);
        break;
      }

      case IpmEventType.CALL_ACCEPT: {
        const payload = envelope.payload as { callId: string; responderDeviceId: string };
        this.emit('callAccept', payload);
        break;
      }

      case IpmEventType.CALL_REJECT: {
        const payload = envelope.payload as { callId: string; responderDeviceId: string };
        this.emit('callReject', payload);
        break;
      }

      case IpmEventType.CALL_END: {
        const payload = envelope.payload as { callId: string; senderDeviceId: string; reason?: string };
        this.emit('callEnd', payload);
        break;
      }

      case IpmEventType.CALL_SIGNAL: {
        const payload = envelope.payload as CallSignalInput;
        this.emit('callSignal', payload);
        break;
      }

      default:
        break;
    }
  }
}

