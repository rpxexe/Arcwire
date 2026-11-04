import path from 'node:path';
import fs from 'node:fs';

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class PathTraversalGuard {
  private static readonly WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

  /**
   * Sanitizes a single filename (not a path) to remove path separators and illegal characters.
   */
  public static sanitizeFilename(filename: string): string {
    const base = path.basename(filename.replace(/[\\/]/g, path.sep));
    // Strip control characters and null bytes
    const noControl = base.replace(/[\x00-\x1F\x7F]/g, '');
    // Replace remaining filesystem reserved characters (< > : " / \ | ? *)
    const cleaned = noControl.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (this.WINDOWS_RESERVED.test(cleaned)) {
      return `_${cleaned}`;
    }
    return cleaned || 'unnamed_file';
  }

  /**
   * Validates that rootPath is safe to share (not a system root like C:\ or /).
   */
  public static validateRootPath(rootPath: string): string {
    const resolved = path.resolve(rootPath);
    const root = path.parse(resolved).root;
    if (resolved === root) {
      throw new SecurityError(`Sharing whole filesystem root (${root}) is strictly forbidden`);
    }
    if (!fs.existsSync(resolved)) {
      throw new SecurityError(`Shared folder does not exist: ${resolved}`);
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new SecurityError(`Shared path is not a directory: ${resolved}`);
    }
    return resolved;
  }

  /**
   * Confines and canonicalizes a relative subpath within an authorized rootPath.
   * Throws SecurityError if directory traversal (../) or symlink escapes the boundary.
   */
  public static resolveSafePath(rootPath: string, relativeSubPath: string): string {
    const safeRoot = this.validateRootPath(rootPath);

    // Block null bytes and control characters
    if (/[\x00-\x1F\x7F]/.test(relativeSubPath)) {
      throw new SecurityError(`Path contains forbidden control characters or null bytes: ${relativeSubPath}`);
    }

    // Block UNC network paths
    if (relativeSubPath.startsWith('\\\\') || relativeSubPath.startsWith('//')) {
      throw new SecurityError(`UNC network paths are forbidden: ${relativeSubPath}`);
    }

    // Normalize relative path
    const normalizedSub = relativeSubPath.replace(/\\/g, '/').replace(/^\/+/, '');

    // Block NTFS Alternate Data Streams (ADS) and illicit drive specifiers in subpath
    if (normalizedSub.includes(':')) {
      throw new SecurityError(`Alternate Data Streams (ADS) and drive specifiers in subpath are forbidden: ${relativeSubPath}`);
    }

    const resolvedTarget = path.resolve(safeRoot, normalizedSub);

    // Verify prefix boundary
    const relative = path.relative(safeRoot, resolvedTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new SecurityError(`Path traversal attempt blocked: ${relativeSubPath}`);
    }

    // Check each segment for reserved device names
    const segments = normalizedSub.split('/');
    for (const seg of segments) {
      if (seg && this.WINDOWS_RESERVED.test(seg)) {
        throw new SecurityError(`Access to Windows reserved device name blocked: ${seg}`);
      }
    }

    // Check for symlinks or reparse points escaping boundary
    if (fs.existsSync(resolvedTarget)) {
      try {
        const realTarget = fs.realpathSync(resolvedTarget);
        const realRelative = path.relative(fs.realpathSync(safeRoot), realTarget);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
          throw new SecurityError(`Reparse point/symlink escape attempt blocked: ${resolvedTarget}`);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }

    return resolvedTarget;
  }
}
