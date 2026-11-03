import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  generateDeviceIdentity,
  deriveDeviceId,
  signData,
  verifySignature,
  SecretKeyStore,
} from '@ipm/security';

describe('Security Package - Identity & Keys', () => {
  it('generates valid Ed25519 identity with deterministic deviceId', () => {
    const identity = generateDeviceIdentity();
    expect(identity.deviceId).toMatch(/^dev_[a-f0-9]{20}$/);
    expect(identity.publicKey).toBeDefined();
    expect(identity.privateKey).toBeDefined();

    // Verify deriveDeviceId gives identical result
    const derived = deriveDeviceId(identity.publicKey);
    expect(derived).toBe(identity.deviceId);
  });

  it('signs and verifies data correctly with Ed25519', () => {
    const identity = generateDeviceIdentity();
    const message = 'Hello from LAN Messenger Node A';

    const signature = signData(message, identity.privateKey);
    expect(signature).toBeDefined();

    const isValid = verifySignature(message, signature, identity.publicKey);
    expect(isValid).toBe(true);

    const isTamperedValid = verifySignature('Tampered message payload', signature, identity.publicKey);
    expect(isTamperedValid).toBe(false);
  });
});

describe('Security Package - SecretKeyStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-sec-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('encrypts, stores, and decrypts private key material', () => {
    const store = new SecretKeyStore({ storageDir: tempDir });
    expect(store.hasIdentityKey()).toBe(false);

    const secret = 'PRIVATE_KEY_PAYLOAD_TEST_12345';
    store.saveIdentityKey(secret);

    expect(store.hasIdentityKey()).toBe(true);
    const loaded = store.loadIdentityKey();
    expect(loaded).toBe(secret);
  });
});
