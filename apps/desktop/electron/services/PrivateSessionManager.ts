import crypto from 'node:crypto';
import { Argon2Hasher, InvitationTokenManager } from '@ipm/security';
import type { PrivateChatRepository, ConversationRepository, DeviceRepository } from '@ipm/database';
import type { LanTransportAdapter } from '@ipm/networking';
import { IpmEventType } from '@ipm/shared';
import type {
  PrivateStatus,
  SetupUnlockCredentialInput,
  UnlockPrivateInput,
  ChangePrivatePasswordInput,
  ResetPrivateWithRecoveryInput,
  CreatePrivateConversationInput,
  CreateInvitationInput,
  RedeemInvitationInput,
  ConversationItem,
  InvitationItem,
  NetworkEnvelope,
} from '@ipm/shared';

type LockState = { isUnlocked: boolean; lockedUntil?: number | null };

export interface PrivateSessionNetworkDeps {
  conversationRepo?: ConversationRepository;
  deviceRepo?: DeviceRepository;
  getLanAdapter?: () => LanTransportAdapter | null;
}

interface PrivateConversationRecord {
  id: string;
  title: string;
  creatorDeviceId: string;
  sessionKeyHash: string;
  memberDeviceIds: string[];
}

interface PendingJoin {
  resolve: (conv: ConversationItem) => void;
  reject: (err: Error) => void;
  remaining: Set<string>;
  timer: NodeJS.Timeout;
}

const JOIN_TIMEOUT_MS = 10_000;
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
export const WIPE_CONFIRMATION = 'RESET';

type VerifyResult = { success: boolean; error?: string; lockedUntil?: number | null };

function generateRecoveryKey(): string {
  const bytes = crypto.randomBytes(24);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return chars.match(/.{4}/g)!.join('-'); // XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
}

function normalizeRecoveryKey(key: string): string {
  return key.toUpperCase().replace(/[^0-9A-Z]/g, '');
}
const JOIN_RATE_LIMIT = 10; // requests per peer per minute

export class PrivateSessionManager {
  private repo: PrivateChatRepository;
  private localDeviceId: string;
  private conversationRepo: ConversationRepository | null = null;
  private deviceRepo: DeviceRepository | null = null;
  private getLanAdapter: () => LanTransportAdapter | null = () => null;

  private _isUnlocked: boolean = false;
  private unlockedAt: number | null = null;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private readonly AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes
  private onStateChangeListeners: Array<(status: LockState) => void> = [];
  private pendingJoins = new Map<string, PendingJoin>();
  private joinRequestLog = new Map<string, number[]>();

  constructor(repo: PrivateChatRepository, localDeviceId: string, deps?: PrivateSessionNetworkDeps) {
    this.repo = repo;
    this.localDeviceId = localDeviceId;
    if (deps) this.attachNetwork(deps);
  }

  public attachNetwork(deps: PrivateSessionNetworkDeps): void {
    if (deps.conversationRepo) this.conversationRepo = deps.conversationRepo;
    if (deps.deviceRepo) this.deviceRepo = deps.deviceRepo;
    if (deps.getLanAdapter) this.getLanAdapter = deps.getLanAdapter;
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  public onStateChange(listener: (status: LockState) => void): () => void {
    this.onStateChangeListeners.push(listener);
    return () => {
      this.onStateChangeListeners = this.onStateChangeListeners.filter((l) => l !== listener);
    };
  }

  private notifyStateChange(): void {
    const cred = this.repo.getCredential();
    const lockedUntil = cred?.lockedUntil && cred.lockedUntil > Date.now() ? cred.lockedUntil : null;
    for (const listener of this.onStateChangeListeners) {
      try {
        listener({ isUnlocked: this.isUnlocked(), lockedUntil });
      } catch (err) {
        console.error('[PrivateSessionManager] Error notifying listener:', err);
      }
    }
  }

  public getStatus(): PrivateStatus {
    return this.repo.getStatus(this.isUnlocked());
  }

  public async setupCredential(input: SetupUnlockCredentialInput): Promise<{ recoveryKey: string }> {
    if (this.repo.getCredential()) {
      throw new Error('A PIN/passphrase is already configured. Unlock with it instead.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await Argon2Hasher.hashPassword(input.password);
    this.repo.setCredential(hash, salt, input.recoveryHint);
    const recoveryKey = await this.rotateRecoveryKey();
    this._isUnlocked = true;
    this.unlockedAt = Date.now();
    this.resetAutoLockTimer();
    this.notifyStateChange();
    return { recoveryKey };
  }

  // ==========================================
  // PIN change / recovery / reset
  // ==========================================

  /** Applies the shared lockout policy to a failed secret check. */
  private registerFailure(label: string): VerifyResult {
    const now = Date.now();
    const { failedAttempts, lockedUntil } = this.repo.recordFailedAttempt();
    if (lockedUntil && lockedUntil > now) {
      this._isUnlocked = false;
      this.notifyStateChange();
      return { success: false, error: `Incorrect ${label}. Locked for ${Math.ceil((lockedUntil - now) / 1000)}s`, lockedUntil };
    }
    return { success: false, error: `Incorrect ${label} (${failedAttempts} failed attempt${failedAttempts > 1 ? 's' : ''})` };
  }

  private lockoutError(): VerifyResult | null {
    const cred = this.repo.getCredential();
    if (!cred) return { success: false, error: 'Private chats have no PIN configured yet.' };
    if (cred.lockedUntil && cred.lockedUntil > Date.now()) {
      return {
        success: false,
        error: `Too many failed attempts. Try again in ${Math.ceil((cred.lockedUntil - Date.now()) / 1000)}s`,
        lockedUntil: cred.lockedUntil,
      };
    }
    return null;
  }

  private async rotateRecoveryKey(): Promise<string> {
    const recoveryKey = generateRecoveryKey();
    this.repo.setRecoveryHash(await Argon2Hasher.hashPassword(normalizeRecoveryKey(recoveryKey)));
    return recoveryKey;
  }

  private unlockNow(): void {
    this._isUnlocked = true;
    this.unlockedAt = Date.now();
    this.resetAutoLockTimer();
    this.notifyStateChange();
  }

  /** Changes the PIN. Requires the current PIN; chats are kept. */
  public async changePassword(input: ChangePrivatePasswordInput): Promise<VerifyResult> {
    const blocked = this.lockoutError();
    if (blocked) return blocked;
    const cred = this.repo.getCredential()!;
    if (input.currentPassword === input.newPassword) {
      return { success: false, error: 'The new PIN must be different from the current one.' };
    }
    const ok = await Argon2Hasher.verifyPassword(cred.passwordHash, input.currentPassword).catch(() => false);
    if (!ok) return this.registerFailure('current PIN');

    const hash = await Argon2Hasher.hashPassword(input.newPassword);
    this.repo.updatePasswordHash(hash, crypto.randomBytes(16).toString('hex'), input.recoveryHint);
    this.unlockNow();
    return { success: true };
  }

  /** Creates a new recovery key (the previous one stops working). Requires an unlocked session. */
  public async generateRecoveryKey(): Promise<{ recoveryKey: string }> {
    this.requireUnlocked();
    this.resetAutoLockTimer();
    const recoveryKey = await this.rotateRecoveryKey();
    this.notifyStateChange();
    return { recoveryKey };
  }

  /**
   * Forgot-PIN flow that keeps all chats: proves ownership with the recovery key, sets a new
   * PIN and issues a fresh recovery key (the used one is single-use).
   */
  public async resetWithRecoveryKey(
    input: ResetPrivateWithRecoveryInput
  ): Promise<VerifyResult & { recoveryKey?: string }> {
    const blocked = this.lockoutError();
    if (blocked) return blocked;
    const cred = this.repo.getCredential()!;
    if (!cred.recoveryHash) {
      return { success: false, error: 'No recovery key was created for this PIN. Use "Erase private chats" instead.' };
    }
    const ok = await Argon2Hasher.verifyPassword(cred.recoveryHash, normalizeRecoveryKey(input.recoveryKey)).catch(() => false);
    if (!ok) return this.registerFailure('recovery key');

    const hash = await Argon2Hasher.hashPassword(input.newPassword);
    this.repo.updatePasswordHash(hash, crypto.randomBytes(16).toString('hex'), input.recoveryHint);
    const recoveryKey = await this.rotateRecoveryKey();
    this.unlockNow();
    return { success: true, recoveryKey };
  }

  /**
   * Last-resort reset when both the PIN and the recovery key are lost: permanently deletes
   * every private conversation, every locked chat and all invitations, then removes the PIN.
   * Nothing protected survives, so this cannot be used to read someone else's chats.
   */
  public resetAndWipe(confirmation: string): void {
    if (confirmation !== WIPE_CONFIRMATION) {
      throw new Error(`Type ${WIPE_CONFIRMATION} to confirm erasing all private chats.`);
    }
    const ids = new Set<string>(this.repo.listPrivateConversationIds());
    if (this.conversationRepo) {
      for (const c of this.conversationRepo.getConversations(this.localDeviceId, true)) {
        if (c.type === 'private' || c.isChatLocked) ids.add(c.id);
      }
      for (const id of ids) this.conversationRepo.deleteConversation(id);
    }
    this.repo.deleteCredential();
    this.lock();
    this.notifyStateChange();
  }

  public async unlock(input: UnlockPrivateInput): Promise<{ success: boolean; error?: string; lockedUntil?: number | null }> {
    const cred = this.repo.getCredential();
    if (!cred) {
      return { success: false, error: 'Private chat credential not set. Please set up a PIN/passphrase first.' };
    }

    const now = Date.now();
    if (cred.lockedUntil && cred.lockedUntil > now) {
      const waitSeconds = Math.ceil((cred.lockedUntil - now) / 1000);
      return {
        success: false,
        error: `Too many failed attempts. Locked for another ${waitSeconds}s`,
        lockedUntil: cred.lockedUntil,
      };
    }

    let isValid = false;
    try {
      isValid = await Argon2Hasher.verifyPassword(cred.passwordHash, input.password);
    } catch (err) {
      console.error('[PrivateSessionManager] Credential verification error:', err);
      return { success: false, error: 'Could not verify credentials on this device. Please try again.' };
    }

    if (!isValid) {
      const { failedAttempts, lockedUntil } = this.repo.recordFailedAttempt();
      this.notifyStateChange();
      if (lockedUntil && lockedUntil > now) {
        const waitSeconds = Math.ceil((lockedUntil - now) / 1000);
        return {
          success: false,
          error: `Incorrect credentials. Locked for ${waitSeconds}s`,
          lockedUntil,
        };
      }
      return {
        success: false,
        error: `Incorrect credentials (${failedAttempts} failed attempt${failedAttempts > 1 ? 's' : ''})`,
      };
    }

    this.repo.resetFailedAttempts();
    this._isUnlocked = true;
    this.unlockedAt = Date.now();
    this.resetAutoLockTimer();
    this.notifyStateChange();

    return { success: true };
  }

  public lock(): void {
    const wasUnlocked = this._isUnlocked;
    this._isUnlocked = false;
    this.unlockedAt = null;
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    if (wasUnlocked || this.onStateChangeListeners.length > 0) {
      this.notifyStateChange();
    }
  }

  public isUnlocked(): boolean {
    if (!this._isUnlocked) return false;
    const cred = this.repo.getCredential();
    if (!cred) {
      this._isUnlocked = false;
      return false;
    }
    if (cred.lockedUntil && cred.lockedUntil > Date.now()) {
      this._isUnlocked = false;
      return false;
    }
    return true;
  }

  public requireUnlocked(): void {
    if (!this.isUnlocked()) {
      throw new Error('Access denied: Private chats are currently locked');
    }
  }

  /** Called on any private-chat activity to postpone the inactivity auto-lock. */
  public touch(): void {
    if (this.isUnlocked()) this.resetAutoLockTimer();
  }

  public resetAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }
    this.autoLockTimer = setTimeout(() => {
      console.log('[PrivateSessionManager] Inactivity timeout reached. Auto-locking private chats.');
      this.lock();
    }, this.AUTO_LOCK_MS);
  }

  /** A conversation hidden behind the PIN: private conversations and user-locked chats. */
  public isProtectedConversation(conversationId: string): boolean {
    if (this.repo.isPrivateConversation(conversationId)) return true;
    return this.conversationRepo?.isChatLocked(conversationId) ?? false;
  }

  // ==========================================
  // Private Conversations Operations
  // ==========================================

  public getPrivateConversations(): ConversationItem[] {
    this.requireUnlocked();
    this.resetAutoLockTimer();
    const privateConvs = this.repo.listPrivateConversations(this.localDeviceId);

    // Normal chats the user moved behind the lock
    const lockedChats = this.conversationRepo
      ? this.conversationRepo
          .getConversations(this.localDeviceId, true)
          .filter((c) => c.type !== 'private' && c.isChatLocked)
      : [];

    // Enrich private conversations with real unread counts
    const enriched = this.conversationRepo
      ? privateConvs.map((p) => {
          const full = this.conversationRepo!.getConversationById(p.id, this.localDeviceId, true);
          return full ? { ...p, unreadCount: full.unreadCount, lastMessage: full.lastMessage ?? p.lastMessage } : p;
        })
      : privateConvs;

    return [...enriched, ...lockedChats].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  private ensureLocalDeviceRow(): void {
    if (!this.localDeviceId) {
      throw new Error('Profile is not initialised yet. Complete onboarding first.');
    }
    this.repo.ensureDeviceRow(this.localDeviceId, 'This device');
  }

  public createPrivateConversation(input: CreatePrivateConversationInput): ConversationItem {
    this.requireUnlocked();
    this.resetAutoLockTimer();
    this.ensureLocalDeviceRow();

    const convId = `prv_${crypto.randomUUID()}`;
    const sessionKeyHash = crypto.randomBytes(32).toString('hex');

    this.repo.createPrivateConversation({
      id: convId,
      title: input.title,
      creatorDeviceId: this.localDeviceId,
      sessionKeyHash,
    });

    const created = this.repo.getPrivateConversation(convId, this.localDeviceId);
    if (!created) {
      throw new Error(`Failed to create private conversation ${convId}`);
    }
    return created;
  }

  public createInvitation(input: CreateInvitationInput): { code: string; expiresAt: number; id: string } {
    this.requireUnlocked();
    this.resetAutoLockTimer();

    if (!this.repo.isPrivateConversation(input.conversationId)) {
      throw new Error('Invitations can only be created for private conversations');
    }

    const code = InvitationTokenManager.generateCode();
    const codeHash = InvitationTokenManager.hashCode(code);
    const id = `inv_${crypto.randomUUID()}`;
    const expiresInHours = input.expiresInHours || 24;
    const expiresAt = Date.now() + expiresInHours * 3600 * 1000;

    this.repo.createInvitation({
      id,
      conversationId: input.conversationId,
      creatorDeviceId: this.localDeviceId,
      codeHash,
      maxUses: input.maxUses || 1,
      expiresAt,
    });

    return { id, code, expiresAt };
  }

  /**
   * Redeems a PRV-XXXX-XXXX code. The code is first checked locally (same device);
   * otherwise its SHA-256 hash is sent to every reachable LAN peer and the device that
   * issued it validates the code and returns the conversation to join.
   */
  public async redeemInvitation(input: RedeemInvitationInput): Promise<ConversationItem> {
    this.requireUnlocked();
    this.resetAutoLockTimer();

    if (!InvitationTokenManager.isValidFormat(input.code)) {
      throw new Error('Invalid invitation code format. Expected PRV-XXXX-XXXX');
    }

    this.ensureLocalDeviceRow();
    const norm = InvitationTokenManager.normalizeCode(input.code);
    const codeHash = InvitationTokenManager.hashCode(norm);

    // 1. Issued on this device?
    const localInvite = this.repo.getInvitationByCodeHash(codeHash);
    if (localInvite) {
      if (localInvite.creatorDeviceId === this.localDeviceId) {
        throw new Error('This invitation was created on this device. Share it with another device to let them join.');
      }
      const result = this.repo.redeemInvitation(codeHash, this.localDeviceId);
      if (!result.success || !result.conversationId) {
        throw new Error(result.error || 'Failed to redeem invitation');
      }
      const conv = this.repo.getPrivateConversation(result.conversationId, this.localDeviceId);
      if (!conv) throw new Error('Private conversation joined, but could not be loaded');
      return conv;
    }

    // 2. Ask the LAN
    return this.redeemOverNetwork(codeHash);
  }

  private getReachablePeerIds(): string[] {
    const adapter = this.getLanAdapter();
    const ids = new Set<string>();
    if (adapter) {
      for (const id of adapter.getConnectionPool().getConnectedPeerIds()) ids.add(id);
    }
    for (const dev of this.deviceRepo?.getAllDevices() ?? []) {
      if (dev.status !== 'offline' && dev.ipAddress && dev.ipAddress !== 'unknown') ids.add(dev.id);
    }
    ids.delete(this.localDeviceId);
    ids.delete('*_direct');
    return Array.from(ids);
  }

  private redeemOverNetwork(codeHash: string): Promise<ConversationItem> {
    const adapter = this.getLanAdapter();
    if (!adapter) {
      return Promise.reject(new Error('LAN networking is not running. Complete onboarding and try again.'));
    }
    const peers = this.getReachablePeerIds();
    if (peers.length === 0) {
      return Promise.reject(
        new Error('No online devices found. Make sure the device that created the invitation is online on this network.')
      );
    }

    const requestId = crypto.randomUUID();
    return new Promise<ConversationItem>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingJoins.delete(requestId);
        reject(new Error('Invitation not found on any online device (timed out). Check the code and that the inviter is online.'));
      }, JOIN_TIMEOUT_MS);

      const pending: PendingJoin = { resolve, reject, remaining: new Set(peers), timer };
      this.pendingJoins.set(requestId, pending);

      for (const peerId of peers) {
        adapter
          .sendPayload(peerId, IpmEventType.PRIVATE_JOIN_REQUEST, { requestId, codeHash }, 'global')
          .catch(() => this.markPeerDone(requestId, peerId, null));
      }
    });
  }

  private markPeerDone(requestId: string, peerId: string, error: string | null): void {
    const pending = this.pendingJoins.get(requestId);
    if (!pending) return;
    pending.remaining.delete(peerId);
    if (error) {
      // The issuing device answered with a definitive problem (expired, revoked, used up)
      clearTimeout(pending.timer);
      this.pendingJoins.delete(requestId);
      pending.reject(new Error(error));
      return;
    }
    if (pending.remaining.size === 0) {
      clearTimeout(pending.timer);
      this.pendingJoins.delete(requestId);
      pending.reject(new Error('Invitation code not found on any online device. Check the code and try again.'));
    }
  }

  private isRateLimited(peerId: string): boolean {
    const now = Date.now();
    const recent = (this.joinRequestLog.get(peerId) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.joinRequestLog.set(peerId, recent);
    return recent.length > JOIN_RATE_LIMIT;
  }

  /** Routes private-chat network envelopes. Returns true when the envelope was handled. */
  public async handleIncomingEnvelope(envelope: NetworkEnvelope): Promise<boolean> {
    const adapter = this.getLanAdapter();
    const payload = envelope.payload as Record<string, any>;

    switch (envelope.type) {
      case IpmEventType.PRIVATE_JOIN_REQUEST: {
        if (!adapter || typeof payload.requestId !== 'string' || typeof payload.codeHash !== 'string') return true;
        const reply = (type: IpmEventType, body: Record<string, unknown>) =>
          adapter.sendPayload(envelope.senderId, type, { requestId: payload.requestId, ...body }, 'global').catch(() => {});

        if (this.isRateLimited(envelope.senderId)) {
          await reply(IpmEventType.PRIVATE_JOIN_REJECTED, { reason: 'error', error: 'Too many join attempts. Wait a minute.' });
          return true;
        }

        const invite = this.repo.getInvitationByCodeHash(payload.codeHash);
        if (!invite || invite.creatorDeviceId !== this.localDeviceId) {
          await reply(IpmEventType.PRIVATE_JOIN_REJECTED, { reason: 'not_found' });
          return true;
        }

        const known = this.deviceRepo?.getDeviceById(envelope.senderId);
        this.repo.ensureDeviceRow(envelope.senderId, known?.displayName ?? 'LAN Peer', known?.publicKey ?? '');
        const result = this.repo.redeemInvitation(payload.codeHash, envelope.senderId);
        if (!result.success || !result.conversationId) {
          await reply(IpmEventType.PRIVATE_JOIN_REJECTED, { reason: 'error', error: result.error || 'Invitation rejected' });
          return true;
        }

        const record = this.repo.exportPrivateConversation(result.conversationId);
        if (!record) {
          await reply(IpmEventType.PRIVATE_JOIN_REJECTED, { reason: 'error', error: 'Conversation no longer exists' });
          return true;
        }
        await reply(IpmEventType.PRIVATE_JOIN_ACCEPTED, { conversation: record });

        // Tell existing members about the new participant
        for (const memberId of record.memberDeviceIds) {
          if (memberId === this.localDeviceId || memberId === envelope.senderId) continue;
          adapter
            .sendPayload(memberId, IpmEventType.PRIVATE_MEMBER_ADDED, { conversationId: record.id, deviceId: envelope.senderId }, record.id)
            .catch(() => {});
        }
        this.notifyStateChange();
        return true;
      }

      case IpmEventType.PRIVATE_JOIN_ACCEPTED: {
        const pending = this.pendingJoins.get(payload.requestId);
        if (!pending) return true;
        const record = payload.conversation as PrivateConversationRecord | undefined;
        if (
          !record ||
          typeof record.id !== 'string' ||
          !record.id.startsWith('prv_') ||
          record.creatorDeviceId !== envelope.senderId
        ) {
          this.markPeerDone(payload.requestId, envelope.senderId, null);
          return true;
        }
        clearTimeout(pending.timer);
        this.pendingJoins.delete(payload.requestId);
        try {
          const known = this.deviceRepo?.getDeviceById(envelope.senderId);
          this.repo.ensureDeviceRow(envelope.senderId, known?.displayName ?? 'LAN Peer', known?.publicKey ?? '');
          this.repo.importPrivateConversation({
            ...record,
            memberDeviceIds: Array.from(new Set([...(record.memberDeviceIds ?? []), this.localDeviceId])),
          });
          const conv = this.repo.getPrivateConversation(record.id, this.localDeviceId);
          if (!conv) throw new Error('Joined conversation could not be loaded');
          pending.resolve(conv);
        } catch (err: any) {
          pending.reject(new Error(err?.message ?? 'Failed to join private conversation'));
        }
        return true;
      }

      case IpmEventType.PRIVATE_JOIN_REJECTED: {
        if (typeof payload.requestId !== 'string') return true;
        this.markPeerDone(
          payload.requestId,
          envelope.senderId,
          payload.reason === 'not_found' ? null : String(payload.error ?? 'Invitation rejected')
        );
        return true;
      }

      case IpmEventType.PRIVATE_MEMBER_ADDED: {
        const conversationId = payload.conversationId as string;
        const deviceId = payload.deviceId as string;
        if (!conversationId || !deviceId || !this.repo.isPrivateConversation(conversationId)) return true;
        const record = this.repo.exportPrivateConversation(conversationId);
        // Only an existing member can announce new members
        if (!record || !record.memberDeviceIds.includes(envelope.senderId)) return true;
        this.repo.ensureDeviceRow(deviceId);
        this.repo.addPrivateMember(conversationId, deviceId, 'member');
        this.notifyStateChange();
        return true;
      }

      default:
        return false;
    }
  }

  public listInvitations(conversationId: string): InvitationItem[] {
    this.requireUnlocked();
    this.resetAutoLockTimer();
    return this.repo.listInvitations(conversationId);
  }

  public revokeInvitation(invitationId: string): void {
    this.requireUnlocked();
    this.resetAutoLockTimer();
    this.repo.revokeInvitation(invitationId);
  }

  public destroy(): void {
    if (this.autoLockTimer) clearTimeout(this.autoLockTimer);
    for (const pending of this.pendingJoins.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Shutting down'));
    }
    this.pendingJoins.clear();
  }
}
