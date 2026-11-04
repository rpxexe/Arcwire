import { eq, desc, and } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { transfers } from '../schema/index';
import type { TransferItem, TransferStatus } from '@ipm/shared';

export class TransferRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  private mapTransferRow(r: typeof transfers.$inferSelect): TransferItem {
    return {
      id: r.id,
      conversationId: r.conversationId,
      direction: r.direction as TransferItem['direction'],
      remoteDeviceId: r.remoteDeviceId,
      fileName: r.fileName,
      fileSize: r.fileSize,
      fileHash: r.fileHash,
      tempPath: r.tempPath,
      finalPath: r.finalPath,
      bytesTransferred: r.bytesTransferred,
      status: r.status as TransferStatus,
      speed: 0,
      remainingTime: 0,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  public createTransfer(options: {
    id: string;
    conversationId: string;
    direction: 'incoming' | 'outgoing';
    remoteDeviceId: string;
    fileName: string;
    fileSize: number;
    fileHash: string;
    tempPath: string;
    finalPath?: string | null;
    status?: TransferStatus;
  }): TransferItem {
    const db = this.dbService.getDb();
    const now = Date.now();
    const status = options.status || (options.direction === 'outgoing' ? 'accepted' : 'offered');

    db.insert(transfers)
      .values({
        id: options.id,
        conversationId: options.conversationId,
        direction: options.direction,
        remoteDeviceId: options.remoteDeviceId,
        fileName: options.fileName,
        fileSize: options.fileSize,
        fileHash: options.fileHash,
        tempPath: options.tempPath,
        finalPath: options.finalPath || null,
        bytesTransferred: 0,
        status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    const created = this.getTransferById(options.id);
    if (!created) {
      throw new Error(`Failed to create transfer ${options.id}`);
    }
    return created;
  }

  public getTransferById(id: string): TransferItem | null {
    const db = this.dbService.getDb();
    const rows = db.select().from(transfers).where(eq(transfers.id, id)).limit(1).all();
    if (rows.length === 0 || !rows[0]) return null;
    return this.mapTransferRow(rows[0]);
  }

  public listTransfers(conversationId?: string): TransferItem[] {
    const db = this.dbService.getDb();
    let rows;
    if (conversationId) {
      rows = db
        .select()
        .from(transfers)
        .where(eq(transfers.conversationId, conversationId))
        .orderBy(desc(transfers.createdAt))
        .all();
    } else {
      rows = db.select().from(transfers).orderBy(desc(transfers.createdAt)).all();
    }
    return rows.map((r) => this.mapTransferRow(r));
  }

  public updateTransferProgress(id: string, bytesTransferred: number, status?: TransferStatus): void {
    const db = this.dbService.getDb();
    const now = Date.now();
    const updateData: Partial<typeof transfers.$inferInsert> = {
      bytesTransferred,
      updatedAt: now,
    };
    if (status) {
      updateData.status = status;
    }

    db.update(transfers)
      .set(updateData)
      .where(eq(transfers.id, id))
      .run();
  }

  public completeTransfer(id: string, finalPath: string): void {
    const db = this.dbService.getDb();
    const now = Date.now();
    const current = this.getTransferById(id);

    db.update(transfers)
      .set({
        bytesTransferred: current ? current.fileSize : undefined,
        finalPath,
        status: 'completed',
        updatedAt: now,
      })
      .where(eq(transfers.id, id))
      .run();
  }

  public failTransfer(id: string, errorMessage: string): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.update(transfers)
      .set({
        status: 'failed',
        errorMessage,
        updatedAt: now,
      })
      .where(eq(transfers.id, id))
      .run();
  }

  public cancelTransfer(id: string): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.update(transfers)
      .set({
        status: 'cancelled',
        updatedAt: now,
      })
      .where(eq(transfers.id, id))
      .run();
  }

  public setStatus(id: string, status: TransferStatus): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.update(transfers)
      .set({
        status,
        updatedAt: now,
      })
      .where(eq(transfers.id, id))
      .run();
  }
}

