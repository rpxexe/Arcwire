import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  ChatMessagePayloadSchema,
  ChatMessagePayload,
  MessageItem,
} from '@ipm/shared';
import { MessageRepository, ConversationRepository } from '@ipm/database';
import { TransportAdapter } from '@ipm/networking';
import { OfflineMessageQueue } from '../offline-queue/OfflineMessageQueue';
import { ReceiptTracker } from '../receipts/ReceiptTracker';

export class DirectMessagePipeline extends EventEmitter {
  private messageRepo: MessageRepository;
  private conversationRepo: ConversationRepository;
  private transport: TransportAdapter;
  private offlineQueue: OfflineMessageQueue;
  private receiptTracker: ReceiptTracker;
  private localDeviceId: string;

  constructor(
    messageRepo: MessageRepository,
    conversationRepo: ConversationRepository,
    transport: TransportAdapter,
    offlineQueue: OfflineMessageQueue,
    receiptTracker: ReceiptTracker,
    localDeviceId: string
  ) {
    super();
    this.messageRepo = messageRepo;
    this.conversationRepo = conversationRepo;
    this.transport = transport;
    this.offlineQueue = offlineQueue;
    this.receiptTracker = receiptTracker;
    this.localDeviceId = localDeviceId;
  }

  public async sendMessage(
    conversationId: string,
    peerDeviceId: string,
    content: string,
    contentType: 'text' | 'file' | 'system' = 'text',
    isEncrypted: boolean = false,
    replyToId?: string | null
  ): Promise<MessageItem> {
    const messageId = crypto.randomUUID();
    const now = Date.now();
    const sequence = this.messageRepo.getNextSequence(conversationId);

    const message: MessageItem = {
      id: messageId,
      conversationId,
      senderId: this.localDeviceId,
      sequence,
      content,
      contentType,
      deliveryStatus: 'pending',
      sentAt: now,
      deliveredAt: null,
      readAt: null,
      isEncrypted,
      replyToId: replyToId ?? null,
    };

    // 1. Commit to local SQLite
    this.messageRepo.insertMessage(message);
    this.conversationRepo.updateLastActivity(conversationId, messageId, now);

    // 2. Build network frame
    const payload: ChatMessagePayload = {
      messageId,
      content,
      contentType,
      isEncrypted,
      sentAt: now,
      replyToId: replyToId ?? undefined,
    };

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.CHAT_MESSAGE,
      senderId: this.localDeviceId,
      receiverId: peerDeviceId,
      conversationId,
      timestamp: now,
      sequence,
      payload,
    };

    // 3. Attempt direct network dispatch
    try {
      await this.transport.send(peerDeviceId, envelope);
      // Update status to 'sent' once sent to peer transport
      this.messageRepo.updateMessageStatus(messageId, 'sent');
      const latest = this.messageRepo.getMessageById(messageId);
      message.deliveryStatus = latest ? latest.deliveryStatus : 'sent';
    } catch {
      // Peer offline or socket unavailable -> queue for auto-retry
      this.offlineQueue.enqueue(peerDeviceId, envelope);
    }

    this.emit('messageSent', message);
    return message;
  }

  public async handleIncomingMessage(envelope: NetworkEnvelope): Promise<MessageItem | null> {
    try {
      const payload = ChatMessagePayloadSchema.parse(envelope.payload);
      const conversationId = envelope.conversationId;
      const senderDeviceId = envelope.senderId;
      const now = Date.now();

      // Ensure direct conversation exists in database
      this.conversationRepo.getOrCreateDirectConversation(this.localDeviceId, senderDeviceId);

      // Deduplication check
      const isNew = this.messageRepo.insertMessage({
        id: payload.messageId,
        conversationId,
        senderId: senderDeviceId,
        sequence: envelope.sequence,
        content: payload.content,
        contentType: payload.contentType,
        deliveryStatus: 'delivered',
        sentAt: payload.sentAt,
        deliveredAt: now,
        readAt: null,
        isEncrypted: payload.isEncrypted,
      });

      // Always acknowledge delivery back to sender so sender marks 'delivered'
      await this.receiptTracker.sendReceipt(senderDeviceId, conversationId, payload.messageId, 'delivered');

      if (!isNew) {
        // Message was already processed (duplicate frame received), do not re-emit
        return null;
      }

      this.conversationRepo.updateLastActivity(conversationId, payload.messageId, now);

      const message = this.messageRepo.getMessageById(payload.messageId);
      if (message) {
        this.emit('messageReceived', message);
      }
      return message;
    } catch (err) {
      console.error('[DirectMessagePipeline] Error processing incoming chat message:', err);
      return null;
    }
  }

  public async markConversationRead(conversationId: string, peerDeviceId: string): Promise<void> {
    const now = Date.now();
    const readIds = this.messageRepo.markMessagesAsRead(conversationId, this.localDeviceId, now);

    for (const msgId of readIds) {
      await this.receiptTracker.sendReceipt(peerDeviceId, conversationId, msgId, 'read');
    }
  }
}
