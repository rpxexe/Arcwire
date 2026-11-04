import { describe, it, expect } from 'vitest';
import { InvitationTokenManager } from '@ipm/security';

describe('InvitationTokenManager (PRV-XXXX-XXXX System)', () => {
  it('should generate codes conforming strictly to PRV-XXXX-XXXX format', () => {
    for (let i = 0; i < 20; i++) {
      const code = InvitationTokenManager.generateCode();
      expect(code).toMatch(/^PRV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    }
  });

  it('should exclude visually ambiguous characters (0, O, 1, I)', () => {
    for (let i = 0; i < 50; i++) {
      const code = InvitationTokenManager.generateCode();
      expect(code).not.toContain('0');
      expect(code).not.toContain('O');
      expect(code).not.toContain('1');
      expect(code).not.toContain('I');
    }
  });

  it('should validate correctly formatted codes and reject malformed ones', () => {
    expect(InvitationTokenManager.isValidFormat('PRV-82K9-X7QM')).toBe(true);
    expect(InvitationTokenManager.isValidFormat('prv-82k9-x7qm')).toBe(true); // case-insensitive check
    expect(InvitationTokenManager.isValidFormat('PRV-0000-1111')).toBe(false); // contains excluded 0 and 1
    expect(InvitationTokenManager.isValidFormat('PRV-82K-X7QM')).toBe(false); // short chunk
    expect(InvitationTokenManager.isValidFormat('INV-82K9-X7QM')).toBe(false); // wrong prefix
    expect(InvitationTokenManager.isValidFormat('')).toBe(false);
  });

  it('should normalize codes by trimming whitespace and converting to uppercase', () => {
    expect(InvitationTokenManager.normalizeCode('  prv-82k9-x7qm  ')).toBe('PRV-82K9-X7QM');
    expect(InvitationTokenManager.normalizeCode('PRV-82k9-X7qm')).toBe('PRV-82K9-X7QM');
  });

  it('should compute consistent SHA-256 hashes of invitation tokens', () => {
    const code = 'PRV-82K9-X7QM';
    const hash1 = InvitationTokenManager.hashCode(code);
    const hash2 = InvitationTokenManager.hashCode(code);

    expect(hash1).toHaveLength(64); // 32 bytes in hex
    expect(hash1).toBe(hash2);

    // Normalization should ensure case differences result in identical hash
    const lowerHash = InvitationTokenManager.hashCode('prv-82k9-x7qm');
    expect(lowerHash).toBe(hash1);
  });
});
