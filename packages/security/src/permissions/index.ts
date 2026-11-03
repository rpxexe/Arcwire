import path from 'node:path';
import fs from 'node:fs';

export class SecurityException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityException';
  }
}

/**
 * Validates that a requested path strictly resides within the configured root directory.
 * Defends against:
 * - Dot-dot traversal (`../../windows/system32`)
 * - Absolute path overrides (`C:\Windows`)
 * - Windows reparse point / symlink escapes
 */
export function validatePathWithinRoot(targetPath: string, rootDir: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, targetPath);

  // Check if target is inside root boundary
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SecurityException(`Path traversal attack detected: "${targetPath}" is outside root boundary.`);
  }

  // If the path exists on disk, check for symlink / reparse point boundary escape
  if (fs.existsSync(resolvedTarget)) {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realTarget = fs.realpathSync(resolvedTarget);
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new SecurityException(`Reparse point traversal detected: "${targetPath}" points outside root boundary.`);
    }
    return realTarget;
  }

  return resolvedTarget;
}

/**
 * Strips dangerous filesystem characters and path separators from an untrusted filename.
 */
export function sanitizeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[/\\?%*:|"<>]/g, '_');
}
