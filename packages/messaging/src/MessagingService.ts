import { EventEmitter } from 'node:events';
import {
  IpmEventType,
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

  public async sendGroupMessage(
    groupId: string,
    content: string,
    contentType: 'text' | 'file' | 'system' = 'text'
  ): Promise<MessageItem> {
    return this.groupCoordinator.sendGroupMessage(groupId, content, contentType);
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
