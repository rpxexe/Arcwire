import { eq, asc, desc, and, ne, isNull, like, sql, inArray } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { messages, messageReceipts, conversations } from '../schema/index';
import type { MessageItem } from '@ipm/shared';

export class MessageRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  private mapMessageRow(r: typeof messages.$inferSelect): MessageItem {
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
      replyToId: r.replyToId ?? null,
      isDeleted: Boolean(r.isDeleted),
      editedAt: r.editedAt ?? null,
      reactions: this.parseReactions(r.reactions),
      isPinned: Boolean(r.isPinned),
      isStarred: Boolean(r.isStarred),
    };
  }

  private parseReactions(raw: string | null | undefined): Record<string, string[]> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  public getMessages(conversationId: string, limit: number = 100): MessageItem[] {
    const db = this.dbService.getDb();
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.sentAt), desc(messages.sequence))
      .limit(limit)
      .all();

    // Return the most recent `limit` messages in chronological order
    return rows.reverse().map((r) => this.mapMessageRow(r));
  }

  public getMessageById(id: string): MessageItem | null {
    const db = this.dbService.getDb();
    const rows = db.select().from(messages).where(eq(messages.id, id)).limit(1).all();
    if (rows.length === 0 || !rows[0]) return null;
    return this.mapMessageRow(rows[0]);
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
        replyToId: msg.replyToId ?? null,
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

  // ==========================================
  // Message actions (delete / edit / react / flags)
  // ==========================================

  /** Permanently removes a message from the local database ("delete for me"). */
  public deleteMessageLocally(id: string): boolean {
    const db = this.dbService.getDb();
    const result = db.delete(messages).where(eq(messages.id, id)).run();
    return result.changes > 0;
  }

  /** Tombstones a message ("delete for everyone"): content is wiped, row kept for ordering. */
  public markMessageDeleted(id: string): MessageItem | null {
    const db = this.dbService.getDb();
    db.update(messages)
      .set({ isDeleted: 1, content: '', reactions: null, isPinned: 0, isStarred: 0 })
      .where(eq(messages.id, id))
      .run();
    return this.getMessageById(id);
  }

  public editMessageContent(id: string, content: string, editedAt: number = Date.now()): MessageItem | null {
    const db = this.dbService.getDb();
    db.update(messages)
      .set({ content, editedAt })
      .where(and(eq(messages.id, id), eq(messages.isDeleted, 0)))
      .run();
    return this.getMessageById(id);
  }

  /**
   * Toggles (or explicitly sets) a reaction emoji for a device.
   * A device may hold a single reaction per message (Instagram-style): choosing a
   * new emoji replaces the previous one; choosing the same emoji removes it.
   */
  public toggleReaction(id: string, deviceId: string, emoji: string, active?: boolean): MessageItem | null {
    const current = this.getMessageById(id);
    if (!current || current.isDeleted) return current;

    const reactions: Record<string, string[]> = { ...(current.reactions ?? {}) };
    const hadThis = (reactions[emoji] ?? []).includes(deviceId);
    const shouldBeActive = active ?? !hadThis;

    for (const key of Object.keys(reactions)) {
      reactions[key] = (reactions[key] ?? []).filter((d) => d !== deviceId);
      if (reactions[key]!.length === 0) delete reactions[key];
    }
    if (shouldBeActive) {
      reactions[emoji] = [...(reactions[emoji] ?? []), deviceId];
    }

    const db = this.dbService.getDb();
    db.update(messages)
      .set({ reactions: Object.keys(reactions).length > 0 ? JSON.stringify(reactions) : null })
      .where(eq(messages.id, id))
      .run();
    return this.getMessageById(id);
  }

  public setMessageFlags(id: string, flags: { isPinned?: boolean; isStarred?: boolean }): MessageItem | null {
    const db = this.dbService.getDb();
    const update: Partial<typeof messages.$inferInsert> = {};
    if (flags.isPinned !== undefined) update.isPinned = flags.isPinned ? 1 : 0;
    if (flags.isStarred !== undefined) update.isStarred = flags.isStarred ? 1 : 0;
    if (Object.keys(update).length > 0) {
      db.update(messages).set(update).where(eq(messages.id, id)).run();
    }
    return this.getMessageById(id);
  }

  public deleteMessagesForConversation(conversationId: string): number {
    const db = this.dbService.getDb();
    const result = db.delete(messages).where(eq(messages.conversationId, conversationId)).run();
    return result.changes;
  }

  public searchMessages(query: string, conversationId?: string, includePrivate: boolean = false): MessageItem[] {
    const db = this.dbService.getDb();
    const term = `%${query}%`;

    if (conversationId) {
      if (!includePrivate) {
        const conv = db
          .select({ type: conversations.type })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1)
          .all()[0];
        if (conv?.type === 'private') {
          return [];
        }
      }

      const rows = db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, conversationId), like(messages.content, term), eq(messages.isDeleted, 0)))
        .orderBy(desc(messages.sentAt))
        .limit(50)
        .all();

      return rows.map((r) => this.mapMessageRow(r));
    }

    // Global search across conversations
    if (includePrivate) {
      const rows = db
        .select()
        .from(messages)
        .where(and(like(messages.content, term), eq(messages.isDeleted, 0)))
        .orderBy(desc(messages.sentAt))
        .limit(50)
        .all();
      return rows.map((r) => this.mapMessageRow(r));
    }

    // Exclude messages belonging to private conversations
    const nonPrivateConvIds = db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(ne(conversations.type, 'private'), eq(conversations.isChatLocked, 0)))
      .all()
      .map((c) => c.id);

    if (nonPrivateConvIds.length === 0) {
      return [];
    }

    const rows = db
      .select()
      .from(messages)
      .where(and(inArray(messages.conversationId, nonPrivateConvIds), like(messages.content, term), eq(messages.isDeleted, 0)))
      .orderBy(desc(messages.sentAt))
      .limit(50)
      .all();

    return rows.map((r) => this.mapMessageRow(r));
  }
}
