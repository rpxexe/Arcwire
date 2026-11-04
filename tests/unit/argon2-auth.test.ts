import { describe, it, expect } from 'vitest';
import { Argon2Hasher } from '@ipm/security';

describe('Argon2Hasher (Argon2id Authentication)', () => {
  it('should hash a password and produce a valid Argon2id PHC string', async () => {
    const password = 'SecretMasterPassphrase123!';
    const hashed = await Argon2Hasher.hashPassword(password);

    expect(hashed).toBeDefined();
    expect(typeof hashed).toBe('string');
    // PHC format begins with $argon2id$
    expect(hashed.startsWith('$argon2id$')).toBe(true);
  });

  it('should verify matching passwords successfully', async () => {
    const password = 'SuperSecureLANMessengerPin!987';
    const hashed = await Argon2Hasher.hashPassword(password);

    const isMatch = await Argon2Hasher.verifyPassword(hashed, password);
    expect(isMatch).toBe(true);
  });

  it('should reject incorrect candidate passwords', async () => {
    const password = 'CorrectPassword';
    const wrongPassword = 'WrongPassword';
    const hashed = await Argon2Hasher.hashPassword(password);

    const isMatch = await Argon2Hasher.verifyPassword(hashed, wrongPassword);
    expect(isMatch).toBe(false);
  });

  it('should produce different hashes for identical passwords due to unique salts', async () => {
    const password = 'SamePasswordTwice';
    const hash1 = await Argon2Hasher.hashPassword(password);
    const hash2 = await Argon2Hasher.hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await Argon2Hasher.verifyPassword(hash1, password)).toBe(true);
    expect(await Argon2Hasher.verifyPassword(hash2, password)).toBe(true);
  });

  it('should safely return false on corrupted hash string', async () => {
    const isMatch = await Argon2Hasher.verifyPassword('invalid_phc_format', 'candidate');
    expect(isMatch).toBe(false);
  });
});

