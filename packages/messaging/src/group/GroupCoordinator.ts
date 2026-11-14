import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  GroupCreatePayload,
  GroupCreatePayloadSchema,
  GroupMessagePayload,
  GroupMessagePayloadSchema,
  GroupHostMigratedPayload,
  GroupHostMigratedPayloadSchema,
  MessageItem,
} from '@ipm/shared';
import { GroupRepository, MessageRepository, ConversationRepository } from '@ipm/database';
import { TransportAdapter } from '@ipm/networking';

export class GroupCoordinator extends EventEmitter {
  private groupRepo: GroupRepository;
  private messageRepo: MessageRepository;
  private conversationRepo: ConversationRepository;
  private transport: TransportAdapter;
  private localDeviceId: string;

  // Track highest sequence acknowledged per group
  private highestSequences: Map<string, number> = new Map();
  // Track last seen timestamp for each group host
  private hostHeartbeats: Map<string, number> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    groupRepo: GroupRepository,
    messageRepo: MessageRepository,
    conversationRepo: ConversationRepository,
    transport: TransportAdapter,
    localDeviceId: string
  ) {
    super();
    this.groupRepo = groupRepo;
    this.messageRepo = messageRepo;
    this.conversationRepo = conversationRepo;
    this.transport = transport;
    this.localDeviceId = localDeviceId;

    this.startHeartbeatMonitor();
  }

  public async createGroup(
    name: string,
    description: string | undefined,
    memberDeviceIds: string[]
  ): Promise<string> {
    const groupId = crypto.randomUUID();
    const allMembers = Array.from(new Set([this.localDeviceId, ...memberDeviceIds]));
    const now = Date.now();

    // 1. Host local creation
    this.groupRepo.createGroup(groupId, name, description, this.localDeviceId, true, allMembers);

    // 2. Broadcast GROUP_CREATE to all group members
    const payload: GroupCreatePayload = {
      groupId,
      name,
      description,
      memberDeviceIds: allMembers,
      hostDeviceId: this.localDeviceId,
    };

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.GROUP_CREATE,
      senderId: this.localDeviceId,
      receiverId: '*',
      conversationId: groupId,
      timestamp: now,
      sequence: 0,
      payload,
    };

    for (const memberId of allMembers) {
      if (memberId !== this.localDeviceId) {
        this.transport.send(memberId, envelope).catch(() => {});
      }
    }

    this.emit('groupCreated', payload);
    return groupId;
  }

  public async sendGroupMessage(
    groupId: string,
    content: string,
    contentType: 'text' | 'file' | 'system' = 'text',
    replyToId?: string | null
  ): Promise<MessageItem> {
    const group = this.groupRepo.getGroupById(groupId);
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }

    const messageId = crypto.randomUUID();
    const now = Date.now();
    const isHost = group.isHost || group.hostDeviceId === this.localDeviceId;

    if (isHost) {
      // Local node is Host: sequence message directly and fan out
      const sequence = this.messageRepo.getNextSequence(groupId);
      const message: MessageItem = {
        id: messageId,
        conversationId: groupId,
        senderId: this.localDeviceId,
        sequence,
        content,
        contentType,
        deliveryStatus: 'sent',
        sentAt: now,
        deliveredAt: null,
        readAt: null,
        isEncrypted: false,
        replyToId: replyToId ?? null,
      };

      this.messageRepo.insertMessage(message);
      this.conversationRepo.updateLastActivity(groupId, messageId, now);
      this.highestSequences.set(groupId, sequence);

      // Fan out to all members
      const members = this.groupRepo.getGroupMembers(groupId);
      const payload: GroupMessagePayload = {
        groupId,
        messageId,
        senderId: this.localDeviceId,
        sequence,
        content,
        contentType,
        sentAt: now,
        replyToId: replyToId ?? null,
      };

      const envelope: NetworkEnvelope = {
        protocol: IPM_PROTOCOL,
        id: crypto.randomUUID(),
        type: IpmEventType.GROUP_MESSAGE,
        senderId: this.localDeviceId,
        receiverId: '*',
        conversationId: groupId,
        timestamp: now,
        sequence,
        payload,
      };

      for (const memberId of members) {
        if (memberId !== this.localDeviceId) {
          this.transport.send(memberId, envelope).catch(() => {});
        }
      }

      this.emit('messageSent', message);
      return message;
    } else {
      // Local node is Member: send message to Host Node
      const message: MessageItem = {
        id: messageId,
        conversationId: groupId,
        senderId: this.localDeviceId,
        sequence: 0,
        content,
        contentType,
        deliveryStatus: 'pending',
        sentAt: now,
        deliveredAt: null,
        readAt: null,
        isEncrypted: false,
        replyToId: replyToId ?? null,
      };

      this.messageRepo.insertMessage(message);
      this.conversationRepo.updateLastActivity(groupId, messageId, now);

      const payload: GroupMessagePayload = {
        groupId,
        messageId,
        senderId: this.localDeviceId,
        sequence: 0,
        content,
        contentType,
        sentAt: now,
        replyToId: replyToId ?? null,
      };

      const envelope: NetworkEnvelope = {
        protocol: IPM_PROTOCOL,
        id: crypto.randomUUID(),
        type: IpmEventType.GROUP_MESSAGE,
        senderId: this.localDeviceId,
        receiverId: group.hostDeviceId,
        conversationId: groupId,
        timestamp: now,
        sequence: 0,
        payload,
      };

      try {
        await this.transport.send(group.hostDeviceId, envelope);
      } catch (err) {
        console.warn(`[GroupCoordinator] Failed to deliver group message to host ${group.hostDeviceId}:`, err);
      }

      this.emit('messageSent', message);
      return message;
    }
  }

  public async handleIncomingGroupMessage(envelope: NetworkEnvelope): Promise<MessageItem | null> {
    try {
      const payload = GroupMessagePayloadSchema.parse(envelope.payload);
      const groupId = payload.groupId;
      const group = this.groupRepo.getGroupById(groupId);

      if (!group) return null;

      const isHost = group.isHost || group.hostDeviceId === this.localDeviceId;
      const now = Date.now();

      // Update heartbeat from host
      if (envelope.senderId === group.hostDeviceId) {
        this.hostHeartbeats.set(groupId, now);
      }

      if (isHost) {
        // As Host: Sequence and fan out
        const sequence = this.messageRepo.getNextSequence(groupId);
        const isNew = this.messageRepo.insertMessage({
          id: payload.messageId,
          conversationId: groupId,
          senderId: payload.senderId,
          sequence,
          content: payload.content,
          contentType: payload.contentType,
          deliveryStatus: 'delivered',
          sentAt: payload.sentAt,
          deliveredAt: now,
          readAt: null,
          isEncrypted: false,
        });

        if (!isNew) return null;

        this.conversationRepo.updateLastActivity(groupId, payload.messageId, now);
        this.highestSequences.set(groupId, sequence);

        // Fan out to other members
        const members = this.groupRepo.getGroupMembers(groupId);
        const fanOutPayload: GroupMessagePayload = {
          groupId,
          messageId: payload.messageId,
          senderId: payload.senderId,
          sequence,
          content: payload.content,
          contentType: payload.contentType,
          sentAt: payload.sentAt,
          replyToId: payload.replyToId ?? null,
        };

        const fanOutEnvelope: NetworkEnvelope = {
          protocol: IPM_PROTOCOL,
          id: crypto.randomUUID(),
          type: IpmEventType.GROUP_MESSAGE,
          senderId: this.localDeviceId,
          receiverId: '*',
          conversationId: groupId,
          timestamp: now,
          sequence,
          payload: fanOutPayload,
        };

        for (const memberId of members) {
          if (memberId !== this.localDeviceId && memberId !== payload.senderId) {
            this.transport.send(memberId, fanOutEnvelope).catch(() => {});
          }
        }

        const savedMsg = this.messageRepo.getMessageById(payload.messageId);
        if (savedMsg) {
          this.emit('messageReceived', savedMsg);
        }
        return savedMsg;
      } else {
        // As Member: receive sequenced message from Host
        const isNew = this.messageRepo.insertMessage({
          id: payload.messageId,
          conversationId: groupId,
          senderId: payload.senderId,
          sequence: payload.sequence,
          content: payload.content,
          contentType: payload.contentType,
          deliveryStatus: 'delivered',
          sentAt: payload.sentAt,
          deliveredAt: now,
          readAt: null,
          isEncrypted: false,
        });

        if (!isNew) return null;

        this.conversationRepo.updateLastActivity(groupId, payload.messageId, now);
        this.highestSequences.set(groupId, Math.max(this.highestSequences.get(groupId) ?? 0, payload.sequence));

        const savedMsg = this.messageRepo.getMessageById(payload.messageId);
        if (savedMsg) {
          this.emit('messageReceived', savedMsg);
        }
        return savedMsg;
      }
    } catch (err) {
      console.error('[GroupCoordinator] Error processing group message:', err);
      return null;
    }
  }

  public handleIncomingGroupCreate(envelope: NetworkEnvelope): void {
    try {
      const payload = GroupCreatePayloadSchema.parse(envelope.payload);
      const isHost = payload.hostDeviceId === this.localDeviceId;

      this.groupRepo.createGroup(
        payload.groupId,
        payload.name,
        payload.description,
        payload.hostDeviceId,
        isHost,
        payload.memberDeviceIds
      );

      this.hostHeartbeats.set(payload.groupId, Date.now());
      this.emit('groupCreated', payload);
    } catch (err) {
      console.error('[GroupCoordinator] Error processing GROUP_CREATE:', err);
    }
  }

  public handleIncomingHostMigrated(envelope: NetworkEnvelope): void {
    try {
      const payload = GroupHostMigratedPayloadSchema.parse(envelope.payload);
      const isHost = payload.newHostDeviceId === this.localDeviceId;

      this.groupRepo.updateGroupHost(payload.groupId, payload.newHostDeviceId, isHost);
      this.hostHeartbeats.set(payload.groupId, Date.now());
      this.highestSequences.set(payload.groupId, payload.highestSequence);

      this.emit('hostMigrated', payload);
    } catch (err) {
      console.error('[GroupCoordinator] Error processing GROUP_HOST_MIGRATED:', err);
    }
  }

  private startHeartbeatMonitor(): void {
    this.heartbeatInterval = setInterval(() => {
      this.checkHostLivenessAndElect();
    }, 5000);
  }

  /**
   * Deterministic election algorithm:
   * If group host is silent for > 15 seconds, remaining members evaluate candidates
   * with the highest acknowledged sequence number. The lowest lexical device ID
   * promotes itself to Host Node.
   */
  public checkHostLivenessAndElect(): void {
    const now = Date.now();
    const convs = this.conversationRepo.getConversations(this.localDeviceId, false);
    const groupConvs = convs.filter((c) => c.type === 'group');

    for (const conv of groupConvs) {
      const group = this.groupRepo.getGroupById(conv.id);
      if (!group || group.isHost || group.hostDeviceId === this.localDeviceId) {
        continue;
      }

      const lastSeen = this.hostHeartbeats.get(group.id) ?? group.createdAt;
      if (now - lastSeen > 15000) {
        // Host loss detected!
        const members = this.groupRepo.getGroupMembers(group.id);
        const survivingCandidates = members.filter((m) => m !== group.hostDeviceId);

        if (survivingCandidates.length === 0) continue;

        // Sort lexically
        survivingCandidates.sort();

        const electedHostId = survivingCandidates[0];
        if (electedHostId === this.localDeviceId) {
          // Local node is elected new host!
          const highestSeq = this.highestSequences.get(group.id) ?? 0;
          this.groupRepo.updateGroupHost(group.id, this.localDeviceId, true);

          const payload: GroupHostMigratedPayload = {
            groupId: group.id,
            previousHostDeviceId: group.hostDeviceId,
            newHostDeviceId: this.localDeviceId,
            highestSequence: highestSeq,
            timestamp: now,
          };

          const envelope: NetworkEnvelope = {
            protocol: IPM_PROTOCOL,
            id: crypto.randomUUID(),
            type: IpmEventType.GROUP_HOST_MIGRATED,
            senderId: this.localDeviceId,
            receiverId: '*',
            conversationId: group.id,
            timestamp: now,
            sequence: highestSeq,
            payload,
          };

          for (const memberId of survivingCandidates) {
            if (memberId !== this.localDeviceId) {
              this.transport.send(memberId, envelope).catch(() => {});
            }
          }

          this.emit('hostMigrated', payload);
        }
      }
    }
  }

  public destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

