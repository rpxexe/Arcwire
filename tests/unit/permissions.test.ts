import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { validatePathWithinRoot, sanitizeFileName, SecurityException } from '@ipm/security';

describe('Security Package - Path Traversal Guard', () => {
  const rootDir = path.resolve('c:/lan_shares/public');

  it('permits valid subpaths within root', () => {
    const valid = validatePathWithinRoot('subfolder/document.pdf', rootDir);
    expect(valid).toBe(path.join(rootDir, 'subfolder', 'document.pdf'));
  });

  it('rejects dot-dot traversal attempts', () => {
    expect(() => {
      validatePathWithinRoot('../secret.txt', rootDir);
    }).toThrow(SecurityException);

    expect(() => {
      validatePathWithinRoot('subfolder/../../windows/system32/cmd.exe', rootDir);
    }).toThrow(SecurityException);
  });

  it('sanitizes untrusted filenames', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('report:annual<2026>.docx')).toBe('report_annual_2026_.docx');
  });
});
