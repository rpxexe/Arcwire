import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  MessageItem,
  ReceiptEventData,
  TypingEventData,
  GroupCreatePayload,
  GroupHostMigratedPayload,
} from '@ipm/shared';
import {
  MessageRepository,
  ConversationRepository,
  GroupRepository,
  DatabaseService,
} from '@ipm/database';
import { TransportAdapter } from '@ipm/networking';
import { OfflineMessageQueue } from './offline-queue/OfflineMessageQueue';
import { ReceiptTracker } from './receipts/ReceiptTracker';
import { TypingManager } from './typing/TypingManager';
import { DirectMessagePipeline } from './direct/DirectMessagePipeline';
import { GroupCoordinator } from './group/GroupCoordinator';

export interface MessagingServiceOptions {
  localDeviceId: string;
  dbService: DatabaseService;
  transport: TransportAdapter;
}

export class MessagingService extends EventEmitter {
  private localDeviceId: string;
  private messageRepo: MessageRepository;
  private conversationRepo: ConversationRepository;
  private groupRepo: GroupRepository;
  private transport: TransportAdapter;

  private offlineQueue: OfflineMessageQueue;
  private receiptTracker: ReceiptTracker;
  private typingManager: TypingManager;
  private directPipeline: DirectMessagePipeline;
  private groupCoordinator: GroupCoordinator;

  constructor(options: MessagingServiceOptions) {
    super();
    this.localDeviceId = options.localDeviceId;
    this.transport = options.transport;

    this.messageRepo = new MessageRepository(options.dbService);
    this.conversationRepo = new ConversationRepository(options.dbService);
    this.groupRepo = new GroupRepository(options.dbService);

    this.offlineQueue = new OfflineMessageQueue(this.transport);
    this.receiptTracker = new ReceiptTracker(this.messageRepo, this.transport, this.localDeviceId);
    this.typingManager = new TypingManager(this.transport, this.localDeviceId);

    this.directPipeline = new DirectMessagePipeline(
      this.messageRepo,
      this.conversationRepo,
      this.transport,
      this.offlineQueue,
      this.receiptTracker,
      this.localDeviceId
    );

    this.groupCoordinator = new GroupCoordinator(
      this.groupRepo,
      this.messageRepo,
      this.conversationRepo,
      this.transport,
      this.localDeviceId
    );

    this.setupTransportListeners();
    this.setupPipelineEvents();
  }

  private setupTransportListeners(): void {
    // 1. Inbound network envelope routing
    this.transport.onMessage((envelope: NetworkEnvelope) => {
      this.handleIncomingEnvelope(envelope).catch((err) => {
        console.error('[MessagingService] Error handling envelope:', err);
      });
    });

    // 2. Peer connected -> Auto-flush offline queue
    if ('on' in this.transport && typeof (this.transport as any).on === 'function') {
      (this.transport as any).on('peerConnected', (peerId: string) => {
        this.offlineQueue.flushPeer(peerId).catch(() => {});
      });
    }
  }

  private setupPipelineEvents(): void {
    this.directPipeline.on('messageReceived', (msg: MessageItem) => {
      this.emit('messageReceived', msg);
    });

    this.directPipeline.on('messageSent', (msg: MessageItem) => {
      this.emit('messageSent', msg);
    });

    // Single tick: message reached the peer (immediately or after a queued retry)
    this.directPipeline.on('statusChanged', (receipt: ReceiptEventData) => {
      this.emit('receipt', receipt);
    });

    this.offlineQueue.on('flushed', (_peerId: string, envelope: NetworkEnvelope) => {
      if (envelope.type === IpmEventType.CHAT_MESSAGE) {
        const messageId = (envelope.payload as { messageId?: string })?.messageId;
        if (messageId) this.directPipeline.markSent(messageId, envelope.conversationId);
      }
    });

    this.groupCoordinator.on('messageReceived', (msg: MessageItem) => {
      this.emit('messageReceived', msg);
    });

    this.groupCoordinator.on('messageSent', (msg: MessageItem) => {
      this.emit('messageSent', msg);
    });

    this.receiptTracker.on('receipt', (receipt: ReceiptEventData) => {
      this.emit('receipt', receipt);
    });

    this.typingManager.on('typing', (typing: TypingEventData) => {
      this.emit('typing', typing);
    });

    this.groupCoordinator.on('groupCreated', (group: GroupCreatePayload) => {
      this.emit('groupCreated', group);
    });

    this.groupCoordinator.on('hostMigrated', (migration: GroupHostMigratedPayload) => {
      this.emit('hostMigrated', migration);
    });
  }

  public async handleIncomingEnvelope(envelope: NetworkEnvelope): Promise<void> {
    switch (envelope.type) {
      case IpmEventType.CHAT_MESSAGE:
        await this.directPipeline.handleIncomingMessage(envelope);
        break;

      case IpmEventType.MESSAGE_ACK:
      case IpmEventType.MESSAGE_DELIVERED:
      case IpmEventType.MESSAGE_READ:
        this.receiptTracker.handleIncomingReceipt(envelope);
        break;

      case IpmEventType.TYPING_INDICATOR:
        this.typingManager.handleIncomingTyping(envelope);
        break;

      case IpmEventType.GROUP_CREATE:
        this.groupCoordinator.handleIncomingGroupCreate(envelope);
        break;

      case IpmEventType.GROUP_MESSAGE:
        await this.groupCoordinator.handleIncomingGroupMessage(envelope);
        break;

      case IpmEventType.GROUP_HOST_MIGRATED:
        this.groupCoordinator.handleIncomingHostMigrated(envelope);
        break;

      case IpmEventType.MESSAGE_DELETE:
      case IpmEventType.MESSAGE_EDIT:
      case IpmEventType.MESSAGE_REACTION:
        this.handleIncomingMessageAction(envelope);
        break;

      default:
        // Ignore unhandled non-messaging frames
        break;
    }
  }

  public async sendDirectMessage(
    conversationId: string,
    peerDeviceId: string,
    content: string,
    contentType: 'text' | 'file' | 'system' = 'text',
    isEncrypted: boolean = false,
    replyToId?: string | null
  ): Promise<MessageItem> {
    return this.directPipeline.sendMessage(conversationId, peerDeviceId, content, contentType, isEncrypted, replyToId);
  }

  public async sendFanoutMessage(
    conversationId: string,
    peerDeviceIds: string[],
    content: string,
    contentType: 'text' | 'file' | 'system' = 'text',
    isEncrypted: boolean = false,
    replyToId?: string | null
  ): Promise<MessageItem> {
    return this.directPipeline.sendFanoutMessage(conversationId, peerDeviceIds, content, contentType, isEncrypted, replyToId);
  }

  // ==========================================
  // Message actions synced across members
  // ==========================================

  private getPeers(conversationId: string): string[] {
    return this.conversationRepo
      .getConversationMembers(conversationId)
      .filter((id) => id && id !== this.localDeviceId);
  }

  private async broadcastAction(
    conversationId: string,
    type: IpmEventType,
    payload: Record<string, unknown>
  ): Promise<void> {
    const peers = this.getPeers(conversationId);
    await Promise.all(
      peers.map(async (peerId) => {
        const envelope: NetworkEnvelope = {
          protocol: IPM_PROTOCOL,
          id: randomUUID(),
          type,
          senderId: this.localDeviceId,
          receiverId: peerId,
          conversationId,
          timestamp: Date.now(),
          sequence: 0,
          payload,
        };
        try {
          await this.transport.send(peerId, envelope);
        } catch {
          this.offlineQueue.enqueue(peerId, envelope);
        }
      })
    );
  }

  /** Deletes a message. `forEveryone` is only honoured for messages this device sent. */
  public async deleteMessage(messageId: string, forEveryone: boolean): Promise<MessageItem | null> {
    const msg = this.messageRepo.getMessageById(messageId);
    if (!msg) return null;

    if (forEveryone) {
      if (msg.senderId !== this.localDeviceId) {
        throw new Error('You can only delete your own messages for everyone');
      }
      const updated = this.messageRepo.markMessageDeleted(messageId);
      await this.broadcastAction(msg.conversationId, IpmEventType.MESSAGE_DELETE, { messageId });
      return updated;
    }

    this.messageRepo.deleteMessageLocally(messageId);
    return null;
  }

  public async editMessage(messageId: string, content: string): Promise<MessageItem> {
    const msg = this.messageRepo.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    if (msg.senderId !== this.localDeviceId) throw new Error('You can only edit your own messages');
    if (msg.contentType !== 'text') throw new Error('Only text messages can be edited');
    const editedAt = Date.now();
    const updated = this.messageRepo.editMessageContent(messageId, content, editedAt);
    if (!updated) throw new Error('Message not found');
    await this.broadcastAction(msg.conversationId, IpmEventType.MESSAGE_EDIT, { messageId, content, editedAt });
    return updated;
  }

  public async reactToMessage(messageId: string, emoji: string): Promise<MessageItem> {
    const msg = this.messageRepo.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    const wasActive = (msg.reactions?.[emoji] ?? []).includes(this.localDeviceId);
    const updated = this.messageRepo.toggleReaction(messageId, this.localDeviceId, emoji, !wasActive);
    if (!updated) throw new Error('Message not found');
    await this.broadcastAction(msg.conversationId, IpmEventType.MESSAGE_REACTION, {
      messageId,
      emoji,
      active: !wasActive,
    });
    return updated;
  }

  private handleIncomingMessageAction(envelope: NetworkEnvelope): void {
    const payload = envelope.payload as {
      messageId?: string;
      content?: string;
      editedAt?: number;
      emoji?: string;
      active?: boolean;
    };
    if (!payload?.messageId) return;
    const msg = this.messageRepo.getMessageById(payload.messageId);
    if (!msg) return;

    let updated: MessageItem | null = null;
    switch (envelope.type) {
      case IpmEventType.MESSAGE_DELETE:
        if (msg.senderId !== envelope.senderId) return; // only the author may delete for everyone
        updated = this.messageRepo.markMessageDeleted(msg.id);
        break;
      case IpmEventType.MESSAGE_EDIT:
        if (msg.senderId !== envelope.senderId || typeof payload.content !== 'string') return;
        updated = this.messageRepo.editMessageContent(msg.id, payload.content.slice(0, 20000), payload.editedAt ?? Date.now());
        break;
      case IpmEventType.MESSAGE_REACTION:
        if (typeof payload.emoji !== 'string' || payload.emoji.length > 16) return;
        updated = this.messageRepo.toggleReaction(msg.id, envelope.senderId, payload.emoji, payload.active);
        break;
    }

    if (updated) {
      this.emit('messageUpdated', updated);
    }
  }

  public async sendGroupMessage(
    groupId: string,
    content: string,
    contentType: 'text' | 'file' | 'system' = 'text',
    replyToId?: string | null
  ): Promise<MessageItem> {
    return this.groupCoordinator.sendGroupMessage(groupId, content, contentType, replyToId);
  }

  public async createGroup(
    name: string,
    description: string | undefined,
    memberDeviceIds: string[]
  ): Promise<string> {
    return this.groupCoordinator.createGroup(name, description, memberDeviceIds);
  }

  public async markConversationRead(conversationId: string, peerDeviceId?: string): Promise<void> {
    if (peerDeviceId) {
      await this.directPipeline.markConversationRead(conversationId, peerDeviceId);
    } else {
      const members = this.conversationRepo.getConversationMembers(conversationId);
      const peer = members.find((id) => id !== this.localDeviceId);
      if (peer) {
        await this.directPipeline.markConversationRead(conversationId, peer);
      } else {
        this.messageRepo.markMessagesAsRead(conversationId, this.localDeviceId);
      }
    }
  }

  public async sendTyping(conversationId: string, isTyping: boolean, targetPeerIds?: string[]): Promise<void> {
    let peers = targetPeerIds;
    if (!peers || peers.length === 0) {
      peers = this.conversationRepo.getConversationMembers(conversationId).filter((id) => id !== this.localDeviceId);
    }
    if (peers.length > 0) {
      await this.typingManager.sendTyping(peers, conversationId, isTyping);
    }
  }

  public getMessageRepo(): MessageRepository {
    return this.messageRepo;
  }

  public getConversationRepo(): ConversationRepository {
    return this.conversationRepo;
  }

  public getGroupRepo(): GroupRepository {
    return this.groupRepo;
  }

  public getOfflineQueue(): OfflineMessageQueue {
    return this.offlineQueue;
  }

  public destroy(): void {
    this.offlineQueue.destroy();
    this.typingManager.destroy();
    this.groupCoordinator.destroy();
  }
}
