import type { FolderPermission } from '@ipm/shared';
import { SecurityError } from './PathTraversalGuard';

export type FolderOperation = 'list' | 'download' | 'create_dir' | 'upload' | 'rename' | 'delete';

export class FolderSecurityManager {
  private static readonly PERMISSION_HIERARCHY: Record<FolderPermission, number> = {
    read_only: 1,
    upload: 2,
    modify: 3,
    full_control: 4,
  };

  private static readonly OPERATION_REQUIREMENTS: Record<FolderOperation, FolderPermission> = {
    list: 'read_only',
    download: 'read_only',
    create_dir: 'upload',
    upload: 'upload',
    rename: 'modify',
    delete: 'full_control',
  };

  /**
   * Asserts whether a given operation is permitted under the assigned permission level.
   * Throws SecurityError if unauthorized.
   */
  public static assertPermission(operation: FolderOperation, permission: FolderPermission): void {
    const requiredLevel = this.OPERATION_REQUIREMENTS[operation];
    const userRank = this.PERMISSION_HIERARCHY[permission] ?? 0;
    const requiredRank = this.PERMISSION_HIERARCHY[requiredLevel];

    if (userRank < requiredRank) {
      throw new SecurityError(
        `Operation '${operation}' rejected: requires '${requiredLevel}' permission, but granted '${permission}'`
      );
    }
  }

  /**
   * Non-throwing boolean check for permission.
   */
  public static hasPermission(operation: FolderOperation, permission: FolderPermission): boolean {
    try {
      this.assertPermission(operation, permission);
      return true;
    } catch {
      return false;
    }
  }
}

