import { hash, verify } from '@node-rs/argon2';

export interface Argon2Options {
  memoryCost?: number; // in KB, default 19456 (19 MB)
  timeCost?: number;   // iterations, default 2
  parallelism?: number; // threads, default 1
}

export class Argon2Hasher {
  private static defaultOptions: Argon2Options = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  /**
   * Hashes a password or PIN using Argon2id with a cryptographically secure random salt.
   * Produces a standard Argon2id PHC format string: $argon2id$v=19$m=...,t=...,p=...$salt$hash
   */
  public static async hashPassword(password: string, options?: Argon2Options): Promise<string> {
    const opts = { ...this.defaultOptions, ...options };
    return hash(password, {
      algorithm: 2, // Argon2id
      memoryCost: opts.memoryCost,
      timeCost: opts.timeCost,
      outputLen: 32,
      parallelism: opts.parallelism,
    });
  }

  /**
   * Verifies a candidate password against an Argon2id hash.
   */
  public static async verifyPassword(hashedPassword: string, candidate: string): Promise<boolean> {
    try {
      return await verify(hashedPassword, candidate);
    } catch {
      return false;
    }
  }
}
