import crypto from 'node:crypto';

// Unambiguous character alphabet (32 characters, excluding O, 0, I, 1 to prevent human transcription errors)
const INVITATION_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITATION_REGEX = /^PRV-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/i;

export class InvitationTokenManager {
  /**
   * Generates a cryptographically secure random invitation code in format:
   * PRV-XXXX-XXXX (e.g. PRV-82K9-X7QM)
   */
  public static generateCode(): string {
    const bytes = crypto.randomBytes(8);
    let part1 = '';
    let part2 = '';

    for (let i = 0; i < 4; i++) {
      const idx1 = (bytes[i] ?? 0) % INVITATION_ALPHABET.length;
      part1 += INVITATION_ALPHABET[idx1];
    }

    for (let i = 4; i < 8; i++) {
      const idx2 = (bytes[i] ?? 0) % INVITATION_ALPHABET.length;
      part2 += INVITATION_ALPHABET[idx2];
    }

    return `PRV-${part1}-${part2}`;
  }

  /**
   * Normalizes an invitation code (trims whitespace, converts to uppercase).
   */
  public static normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  /**
   * Validates whether a string matches the required PRV-XXXX-XXXX format.
   */
  public static isValidFormat(code: string): boolean {
    return INVITATION_REGEX.test(this.normalizeCode(code));
  }

  /**
   * Computes a SHA-256 hash of the normalized invitation code for secure storage.
   * Raw invitation codes must never be stored in plain text in the database.
   */
  public static hashCode(code: string): string {
    const normalized = this.normalizeCode(code);
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }
}
