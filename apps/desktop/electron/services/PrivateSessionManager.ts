import crypto from 'node:crypto';
import { Argon2Hasher, InvitationTokenManager } from '@ipm/security';
import type { PrivateChatRepository } from '@ipm/database';
import type {
  PrivateStatus,
  SetupUnlockCredentialInput,
  UnlockPrivateInput,
  CreatePrivateConversationInput,
  CreateInvitationInput,
  RedeemInvitationInput,
  ConversationItem,
  InvitationItem,
} from '@ipm/shared';

export class PrivateSessionManager {
  private repo: PrivateChatRepository;
  private localDeviceId: string;
  private _isUnlocked: boolean = false;
  private unlockedAt: number | null = null;
  private autoLockTimer: NodeJS.Timeout | null = null;
  private readonly AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes
  private onStateChangeListeners: Array<(status: { isUnlocked: boolean; lockedUntil?: number | null }) => void> = [];

  constructor(repo: PrivateChatRepository, localDeviceId: string) {
    this.repo = repo;
    this.localDeviceId = localDeviceId;
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  public onStateChange(listener: (status: { isUnlocked: boolean; lockedUntil?: number | null }) => void): () => void {
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
        listener({ isUnlocked: this._isUnlocked, lockedUntil });
      } catch (err) {
        console.error('[PrivateSessionManager] Error notifying listener:', err);
      }
    }
  }

  public getStatus(): PrivateStatus {
    return this.repo.getStatus(this._isUnlocked);
  }

  public async setupCredential(input: SetupUnlockCredentialInput): Promise<void> {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await Argon2Hasher.hashPassword(input.password);
    this.repo.setCredential(hash, salt, input.recoveryHint);
    this._isUnlocked = true;
    this.unlockedAt = Date.now();
    this.resetAutoLockTimer();
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

    const isValid = await Argon2Hasher.verifyPassword(cred.passwordHash, input.password);
    if (!isValid) {
      const { failedAttempts, lockedUntil } = this.repo.recordFailedAttempt();
      this.notifyStateChange();
      if (lockedUntil && lockedUntil > now) {
        const waitSeconds = Math.ceil((lockedUntil - now) / 1000);
        return {
          success: false,
          error: `Incorrect credentials. Account locked for ${waitSeconds}s`,
          lockedUntil,
        };
      }
      return {
        success: false,
        error: `Incorrect credentials (${failedAttempts} failed attempt${failedAttempts > 1 ? 's' : ''})`,
      };
    }

    // Success: reset failed attempts
    this.repo.resetFailedAttempts();
    this._isUnlocked = true;
    this.unlockedAt = Date.now();
    this.resetAutoLockTimer();
    this.notifyStateChange();

    return { success: true };
  }

  public lock(): void {
    this._isUnlocked = false;
    this.unlockedAt = null;
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
    this.notifyStateChange();
  }

  public isUnlocked(): boolean {
    if (!this._isUnlocked) return false;
    const cred = this.repo.getCredential();
    if (cred?.lockedUntil && cred.lockedUntil > Date.now()) {
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

  public resetAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }
    this.autoLockTimer = setTimeout(() => {
      console.log('[PrivateSessionManager] Inactivity timeout reached. Auto-locking private chats.');
      this.lock();
    }, this.AUTO_LOCK_MS);
  }

  // ==========================================
  // Private Conversations Operations
  // ==========================================

  public getPrivateConversations(): ConversationItem[] {
    this.requireUnlocked();
    this.resetAutoLockTimer();
    return this.repo.listPrivateConversations(this.localDeviceId);
  }

  public createPrivateConversation(input: CreatePrivateConversationInput): ConversationItem {
    this.requireUnlocked();
    this.resetAutoLockTimer();

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

  public redeemInvitation(input: RedeemInvitationInput): ConversationItem {
    this.requireUnlocked();
    this.resetAutoLockTimer();

    if (!InvitationTokenManager.isValidFormat(input.code)) {
      throw new Error('Invalid invitation code format. Expected PRV-XXXX-XXXX');
    }

    const norm = InvitationTokenManager.normalizeCode(input.code);
    const codeHash = InvitationTokenManager.hashCode(norm);

    const result = this.repo.redeemInvitation(codeHash, this.localDeviceId);
    if (!result.success || !result.conversationId) {
      throw new Error(result.error || 'Failed to redeem invitation');
    }

    const conv = this.repo.getPrivateConversation(result.conversationId, this.localDeviceId);
    if (!conv) {
      throw new Error('Private conversation joined, but could not be loaded');
    }
    return conv;
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
}
