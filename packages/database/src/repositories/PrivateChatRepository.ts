import { eq, desc, and, sql } from 'drizzle-orm';
import { DatabaseService } from '../connection';
import {
  conversations,
  conversationMembers,
  privateConversations,
  privateMembers,
  privateCredentials,
  invitations,
  devices,
  messages,
} from '../schema/index';
import type { ConversationItem, InvitationItem, PrivateStatus } from '@ipm/shared';

export interface PrivateCredentialRecord {
  id: string;
  passwordHash: string;
  salt: string;
  failedAttempts: number;
  lockedUntil: number | null;
  recoveryHint: string | null;
  createdAt: number;
  updatedAt: number;
}

export class PrivateChatRepository {
  private dbService: DatabaseService;

  constructor(dbService: DatabaseService) {
    this.dbService = dbService;
  }

  // ==========================================
  // Credential & Unlock Management
  // ==========================================

  public getCredential(): PrivateCredentialRecord | null {
    const db = this.dbService.getDb();
    const rows = db.select().from(privateCredentials).limit(1).all();
    if (rows.length === 0 || !rows[0]) return null;
    return rows[0] as PrivateCredentialRecord;
  }

  public setCredential(passwordHash: string, salt: string, recoveryHint?: string): void {
    const db = this.dbService.getDb();
    const now = Date.now();
    const existing = this.getCredential();

    if (existing) {
      db.update(privateCredentials)
        .set({
          passwordHash,
          salt,
          failedAttempts: 0,
          lockedUntil: null,
          recoveryHint: recoveryHint ?? existing.recoveryHint,
          updatedAt: now,
        })
        .where(eq(privateCredentials.id, existing.id))
        .run();
    } else {
      db.insert(privateCredentials)
        .values({
          id: 'default_credential',
          passwordHash,
          salt,
          failedAttempts: 0,
          lockedUntil: null,
          recoveryHint: recoveryHint || null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  public recordFailedAttempt(): { failedAttempts: number; lockedUntil: number | null } {
    const db = this.dbService.getDb();
    const cred = this.getCredential();
    if (!cred) {
      return { failedAttempts: 0, lockedUntil: null };
    }

    const failedAttempts = cred.failedAttempts + 1;
    let lockoutDurationMs = 0;

    // Exponential lockout policy:
    // 3 attempts: 30 seconds
    // 4 attempts: 60 seconds (1 min)
    // 5 attempts: 300 seconds (5 min)
    // 6+ attempts: 900 seconds (15 min)
    if (failedAttempts === 3) {
      lockoutDurationMs = 30 * 1000;
    } else if (failedAttempts === 4) {
      lockoutDurationMs = 60 * 1000;
    } else if (failedAttempts === 5) {
      lockoutDurationMs = 300 * 1000;
    } else if (failedAttempts >= 6) {
      lockoutDurationMs = 900 * 1000;
    }

    const lockedUntil = lockoutDurationMs > 0 ? Date.now() + lockoutDurationMs : null;

    db.update(privateCredentials)
      .set({
        failedAttempts,
        lockedUntil,
        updatedAt: Date.now(),
      })
      .where(eq(privateCredentials.id, cred.id))
      .run();

    return { failedAttempts, lockedUntil };
  }

  public resetFailedAttempts(): void {
    const db = this.dbService.getDb();
    const cred = this.getCredential();
    if (!cred) return;

    db.update(privateCredentials)
      .set({
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: Date.now(),
      })
      .where(eq(privateCredentials.id, cred.id))
      .run();
  }

  public getStatus(isUnlockedInMemory: boolean): PrivateStatus {
    const cred = this.getCredential();
    if (!cred) {
      return {
        hasCredential: false,
        isUnlocked: false,
        lockedUntil: null,
        failedAttempts: 0,
        recoveryHint: null,
      };
    }

    const now = Date.now();
    const isLockedOut = cred.lockedUntil ? cred.lockedUntil > now : false;

    return {
      hasCredential: true,
      isUnlocked: isUnlockedInMemory && !isLockedOut,
      lockedUntil: isLockedOut ? cred.lockedUntil : null,
      failedAttempts: cred.failedAttempts,
      recoveryHint: cred.recoveryHint,
    };
  }

  // ==========================================
  // Private Conversation Management
  // ==========================================

  public createPrivateConversation(options: {
    id: string;
    title: string;
    creatorDeviceId: string;
    sessionKeyHash: string;
    peerDeviceId?: string;
  }): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    // 1. Insert into base conversations table
    db.insert(conversations)
      .values({
        id: options.id,
        type: 'private',
        title: options.title,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    // 2. Insert into private_conversations table
    db.insert(privateConversations)
      .values({
        id: options.id,
        title: options.title,
        creatorDeviceId: options.creatorDeviceId,
        sessionKeyHash: options.sessionKeyHash,
        isLocked: 1,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();

    // 3. Add creator as member
    this.addPrivateMember(options.id, options.creatorDeviceId, 'owner');

    // 4. If peerDeviceId provided, add peer as member
    if (options.peerDeviceId && options.peerDeviceId !== options.creatorDeviceId) {
      this.addPrivateMember(options.id, options.peerDeviceId, 'member');
    }
  }

  public addPrivateMember(
    privateConversationId: string,
    deviceId: string,
    role: string = 'member'
  ): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    // Ensure member exists in conversation_members
    db.insert(conversationMembers)
      .values({
        id: `cm_${privateConversationId}_${deviceId}`,
        conversationId: privateConversationId,
        deviceId,
        role,
        joinedAt: now,
      })
      .onConflictDoNothing()
      .run();

    // Ensure member exists in private_members
    db.insert(privateMembers)
      .values({
        id: `pm_${privateConversationId}_${deviceId}`,
        privateConversationId,
        deviceId,
        approvedAt: now,
        status: 'active',
      })
      .onConflictDoNothing()
      .run();
  }

  public getPrivateConversation(id: string, localDeviceId: string = ''): ConversationItem | null {
    const db = this.dbService.getDb();
    const pRows = db
      .select()
      .from(privateConversations)
      .where(eq(privateConversations.id, id))
      .limit(1)
      .all();
    if (pRows.length === 0 || !pRows[0]) return null;
    const pConv = pRows[0];

    const cRows = db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1)
      .all();
    const cConv = cRows[0];

    const memberRows = db
      .select()
      .from(privateMembers)
      .where(eq(privateMembers.privateConversationId, id))
      .all();
    const memberDeviceIds = memberRows.map((m) => m.deviceId);

    // Fetch last message
    let lastMessageText: string | null = null;
    const lastMsg = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.sequence))
      .limit(1)
      .all()[0];
    if (lastMsg) {
      lastMessageText = lastMsg.contentType === 'file' ? '[File Attachment]' : lastMsg.content;
    }

    return {
      id: pConv.id,
      type: 'private',
      title: pConv.title,
      lastMessage: lastMessageText,
      lastActivityAt: cConv ? cConv.lastActivityAt : pConv.createdAt,
      unreadCount: 0,
      isLocked: true,
      memberDeviceIds,
      hostDeviceId: pConv.creatorDeviceId,
      isHost: pConv.creatorDeviceId === localDeviceId,
    };
  }

  public listPrivateConversations(localDeviceId: string = ''): ConversationItem[] {
    const db = this.dbService.getDb();
    const pRows = db.select().from(privateConversations).orderBy(desc(privateConversations.createdAt)).all();

    return pRows.map((pConv) => {
      const cRows = db
        .select()
        .from(conversations)
        .where(eq(conversations.id, pConv.id))
        .limit(1)
        .all();
      const cConv = cRows[0];

      const memberRows = db
        .select()
        .from(privateMembers)
        .where(eq(privateMembers.privateConversationId, pConv.id))
        .all();
      const memberDeviceIds = memberRows.map((m) => m.deviceId);

      // Fetch last message
      let lastMessageText: string | null = null;
      const lastMsg = db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, pConv.id))
        .orderBy(desc(messages.sequence))
        .limit(1)
        .all()[0];
      if (lastMsg) {
        lastMessageText = lastMsg.contentType === 'file' ? '[File Attachment]' : lastMsg.content;
      }

      return {
        id: pConv.id,
        type: 'private',
        title: pConv.title,
        lastMessage: lastMessageText,
        lastActivityAt: cConv ? cConv.lastActivityAt : pConv.createdAt,
        unreadCount: 0,
        isLocked: true,
        memberDeviceIds,
        hostDeviceId: pConv.creatorDeviceId,
        isHost: pConv.creatorDeviceId === localDeviceId,
      };
    });
  }

  public isPrivateConversation(conversationId: string): boolean {
    const db = this.dbService.getDb();
    const rows = db
      .select({ id: privateConversations.id })
      .from(privateConversations)
      .where(eq(privateConversations.id, conversationId))
      .limit(1)
      .all();
    return rows.length > 0;
  }

  // ==========================================
  // Invitation Management
  // ==========================================

  public createInvitation(options: {
    id: string;
    conversationId: string;
    creatorDeviceId: string;
    codeHash: string;
    maxUses?: number;
    expiresAt: number;
  }): void {
    const db = this.dbService.getDb();
    const now = Date.now();

    db.insert(invitations)
      .values({
        id: options.id,
        codeHash: options.codeHash,
        privateConversationId: options.conversationId,
        creatorDeviceId: options.creatorDeviceId,
        maxUses: options.maxUses ?? 1,
        usedCount: 0,
        expiresAt: options.expiresAt,
        isRevoked: 0,
        createdAt: now,
      })
      .run();
  }

  public getInvitationByCodeHash(codeHash: string): InvitationItem | null {
    const db = this.dbService.getDb();
    const rows = db
      .select()
      .from(invitations)
      .where(eq(invitations.codeHash, codeHash))
      .limit(1)
      .all();

    if (rows.length === 0 || !rows[0]) return null;
    const r = rows[0];

    return {
      id: r.id,
      codeHash: r.codeHash,
      conversationId: r.privateConversationId,
      creatorDeviceId: r.creatorDeviceId,
      maxUses: r.maxUses,
      usedCount: r.usedCount,
      expiresAt: r.expiresAt,
      isRevoked: Boolean(r.isRevoked),
      createdAt: r.createdAt,
    };
  }

  public getInvitationById(id: string): InvitationItem | null {
    const db = this.dbService.getDb();
    const rows = db
      .select()
      .from(invitations)
      .where(eq(invitations.id, id))
      .limit(1)
      .all();

    if (rows.length === 0 || !rows[0]) return null;
    const r = rows[0];

    return {
      id: r.id,
      codeHash: r.codeHash,
      conversationId: r.privateConversationId,
      creatorDeviceId: r.creatorDeviceId,
      maxUses: r.maxUses,
      usedCount: r.usedCount,
      expiresAt: r.expiresAt,
      isRevoked: Boolean(r.isRevoked),
      createdAt: r.createdAt,
    };
  }

  public listInvitations(conversationId: string): InvitationItem[] {
    const db = this.dbService.getDb();
    const rows = db
      .select()
      .from(invitations)
      .where(eq(invitations.privateConversationId, conversationId))
      .orderBy(desc(invitations.createdAt))
      .all();

    return rows.map((r) => ({
      id: r.id,
      codeHash: r.codeHash,
      conversationId: r.privateConversationId,
      creatorDeviceId: r.creatorDeviceId,
      maxUses: r.maxUses,
      usedCount: r.usedCount,
      expiresAt: r.expiresAt,
      isRevoked: Boolean(r.isRevoked),
      createdAt: r.createdAt,
    }));
  }

  public revokeInvitation(id: string): boolean {
    const db = this.dbService.getDb();
    const result = db
      .update(invitations)
      .set({ isRevoked: 1 })
      .where(eq(invitations.id, id))
      .run();
    return result.changes > 0;
  }

  public redeemInvitation(
    codeHash: string,
    redeemingDeviceId: string
  ): { success: boolean; error?: string; conversationId?: string } {
    const db = this.dbService.getDb();
    const inv = this.getInvitationByCodeHash(codeHash);

    if (!inv) {
      return { success: false, error: 'Invitation not found or invalid' };
    }

    if (inv.isRevoked) {
      return { success: false, error: 'Invitation has been revoked' };
    }

    if (Date.now() > inv.expiresAt) {
      return { success: false, error: 'Invitation has expired' };
    }

    if (inv.usedCount >= inv.maxUses) {
      return { success: false, error: 'Invitation usage limit reached' };
    }

    // Increment usage
    db.update(invitations)
      .set({ usedCount: inv.usedCount + 1 })
      .where(eq(invitations.id, inv.id))
      .run();

    // Add redeeming device as private member
    this.addPrivateMember(inv.conversationId, redeemingDeviceId, 'member');

    return { success: true, conversationId: inv.conversationId };
  }
}

