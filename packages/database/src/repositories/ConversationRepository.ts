import { eq, desc, and, ne, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import {
  conversations,
  conversationMembers,
  messages,
  groups,
  devices,
  privateConversations,
} from '../schema/index';
import type { ConversationItem } from '@ipm/shared';

export class ConversationRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  /** Human-readable preview for the conversation list. */
  public static previewText(msg: { content: string; contentType: string; isDeleted?: number | null }): string {
    if (msg.isDeleted) return 'This message was deleted';
    if (msg.contentType === 'file') {
      try {
        const meta = JSON.parse(msg.content) as { fileName?: string; caption?: string };
        return meta.caption ? `Attachment: ${meta.caption}` : `Attachment: ${meta.fileName ?? 'file'}`;
      } catch {
        return 'Attachment';
      }
    }
    return msg.content;
  }

  /**
   * @param includePrivate when true, also returns PIN-protected conversations
   *   (private conversations and chats the user has locked).
   */
  public getConversations(localDeviceId: string = '', includePrivate: boolean = false): ConversationItem[] {
    const db = this.dbService.getDb();
    const rows = db.select().from(conversations).orderBy(desc(conversations.lastActivityAt)).all();

    return rows
      .filter((row) => includePrivate || (row.type !== 'private' && !row.isChatLocked))
      .map((row) => {
        // 1. Fetch last message if available (falls back to newest row if the pointer is stale)
        let lastMsg = row.lastMessageId
          ? db.select().from(messages).where(eq(messages.id, row.lastMessageId)).limit(1).all()[0]
          : undefined;
        if (!lastMsg) {
          lastMsg = db
            .select()
            .from(messages)
            .where(eq(messages.conversationId, row.id))
            .orderBy(desc(messages.sequence))
            .limit(1)
            .all()[0];
        }
        const lastMessageText: string | null = lastMsg ? ConversationRepository.previewText(lastMsg) : null;

        // 2. Count unread messages (where sender is not current device and readAt is null)
        const unreadRows = db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, row.id),
              ne(messages.senderId, localDeviceId),
              isNull(messages.readAt)
            )
          )
          .all();
        const unreadCount = Math.max(Number(unreadRows[0]?.count || 0), row.isMarkedUnread ? 1 : 0);

        // 3. Find members with automatic self-healing for corrupted direct conversations
        let memberRows = db
          .select()
          .from(conversationMembers)
          .where(eq(conversationMembers.conversationId, row.id))
          .all();

        if (row.type === 'direct' && memberRows.length < 2) {
          const allDevs = db.select().from(devices).all();
          let peerDev = allDevs.find(
            (d) =>
              d.id !== localDeviceId &&
              (row.id.includes(d.id.slice(0, 8)) ||
                (row.title && d.displayName.toLowerCase() === row.title.toLowerCase()))
          );
          if (!peerDev && allDevs.length > 0) {
            peerDev = allDevs.find((d) => d.id !== localDeviceId);
          }

          if (localDeviceId && peerDev) {
            const now = Date.now();
            db.insert(conversationMembers)
              .values({
                id: `cm_${row.id}_${localDeviceId}`,
                conversationId: row.id,
                deviceId: localDeviceId,
                role: 'member',
                joinedAt: now,
              })
              .onConflictDoNothing()
              .run();

            db.insert(conversationMembers)
              .values({
                id: `cm_${row.id}_${peerDev.id}`,
                conversationId: row.id,
                deviceId: peerDev.id,
                role: 'member',
                joinedAt: now,
              })
              .onConflictDoNothing()
              .run();

            memberRows = db
              .select()
              .from(conversationMembers)
              .where(eq(conversationMembers.conversationId, row.id))
              .all();
          }
        }

        const memberDeviceIds = memberRows.map((m) => m.deviceId);

        // 4. Resolve title & peer details
        let title = row.title || 'Conversation';
        let peerDeviceId: string | undefined;
        let hostDeviceId: string | undefined;
        let isHost: boolean | undefined;
        let description: string | null = null;

        if (row.type === 'direct') {
          peerDeviceId = memberDeviceIds.find((id) => id !== localDeviceId) || memberDeviceIds[0];
          if (peerDeviceId) {
            const peerDevice = db.select().from(devices).where(eq(devices.id, peerDeviceId)).limit(1).all()[0];
            if (peerDevice) {
              title = peerDevice.displayName;
            }
          }
        } else if (row.type === 'group') {
          const groupRow = db.select().from(groups).where(eq(groups.id, row.id)).limit(1).all()[0];
          if (groupRow) {
            title = groupRow.name;
            description = groupRow.description;
            hostDeviceId = groupRow.hostDeviceId;
            isHost = Boolean(groupRow.isHost || groupRow.hostDeviceId === localDeviceId);
          }
        } else if (row.type === 'private') {
          const priv = db.select().from(privateConversations).where(eq(privateConversations.id, row.id)).limit(1).all()[0];
          if (priv) {
            title = priv.title;
            hostDeviceId = priv.creatorDeviceId;
            isHost = priv.creatorDeviceId === localDeviceId;
          }
        }

        return {
          id: row.id,
          type: row.type as ConversationItem['type'],
          title,
          description,
          lastMessage: lastMessageText,
          lastActivityAt: row.lastActivityAt,
          unreadCount,
          isLocked: row.type === 'private',
          peerDeviceId,
          memberDeviceIds,
          hostDeviceId,
          isHost,
          isPinned: Boolean(row.isPinned),
          isMuted: Boolean(row.isMuted),
          isArchived: Boolean(row.isArchived),
          isChatLocked: Boolean(row.isChatLocked),
          isMarkedUnread: Boolean(row.isMarkedUnread),
        };
      });
  }

  public getConversationById(id: string, localDeviceId: string = '', includePrivate: boolean = true): ConversationItem | null {
    const list = this.getConversations(localDeviceId, includePrivate);
    return list.find((c) => c.id === id) || null;
  }

  public getDirectConversationBetween(localDeviceId: string, peerDeviceId: string): ConversationItem | null {
    const db = this.dbService.getDb();
    // Query direct conversations having both members
    const myConvs = db
      .select({ conversationId: conversationMembers.conversationId })
      .from(conversationMembers)
      .where(eq(conversationMembers.deviceId, localDeviceId))
      .all()
      .map((r) => r.conversationId);

    if (myConvs.length > 0) {
      for (const convId of myConvs) {
        const conv = db.select().from(conversations).where(eq(conversations.id, convId)).limit(1).all()[0];
        if (conv && conv.type === 'direct') {
          const peerMember = db
            .select()
            .from(conversationMembers)
            .where(and(eq(conversationMembers.conversationId, convId), eq(conversationMembers.deviceId, peerDeviceId)))
            .limit(1)
            .all()[0];
          if (peerMember) {
            return this.getConversationById(convId, localDeviceId, false);
          }
        }
      }
    }

    // Fallback: check deterministic conversation ID
    const sorted = [localDeviceId, peerDeviceId].sort();
    const first = sorted[0] ?? 'a';
    const second = sorted[1] ?? 'b';
    const convId = `conv_${first.slice(0, 10)}_${second.slice(0, 10)}`;
    const existingConv = db.select().from(conversations).where(eq(conversations.id, convId)).limit(1).all()[0];
    if (existingConv && existingConv.type === 'direct') {
      const now = Date.now();
      db.insert(conversationMembers).values({
        id: `cm_${convId}_${localDeviceId}`,
        conversationId: convId,
        deviceId: localDeviceId,
        role: 'member',
        joinedAt: now,
      }).onConflictDoNothing().run();

      db.insert(conversationMembers).values({
        id: `cm_${convId}_${peerDeviceId}`,
        conversationId: convId,
        deviceId: peerDeviceId,
        role: 'member',
        joinedAt: now,
      }).onConflictDoNothing().run();

      return this.getConversationById(convId, localDeviceId, false);
    }

    return null;
  }

  public getOrCreateDirectConversation(localDeviceId: string, peerDeviceId: string, peerDisplayName?: string): ConversationItem {
    const existing = this.getDirectConversationBetween(localDeviceId, peerDeviceId);
    if (existing) return existing;

    // Create deterministic or UUID conversation ID
    const sorted = [localDeviceId, peerDeviceId].sort();
    const first = sorted[0] ?? 'a';
    const second = sorted[1] ?? 'b';
    const convId = `conv_${first.slice(0, 10)}_${second.slice(0, 10)}`;

    this.createConversation(convId, 'direct', peerDisplayName || 'Direct Message', [localDeviceId, peerDeviceId]);
    const created = this.getConversationById(convId, localDeviceId, false);
    if (!created) {
      throw new Error(`Failed to create direct conversation between ${localDeviceId} and ${peerDeviceId}`);
    }
    return created;
  }

  public createConversation(
    inputOrId:
      | string
      | {
          id: string;
          type: 'direct' | 'group' | 'private';
          title?: string;
          memberDeviceIds?: string[];
        },
    typeArg?: 'direct' | 'group' | 'private',
    titleArg?: string,
    memberDeviceIdsArg: string[] = []
  ): void {
    let id: string;
    let type: 'direct' | 'group' | 'private';
    let title: string | undefined;
    let memberDeviceIds: string[];

    if (typeof inputOrId === 'object') {
      id = inputOrId.id;
      type = inputOrId.type;
      title = inputOrId.title;
      memberDeviceIds = inputOrId.memberDeviceIds || [];
    } else {
      id = inputOrId;
      type = typeArg!;
      title = titleArg;
      memberDeviceIds = memberDeviceIdsArg;
    }

    const db = this.dbService.getDb();
    const now = Date.now();

    db.insert(conversations)
      .values({
        id,
        type,
        title: title || null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    for (const devId of memberDeviceIds) {
      const existingDev = db.select({ id: devices.id }).from(devices).where(eq(devices.id, devId)).limit(1).all();
      if (existingDev.length === 0) {
        db.insert(devices)
          .values({
            id: devId,
            publicKey: '',
            displayName: title || 'LAN Peer',
            hostname: 'lan-peer',
            lastSeen: now,
            status: 'online',
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
      db.insert(conversationMembers)
        .values({
          id: `cm_${id}_${devId}`,
          conversationId: id,
          deviceId: devId,
          role: 'member',
          joinedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  public setConversationFlags(
    id: string,
    flags: { isPinned?: boolean; isMuted?: boolean; isArchived?: boolean; isChatLocked?: boolean; isMarkedUnread?: boolean }
  ): void {
    const db = this.dbService.getDb();
    const update: Partial<typeof conversations.$inferInsert> = {};
    if (flags.isPinned !== undefined) update.isPinned = flags.isPinned ? 1 : 0;
    if (flags.isMuted !== undefined) update.isMuted = flags.isMuted ? 1 : 0;
    if (flags.isArchived !== undefined) update.isArchived = flags.isArchived ? 1 : 0;
    if (flags.isChatLocked !== undefined) update.isChatLocked = flags.isChatLocked ? 1 : 0;
    if (flags.isMarkedUnread !== undefined) update.isMarkedUnread = flags.isMarkedUnread ? 1 : 0;
    if (Object.keys(update).length === 0) return;
    update.updatedAt = Date.now();
    db.update(conversations).set(update).where(eq(conversations.id, id)).run();
  }

  public isChatLocked(id: string): boolean {
    const db = this.dbService.getDb();
    const row = db.select({ v: conversations.isChatLocked }).from(conversations).where(eq(conversations.id, id)).limit(1).all()[0];
    return Boolean(row?.v);
  }

  public conversationExists(id: string): boolean {
    const db = this.dbService.getDb();
    return db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id)).limit(1).all().length > 0;
  }

  /** Clears all messages but keeps the conversation. */
  public clearConversation(id: string): void {
    const db = this.dbService.getDb();
    db.delete(messages).where(eq(messages.conversationId, id)).run();
    db.update(conversations)
      .set({ lastMessageId: null, isMarkedUnread: 0, updatedAt: Date.now() })
      .where(eq(conversations.id, id))
      .run();
  }

  /** Deletes the conversation locally; members, messages and private rows cascade. */
  public deleteConversation(id: string): void {
    const sqlite = this.dbService.getRawSqlite();
    const run = (statement: string) => {
      try {
        sqlite.prepare(statement).run(id);
      } catch (err) {
        console.error('[ConversationRepository] delete step failed:', statement, err);
      }
    };
    // Explicit deletes so the operation also succeeds on DBs where FK cascades are off.
    run('DELETE FROM messages WHERE conversation_id = ?');
    run('DELETE FROM invitations WHERE private_conversation_id = ?');
    run('DELETE FROM private_members WHERE private_conversation_id = ?');
    run('DELETE FROM private_conversations WHERE id = ?');
    run('DELETE FROM group_members WHERE group_id = ?');
    run('DELETE FROM groups WHERE id = ?');
    run('DELETE FROM conversation_members WHERE conversation_id = ?');
    run('DELETE FROM conversations WHERE id = ?');
  }

  public updateLastActivity(id: string, lastMessageId: string, timestamp: number = Date.now()): void {
    const db = this.dbService.getDb();
    db.update(conversations)
      .set({
        lastMessageId,
        lastActivityAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(conversations.id, id))
      .run();
  }

  public getConversationMembers(conversationId: string): string[] {
    const db = this.dbService.getDb();
    const rows = db
      .select({ deviceId: conversationMembers.deviceId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId))
      .all();
    return rows.map((r) => r.deviceId);
  }
}
