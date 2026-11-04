import { eq, and } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import { groups, groupMembers, conversations, conversationMembers } from '../schema/index';

export interface GroupRecord {
  id: string;
  name: string;
  description?: string | null;
  hostDeviceId: string;
  isHost: boolean;
  avatarUrl?: string | null;
  createdAt: number;
}

export class GroupRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  public createGroup(
    inputOrId:
      | string
      | {
          id: string;
          name: string;
          description?: string;
          hostDeviceId: string;
          isHost?: boolean;
          memberDeviceIds?: string[];
        },
    nameArg?: string,
    descriptionArg?: string,
    hostDeviceIdArg?: string,
    isHostArg: boolean = true,
    memberDeviceIdsArg: string[] = []
  ): void {
    let id: string;
    let name: string;
    let description: string | undefined;
    let hostDeviceId: string;
    let isHost: boolean;
    let memberDeviceIds: string[];

    if (typeof inputOrId === 'object') {
      id = inputOrId.id;
      name = inputOrId.name;
      description = inputOrId.description;
      hostDeviceId = inputOrId.hostDeviceId;
      isHost = inputOrId.isHost ?? true;
      memberDeviceIds = inputOrId.memberDeviceIds || [];
    } else {
      id = inputOrId;
      name = nameArg!;
      description = descriptionArg;
      hostDeviceId = hostDeviceIdArg!;
      isHost = isHostArg;
      memberDeviceIds = memberDeviceIdsArg;
    }

    const db = this.dbService.getDb();
    const now = Date.now();

    // 1. Ensure conversation record exists
    db.insert(conversations)
      .values({
        id,
        type: 'group',
        title: name,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    // 2. Insert group metadata
    db.insert(groups)
      .values({
        id,
        name,
        description: description || null,
        hostDeviceId,
        isHost: isHost ? 1 : 0,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: groups.id,
        set: {
          name,
          description: description || null,
          hostDeviceId,
          isHost: isHost ? 1 : 0,
        },
      })
      .run();

    // 3. Ensure members are in both conversationMembers and groupMembers
    for (const devId of memberDeviceIds) {
      db.insert(conversationMembers)
        .values({
          id: `cm_${id}_${devId}`,
          conversationId: id,
          deviceId: devId,
          role: devId === hostDeviceId ? 'owner' : 'member',
          joinedAt: now,
        })
        .onConflictDoNothing()
        .run();

      db.insert(groupMembers)
        .values({
          id: `gm_${id}_${devId}`,
          groupId: id,
          deviceId: devId,
          role: devId === hostDeviceId ? 'owner' : 'member',
          joinedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  public getGroupById(id: string): GroupRecord | null {
    const db = this.dbService.getDb();
    const rows = db.select().from(groups).where(eq(groups.id, id)).limit(1).all();
    if (rows.length === 0 || !rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      hostDeviceId: r.hostDeviceId,
      isHost: Boolean(r.isHost),
      avatarUrl: r.avatarUrl,
      createdAt: r.createdAt,
    };
  }

  public getGroupMembers(groupId: string): string[] {
    const db = this.dbService.getDb();
    const rows = db
      .select({ deviceId: groupMembers.deviceId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .all();
    return rows.map((r) => r.deviceId);
  }

  public addGroupMember(groupId: string, deviceId: string, role: string = 'member'): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.insert(groupMembers)
      .values({
        id: `gm_${groupId}_${deviceId}`,
        groupId,
        deviceId,
        role,
        joinedAt: now,
      })
      .onConflictDoNothing()
      .run();

    db.insert(conversationMembers)
      .values({
        id: `cm_${groupId}_${deviceId}`,
        conversationId: groupId,
        deviceId,
        role,
        joinedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  public removeGroupMember(groupId: string, deviceId: string): void {
    const db = this.dbService.getDb();
    db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.deviceId, deviceId))).run();
    db.delete(conversationMembers).where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.deviceId, deviceId))).run();
  }

  public updateGroupHost(groupId: string, newHostDeviceId: string, isHost: boolean): void {
    const db = this.dbService.getDb();
    db.update(groups)
      .set({
        hostDeviceId: newHostDeviceId,
        isHost: isHost ? 1 : 0,
      })
      .where(eq(groups.id, groupId))
      .run();
  }
}
