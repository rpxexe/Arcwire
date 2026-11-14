import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  DatabaseService,
  DeviceRepository,
  ConversationRepository,
  MessageRepository,
  PrivateChatRepository,
} from '@ipm/database';
import { IPM_PROTOCOL, IpmEventType, NetworkEnvelope, MessageItem } from '@ipm/shared';
import { PrivateSessionManager } from '../../apps/desktop/electron/services/PrivateSessionManager';

const makeMessage = (conversationId: string, senderId: string, sentAt: number, content = 'hi'): MessageItem => ({
  id: crypto.randomUUID(),
  conversationId,
  senderId,
  sequence: sentAt,
  content,
  contentType: 'text',
  deliveryStatus: 'sent',
  sentAt,
  deliveredAt: null,
  readAt: null,
  isEncrypted: false,
});

describe('Chat actions & cross-device private invitations', () => {
  const aliceId = 'dev_alice_join';
  const bobId = 'dev_bob_join';
  let dirA: string;
  let dirB: string;
  let dbA: DatabaseService;
  let dbB: DatabaseService;

  beforeEach(() => {
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-join-a-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-join-b-'));
    dbA = DatabaseService.create({ dbPath: path.join(dirA, 'a.db') });
    dbB = DatabaseService.create({ dbPath: path.join(dirB, 'b.db') });
  });

  afterEach(() => {
    dbA.close();
    dbB.close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  it('supports reactions (one per device), edit, unsend tombstones and latest-N history', () => {
    const devices = new DeviceRepository(dbA);
    devices.upsertDevice({ id: aliceId, publicKey: 'a', displayName: 'Alice', hostname: 'A' });
    devices.upsertDevice({ id: bobId, publicKey: 'b', displayName: 'Bob', hostname: 'B' });
    const convs = new ConversationRepository(dbA);
    const msgs = new MessageRepository(dbA);
    const conv = convs.getOrCreateDirectConversation(aliceId, bobId, 'Bob');

    for (let i = 1; i <= 5; i++) msgs.insertMessage(makeMessage(conv.id, aliceId, 1000 * i, `m${i}`));
    const latest = msgs.getMessages(conv.id, 3);
    expect(latest.map((m) => m.content)).toEqual(['m3', 'm4', 'm5']);

    const target = latest[2]!;
    let updated = msgs.toggleReaction(target.id, bobId, '❤️');
    expect(updated?.reactions).toEqual({ '❤️': [bobId] });
    updated = msgs.toggleReaction(target.id, bobId, '😂'); // replaces previous reaction
    expect(updated?.reactions).toEqual({ '😂': [bobId] });
    updated = msgs.toggleReaction(target.id, bobId, '😂'); // same emoji toggles off
    expect(updated?.reactions).toEqual({});

    updated = msgs.editMessageContent(target.id, 'edited text', 5555);
    expect(updated?.content).toBe('edited text');
    expect(updated?.editedAt).toBe(5555);

    updated = msgs.markMessageDeleted(target.id);
    expect(updated?.isDeleted).toBe(true);
    expect(updated?.content).toBe('');
    expect(msgs.editMessageContent(target.id, 'nope')?.content).toBe('');
  });

  it('reports the most recently announced IP for a device that changed networks', () => {
    const devices = new DeviceRepository(dbA);
    devices.upsertDevice({ id: bobId, publicKey: 'b', displayName: 'Bob', hostname: 'B', ipAddress: '192.168.1.39', status: 'online' });
    devices.upsertDevice({ id: bobId, publicKey: 'b', displayName: 'Bob', hostname: 'B', ipAddress: '192.168.0.111', status: 'online' });
    expect(devices.getDeviceById(bobId)?.ipAddress).toBe('192.168.0.111');
    expect(devices.getAllDevices().find((d) => d.id === bobId)?.ipAddress).toBe('192.168.0.111');

    devices.markAllOffline();
    expect(devices.getDeviceById(bobId)?.status).toBe('offline');
  });

  it('hides locked chats from the normal list and deletes conversations with their messages', () => {
    const devices = new DeviceRepository(dbA);
    devices.upsertDevice({ id: aliceId, publicKey: 'a', displayName: 'Alice', hostname: 'A' });
    devices.upsertDevice({ id: bobId, publicKey: 'b', displayName: 'Bob', hostname: 'B' });
    const convs = new ConversationRepository(dbA);
    const msgs = new MessageRepository(dbA);
    const conv = convs.getOrCreateDirectConversation(aliceId, bobId, 'Bob');
    msgs.insertMessage(makeMessage(conv.id, bobId, 1000));

    convs.setConversationFlags(conv.id, { isPinned: true, isMuted: true });
    expect(convs.getConversationById(conv.id, aliceId, false)?.isPinned).toBe(true);

    convs.setConversationFlags(conv.id, { isChatLocked: true });
    expect(convs.getConversations(aliceId, false).some((c) => c.id === conv.id)).toBe(false);
    expect(convs.getConversations(aliceId, true).find((c) => c.id === conv.id)?.isChatLocked).toBe(true);
    expect(msgs.searchMessages('hi', undefined, false)).toHaveLength(0);

    convs.deleteConversation(conv.id);
    expect(convs.conversationExists(conv.id)).toBe(false);
    expect(msgs.getMessages(conv.id)).toHaveLength(0);
  });

  it('redeems a PRV invitation issued on another device over the LAN', async () => {
    const repoA = new PrivateChatRepository(dbA);
    const repoB = new PrivateChatRepository(dbB);
    const devA = new DeviceRepository(dbA);
    const devB = new DeviceRepository(dbB);
    devA.upsertDevice({ id: bobId, publicKey: 'b', displayName: 'Bob', hostname: 'B', ipAddress: '10.0.0.2', status: 'online' } as any);
    devB.upsertDevice({ id: aliceId, publicKey: 'a', displayName: 'Alice', hostname: 'A', ipAddress: '10.0.0.1', status: 'online' } as any);

    let alice!: PrivateSessionManager;
    let bob!: PrivateSessionManager;

    // In-memory transport: delivers payloads to the other manager asynchronously
    const makeAdapter = (fromId: string) => ({
      getConnectionPool: () => ({ getConnectedPeerIds: () => [fromId === aliceId ? bobId : aliceId] }),
      sendPayload: async (peerId: string, type: IpmEventType, payload: Record<string, any>, conversationId = 'global') => {
        const envelope: NetworkEnvelope = {
          protocol: IPM_PROTOCOL,
          id: crypto.randomUUID(),
          type,
          senderId: fromId,
          receiverId: peerId,
          conversationId,
          timestamp: Date.now(),
          sequence: 0,
          payload,
        };
        const target = peerId === aliceId ? alice : bob;
        setTimeout(() => void target.handleIncomingEnvelope(envelope), 0);
      },
    });

    alice = new PrivateSessionManager(repoA, aliceId, {
      conversationRepo: new ConversationRepository(dbA),
      deviceRepo: devA,
      getLanAdapter: () => makeAdapter(aliceId) as any,
    });
    bob = new PrivateSessionManager(repoB, bobId, {
      conversationRepo: new ConversationRepository(dbB),
      deviceRepo: devB,
      getLanAdapter: () => makeAdapter(bobId) as any,
    });

    await alice.setupCredential({ password: 'alice-pin-1234' });
    await bob.setupCredential({ password: 'bob-pin-5678' });

    // Creating a private chat must work even though Alice's own device row did not exist (FK fix)
    const conv = alice.createPrivateConversation({ title: 'Launch plan' });
    const invite = alice.createInvitation({ conversationId: conv.id, maxUses: 1, expiresInHours: 1 });

    // Bob's database has never seen this invitation — it must be resolved over the network
    expect(repoB.getInvitationByCodeHash(crypto.createHash('sha256').update(invite.code).digest('hex'))).toBeNull();
    const joined = await bob.redeemInvitation({ code: invite.code.toLowerCase() });

    expect(joined.id).toBe(conv.id);
    expect(joined.title).toBe('Launch plan');
    expect(repoB.exportPrivateConversation(conv.id)?.memberDeviceIds.sort()).toEqual([aliceId, bobId].sort());
    expect(repoA.exportPrivateConversation(conv.id)?.memberDeviceIds.sort()).toEqual([aliceId, bobId].sort());

    // Single-use code is now exhausted
    await expect(bob.redeemInvitation({ code: invite.code })).rejects.toThrow(/usage limit/i);

    // Unknown code: every peer answers "not found"
    await expect(bob.redeemInvitation({ code: 'PRV-ZZZZ-ZZZZ' })).rejects.toThrow(/not found/i);

    alice.destroy();
    bob.destroy();
  });
});
