import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseService, ConversationRepository, DeviceRepository, PrivateChatRepository } from '@ipm/database';
import { PrivateSessionManager } from '../../apps/desktop/electron/services/PrivateSessionManager';

describe('Private Chats PIN change, recovery key and reset', () => {
  const me = 'dev_pin_owner';
  let dir: string;
  let db: DatabaseService;
  let repo: PrivateChatRepository;
  let convs: ConversationRepository;
  let manager: PrivateSessionManager;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-pin-'));
    db = DatabaseService.create({ dbPath: path.join(dir, 'pin.db') });
    repo = new PrivateChatRepository(db);
    convs = new ConversationRepository(db);
    manager = new PrivateSessionManager(repo, me, { conversationRepo: convs, deviceRepo: new DeviceRepository(db) });
  });

  afterEach(() => {
    manager.destroy();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('issues a recovery key at setup and changes the PIN only with the current PIN', async () => {
    const { recoveryKey } = await manager.setupCredential({ password: 'old-pin-1' });
    expect(recoveryKey).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){5}$/);
    expect(manager.getStatus().hasRecoveryKey).toBe(true);

    const wrong = await manager.changePassword({ currentPassword: 'nope', newPassword: 'new-pin-2' });
    expect(wrong.success).toBe(false);
    expect(manager.getStatus().failedAttempts).toBe(1);

    const ok = await manager.changePassword({ currentPassword: 'old-pin-1', newPassword: 'new-pin-2' });
    expect(ok.success).toBe(true);

    manager.lock();
    expect((await manager.unlock({ password: 'old-pin-1' })).success).toBe(false);
    expect((await manager.unlock({ password: 'new-pin-2' })).success).toBe(true);
  });

  it('resets a forgotten PIN with the recovery key, keeps chats, and makes the key single-use', async () => {
    const { recoveryKey } = await manager.setupCredential({ password: 'forgotten' });
    const conv = manager.createPrivateConversation({ title: 'Keep me' });
    manager.lock();

    const bad = await manager.resetWithRecoveryKey({ recoveryKey: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', newPassword: 'fresh-pin' });
    expect(bad.success).toBe(false);

    // Lower-case and without dashes is accepted
    const good = await manager.resetWithRecoveryKey({
      recoveryKey: recoveryKey.replace(/-/g, '').toLowerCase(),
      newPassword: 'fresh-pin',
    });
    expect(good.success).toBe(true);
    expect(good.recoveryKey).toBeDefined();
    expect(good.recoveryKey).not.toBe(recoveryKey);
    expect(manager.isUnlocked()).toBe(true);
    expect(manager.getPrivateConversations().some((c) => c.id === conv.id)).toBe(true);

    manager.lock();
    const reused = await manager.resetWithRecoveryKey({ recoveryKey, newPassword: 'another' });
    expect(reused.success).toBe(false);
    expect((await manager.unlock({ password: 'fresh-pin' })).success).toBe(true);
  });

  it('locks out after repeated wrong recovery keys', async () => {
    await manager.setupCredential({ password: 'pin-1234' });
    manager.lock();
    let last;
    for (let i = 0; i < 3; i++) {
      last = await manager.resetWithRecoveryKey({ recoveryKey: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: 'x-pin' });
    }
    expect(last!.lockedUntil).toBeGreaterThan(Date.now());
    const blocked = await manager.changePassword({ currentPassword: 'pin-1234', newPassword: 'other-pin' });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/Try again/);
  });

  it('erase & start over removes the PIN, private chats and locked chats', async () => {
    const devices = new DeviceRepository(db);
    devices.upsertDevice({ id: me, publicKey: 'a', displayName: 'Me', hostname: 'ME' });
    devices.upsertDevice({ id: 'dev_peer', publicKey: 'b', displayName: 'Peer', hostname: 'PEER' });
    await manager.setupCredential({ password: 'pin-1234' });
    const priv = manager.createPrivateConversation({ title: 'Secret' });
    const direct = convs.getOrCreateDirectConversation(me, 'dev_peer', 'Peer');
    const normal = convs.createConversation('conv_normal_x', 'group', 'Normal', [me]);
    convs.setConversationFlags(direct.id, { isChatLocked: true });
    manager.lock();

    expect(() => manager.resetAndWipe('reset')).toThrow(/RESET/);
    manager.resetAndWipe('RESET');

    expect(manager.getStatus().hasCredential).toBe(false);
    expect(convs.conversationExists(priv.id)).toBe(false);
    expect(convs.conversationExists(direct.id)).toBe(false);
    expect(convs.conversationExists('conv_normal_x')).toBe(true);
    void normal;
  });
});
