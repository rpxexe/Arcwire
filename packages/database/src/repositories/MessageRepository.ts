import { eq, asc } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { messages } from '../schema/index';
import type { MessageItem } from '@ipm/shared';

export class MessageRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public getMessages(conversationId: string, limit: number = 50): MessageItem[] {
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

  public insertMessage(msg: MessageItem): void {
    const db = this.dbService.getDb();
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
  }

  public updateMessageStatus(id: string, status: MessageItem['deliveryStatus'], timestamp: number): void {
    const db = this.dbService.getDb();
    const updateData: Partial<typeof messages.$inferInsert> = {
      deliveryStatus: status,
    };
    if (status === 'delivered') updateData.deliveredAt = timestamp;
    if (status === 'read') updateData.readAt = timestamp;

    db.update(messages)
      .set(updateData)
      .where(eq(messages.id, id))
      .run();
  }
}
