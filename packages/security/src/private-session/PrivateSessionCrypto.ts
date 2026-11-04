import crypto from 'node:crypto';

export interface X25519KeyPair {
  publicKey: string;  // Base64 encoded SPKI
  privateKey: string; // Base64 encoded PKCS8
}

export interface EncryptedPayload {
  ciphertext: string; // Base64
  iv: string;         // Base64 12 bytes
  tag: string;        // Base64 16 bytes
  authTag?: string;   // Alias for tag
}

export class PrivateSessionCrypto {
  /**
   * Generates an ephemeral or conversation-specific X25519 keypair for key exchange.
   */
  public static generateKeyPair(): X25519KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
      publicKeyEncoding: {
        type: 'spki',
        format: 'der',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'der',
      },
    });

    return {
      publicKey: publicKey.toString('base64'),
      privateKey: privateKey.toString('base64'),
    };
  }

  /**
   * Derives a 32-byte AES-256-GCM symmetric session key from local private key and remote public key
   * using Diffie-Hellman over X25519 and HKDF-SHA-256.
   */
  public static deriveSessionKey(
    localPrivateKeyBase64: string,
    remotePublicKeyBase64: string,
    salt?: Buffer | string,
    info: string = 'IPM_PRIVATE_SESSION_V1'
  ): Buffer {
    const privKey = crypto.createPrivateKey({
      key: Buffer.from(localPrivateKeyBase64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });

    const pubKey = crypto.createPublicKey({
      key: Buffer.from(remotePublicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });

    const sharedSecret = crypto.diffieHellman({
      privateKey: privKey,
      publicKey: pubKey,
    });

    let effectiveSalt: Buffer;
    if (salt) {
      effectiveSalt = typeof salt === 'string' ? Buffer.from(salt, 'utf8') : salt;
    } else {
      effectiveSalt = crypto.createHash('sha256').update(info).digest();
    }

    const derived = crypto.hkdfSync('sha256', sharedSecret, effectiveSalt, Buffer.from(info, 'utf8'), 32);
    return Buffer.from(derived);
  }

  /**
   * Alias for deriveSessionKey
   */
  public static deriveSharedKey(
    localPrivateKeyBase64: string,
    remotePublicKeyBase64: string,
    salt?: Buffer | string,
    info?: string
  ): Buffer {
    return PrivateSessionCrypto.deriveSessionKey(localPrivateKeyBase64, remotePublicKeyBase64, salt, info);
  }

  /**
   * Encrypts plaintext string using AES-256-GCM with a 12-byte random IV.
   */
  public static encrypt(plaintext: string, sessionKey: Buffer): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const tagBase64 = tag.toString('base64');
    return {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tagBase64,
      authTag: tagBase64,
    };
  }

  /**
   * Decrypts ciphertext using AES-256-GCM and verifies the 16-byte authentication tag.
   */
  public static decrypt(payload: EncryptedPayload, sessionKey: Buffer): string {
    const iv = Buffer.from(payload.iv, 'base64');
    const tagStr = payload.tag || payload.authTag || '';
    const tag = Buffer.from(tagStr, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Computes SHA-256 hash of a session key for database verification without storing the key itself.
   */
  public static hashSessionKey(sessionKey: Buffer): string {
    return crypto.createHash('sha256').update(sessionKey).digest('hex');
  }
}
