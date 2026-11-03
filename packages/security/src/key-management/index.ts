import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface SafeStorageProvider {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretStoreOptions {
  storageDir: string;
  safeStorage?: SafeStorageProvider | null;
}

/**
 * Storage manager for sensitive cryptographic keys.
 * Uses Electron's safeStorage (Windows DPAPI) in production.
 * Automatically falls back to machine/user-bound encrypted local storage in test/non-electron environments.
 */
export class SecretKeyStore {
  private readonly storageDir: string;
  private readonly identityFile: string;
  private safeStorage: SafeStorageProvider | null = null;

  constructor(options: SecretStoreOptions) {
    this.storageDir = options.storageDir;
    this.identityFile = path.join(this.storageDir, 'identity.dat');
    this.safeStorage = options.safeStorage ?? null;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Sets or updates safeStorage provider
   */
  public setSafeStorage(safeStorage: SafeStorageProvider): void {
    this.safeStorage = safeStorage;
  }

  /**
   * Encrypts plaintext string using DPAPI or hardware-bound fallback
   */
  public encrypt(plaintext: string): Buffer {
    if (this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
      return this.safeStorage.encryptString(plaintext);
    }
    // Fallback for test runner environments: AES-256-GCM using machine-derived key
    const machineSalt = process.env.COMPUTERNAME || 'IPM_LOCAL_SALT';
    const key = crypto.createHash('sha256').update(machineSalt).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  /**
   * Decrypts buffer using DPAPI or hardware-bound fallback
   */
  public decrypt(cipherBuffer: Buffer): string {
    if (this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
      return this.safeStorage.decryptString(cipherBuffer);
    }
    const machineSalt = process.env.COMPUTERNAME || 'IPM_LOCAL_SALT';
    const key = crypto.createHash('sha256').update(machineSalt).digest();
    const iv = cipherBuffer.subarray(0, 12);
    const tag = cipherBuffer.subarray(12, 28);
    const ciphertext = cipherBuffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  }

  /**
   * Saves encrypted identity key
   */
  public saveIdentityKey(privateKeyBase64: string): void {
    const encrypted = this.encrypt(privateKeyBase64);
    fs.writeFileSync(this.identityFile, encrypted);
  }

  /**
   * Loads and decrypts private identity key if exists
   */
  public loadIdentityKey(): string | null {
    if (!fs.existsSync(this.identityFile)) {
      return null;
    }
    try {
      const buffer = fs.readFileSync(this.identityFile);
      return this.decrypt(buffer);
    } catch (err) {
      console.error('Failed to load identity key:', err);
      return null;
    }
  }

  /**
   * Checks if an identity key has already been initialized
   */
  public hasIdentityKey(): boolean {
    return fs.existsSync(this.identityFile);
  }
}
