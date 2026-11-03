import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DatabaseService, ProfileRepository, SettingsRepository } from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity } from '@ipm/security';
import { SystemInfoSchema } from '@ipm/shared';

describe('Phase 1 Integration - Database & Desktop Core Services', () => {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-integ-test-'));
  const dbFile = path.join(tempBase, 'data', 'ipm.db');
  const secDir = path.join(tempBase, 'security');

  it('initializes SQLite with Write-Ahead Logging and all 20 schema tables', () => {
    const dbService = DatabaseService.initialize({ dbPath: dbFile });
    expect(fs.existsSync(dbFile)).toBe(true);

    const raw = dbService.getRawSqlite();
    const journalMode = raw.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');

    // Verify all core tables exist in sqlite_master
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('profiles');
    expect(tables).toContain('devices');
    expect(tables).toContain('device_addresses');
    expect(tables).toContain('trusted_devices');
    expect(tables).toContain('conversations');
    expect(tables).toContain('conversation_members');
    expect(tables).toContain('messages');
    expect(tables).toContain('message_receipts');
    expect(tables).toContain('groups');
    expect(tables).toContain('group_members');
    expect(tables).toContain('private_conversations');
    expect(tables).toContain('private_members');
    expect(tables).toContain('private_credentials');
    expect(tables).toContain('invitations');
    expect(tables).toContain('attachments');
    expect(tables).toContain('transfers');
    expect(tables).toContain('shared_folders');
    expect(tables).toContain('folder_permissions');
    expect(tables).toContain('calls');
    expect(tables).toContain('settings');
  });

  it('completes onboarding profile creation and cryptographic identity derivation', () => {
    const dbService = DatabaseService.getInstance();
    const profileRepo = new ProfileRepository(dbService);
    const secretStore = new SecretKeyStore({ storageDir: secDir });

    // 1. Initial state: No profile
    expect(profileRepo.getProfile()).toBeNull();

    // 2. Generate identity
    const identity = generateDeviceIdentity();
    secretStore.saveIdentityKey(identity.privateKey);

    // 3. Create profile via onboarding
    const created = profileRepo.createProfile(
      {
        displayName: 'Test Architect',
        username: 'test_architect',
        status: 'online',
        customStatus: 'Testing Phase 1',
      },
      { osUsername: 'testuser', computerName: 'TEST-RIG-01' },
      { deviceId: identity.deviceId, publicKey: identity.publicKey }
    );

    expect(created.id).toBe('prof_local');
    expect(created.displayName).toBe('Test Architect');
    expect(created.deviceId).toBe(identity.deviceId);

    // 4. Persistence verification: Retrieve profile from SQLite
    const retrieved = profileRepo.getProfile();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.displayName).toBe('Test Architect');
    expect(retrieved?.status).toBe('online');
    expect(retrieved?.deviceId).toBe(identity.deviceId);

    // 5. Profile Update
    const updated = profileRepo.updateProfile({
      displayName: 'Senior Lead Architect',
      status: 'busy',
    });
    expect(updated.displayName).toBe('Senior Lead Architect');
    expect(updated.status).toBe('busy');
    // DeviceId must remain identical across updates
    expect(updated.deviceId).toBe(identity.deviceId);
  });

  it('manages application settings with default fallbacks and updates', () => {
    const dbService = DatabaseService.getInstance();
    const settingsRepo = new SettingsRepository(dbService);

    const initial = settingsRepo.getSettings();
    expect(initial.theme).toBe('system');
    expect(initial.udpPort).toBe(45820);
    expect(initial.tcpPort).toBe(45821);
    expect(initial.signalingPort).toBe(45822);
    expect(initial.minimizeToTray).toBe(true);

    const updated = settingsRepo.updateSettings({
      theme: 'dark',
      minimizeToTray: false,
    });
    expect(updated.theme).toBe('dark');
    expect(updated.minimizeToTray).toBe(false);

    // Verify persisted
    const retrieved = settingsRepo.getSettings();
    expect(retrieved.theme).toBe('dark');
    expect(retrieved.minimizeToTray).toBe(false);
  });
});

