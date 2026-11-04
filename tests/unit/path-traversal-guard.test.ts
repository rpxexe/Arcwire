import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PathTraversalGuard, SecurityError } from '@ipm/file-sharing';

describe('PathTraversalGuard (Section 9 Security Confinement)', () => {
  let tempRootDir: string;

  beforeEach(() => {
    tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-sec-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRootDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Filename Sanitization', () => {
    it('strips directory separators from malicious filenames', () => {
      const sanitized = PathTraversalGuard.sanitizeFilename('../../etc/passwd');
      expect(sanitized).not.toContain('/');
      expect(sanitized).not.toContain('\\');
      expect(sanitized).toBe('passwd');
    });

    it('sanitizes Windows reserved device names', () => {
      const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9'];
      for (const name of reservedNames) {
        const sanitized = PathTraversalGuard.sanitizeFilename(name);
        expect(sanitized.toLowerCase()).not.toBe(name.toLowerCase());
        expect(sanitized).toMatch(/^[a-zA-Z0-9_-]+$/);
      }

      // With extension: CON.txt -> CON_file.txt or _CON.txt
      const conTxt = PathTraversalGuard.sanitizeFilename('CON.txt');
      expect(conTxt.toLowerCase()).not.toBe('con.txt');
    });

    it('strips null bytes and control characters', () => {
      const evil = 'report\x00.pdf\x1f';
      const clean = PathTraversalGuard.sanitizeFilename(evil);
      expect(clean).toBe('report.pdf');
    });

    it('falls back to default safe name for empty or whitespace-only names', () => {
      expect(PathTraversalGuard.sanitizeFilename('')).toBe('unnamed_file');
      expect(PathTraversalGuard.sanitizeFilename('   ')).toBe('unnamed_file');
    });
  });

  describe('Root Path Validation', () => {
    it('rejects whole drive roots on Windows or Unix', () => {
      expect(() => PathTraversalGuard.validateRootPath('C:\\')).toThrow(SecurityError);
      expect(() => PathTraversalGuard.validateRootPath('C:/')).toThrow(SecurityError);
      expect(() => PathTraversalGuard.validateRootPath('/')).toThrow(SecurityError);
      expect(() => PathTraversalGuard.validateRootPath('D:\\')).toThrow(SecurityError);
    });

    it('accepts valid specific subdirectories', () => {
      expect(() => PathTraversalGuard.validateRootPath(tempRootDir)).not.toThrow();
    });
  });

  describe('Safe Path Resolution & Confinement', () => {
    it('resolves valid relative paths inside root directory', () => {
      const sub = path.join(tempRootDir, 'sub');
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(sub, 'test.txt'), 'hello');

      const resolved = PathTraversalGuard.resolveSafePath(tempRootDir, 'sub/test.txt');
      expect(resolved).toBe(path.join(tempRootDir, 'sub', 'test.txt'));
    });

    it('rejects relative path attempting to climb outside root via ../', () => {
      expect(() => {
        PathTraversalGuard.resolveSafePath(tempRootDir, '../evil.txt');
      }).toThrow(SecurityError);

      expect(() => {
        PathTraversalGuard.resolveSafePath(tempRootDir, 'sub/../../secret.txt');
      }).toThrow(SecurityError);
    });

    it('rejects symlinks that resolve outside the shared root (Symlink Escape Protection)', () => {
      // Create external target outside root
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-outside-'));
      const outsideFile = path.join(outsideDir, 'passwords.txt');
      fs.writeFileSync(outsideFile, 'secret-data');

      // Create a symlink inside tempRootDir pointing to outsideFile
      const symlinkPath = path.join(tempRootDir, 'link_to_outside');
      try {
        fs.symlinkSync(outsideFile, symlinkPath);

        // Attempting to resolve the symlink relative path must fail
        expect(() => {
          PathTraversalGuard.resolveSafePath(tempRootDir, 'link_to_outside');
        }).toThrow(SecurityError);
      } catch (err: any) {
        // On Windows without Developer Mode, symlink creation might require privileges; skip if not supported
        if (err.code !== 'EPERM') {
          throw err;
        }
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
