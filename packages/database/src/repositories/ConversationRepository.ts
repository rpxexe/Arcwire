import { eq, desc } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { conversations, conversationMembers } from '../schema/index';
import type { ConversationItem } from '@ipm/shared';

export class ConversationRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public getConversations(includePrivate: boolean = false): ConversationItem[] {
    const db = this.dbService.getDb();
    const rows = db.select().from(conversations).orderBy(desc(conversations.lastActivityAt)).all();

    return rows
      .filter((row) => includePrivate || row.type !== 'private')
      .map((row) => ({
        id: row.id,
        type: row.type as ConversationItem['type'],
        title: row.title ?? 'Direct Conversation',
        lastMessage: null,
        lastActivityAt: row.lastActivityAt,
        unreadCount: 0,
        isLocked: row.type === 'private',
      }));
  }

  public createConversation(
    id: string,
    type: 'direct' | 'group' | 'private',
    title?: string,
    memberDeviceIds: string[] = []
  ): void {
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
}
