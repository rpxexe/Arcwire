import { eq, asc, desc, and, ne, isNull, like, sql } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { messages, messageReceipts } from '../schema/index';
import type { MessageItem } from '@ipm/shared';

export class MessageRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public getMessages(conversationId: string, limit: number = 100): MessageItem[] {
    const db = this.dbService.getDb();
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.sequence))
      .limit(limit)
      .all();

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      sequence: r.sequence,
      content: r.content,
      contentType: r.contentType as MessageItem['contentType'],
      deliveryStatus: r.deliveryStatus as MessageItem['deliveryStatus'],
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      isEncrypted: Boolean(r.isEncrypted),
    }));
  }

  public getMessageById(id: string): MessageItem | null {
    const db = this.dbService.getDb();
    const rows = db.select().from(messages).where(eq(messages.id, id)).limit(1).all();
    if (rows.length === 0 || !rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      sequence: r.sequence,
      content: r.content,
      contentType: r.contentType as MessageItem['contentType'],
      deliveryStatus: r.deliveryStatus as MessageItem['deliveryStatus'],
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      isEncrypted: Boolean(r.isEncrypted),
    };
  }

  public hasMessage(id: string): boolean {
    const db = this.dbService.getDb();
    const rows = db.select({ id: messages.id }).from(messages).where(eq(messages.id, id)).limit(1).all();
    return rows.length > 0;
  }

  public getNextSequence(conversationId: string): number {
    const db = this.dbService.getDb();
    const result = db
      .select({ maxSeq: sql<number>`max(${messages.sequence})` })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();

    const max = Number(result[0]?.maxSeq || 0);
    return max + 1;
  }

  public insertMessage(msg: MessageItem): boolean {
    const db = this.dbService.getDb();
    if (this.hasMessage(msg.id)) {
      return false; // Deduplicated
    }

    db.insert(messages)
      .values({
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        sequence: msg.sequence,
        content: msg.content,
        contentType: msg.contentType,
        deliveryStatus: msg.deliveryStatus,
        sentAt: msg.sentAt,
        deliveredAt: msg.deliveredAt || null,
        readAt: msg.readAt || null,
        isEncrypted: msg.isEncrypted ? 1 : 0,
      })
      .onConflictDoNothing()
      .run();

    return true;
  }

  public updateMessageStatus(
    id: string,
    status: MessageItem['deliveryStatus'],
    deliveredAtTimestamp?: number,
    readAtTimestamp?: number
  ): void {
    const db = this.dbService.getDb();
    const current = this.getMessageById(id);
    if (current) {
      const statusOrder: Record<MessageItem['deliveryStatus'], number> = {
        failed: 0,
        pending: 1,
        sent: 2,
        delivered: 3,
        read: 4,
      };
      if (statusOrder[current.deliveryStatus] >= statusOrder[status]) {
        // Do not regress status
        return;
      }
    }

    const now = Date.now();
    const updateData: Partial<typeof messages.$inferInsert> = {
      deliveryStatus: status,
    };
    if (status === 'delivered') updateData.deliveredAt = deliveredAtTimestamp ?? now;
    if (status === 'read') updateData.readAt = readAtTimestamp ?? now;

    db.update(messages)
      .set(updateData)
      .where(eq(messages.id, id))
      .run();
  }

  public markMessagesAsRead(conversationId: string, readerDeviceId: string, timestamp: number = Date.now()): string[] {
    const db = this.dbService.getDb();

    // Select unread incoming messages from this conversation
    const unread = db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          ne(messages.senderId, readerDeviceId),
          isNull(messages.readAt)
        )
      )
      .all();

    if (unread.length === 0) return [];

    const ids = unread.map((u) => u.id);
    for (const id of ids) {
      db.update(messages)
        .set({
          deliveryStatus: 'read',
          readAt: timestamp,
        })
        .where(eq(messages.id, id))
        .run();
    }

    return ids;
  }

  public recordReceipt(
    messageId: string,
    deviceId: string,
    receiptType: 'ack' | 'delivered' | 'read',
    timestamp: number = Date.now()
  ): void {
    const db = this.dbService.getDb();
    const receiptId = `rcpt_${messageId}_${deviceId}_${receiptType}`;

    db.insert(messageReceipts)
      .values({
        id: receiptId,
        messageId,
        deviceId,
        receiptType,
        receivedAt: timestamp,
      })
      .onConflictDoNothing()
      .run();

    // Update message status if advancing state
    const current = this.getMessageById(messageId);
    if (current) {
      if (receiptType === 'read') {
        this.updateMessageStatus(messageId, 'read', timestamp);
      } else if (receiptType === 'delivered' && current.deliveryStatus !== 'read') {
        this.updateMessageStatus(messageId, 'delivered', timestamp);
      } else if (receiptType === 'ack' && current.deliveryStatus === 'pending') {
        this.updateMessageStatus(messageId, 'sent', timestamp);
      }
    }
  }

  public searchMessages(query: string, conversationId?: string): MessageItem[] {
    const db = this.dbService.getDb();
    const term = `%${query}%`;

    let whereClause = like(messages.content, term);
    if (conversationId) {
      whereClause = and(eq(messages.conversationId, conversationId), like(messages.content, term)) as any;
    }

    const rows = db
      .select()
      .from(messages)
      .where(whereClause)
      .orderBy(desc(messages.sentAt))
      .limit(50)
      .all();

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      sequence: r.sequence,
      content: r.content,
      contentType: r.contentType as MessageItem['contentType'],
      deliveryStatus: r.deliveryStatus as MessageItem['deliveryStatus'],
      sentAt: r.sentAt,
      deliveredAt: r.deliveredAt,
      readAt: r.readAt,
      isEncrypted: Boolean(r.isEncrypted),
    }));
  }
}
