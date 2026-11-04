import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DatabaseService,
  PrivateChatRepository,
  ConversationRepository,
  MessageRepository,
  DeviceRepository,
} from '@ipm/database';
import { InvitationTokenManager } from '@ipm/security';

describe('PrivateChatRepository & Isolation Rules', () => {
  let tempDir: string;
  let dbService: DatabaseService;
  let privateRepo: PrivateChatRepository;
  let convRepo: ConversationRepository;
  let messageRepo: MessageRepository;
  let deviceRepo: DeviceRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-private-repo-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    dbService = DatabaseService.create({ dbPath });
    privateRepo = new PrivateChatRepository(dbService);
    convRepo = new ConversationRepository(dbService);
    messageRepo = new MessageRepository(dbService);
    deviceRepo = new DeviceRepository(dbService);

    // Register test devices
    deviceRepo.upsertDevice({
      id: 'dev_alice',
      publicKey: 'alice_pub',
      displayName: 'Alice',
      hostname: 'ALICE-PC',
    });
    deviceRepo.upsertDevice({
      id: 'dev_bob',
      publicKey: 'bob_pub',
      displayName: 'Bob',
      hostname: 'BOB-PC',
    });
  });

  afterEach(() => {
    dbService.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should manage unlock credentials and report status correctly', () => {
    const initialStatus = privateRepo.getStatus(false);
    expect(initialStatus.hasCredential).toBe(false);
    expect(initialStatus.isUnlocked).toBe(false);

    privateRepo.setCredential('argon2_hash_val', 'salt_123', 'My dog name');
    const cred = privateRepo.getCredential();
    expect(cred).not.toBeNull();
    expect(cred?.passwordHash).toBe('argon2_hash_val');
    expect(cred?.recoveryHint).toBe('My dog name');

    const statusLocked = privateRepo.getStatus(false);
    expect(statusLocked.hasCredential).toBe(true);
    expect(statusLocked.isUnlocked).toBe(false);

    const statusUnlocked = privateRepo.getStatus(true);
    expect(statusUnlocked.hasCredential).toBe(true);
    expect(statusUnlocked.isUnlocked).toBe(true);
  });

  it('should enforce exponential lockout throttling on consecutive failed attempts', () => {
    privateRepo.setCredential('argon2_hash_val', 'salt_123');

    // 1st attempt
    const a1 = privateRepo.recordFailedAttempt();
    expect(a1.failedAttempts).toBe(1);
    expect(a1.lockedUntil).toBeNull();

    // 2nd attempt
    const a2 = privateRepo.recordFailedAttempt();
    expect(a2.failedAttempts).toBe(2);
    expect(a2.lockedUntil).toBeNull();

    // 3rd attempt -> 30s lockout
    const a3 = privateRepo.recordFailedAttempt();
    expect(a3.failedAttempts).toBe(3);
    expect(a3.lockedUntil).toBeGreaterThan(Date.now());
    expect(a3.lockedUntil! - Date.now()).toBeLessThanOrEqual(30000);

    // Status reports locked out even if in-memory unlocked
    const status = privateRepo.getStatus(true);
    expect(status.isUnlocked).toBe(false);
    expect(status.lockedUntil).not.toBeNull();

    // Reset failed attempts
    privateRepo.resetFailedAttempts();
    const afterReset = privateRepo.getStatus(true);
    expect(afterReset.failedAttempts).toBe(0);
    expect(afterReset.lockedUntil).toBeNull();
    expect(afterReset.isUnlocked).toBe(true);
  });

  it('should isolate private conversations from standard chat queries', () => {
    // 1. Create standard direct conversation
    convRepo.createConversation('conv_direct_1', 'direct', 'Public Direct Chat', ['dev_alice', 'dev_bob']);

    // 2. Create private conversation
    privateRepo.createPrivateConversation({
      id: 'prv_conv_1',
      title: 'Secret Vault',
      creatorDeviceId: 'dev_alice',
      sessionKeyHash: 'hash_abc_123',
    });

    // Standard query (includePrivate = false) MUST NOT return private conversations
    const standardList = convRepo.getConversations('dev_alice', false);
    expect(standardList.some((c) => c.id === 'prv_conv_1')).toBe(false);
    expect(standardList.some((c) => c.id === 'conv_direct_1')).toBe(true);

    // Private repository query lists private conversation
    const privateList = privateRepo.listPrivateConversations('dev_alice');
    expect(privateList.some((c) => c.id === 'prv_conv_1')).toBe(true);
    expect(privateList.find((c) => c.id === 'prv_conv_1')?.title).toBe('Secret Vault');
  });

  it('should manage invitations lifecycle, single-use enforcement, and revocation', () => {
    privateRepo.createPrivateConversation({
      id: 'prv_conv_1',
      title: 'Secret Vault',
      creatorDeviceId: 'dev_alice',
      sessionKeyHash: 'hash_abc_123',
    });

    const code = 'PRV-82K9-X7QM';
    const codeHash = InvitationTokenManager.hashCode(code);

    // Create single-use invitation expiring in 1 hour
    privateRepo.createInvitation({
      id: 'inv_1',
      conversationId: 'prv_conv_1',
      creatorDeviceId: 'dev_alice',
      codeHash,
      maxUses: 1,
      expiresAt: Date.now() + 3600 * 1000,
    });

    // Lookup by codeHash
    const found = privateRepo.getInvitationByCodeHash(codeHash);
    expect(found).not.toBeNull();
    expect(found?.maxUses).toBe(1);
    expect(found?.usedCount).toBe(0);

    // Bob redeems invitation
    const redeem1 = privateRepo.redeemInvitation(codeHash, 'dev_bob');
    expect(redeem1.success).toBe(true);
    expect(redeem1.conversationId).toBe('prv_conv_1');

    // Bob should now be in private members
    const conv = privateRepo.getPrivateConversation('prv_conv_1', 'dev_alice');
    expect(conv?.memberDeviceIds).toContain('dev_bob');

    // Second redemption attempt must fail due to usage limit
    const redeem2 = privateRepo.redeemInvitation(codeHash, 'dev_bob');
    expect(redeem2.success).toBe(false);
    expect(redeem2.error).toContain('limit reached');
  });

  it('should reject expired and revoked invitations', () => {
    privateRepo.createPrivateConversation({
      id: 'prv_conv_1',
      title: 'Secret Vault',
      creatorDeviceId: 'dev_alice',
      sessionKeyHash: 'hash_abc_123',
    });

    // 1. Expired invitation
    const expiredCode = 'PRV-82K9-EXPR';
    const expiredHash = InvitationTokenManager.hashCode(expiredCode);
    privateRepo.createInvitation({
      id: 'inv_expired',
      conversationId: 'prv_conv_1',
      creatorDeviceId: 'dev_alice',
      codeHash: expiredHash,
      maxUses: 1,
      expiresAt: Date.now() - 1000, // already expired
    });

    const redeemExpired = privateRepo.redeemInvitation(expiredHash, 'dev_bob');
    expect(redeemExpired.success).toBe(false);
    expect(redeemExpired.error).toContain('expired');

    // 2. Revoked invitation
    const revokeCode = 'PRV-82K9-REVK';
    const revokeHash = InvitationTokenManager.hashCode(revokeCode);
    privateRepo.createInvitation({
      id: 'inv_revoked',
      conversationId: 'prv_conv_1',
      creatorDeviceId: 'dev_alice',
      codeHash: revokeHash,
      maxUses: 5,
      expiresAt: Date.now() + 3600 * 1000,
    });

    privateRepo.revokeInvitation('inv_revoked');
    const redeemRevoked = privateRepo.redeemInvitation(revokeHash, 'dev_bob');
    expect(redeemRevoked.success).toBe(false);
    expect(redeemRevoked.error).toContain('revoked');
  });

  it('should exclude private messages from standard search queries', () => {
    // 1. Create standard conversation & message
    convRepo.createConversation('conv_public', 'direct', 'Public', ['dev_alice', 'dev_bob']);
    messageRepo.insertMessage({
      id: 'msg_public_1',
      conversationId: 'conv_public',
      senderId: 'dev_alice',
      sequence: 1,
      content: 'Here is the classified project summary report',
      contentType: 'text',
      deliveryStatus: 'delivered',
      sentAt: Date.now(),
      isEncrypted: false,
    });

    // 2. Create private conversation & message
    privateRepo.createPrivateConversation({
      id: 'conv_private',
      title: 'Private Vault',
      creatorDeviceId: 'dev_alice',
      sessionKeyHash: 'hash_abc',
    });
    messageRepo.insertMessage({
      id: 'msg_private_1',
      conversationId: 'conv_private',
      senderId: 'dev_alice',
      sequence: 1,
      content: 'Here is the classified private key backup',
      contentType: 'text',
      deliveryStatus: 'delivered',
      sentAt: Date.now() + 10,
      isEncrypted: true,
    });

    // Normal search (includePrivate = false)
    const normalResults = messageRepo.searchMessages('classified', undefined, false);
    expect(normalResults).toHaveLength(1);
    expect(normalResults[0]?.id).toBe('msg_public_1');
    expect(normalResults.some((m) => m.id === 'msg_private_1')).toBe(false);

    // Authorized private search (includePrivate = true)
    const authResults = messageRepo.searchMessages('classified', undefined, true);
    expect(authResults).toHaveLength(2);
    expect(authResults.some((m) => m.id === 'msg_private_1')).toBe(true);
  });
});
