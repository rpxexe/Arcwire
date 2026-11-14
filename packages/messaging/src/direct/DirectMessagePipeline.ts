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

    // 3. Dispatch in the background so the UI never waits for a TCP connect/timeout.
    //    Status changes are reported via the 'statusChanged' event.
    this.emit('messageSent', message);
    void this.dispatch(peerDeviceId, envelope, messageId, conversationId);
    return message;
  }

  /**
   * Sends one message to several peers (used for private conversations with more than
   * two members). The message is stored once locally and the same id is used for all peers.
   */
  public async sendFanoutMessage(
    conversationId: string,
    peerDeviceIds: string[],
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

    this.messageRepo.insertMessage(message);
    this.conversationRepo.updateLastActivity(conversationId, messageId, now);

    const payload: ChatMessagePayload = {
      messageId,
      content,
      contentType,
      isEncrypted,
      sentAt: now,
      replyToId: replyToId ?? undefined,
    };

    this.emit('messageSent', message);
    for (const peerDeviceId of peerDeviceIds) {
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
      void this.dispatch(peerDeviceId, envelope, messageId, conversationId);
    }
    return message;
  }

  /** Sends one envelope; on success marks the message 'sent', otherwise queues it for retry. */
  private async dispatch(peerDeviceId: string, envelope: NetworkEnvelope, messageId: string, conversationId: string): Promise<void> {
    try {
      await this.transport.send(peerDeviceId, envelope);
      this.markSent(messageId, conversationId);
    } catch (err: any) {
      console.warn(
        `[DirectMessagePipeline] Peer ${peerDeviceId.slice(0, 12)} unreachable (${err?.message ?? err}). Message queued for retry.`
      );
      this.offlineQueue.enqueue(peerDeviceId, envelope);
    }
  }

  /** Called when a message reached the peer's transport (directly or via the offline queue). */
  public markSent(messageId: string, conversationId: string): void {
    const before = this.messageRepo.getMessageById(messageId)?.deliveryStatus;
    this.messageRepo.updateMessageStatus(messageId, 'sent');
    if (before === 'pending' || before === 'failed') {
      this.emit('statusChanged', { messageId, conversationId, receiptType: 'ack', timestamp: Date.now() });
    }
  }


  public async handleIncomingMessage(envelope: NetworkEnvelope): Promise<MessageItem | null> {
    try {
      const payload = ChatMessagePayloadSchema.parse(envelope.payload);
      const senderDeviceId = envelope.senderId;
      const now = Date.now();

      // Resolve the local conversation. Private conversations must already exist locally
      // (they are imported when an invitation is redeemed); anything else falls back to the
      // direct conversation with the sender so a mismatched ID never violates the FK.
      let conversationId = envelope.conversationId;
      if (!this.conversationRepo.conversationExists(conversationId)) {
        if (conversationId.startsWith('prv_')) {
          console.warn(`[DirectMessagePipeline] Dropping message for unknown private conversation ${conversationId}`);
          return null;
        }
        conversationId = this.conversationRepo.getOrCreateDirectConversation(this.localDeviceId, senderDeviceId).id;
      }

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
        replyToId: payload.replyToId ?? null,
      });

      // Always acknowledge delivery back to sender so sender marks 'delivered'
      // (uses the sender's conversation id so their UI can match the receipt).
      await this.receiptTracker.sendReceipt(senderDeviceId, envelope.conversationId, payload.messageId, 'delivered');

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
