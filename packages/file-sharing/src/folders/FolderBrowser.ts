import fs from 'node:fs';
import path from 'node:path';
import type { RemoteFolderItem } from '@ipm/shared';
import { PathTraversalGuard, SecurityError } from '../security/PathTraversalGuard';

export class FolderBrowser {
  /**
   * Lists the contents of a directory safely confined within rootPath.
   */
  public static async listDirectory(
    rootPath: string,
    subPath: string = ''
  ): Promise<RemoteFolderItem[]> {
    const safeTarget = PathTraversalGuard.resolveSafePath(rootPath, subPath);
    const entries = await fs.promises.readdir(safeTarget, { withFileTypes: true });

    const items: RemoteFolderItem[] = [];

    for (const entry of entries) {
      try {
        const fullEntryPath = path.join(safeTarget, entry.name);
        const stat = await fs.promises.stat(fullEntryPath);
        const relative = path.relative(rootPath, fullEntryPath).replace(/\\/g, '/');

        items.push({
          name: entry.name,
          relativePath: relative,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? 0 : stat.size,
          modifiedAt: Math.round(stat.mtimeMs),
        });
      } catch (err) {
        // Skip inaccessible entries without breaking whole listing
        console.warn(`[FolderBrowser] Skipping inaccessible item ${entry.name}:`, err);
      }
    }

    // Sort: directories first, then files alphabetically
    return items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  /**
   * Creates a directory confined within rootPath.
   */
  public static async createDirectory(rootPath: string, subPath: string): Promise<string> {
    const safeTarget = PathTraversalGuard.resolveSafePath(rootPath, subPath);
    await fs.promises.mkdir(safeTarget, { recursive: true });
    return safeTarget;
  }

  /**
   * Safely renames or moves a file/directory confined within rootPath.
   */
  public static async renameItem(
    rootPath: string,
    oldSubPath: string,
    newSubPath: string
  ): Promise<void> {
    const safeOld = PathTraversalGuard.resolveSafePath(rootPath, oldSubPath);
    const safeNew = PathTraversalGuard.resolveSafePath(rootPath, newSubPath);
    await fs.promises.rename(safeOld, safeNew);
  }

  /**
   * Safely deletes a file or directory confined within rootPath.
   */
  public static async deleteItem(rootPath: string, subPath: string): Promise<void> {
    const safeTarget = PathTraversalGuard.resolveSafePath(rootPath, subPath);
    const safeRoot = PathTraversalGuard.validateRootPath(rootPath);

    // Prevent deleting the root itself
    if (path.resolve(safeTarget) === path.resolve(safeRoot)) {
      throw new SecurityError('Deleting the root shared folder itself is strictly forbidden');
    }

    const stat = await fs.promises.stat(safeTarget);
    if (stat.isDirectory()) {
      await fs.promises.rm(safeTarget, { recursive: true, force: true });
    } else {
      await fs.promises.unlink(safeTarget);
    }
  }
}

