import * as crypto from 'node:crypto';

export interface Argon2Options {
  memoryCost?: number; // in KB, default 19456 (19 MB)
  timeCost?: number;   // iterations, default 2
  parallelism?: number; // threads, default 1
}

type Argon2Module = {
  hash: (password: string, options?: any) => Promise<string>;
  verify: (hashedPassword: string, candidate: string) => Promise<boolean>;
};

let cachedModule: Argon2Module | null = null;
let isModuleChecked = false;

async function getArgon2(): Promise<Argon2Module | null> {
  if (isModuleChecked) {
    return cachedModule;
  }
  isModuleChecked = true;

  try {
    const mod = await import('@node-rs/argon2');
    if (typeof mod.hash === 'function' && typeof mod.verify === 'function') {
      cachedModule = mod as unknown as Argon2Module;
      return cachedModule;
    }
    if (mod.default && typeof (mod.default as any).hash === 'function') {
      cachedModule = mod.default as unknown as Argon2Module;
      return cachedModule;
    }
  } catch {}

  try {
    const req = typeof require !== 'undefined' ? require : null;
    if (req) {
      const mod = req('@node-rs/argon2');
      if (typeof mod?.hash === 'function' && typeof mod?.verify === 'function') {
        cachedModule = mod as Argon2Module;
        return cachedModule;
      }
      if (mod?.default && typeof mod.default.hash === 'function') {
        cachedModule = mod.default as Argon2Module;
        return cachedModule;
      }
    }
  } catch {}

  return null;
}

export class Argon2Hasher {
  private static defaultOptions: Argon2Options = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  /**
   * Hashes a password or PIN using Argon2id with a cryptographically secure random salt.
   * Produces a standard Argon2id PHC format string, with seamless crypto.scrypt fallback.
   */
  public static async hashPassword(password: string, options?: Argon2Options): Promise<string> {
    const argon2 = await getArgon2();
    if (argon2) {
      try {
        const opts = { ...this.defaultOptions, ...options };
        return await argon2.hash(password, {
          algorithm: 2, // Argon2id
          memoryCost: opts.memoryCost,
          timeCost: opts.timeCost,
          outputLen: 32,
          parallelism: opts.parallelism,
        });
      } catch (err) {
        console.warn('[Argon2Hasher] Native Argon2 hashing failed, falling back to scrypt:', err);
      }
    }

    // High-security Node.js native scrypt fallback
    return new Promise<string>((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`$scrypt$N=16384,r=8,p=1$${salt}$${derivedKey.toString('hex')}`);
      });
    });
  }

  /**
   * Verifies a candidate password against an Argon2id or fallback scrypt hash.
   */
  public static async verifyPassword(hashedPassword: string, candidate: string): Promise<boolean> {
    if (!hashedPassword || !candidate) return false;

    // Check if it's a scrypt fallback hash
    if (hashedPassword.startsWith('$scrypt$')) {
      try {
        const parts = hashedPassword.split('$');
        const salt = parts[3];
        const originalHash = parts[4];
        if (!salt || !originalHash) return false;

        const derivedKey = await new Promise<Buffer>((resolve, reject) => {
          crypto.scrypt(candidate, salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => {
            if (err) return reject(err);
            resolve(key);
          });
        });

        const originalBuf = Buffer.from(originalHash, 'hex');
        return crypto.timingSafeEqual(originalBuf, derivedKey);
      } catch {
        return false;
      }
    }

    // Verify using native Argon2
    const argon2 = await getArgon2();
    if (argon2) {
      try {
        return await argon2.verify(hashedPassword, candidate);
      } catch {
        return false;
      }
    }

    return false;
  }
}
