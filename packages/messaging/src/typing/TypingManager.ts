import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  TypingIndicatorPayloadSchema,
  TypingEventData,
} from '@ipm/shared';
import { TransportAdapter } from '@ipm/networking';

export class TypingManager extends EventEmitter {
  private transport: TransportAdapter;
  private localDeviceId: string;
  private lastSentTyping: Map<string, number> = new Map();
  private inboundTypingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(transport: TransportAdapter, localDeviceId: string) {
    super();
    this.transport = transport;
    this.localDeviceId = localDeviceId;
  }

  public async sendTyping(targetPeerIds: string[], conversationId: string, isTyping: boolean): Promise<void> {
    const now = Date.now();
    const lastSent = this.lastSentTyping.get(conversationId) ?? 0;

    // Throttle positive typing indicator to at most once every 2.5 seconds
    if (isTyping && now - lastSent < 2500) {
      return;
    }
    this.lastSentTyping.set(conversationId, now);

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.TYPING_INDICATOR,
      senderId: this.localDeviceId,
      receiverId: targetPeerIds.join(','),
      conversationId,
      timestamp: now,
      sequence: 0,
      payload: {
        conversationId,
        deviceId: this.localDeviceId,
        isTyping,
      },
    };

    for (const peerId of targetPeerIds) {
      try {
        await this.transport.send(peerId, envelope);
      } catch {
        // Ephemeral, safe to ignore
      }
    }
  }

  public handleIncomingTyping(envelope: NetworkEnvelope): TypingEventData | null {
    try {
      const payload = TypingIndicatorPayloadSchema.parse(envelope.payload);
      const timerKey = `${payload.conversationId}_${payload.deviceId}`;

      // Clear existing timer if any
      const existing = this.inboundTypingTimers.get(timerKey);
      if (existing) {
        clearTimeout(existing);
        this.inboundTypingTimers.delete(timerKey);
      }

      const eventData: TypingEventData = {
        conversationId: payload.conversationId,
        deviceId: payload.deviceId,
        isTyping: payload.isTyping,
      };

      this.emit('typing', eventData);

      if (payload.isTyping) {
        // Auto-reset after 5 seconds of inactivity
        const timer = setTimeout(() => {
          this.inboundTypingTimers.delete(timerKey);
          this.emit('typing', {
            conversationId: payload.conversationId,
            deviceId: payload.deviceId,
            isTyping: false,
          });
        }, 5000);
        this.inboundTypingTimers.set(timerKey, timer);
      }

      return eventData;
    } catch {
      return null;
    }
  }

  public destroy(): void {
    for (const timer of this.inboundTypingTimers.values()) {
      clearTimeout(timer);
    }
    this.inboundTypingTimers.clear();
    this.lastSentTyping.clear();
  }
}

