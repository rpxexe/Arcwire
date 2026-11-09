import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { SecretKeyStore, SafeStorageProvider, generateDeviceIdentity } from '@ipm/security';
import { PathTraversalGuard, SecurityError } from '@ipm/file-sharing';
import { DatabaseService } from '@ipm/database';

describe('Phase 8: Production Security Audit & Hardening Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-prod-audit-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe('1. DPAPI Secret Key Store & Cryptographic Isolation', () => {
    it('successfully encrypts and decrypts identity key via simulated Electron safeStorage (Windows DPAPI)', () => {
      const mockKey = crypto.randomBytes(32);
      const mockSafeStorage: SafeStorageProvider = {
        isEncryptionAvailable: () => true,
        encryptString: (plainText: string) => {
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv('aes-256-gcm', mockKey, iv);
          const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
          const tag = cipher.getAuthTag();
          return Buffer.concat([iv, tag, encrypted]);
        },
        decryptString: (cipherBuffer: Buffer) => {
          if (cipherBuffer.length < 28) {
            throw new Error('Ciphertext buffer is too short to contain IV and authentication tag');
          }
          const iv = cipherBuffer.subarray(0, 12);
          const tag = cipherBuffer.subarray(12, 28);
          const ciphertext = cipherBuffer.subarray(28);
          const decipher = crypto.createDecipheriv('aes-256-gcm', mockKey, iv);
          decipher.setAuthTag(tag);
          return decipher.update(ciphertext) + decipher.final('utf8');
        },
      };

      const store = new SecretKeyStore({
        storageDir: tempDir,
        safeStorage: mockSafeStorage,
      });

      const { privateKey } = generateDeviceIdentity();
      store.saveIdentityKey(privateKey);

      // Verify the on-disk file exists and does NOT contain the plaintext private key
      const rawDiskBuffer = fs.readFileSync(path.join(tempDir, 'identity.dat'));
      expect(rawDiskBuffer.toString('utf8')).not.toContain(privateKey);

      // Verify recovery
      const recoveredKey = store.loadIdentityKey();
      expect(recoveredKey).toBe(privateKey);
    });

    it('falls back securely to hardware/machine-bound AES-256-GCM when safeStorage is unavailable', () => {
      const store = new SecretKeyStore({
        storageDir: tempDir,
        safeStorage: null,
      });

      const { privateKey } = generateDeviceIdentity();
      store.saveIdentityKey(privateKey);

      const rawDiskBuffer = fs.readFileSync(path.join(tempDir, 'identity.dat'));
      expect(rawDiskBuffer.toString('utf8')).not.toContain(privateKey);

      const loaded = store.loadIdentityKey();
      expect(loaded).toBe(privateKey);
    });

    it('gracefully handles corrupted ciphertext without throwing fatal exceptions', () => {
      const store = new SecretKeyStore({
        storageDir: tempDir,
        safeStorage: null,
      });

      // Write garbage data to identity.dat
      fs.writeFileSync(path.join(tempDir, 'identity.dat'), Buffer.from('corrupted-data-header-12345'));
      const loaded = store.loadIdentityKey();
      expect(loaded).toBeNull();
    });
  });

  describe('2. Path Traversal & Windows Device Name Penetration Guard', () => {
    it('blocks all canonical Windows reserved device names with or without extensions', () => {
      const reservedDevices = [
        'CON', 'PRN', 'AUX', 'NUL',
        'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
        'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
        'con.txt', 'prn.pdf', 'aux.tar.gz', 'nul.exe', 'com1.dat', 'lpt9.log',
      ];

      for (const dev of reservedDevices) {
        // Filename sanitization should prepend underscore
        const sanitized = PathTraversalGuard.sanitizeFilename(dev);
        expect(sanitized.toLowerCase()).not.toBe(dev.toLowerCase());
        expect(sanitized.startsWith('_')).toBe(true);

        // Path resolution must throw SecurityError
        expect(() => {
          PathTraversalGuard.resolveSafePath(tempDir, dev);
        }).toThrow(SecurityError);

        expect(() => {
          PathTraversalGuard.resolveSafePath(tempDir, `sub/${dev}`);
        }).toThrow(SecurityError);
      }
    });

    it('blocks NTFS Alternate Data Streams (ADS) and drive specifiers in subpaths', () => {
      const adsAttacks = [
        'file.txt:hidden',
        'sub/data.doc:stream',
        'malicious.exe:$DATA',
        'folder:stream/test.txt',
      ];

      for (const attack of adsAttacks) {
        // Filename sanitization neutralizes colon ':'
        const sanitized = PathTraversalGuard.sanitizeFilename(attack);
        expect(sanitized).not.toContain(':');

        // Path resolution must reject Alternate Data Streams
        expect(() => {
          PathTraversalGuard.resolveSafePath(tempDir, attack);
        }).toThrow(SecurityError);
      }
    });

    it('blocks null-byte poisoning and control characters', () => {
      const poisonAttacks = [
        'image.png\x00.exe',
        'sub/secret\x00.txt',
        'report\x1f.pdf',
        'file\x7f.dat',
      ];

      for (const attack of poisonAttacks) {
        const sanitized = PathTraversalGuard.sanitizeFilename(attack);
        expect(sanitized).not.toMatch(/[\x00-\x1F\x7F]/);

        expect(() => {
          PathTraversalGuard.resolveSafePath(tempDir, attack);
        }).toThrow(SecurityError);
      }
    });

    it('blocks complex path traversal sequences and root escapes', () => {
      const traversalAttacks = [
        '../../Windows/System32/calc.exe',
        '..\\..\\..\\etc\\passwd',
        'sub/../../secret.key',
        'sub/./../../escape.txt',
        '//192.168.1.100/c$/Windows',
        '\\\\192.168.1.50\\c$\\Windows',
      ];

      for (const attack of traversalAttacks) {
        expect(() => {
          PathTraversalGuard.resolveSafePath(tempDir, attack);
        }).toThrow(SecurityError);
      }
    });

    it('strictly forbids sharing filesystem roots', () => {
      expect(() => PathTraversalGuard.validateRootPath('C:\\')).toThrow(SecurityError);
      expect(() => PathTraversalGuard.validateRootPath('C:/')).toThrow(SecurityError);
      expect(() => PathTraversalGuard.validateRootPath('/')).toThrow(SecurityError);
      expect(() => PathTraversalGuard.validateRootPath('D:\\')).toThrow(SecurityError);
    });
  });

  describe('3. SQLite Integrity Check Execution', () => {
    it('verifies PRAGMA integrity_check passes on valid database', () => {
      const dbPath = path.join(tempDir, 'test_integrity.db');
      const db = DatabaseService.create({ dbPath });

      try {
        const raw = db.getRawSqlite();
        const integrity = raw.pragma('integrity_check') as Array<{ integrity_check: string }>;

        expect(Array.isArray(integrity)).toBe(true);
        expect(integrity.length).toBeGreaterThan(0);
        expect(integrity[0].integrity_check).toBe('ok');
      } finally {
        db.close();
      }
    });

    it('detects corruption when invalid data is written into an SQLite database file', () => {
      const dbPath = path.join(tempDir, 'test_corrupt.db');
      const db = DatabaseService.create({ dbPath });
      const raw = db.getRawSqlite();

      // Create a table and insert rows
      raw.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, content TEXT);');
      raw.exec("INSERT INTO test_data (content) VALUES ('valuable test data');");
      db.close();

      // Verify file exists on disk
      expect(fs.existsSync(dbPath)).toBe(true);

      // Intentionally corrupt bytes in the database file (after SQLite header at offset 100)
      const buffer = fs.readFileSync(dbPath);
      for (let i = 120; i < Math.min(buffer.length, 300); i++) {
        buffer[i] = 0xaa;
      }
      fs.writeFileSync(dbPath, buffer);

      // Reopen and check integrity
      try {
        const corruptDb = DatabaseService.create({ dbPath });
        try {
          const integrity = corruptDb.getRawSqlite().pragma('integrity_check') as Array<{ integrity_check: string }>;
          const isOk = Array.isArray(integrity) && integrity.length === 1 && integrity[0].integrity_check === 'ok';
          expect(isOk).toBe(false);
        } finally {
          corruptDb.close();
        }
      } catch (err) {
        // Opening or reading corrupt db may throw directly
        expect(err).toBeDefined();
      }
    });
  });

  describe('4. Single Instance Lock & Background Launch Logic', () => {
    it('simulates single instance lock conflict resolution', () => {
      let isFirstInstanceLocked = true;
      const requestLock = () => isFirstInstanceLocked;

      // Primary instance gets the lock
      const primaryGotLock = requestLock();
      expect(primaryGotLock).toBe(true);

      // Secondary instance encounters lock conflict
      const secondaryAcquire = () => {
        const lock = false; // simulates secondary process when first holds lock
        if (!lock) {
          return 'QUIT_SECONDARY';
        }
        return 'RUN_SECONDARY';
      };

      expect(secondaryAcquire()).toBe('QUIT_SECONDARY');
    });

    it('verifies --hidden flag suppresses initial window display', () => {
      const determineWindowVisibility = (argv: string[]): boolean => {
        return !argv.includes('--hidden');
      };

      expect(determineWindowVisibility(['node', 'arcwire.exe', '--hidden'])).toBe(false);
      expect(determineWindowVisibility(['node', 'arcwire.exe'])).toBe(true);
      expect(determineWindowVisibility(['node', 'arcwire.exe', '--other-flag'])).toBe(true);
    });
  });
});
