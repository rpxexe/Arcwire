import { describe, it, expect } from 'vitest';
import { FolderSecurityManager, SecurityError } from '@ipm/file-sharing';
import { FolderPermission } from '@ipm/shared';

describe('FolderSecurityManager (Section 9 LAN Folder Permissions)', () => {
  describe('Permission Matrix: read_only', () => {
    const perm: FolderPermission = 'read_only';

    it('allows read and download operations', () => {
      expect(FolderSecurityManager.hasPermission('list', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('download', perm)).toBe(true);
    });

    it('rejects upload, modify, rename, and delete operations', () => {
      expect(FolderSecurityManager.hasPermission('upload', perm)).toBe(false);
      expect(FolderSecurityManager.hasPermission('create_dir', perm)).toBe(false);
      expect(FolderSecurityManager.hasPermission('rename', perm)).toBe(false);
      expect(FolderSecurityManager.hasPermission('delete', perm)).toBe(false);

      expect(() => FolderSecurityManager.assertPermission('upload', perm)).toThrow(SecurityError);
      expect(() => FolderSecurityManager.assertPermission('delete', perm)).toThrow(SecurityError);
    });
  });

  describe('Permission Matrix: upload', () => {
    const perm: FolderPermission = 'upload';

    it('allows list, download, upload, and create_dir', () => {
      expect(FolderSecurityManager.hasPermission('list', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('download', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('upload', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('create_dir', perm)).toBe(true);
    });

    it('rejects rename and delete operations', () => {
      expect(FolderSecurityManager.hasPermission('rename', perm)).toBe(false);
      expect(FolderSecurityManager.hasPermission('delete', perm)).toBe(false);

      expect(() => FolderSecurityManager.assertPermission('rename', perm)).toThrow(SecurityError);
      expect(() => FolderSecurityManager.assertPermission('delete', perm)).toThrow(SecurityError);
    });
  });

  describe('Permission Matrix: modify', () => {
    const perm: FolderPermission = 'modify';

    it('allows list, download, upload, create_dir, and rename', () => {
      expect(FolderSecurityManager.hasPermission('list', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('download', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('upload', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('create_dir', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('rename', perm)).toBe(true);
    });

    it('rejects delete operations', () => {
      expect(FolderSecurityManager.hasPermission('delete', perm)).toBe(false);
      expect(() => FolderSecurityManager.assertPermission('delete', perm)).toThrow(SecurityError);
    });
  });

  describe('Permission Matrix: full_control', () => {
    const perm: FolderPermission = 'full_control';

    it('allows all filesystem operations including delete', () => {
      expect(FolderSecurityManager.hasPermission('list', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('download', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('upload', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('create_dir', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('rename', perm)).toBe(true);
      expect(FolderSecurityManager.hasPermission('delete', perm)).toBe(true);

      expect(() => FolderSecurityManager.assertPermission('delete', perm)).not.toThrow();
    });
  });
});

