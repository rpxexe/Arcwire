import { eq, desc, and } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { sharedFolders, folderPermissions } from '../schema/index';
import type { SharedFolderItem, FolderPermission } from '@ipm/shared';

export class SharedFolderRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  private mapFolderRow(r: typeof sharedFolders.$inferSelect): SharedFolderItem {
    return {
      id: r.id,
      name: r.name,
      localPath: r.localPath,
      defaultPermission: r.defaultPermission as FolderPermission,
      isEnabled: Boolean(r.isEnabled),
      createdAt: r.createdAt,
    };
  }

  public createSharedFolder(options: {
    id: string;
    name: string;
    localPath: string;
    defaultPermission?: FolderPermission;
  }): SharedFolderItem {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.insert(sharedFolders)
      .values({
        id: options.id,
        name: options.name,
        localPath: options.localPath,
        defaultPermission: options.defaultPermission || 'read_only',
        isEnabled: 1,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    const created = this.getSharedFolderById(options.id);
    if (!created) {
      throw new Error(`Failed to create shared folder ${options.id}`);
    }
    return created;
  }

  public getSharedFolderById(id: string): SharedFolderItem | null {
    const db = this.dbService.getDb();
    const rows = db.select().from(sharedFolders).where(eq(sharedFolders.id, id)).limit(1).all();
    if (rows.length === 0 || !rows[0]) return null;
    return this.mapFolderRow(rows[0]);
  }

  public listSharedFolders(): SharedFolderItem[] {
    const db = this.dbService.getDb();
    const rows = db.select().from(sharedFolders).orderBy(desc(sharedFolders.createdAt)).all();
    return rows.map((r) => this.mapFolderRow(r));
  }

  public updateSharedFolder(
    id: string,
    partial: { name?: string; defaultPermission?: FolderPermission; isEnabled?: boolean }
  ): SharedFolderItem | null {
    const db = this.dbService.getDb();
    const updateData: Partial<typeof sharedFolders.$inferInsert> = {};
    if (partial.name !== undefined) updateData.name = partial.name;
    if (partial.defaultPermission !== undefined) updateData.defaultPermission = partial.defaultPermission;
    if (partial.isEnabled !== undefined) updateData.isEnabled = partial.isEnabled ? 1 : 0;

    db.update(sharedFolders)
      .set(updateData)
      .where(eq(sharedFolders.id, id))
      .run();

    return this.getSharedFolderById(id);
  }

  public deleteSharedFolder(id: string): boolean {
    const db = this.dbService.getDb();
    const result = db.delete(sharedFolders).where(eq(sharedFolders.id, id)).run();
    return result.changes > 0;
  }

  public setFolderPermission(
    folderId: string,
    deviceId: string,
    permissionLevel: FolderPermission
  ): void {
    const db = this.dbService.getDb();
    const id = `fp_${folderId}_${deviceId}`;
    const now = Date.now();

    db.insert(folderPermissions)
      .values({
        id,
        folderId,
        deviceId,
        permissionLevel,
        grantedAt: now,
      })
      .onConflictDoUpdate({
        target: folderPermissions.id,
        set: {
          permissionLevel,
          grantedAt: now,
        },
      })
      .run();
  }

  public getEffectivePermission(folderId: string, deviceId: string): FolderPermission {
    const db = this.dbService.getDb();
    const folder = this.getSharedFolderById(folderId);
    if (!folder || !folder.isEnabled) {
      return 'read_only';
    }

    // Check device-specific override
    const row = db
      .select()
      .from(folderPermissions)
      .where(and(eq(folderPermissions.folderId, folderId), eq(folderPermissions.deviceId, deviceId)))
      .limit(1)
      .all()[0];

    if (row) {
      return row.permissionLevel as FolderPermission;
    }

    return folder.defaultPermission;
  }
}

