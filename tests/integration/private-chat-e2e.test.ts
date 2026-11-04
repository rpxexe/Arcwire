import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DatabaseService,
  ProfileRepository,
  DeviceRepository,
  ConversationRepository,
  MessageRepository,
  PrivateChatRepository,
} from '@ipm/database';
import {
  Argon2Hasher,
  InvitationTokenManager,
  PrivateSessionCrypto,
} from '@ipm/security';
import { PrivateSessionManager } from '../../apps/desktop/electron/services/PrivateSessionManager';

describe('Private Chat System End-to-End Integration', () => {
  let tempDirAlice: string;
  let tempDirBob: string;
  let dbAlice: DatabaseService;
  let dbBob: DatabaseService;

  let aliceProfileRepo: ProfileRepository;
  let aliceDeviceRepo: DeviceRepository;
  let aliceConvRepo: ConversationRepository;
  let aliceMsgRepo: MessageRepository;
  let alicePrivateRepo: PrivateChatRepository;
  let aliceSessionManager: PrivateSessionManager;

  let bobProfileRepo: ProfileRepository;
  let bobDeviceRepo: DeviceRepository;
  let bobConvRepo: ConversationRepository;
  let bobMsgRepo: MessageRepository;
  let bobPrivateRepo: PrivateChatRepository;
  let bobSessionManager: PrivateSessionManager;

  const aliceDeviceId = 'dev_alice_e2e';
  const bobDeviceId = 'dev_bob_e2e';

  beforeEach(() => {
    tempDirAlice = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-alice-'));
    tempDirBob = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-bob-'));

    dbAlice = DatabaseService.create({ dbPath: path.join(tempDirAlice, 'alice.db') });
    dbBob = DatabaseService.create({ dbPath: path.join(tempDirBob, 'bob.db') });

    // Initialize Alice repos
    aliceProfileRepo = new ProfileRepository(dbAlice);
    aliceDeviceRepo = new DeviceRepository(dbAlice);
    aliceConvRepo = new ConversationRepository(dbAlice);
    aliceMsgRepo = new MessageRepository(dbAlice);
    alicePrivateRepo = new PrivateChatRepository(dbAlice);
    aliceSessionManager = new PrivateSessionManager(alicePrivateRepo, aliceDeviceId);

    // Initialize Bob repos
    bobProfileRepo = new ProfileRepository(dbBob);
    bobDeviceRepo = new DeviceRepository(dbBob);
    bobConvRepo = new ConversationRepository(dbBob);
    bobMsgRepo = new MessageRepository(dbBob);
    bobPrivateRepo = new PrivateChatRepository(dbBob);
    bobSessionManager = new PrivateSessionManager(bobPrivateRepo, bobDeviceId);

    // Seed devices
    aliceDeviceRepo.upsertDevice({
      id: aliceDeviceId,
      publicKey: 'alice_pub',
      displayName: 'Alice (Host)',
      hostname: 'ALICE-PC',
    });
    aliceDeviceRepo.upsertDevice({
      id: bobDeviceId,
      publicKey: 'bob_pub',
      displayName: 'Bob (Peer)',
      hostname: 'BOB-PC',
    });

    bobDeviceRepo.upsertDevice({
      id: bobDeviceId,
      publicKey: 'bob_pub',
      displayName: 'Bob (Peer)',
      hostname: 'BOB-PC',
    });
    bobDeviceRepo.upsertDevice({
      id: aliceDeviceId,
      publicKey: 'alice_pub',
      displayName: 'Alice (Host)',
      hostname: 'ALICE-PC',
    });
  });

  afterEach(() => {
    dbAlice.close();
    dbBob.close();
    try {
      fs.rmSync(tempDirAlice, { recursive: true, force: true });
      fs.rmSync(tempDirBob, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should execute full Phase 4 workflow: Argon2id auth, PRV invitation exchange, X25519 session, and search isolation', async () => {
    // 1. Initial State: Alice has no master credential
    expect(aliceSessionManager.getStatus().hasCredential).toBe(false);
    expect(aliceSessionManager.isUnlocked()).toBe(false);

    // 2. Alice sets master credential with Argon2id
    await aliceSessionManager.setupCredential({
      password: 'AliceMasterVaultPIN987!',
      recoveryHint: 'Birth city',
    });

    expect(aliceSessionManager.getStatus().hasCredential).toBe(true);
    expect(aliceSessionManager.isUnlocked()).toBe(true);

    // Verify Argon2id hash format in database
    const credRow = alicePrivateRepo.getCredential();
    expect(credRow?.passwordHash).toMatch(/^\$argon2id\$/);

    // 3. Alice creates a private conversation
    const privateChat = aliceSessionManager.createPrivateConversation({
      title: 'Top Secret Strategy 2026',
    });
    expect(privateChat.id).toMatch(/^prv_/);
    expect(privateChat.type).toBe('private');
    expect(privateChat.title).toBe('Top Secret Strategy 2026');

    // 4. Isolation Check: Ensure standard conversation listing excludes this chat
    const publicConvs = aliceConvRepo.getConversations(aliceDeviceId, false);
    expect(publicConvs.some((c) => c.id === privateChat.id)).toBe(false);

    // 5. Alice generates a PRV invitation code
    const invitation = aliceSessionManager.createInvitation({
      conversationId: privateChat.id,
      maxUses: 1,
      expiresInHours: 24,
    });

    expect(invitation.code).toMatch(/^PRV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    expect(invitation.expiresAt).toBeGreaterThan(Date.now());

    // Verify raw code is NOT stored in DB, only SHA-256 hash
    const invRow = alicePrivateRepo.getInvitationById(invitation.id);
    expect(invRow).not.toBeNull();
    expect(invRow?.codeHash).toBe(InvitationTokenManager.hashCode(invitation.code));
    expect(JSON.stringify(invRow)).not.toContain(invitation.code);

    // 6. Bob redeems the invitation token on Alice's node
    const redeemResult = alicePrivateRepo.redeemInvitation(
      InvitationTokenManager.hashCode(invitation.code),
      bobDeviceId
    );
    expect(redeemResult.success).toBe(true);
    expect(redeemResult.conversationId).toBe(privateChat.id);

    // Verify Bob is now in private members
    const members = alicePrivateRepo.getPrivateConversation(privateChat.id, aliceDeviceId)?.memberDeviceIds;
    expect(members).toContain(aliceDeviceId);
    expect(members).toContain(bobDeviceId);

    // 7. Establish X25519 Diffie-Hellman encrypted session
    const aliceKeys = PrivateSessionCrypto.generateKeyPair();
    const bobKeys = PrivateSessionCrypto.generateKeyPair();

    const aliceSessionKey = PrivateSessionCrypto.deriveSharedKey(
      aliceKeys.privateKey,
      bobKeys.publicKey,
      privateChat.id
    );
    const bobSessionKey = PrivateSessionCrypto.deriveSharedKey(
      bobKeys.privateKey,
      aliceKeys.publicKey,
      privateChat.id
    );
    expect(aliceSessionKey.equals(bobSessionKey)).toBe(true);

    // 8. Alice sends an application-layer encrypted message
    const secretContent = 'Deploy the LAN mesh network node at 192.168.1.150';
    const encryptedPayload = PrivateSessionCrypto.encrypt(secretContent, aliceSessionKey);

    // Insert into Alice database
    aliceMsgRepo.insertMessage({
      id: 'msg_prv_1',
      conversationId: privateChat.id,
      senderId: aliceDeviceId,
      sequence: 1,
      content: secretContent,
      contentType: 'text',
      deliveryStatus: 'sent',
      sentAt: Date.now(),
      isEncrypted: true,
    });

    // 9. Verify normal search query CANNOT find this message
    const unauthSearch = aliceMsgRepo.searchMessages('mesh network', undefined, false);
    expect(unauthSearch).toHaveLength(0);

    // Authorized private search finds it
    const authSearch = aliceMsgRepo.searchMessages('mesh network', undefined, true);
    expect(authSearch).toHaveLength(1);
    expect(authSearch[0]?.id).toBe('msg_prv_1');

    // 10. Bob decrypts the message payload
    const decryptedByBob = PrivateSessionCrypto.decrypt(encryptedPayload, bobSessionKey);
    expect(decryptedByBob).toBe(secretContent);

    // 11. Lock Session: Verify locked state restricts access
    aliceSessionManager.lock();
    expect(aliceSessionManager.isUnlocked()).toBe(false);
    expect(() => aliceSessionManager.getPrivateConversations()).toThrow(/Access denied/);

    // 12. Unlock with wrong password: verify failure
    const badUnlock = await aliceSessionManager.unlock({ password: 'WrongPassword123' });
    expect(badUnlock.success).toBe(false);
    expect(aliceSessionManager.isUnlocked()).toBe(false);

    // 13. Unlock with correct password: verify recovery
    const goodUnlock = await aliceSessionManager.unlock({ password: 'AliceMasterVaultPIN987!' });
    expect(goodUnlock.success).toBe(true);
    expect(aliceSessionManager.isUnlocked()).toBe(true);
    expect(aliceSessionManager.getPrivateConversations()).toHaveLength(1);
  });
});

