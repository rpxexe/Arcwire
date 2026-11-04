import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  MessageReceiptPayload,
  MessageReceiptPayloadSchema,
  ReceiptEventData,
} from '@ipm/shared';
import { MessageRepository } from '@ipm/database';
import { TransportAdapter } from '@ipm/networking';

export class ReceiptTracker extends EventEmitter {
  private messageRepo: MessageRepository;
  private transport: TransportAdapter;
  private localDeviceId: string;

  constructor(messageRepo: MessageRepository, transport: TransportAdapter, localDeviceId: string) {
    super();
    this.messageRepo = messageRepo;
    this.transport = transport;
    this.localDeviceId = localDeviceId;
  }

  public async sendReceipt(
    targetPeerId: string,
    conversationId: string,
    messageId: string,
    receiptType: 'ack' | 'delivered' | 'read'
  ): Promise<void> {
    const timestamp = Date.now();
    const payload: MessageReceiptPayload = {
      messageId,
      conversationId,
      receiptType,
      timestamp,
    };

    let eventType: IpmEventType;
    if (receiptType === 'ack') eventType = IpmEventType.MESSAGE_ACK;
    else if (receiptType === 'delivered') eventType = IpmEventType.MESSAGE_DELIVERED;
    else eventType = IpmEventType.MESSAGE_READ;

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: eventType,
      senderId: this.localDeviceId,
      receiverId: targetPeerId,
      conversationId,
      timestamp,
      sequence: 0,
      payload,
    };

    try {
      await this.transport.send(targetPeerId, envelope);
    } catch (err) {
      // Ignored for ephemeral receipts if peer unreachable
    }
  }

  public handleIncomingReceipt(envelope: NetworkEnvelope): ReceiptEventData | null {
    try {
      const payload = MessageReceiptPayloadSchema.parse(envelope.payload);
      const conversationId = payload.conversationId || envelope.conversationId;

      this.messageRepo.recordReceipt(
        payload.messageId,
        envelope.senderId,
        payload.receiptType,
        payload.timestamp
      );

      // Update message delivery status in SQLite
      if (payload.receiptType === 'delivered') {
        this.messageRepo.updateMessageStatus(payload.messageId, 'delivered', payload.timestamp);
      } else if (payload.receiptType === 'read') {
        this.messageRepo.updateMessageStatus(payload.messageId, 'read', undefined, payload.timestamp);
      } else if (payload.receiptType === 'ack') {
        this.messageRepo.updateMessageStatus(payload.messageId, 'sent');
      }

      const eventData: ReceiptEventData = {
        messageId: payload.messageId,
        conversationId,
        receiptType: payload.receiptType,
        timestamp: payload.timestamp,
      };

      this.emit('receipt', eventData);
      return eventData;
    } catch {
      return null;
    }
  }
}

