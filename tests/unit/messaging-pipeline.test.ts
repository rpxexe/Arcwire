import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DatabaseService,
  ConversationRepository,
  MessageRepository,
  GroupRepository,
  DeviceRepository,
} from '@ipm/database';
import { MessageItem } from '@ipm/shared';

describe('Phase 3 Unit - Messaging Pipeline & Database Layer', () => {
  let tempDir: string;
  let dbService: DatabaseService;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let groupRepo: GroupRepository;
  let deviceRepo: DeviceRepository;

  const registerDevice = (id: string, name: string) => {
    deviceRepo.upsertDevice({
      id,
      publicKey: `pk_${id}`,
      displayName: name,
      hostname: `${name}-PC`,
      ipAddress: '192.168.1.100',
      tcpPort: 45821,
      signalingPort: 45822,
      status: 'online',
    });
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-msg-test-'));
    const dbPath = path.join(tempDir, 'data', 'test.db');
    dbService = DatabaseService.initialize({ dbPath });
    convRepo = new ConversationRepository(dbService);
    msgRepo = new MessageRepository(dbService);
    groupRepo = new GroupRepository(dbService);
    deviceRepo = new DeviceRepository(dbService);
  });

  afterEach(() => {
    dbService.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates and retrieves direct conversation idempotently', () => {
    const aliceId = 'dev_alice123456789012';
    const bobId = 'dev_bob12345678901234';

    registerDevice(aliceId, 'Alice');
    registerDevice(bobId, 'Bob');

    const conv1 = convRepo.getOrCreateDirectConversation(aliceId, bobId, 'Bob LAN Peer');
    expect(conv1.id).toBeDefined();
    expect(conv1.type).toBe('direct');
    expect(conv1.peerDeviceId).toBe(bobId);

    // Call again to verify idempotency (same conversation returned)
    const conv2 = convRepo.getOrCreateDirectConversation(aliceId, bobId, 'Bob LAN Peer');
    expect(conv2.id).toBe(conv1.id);
  });

  it('generates strictly monotonic sequence numbers per conversation', () => {
    const convId = 'conv_monotonic_test';
    convRepo.createConversation({
      id: convId,
      type: 'direct',
      title: 'Monotonic Test',
    });

    const seq1 = msgRepo.getNextSequence(convId);
    expect(seq1).toBe(1);

    const msg1: MessageItem = {
      id: 'msg_1',
      conversationId: convId,
      senderId: 'dev_alice',
      sequence: seq1,
      content: 'Message 1',
      contentType: 'text',
      deliveryStatus: 'pending',
      sentAt: Date.now(),
      isEncrypted: false,
    };
    msgRepo.insertMessage(msg1);

    const seq2 = msgRepo.getNextSequence(convId);
    expect(seq2).toBe(2);

    const msg2: MessageItem = {
      id: 'msg_2',
      conversationId: convId,
      senderId: 'dev_bob',
      sequence: seq2,
      content: 'Message 2',
      contentType: 'text',
      deliveryStatus: 'pending',
      sentAt: Date.now(),
      isEncrypted: false,
    };
    msgRepo.insertMessage(msg2);

    const seq3 = msgRepo.getNextSequence(convId);
    expect(seq3).toBe(3);
  });

  it('deduplicates incoming messages by message ID', () => {
    const convId = 'conv_dedup_test';
    convRepo.createConversation({
      id: convId,
      type: 'direct',
      title: 'Dedup Test',
    });

    const msg: MessageItem = {
      id: 'msg_unique_100',
      conversationId: convId,
      senderId: 'dev_alice',
      sequence: 1,
      content: 'Hello unique world',
      contentType: 'text',
      deliveryStatus: 'pending',
      sentAt: Date.now(),
      isEncrypted: false,
    };

    const firstInsert = msgRepo.insertMessage(msg);
    expect(firstInsert).toBe(true);
    expect(msgRepo.hasMessage('msg_unique_100')).toBe(true);

    // Duplicate insert attempt
    const secondInsert = msgRepo.insertMessage(msg);
    expect(secondInsert).toBe(false);

    const messages = msgRepo.getMessages(convId);
    expect(messages.length).toBe(1);
  });

  it('updates delivery status and records receipts', () => {
    const convId = 'conv_receipt_test';
    const bobId = 'dev_bob_receipt';
    registerDevice(bobId, 'Bob');

    convRepo.createConversation({
      id: convId,
      type: 'direct',
      title: 'Receipt Test',
    });

    const msgId = 'msg_receipt_1';
    const now = Date.now();
    msgRepo.insertMessage({
      id: msgId,
      conversationId: convId,
      senderId: 'dev_alice',
      sequence: 1,
      content: 'Testing delivery receipts',
      contentType: 'text',
      deliveryStatus: 'pending',
      sentAt: now,
      isEncrypted: false,
    });

    // 1. Deliver receipt
    msgRepo.updateMessageStatus(msgId, 'delivered', now + 100);
    msgRepo.recordReceipt(msgId, bobId, 'delivered', now + 100);

    const afterDelivered = msgRepo.getMessageById(msgId);
    expect(afterDelivered?.deliveryStatus).toBe('delivered');
    expect(afterDelivered?.deliveredAt).toBe(now + 100);

    // 2. Read receipt
    msgRepo.updateMessageStatus(msgId, 'read', undefined, now + 500);
    msgRepo.recordReceipt(msgId, bobId, 'read', now + 500);

    const afterRead = msgRepo.getMessageById(msgId);
    expect(afterRead?.deliveryStatus).toBe('read');
    expect(afterRead?.readAt).toBe(now + 500);
  });

  it('marks conversation messages as read and returns read IDs', () => {
    const convId = 'conv_read_batch_test';
    convRepo.createConversation({
      id: convId,
      type: 'direct',
      title: 'Read Batch Test',
    });

    const now = Date.now();
    msgRepo.insertMessage({
      id: 'm_1',
      conversationId: convId,
      senderId: 'dev_remote_peer',
      sequence: 1,
      content: 'First incoming unread',
      contentType: 'text',
      deliveryStatus: 'delivered',
      sentAt: now,
      isEncrypted: false,
    });

    msgRepo.insertMessage({
      id: 'm_2',
      conversationId: convId,
      senderId: 'dev_remote_peer',
      sequence: 2,
      content: 'Second incoming unread',
      contentType: 'text',
      deliveryStatus: 'delivered',
      sentAt: now + 50,
      isEncrypted: false,
    });

    // Own sent message should not be affected by markMessagesAsRead
    msgRepo.insertMessage({
      id: 'm_own',
      conversationId: convId,
      senderId: 'dev_local_me',
      sequence: 3,
      content: 'My own outgoing message',
      contentType: 'text',
      deliveryStatus: 'pending',
      sentAt: now + 100,
      isEncrypted: false,
    });

    const readIds = msgRepo.markMessagesAsRead(convId, 'dev_local_me');
    expect(readIds).toContain('m_1');
    expect(readIds).toContain('m_2');
    expect(readIds).not.toContain('m_own');

    const m1 = msgRepo.getMessageById('m_1');
    expect(m1?.deliveryStatus).toBe('read');
  });

  it('searches messages by substring query', () => {
    const convId = 'conv_search_test';
    convRepo.createConversation({
      id: convId,
      type: 'direct',
      title: 'Search Test',
    });

    msgRepo.insertMessage({
      id: 'm_search_1',
      conversationId: convId,
      senderId: 'dev_alice',
      sequence: 1,
      content: 'The secret passphrase is ALPHA-99',
      contentType: 'text',
      deliveryStatus: 'sent',
      sentAt: Date.now(),
      isEncrypted: false,
    });

    msgRepo.insertMessage({
      id: 'm_search_2',
      conversationId: convId,
      senderId: 'dev_bob',
      sequence: 2,
      content: 'Understood, standby for deployment',
      contentType: 'text',
      deliveryStatus: 'sent',
      sentAt: Date.now(),
      isEncrypted: false,
    });

    const results = msgRepo.searchMessages('passphrase');
    expect(results.length).toBe(1);
    expect(results[0]?.id).toBe('m_search_1');
  });

  it('manages group metadata and host migration in GroupRepository', () => {
    const groupId = 'group_engineering_1';
    const hostId = 'dev_alice';
    const memberId = 'dev_bob';

    registerDevice(hostId, 'Alice');
    registerDevice(memberId, 'Bob');

    groupRepo.createGroup({
      id: groupId,
      name: 'Engineering Team',
      description: 'Dev channel',
      hostDeviceId: hostId,
      isHost: true,
      memberDeviceIds: [hostId, memberId],
    });

    const group = groupRepo.getGroupById(groupId);
    expect(group).not.toBeNull();
    expect(group?.name).toBe('Engineering Team');
    expect(group?.hostDeviceId).toBe(hostId);

    const members = groupRepo.getGroupMembers(groupId);
    expect(members).toContain(hostId);
    expect(members).toContain(memberId);

    // Migrate host to Bob
    groupRepo.updateGroupHost(groupId, memberId);
    const updated = groupRepo.getGroupById(groupId);
    expect(updated?.hostDeviceId).toBe(memberId);
  });
});
