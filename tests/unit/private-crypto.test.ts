import { describe, it, expect } from 'vitest';
import { PrivateSessionCrypto } from '@ipm/security';

describe('PrivateSessionCrypto (X25519 ECDH + HKDF + AES-256-GCM)', () => {
  it('should generate valid X25519 keypairs', () => {
    const pair = PrivateSessionCrypto.generateKeyPair();
    expect(pair.publicKey).toBeDefined();
    expect(pair.privateKey).toBeDefined();
    expect(pair.publicKey.length).toBeGreaterThan(30);
    expect(pair.privateKey.length).toBeGreaterThan(30);
  });

  it('should derive identical shared keys between two peers via Diffie-Hellman and HKDF', () => {
    const alice = PrivateSessionCrypto.generateKeyPair();
    const bob = PrivateSessionCrypto.generateKeyPair();
    const salt = 'ipm-private-session-salt-v1';

    const aliceDerived = PrivateSessionCrypto.deriveSharedKey(alice.privateKey, bob.publicKey, salt);
    const bobDerived = PrivateSessionCrypto.deriveSharedKey(bob.privateKey, alice.publicKey, salt);

    expect(aliceDerived).toHaveLength(32); // 256-bit symmetric key
    expect(bobDerived).toHaveLength(32);
    expect(aliceDerived.equals(bobDerived)).toBe(true);
  });

  it('should encrypt and decrypt messages with authenticated AES-256-GCM', () => {
    const alice = PrivateSessionCrypto.generateKeyPair();
    const bob = PrivateSessionCrypto.generateKeyPair();
    const sessionKey = PrivateSessionCrypto.deriveSharedKey(alice.privateKey, bob.publicKey);

    const message = 'Confidential LAN conversation payload!';
    const encrypted = PrivateSessionCrypto.encrypt(message, sessionKey);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();

    const decrypted = PrivateSessionCrypto.decrypt(encrypted, sessionKey);
    expect(decrypted).toBe(message);
  });

  it('should fail decryption if ciphertext has been tampered with', () => {
    const alice = PrivateSessionCrypto.generateKeyPair();
    const bob = PrivateSessionCrypto.generateKeyPair();
    const sessionKey = PrivateSessionCrypto.deriveSharedKey(alice.privateKey, bob.publicKey);

    const encrypted = PrivateSessionCrypto.encrypt('Secret text', sessionKey);
    // Tamper with ciphertext
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -2) + 'ff',
    };

    expect(() => PrivateSessionCrypto.decrypt(tampered, sessionKey)).toThrow();
  });

  it('should fail decryption if auth tag has been tampered with', () => {
    const alice = PrivateSessionCrypto.generateKeyPair();
    const bob = PrivateSessionCrypto.generateKeyPair();
    const sessionKey = PrivateSessionCrypto.deriveSharedKey(alice.privateKey, bob.publicKey);

    const encrypted = PrivateSessionCrypto.encrypt('Secret text', sessionKey);
    // Tamper with auth tag
    const tampered = {
      ...encrypted,
      tag: Buffer.from('00000000000000000000000000000000', 'hex').toString('base64'),
      authTag: Buffer.from('00000000000000000000000000000000', 'hex').toString('base64'),
    };

    expect(() => PrivateSessionCrypto.decrypt(tampered, sessionKey)).toThrow();
  });

  it('should fail decryption with an incorrect session key', () => {
    const alice = PrivateSessionCrypto.generateKeyPair();
    const bob = PrivateSessionCrypto.generateKeyPair();
    const eve = PrivateSessionCrypto.generateKeyPair();

    const legitimateKey = PrivateSessionCrypto.deriveSharedKey(alice.privateKey, bob.publicKey);
    const eveKey = PrivateSessionCrypto.deriveSharedKey(eve.privateKey, bob.publicKey);

    const encrypted = PrivateSessionCrypto.encrypt('Private sensitive data', legitimateKey);
    expect(() => PrivateSessionCrypto.decrypt(encrypted, eveKey)).toThrow();
  });
});
