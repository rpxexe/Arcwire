import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app, ipcMain, BrowserWindow, dialog, shell, clipboard, systemPreferences } from 'electron';
import {
  IpcChannels,
  ProfileCreateSchema,
  ProfileUpdateSchema,
  AppSettingsSchema,
  DirectConnectInputSchema,
  TrustDeviceInputSchema,
  SendMessageInputSchema,
  CreateConversationInputSchema,
  CreateGroupInputSchema,
  SearchMessagesInputSchema,
  SetupUnlockCredentialInputSchema,
  UnlockPrivateInputSchema,
  CreatePrivateConversationInputSchema,
  CreateInvitationInputSchema,
  RedeemInvitationInputSchema,
  SendFileInputSchema,
  AcceptTransferInputSchema,
  CreateSharedFolderInputSchema,
  UpdateSharedFolderInputSchema,
  BrowseRemoteFolderInputSchema,
  RemoteFolderOperationInputSchema,
  InitiateCallInputSchema,
  RespondCallInputSchema,
  EndCallInputSchema,
  CallSignalInputSchema,
} from '@ipm/shared';
import { SystemInfoService } from '../services/SystemInfoService';
import { AppPaths } from '../services/AppPaths';
import { guessMimeType } from '../services/FileTransferService';
import { FirewallService } from '../services/FirewallService';
import { PathTraversalGuard } from '@ipm/file-sharing';
import {
  ProfileRepository,
  SettingsRepository,
  DeviceRepository,
  ConversationRepository,
  MessageRepository,
  GroupRepository,
  PrivateChatRepository,
  TransferRepository,
  SharedFolderRepository,
  CallRepository,
} from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity, deriveDeviceId } from '@ipm/security';
import type { ConversationItem, FileAttachmentMeta, MessageItem, MediaAccessStatus } from '@ipm/shared';
import type { LanTransportAdapter } from '@ipm/networking';
import type { MessagingService } from '@ipm/messaging';
import type { PrivateSessionManager } from '../services/PrivateSessionManager';
import type { FileTransferService } from '../services/FileTransferService';
import type { FolderSharingService } from '../services/FolderSharingService';
import type { CallSignalingService } from '../services/CallSignalingService';

export interface IpcHandlerDependencies {
  profileRepo: ProfileRepository;
  settingsRepo: SettingsRepository;
  deviceRepo: DeviceRepository;
  conversationRepo: ConversationRepository;
  messageRepo: MessageRepository;
  groupRepo: GroupRepository;
  privateRepo: PrivateChatRepository;
  privateSession: PrivateSessionManager;
  transferRepo: TransferRepository;
  folderRepo: SharedFolderRepository;
  transferService: FileTransferService;
  folderService: FolderSharingService;
  callRepo: CallRepository;
  callService: CallSignalingService;
  secretStore: SecretKeyStore;
  getMainWindow: () => BrowserWindow | null;
  getLanAdapter: () => LanTransportAdapter | null;
  initLanAdapter: () => Promise<LanTransportAdapter | null>;
  getMessagingService: () => MessagingService | null;
}

export function registerIpcHandlers(deps: IpcHandlerDependencies): void {
  const {
    profileRepo,
    settingsRepo,
    deviceRepo,
    conversationRepo,
    messageRepo,
    privateRepo,
    privateSession,
    transferRepo,
    folderRepo,
    transferService,
    folderService,
    callRepo,
    callService,
    secretStore,
    getMainWindow,
    getLanAdapter,
    initLanAdapter,
    getMessagingService,
  } = deps;

  const MAX_BUFFER_UPLOAD_BYTES = 512 * 1024 * 1024; // 512 MB for pasted / dropped in-memory files

  const sendToRenderer = (channel: string, payload: unknown) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const localDeviceId = (): string => profileRepo.getProfile()?.deviceId ?? '';

  /** Throws if the conversation is PIN-protected and the private workspace is locked. */
  const guardConversation = (conversationId: string): boolean => {
    const isProtected = privateSession.isProtectedConversation(conversationId);
    if (isProtected) {
      privateSession.requireUnlocked();
      privateSession.touch();
    }
    return isProtected;
  };

  const guardMessage = (messageId: string): MessageItem => {
    const msg = messageRepo.getMessageById(messageId);
    if (!msg) throw new Error('Message not found');
    guardConversation(msg.conversationId);
    return msg;
  };

  const getRecipients = (conv: ConversationItem): string[] => {
    const me = localDeviceId();
    if (conv.type === 'direct') {
      const peer = conv.peerDeviceId || conv.memberDeviceIds?.find((id) => id !== me);
      return peer && peer !== me ? [peer] : [];
    }
    return Array.from(new Set((conv.memberDeviceIds ?? []).filter((id) => id && id !== me)));
  };

  /** Only paths that belong to a recorded transfer may be opened from the renderer. */
  const isKnownTransferPath = (filePath: string): boolean => {
    if (!filePath) return false;
    const normalized = path.resolve(filePath).toLowerCase();
    return transferRepo.listTransfers().some((t) => t.finalPath && path.resolve(t.finalPath).toLowerCase() === normalized);
  };

  /**
   * Sends a file into a conversation: one chunked transfer per recipient plus a `file`
   * chat message that carries the attachment metadata (rendered as a file bubble).
   */
  const sendFileToConversation = async (
    conversationId: string,
    filePath: string,
    options: { fileName?: string; caption?: string } = {}
  ): Promise<MessageItem> => {
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');
    const isProtected = guardConversation(conversationId);

    const conv = conversationRepo.getConversationById(conversationId, localDeviceId(), true);
    if (!conv) throw new Error(`Conversation ${conversationId} not found`);
    const recipients = getRecipients(conv);
    if (recipients.length === 0) throw new Error('This conversation has no other members to send the file to');

    const transferIds: Record<string, string> = {};
    let fileName = options.fileName ?? path.basename(filePath);
    let fileSize = 0;
    const failures: string[] = [];

    for (const peerId of recipients) {
      const transfer = await transferService.offerFile({ conversationId, peerDeviceId: peerId, filePath, fileName: options.fileName });
      transferIds[peerId] = transfer.id;
      fileName = transfer.fileName;
      fileSize = transfer.fileSize;
      if (transfer.status === 'failed') failures.push(transfer.errorMessage ?? 'unreachable');
    }

    if (failures.length === recipients.length) {
      throw new Error(`Could not reach ${recipients.length > 1 ? 'any member' : 'the peer'}: ${failures[0]}. Make sure they are online.`);
    }

    const meta: FileAttachmentMeta = {
      fileName,
      fileSize,
      mimeType: guessMimeType(fileName),
      transferIds,
      caption: options.caption?.trim() || undefined,
    };
    const content = JSON.stringify(meta);

    if (conv.type === 'group') {
      return messaging.sendGroupMessage(conv.id, content, 'file');
    }
    if (recipients.length > 1) {
      return messaging.sendFanoutMessage(conv.id, recipients, content, 'file', isProtected);
    }
    return messaging.sendDirectMessage(conv.id, recipients[0]!, content, 'file', conv.type === 'private');
  };

  // Window Controls
  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE, () => {
    const win = getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.handle(IpcChannels.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle(IpcChannels.WINDOW_CLOSE, () => {
    const win = getMainWindow();
    if (win) win.close();
  });

  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE_TO_TRAY, () => {
    const win = getMainWindow();
    if (win) win.hide();
  });

  // System Information
  ipcMain.handle(IpcChannels.SYSTEM_GET_INFO, () => {
    return SystemInfoService.getSystemInfo();
  });

  // Profile Management
  ipcMain.handle(IpcChannels.PROFILE_GET, () => {
    return profileRepo.getProfile();
  });

  ipcMain.handle(IpcChannels.PROFILE_CREATE, async (_event, rawInput: unknown) => {
    const validated = ProfileCreateSchema.parse(rawInput);
    const systemInfo = SystemInfoService.getSystemInfo();

    let privateKey = secretStore.loadIdentityKey();
    let publicKey = '';
    let deviceId = '';

    if (!privateKey) {
      const newIdentity = generateDeviceIdentity();
      privateKey = newIdentity.privateKey;
      publicKey = newIdentity.publicKey;
      deviceId = newIdentity.deviceId;
      secretStore.saveIdentityKey(privateKey);
    } else {
      const identity = generateDeviceIdentity();
      publicKey = identity.publicKey;
      deviceId = deriveDeviceId(publicKey);
    }

    const created = profileRepo.createProfile(
      validated,
      { osUsername: systemInfo.osUsername, computerName: systemInfo.computerName },
      { deviceId, publicKey }
    );

    privateSession.updateLocalDeviceId(deviceId);
    transferService.updateLocalDeviceId(deviceId);
    folderService.updateLocalDeviceId(deviceId);
    await initLanAdapter();

    return created;
  });

  ipcMain.handle(IpcChannels.PROFILE_UPDATE, (_event, rawInput: unknown) => {
    const validated = ProfileUpdateSchema.parse(rawInput);
    const updated = profileRepo.updateProfile(validated);

    const adapter = getLanAdapter();
    if (adapter && updated) {
      adapter.updateProfile({
        displayName: updated.displayName,
        status: updated.status as any,
      });
    }

    return updated;
  });

  // Settings Management
  ipcMain.handle(IpcChannels.SETTINGS_GET, () => {
    return settingsRepo.getSettings();
  });

  ipcMain.handle(IpcChannels.SETTINGS_UPDATE, (_event, rawInput: unknown) => {
    const validated = AppSettingsSchema.partial().parse(rawInput);
    if (validated.startWithWindows !== undefined) {
      try {
        app.setLoginItemSettings({
          openAtLogin: validated.startWithWindows,
          args: ['--hidden'],
        });
      } catch (err) {
        console.error('[Main] Failed to update login item settings:', err);
      }
    }
    return settingsRepo.updateSettings(validated);
  });

  // Devices & Network (Phase 2)
  ipcMain.handle(IpcChannels.DEVICES_LIST, () => {
    // Never list this PC itself as a peer
    const me = localDeviceId();
    return deviceRepo.getAllDevices().filter((d) => d.id !== me);
  });

  ipcMain.handle(IpcChannels.DEVICES_REFRESH, async () => {
    const adapter = getLanAdapter();
    if (adapter) {
      adapter.scanNow();
    }
  });

  ipcMain.handle(IpcChannels.DEVICES_CONNECT_MANUAL, async (_event, rawInput: unknown) => {
    const validated = DirectConnectInputSchema.parse(rawInput);
    const adapter = getLanAdapter();
    if (!adapter) {
      throw new Error('LAN networking is not initialized. Please complete onboarding first.');
    }
    try {
      return await adapter.connectDirect(validated.ipAddress, validated.port);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/timed out|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
        throw new Error(
          `Could not reach Arcwire at ${validated.ipAddress}:${validated.port}. Make sure Arcwire is open on that PC and ` +
            `allowed through its Windows Firewall (on that PC: Settings → Windows Firewall → Allow).`
        );
      }
      throw err;
    }
  });

  ipcMain.handle(IpcChannels.DEVICES_TOGGLE_TRUST, (_event, rawInput: unknown) => {
    const validated = TrustDeviceInputSchema.parse(rawInput);
    deviceRepo.setDeviceTrust(validated.deviceId, validated.isTrusted);
    const updated = deviceRepo.getDeviceById(validated.deviceId);
    if (updated) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.EVENT_DEVICE_UPDATED, updated);
      }
    }
  });

  // Conversations & Messaging (Phase 3)
  ipcMain.handle(IpcChannels.CONVERSATIONS_LIST, (_event, rawInput?: { includePrivate?: boolean }) => {
    const profile = profileRepo.getProfile();
    const localDeviceId = profile?.deviceId ?? '';
    const includePrivate = Boolean(rawInput?.includePrivate && privateSession.isUnlocked());
    return conversationRepo.getConversations(localDeviceId, includePrivate);
  });

  ipcMain.handle(IpcChannels.CONVERSATIONS_GET, (_event, conversationId: string) => {
    const isProtected = guardConversation(conversationId);
    return conversationRepo.getConversationById(conversationId, localDeviceId(), isProtected);
  });

  ipcMain.handle(IpcChannels.CONVERSATIONS_CREATE_DIRECT, (_event, peerDeviceId: string) => {
    const profile = profileRepo.getProfile();
    if (!profile) throw new Error('Profile required to create conversation');
    deviceRepo.upsertDevice({
      id: profile.deviceId,
      publicKey: profile.publicKey,
      displayName: profile.displayName,
      hostname: profile.computerName,
      status: 'online',
    });
    const peer = deviceRepo.getDeviceById(peerDeviceId);
    if (!peer) {
      deviceRepo.upsertDevice({
        id: peerDeviceId,
        publicKey: '',
        displayName: 'Direct Chat',
        hostname: 'lan-peer',
        status: 'online',
      });
    }
    return conversationRepo.getOrCreateDirectConversation(
      profile.deviceId,
      peerDeviceId,
      peer?.displayName || 'Direct Chat'
    );
  });

  ipcMain.handle(IpcChannels.CONVERSATIONS_CREATE_GROUP, async (_event, rawInput: unknown) => {
    const input = CreateGroupInputSchema.parse(rawInput);
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');

    const groupId = await messaging.createGroup(
      input.name,
      input.description,
      input.memberDeviceIds || []
    );

    const profile = profileRepo.getProfile();
    const conv = conversationRepo.getConversationById(groupId, profile?.deviceId ?? '');
    if (!conv) throw new Error(`Group conversation ${groupId} could not be retrieved`);
    return conv;
  });

  ipcMain.handle(IpcChannels.MESSAGES_LIST, (_event, rawInput: { conversationId: string; limit?: number }) => {
    guardConversation(rawInput.conversationId);
    const limit = Math.min(Math.max(rawInput.limit ?? 200, 1), 2000);
    return messageRepo.getMessages(rawInput.conversationId, limit);
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEND, async (_event, rawInput: unknown) => {
    const input = SendMessageInputSchema.parse(rawInput);
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');

    const isProtected = guardConversation(input.conversationId);
    const conv = conversationRepo.getConversationById(input.conversationId, localDeviceId(), true);
    if (!conv) throw new Error(`Conversation ${input.conversationId} not found`);
    const isPrivate = conv.type === 'private';

    if (conv.type === 'group') {
      return messaging.sendGroupMessage(conv.id, input.content, input.contentType, input.replyToId);
    }

    const recipients = getRecipients(conv);
    if (recipients.length === 0) {
      throw new Error(
        isPrivate
          ? 'No one has joined this private chat yet. Share an invitation code first.'
          : 'No peer found for this conversation'
      );
    }
    if (recipients.length > 1) {
      return messaging.sendFanoutMessage(conv.id, recipients, input.content, input.contentType, isProtected, input.replyToId);
    }
    return messaging.sendDirectMessage(
      conv.id,
      recipients[0]!,
      input.content,
      input.contentType,
      input.isEncrypted || isPrivate,
      input.replyToId
    );
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEND_READ, async (_event, rawInput: { conversationId: string; peerDeviceId?: string }) => {
    conversationRepo.setConversationFlags(rawInput.conversationId, { isMarkedUnread: false });
    const messaging = getMessagingService();
    if (messaging) {
      await messaging.markConversationRead(rawInput.conversationId, rawInput.peerDeviceId);
    }
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEND_TYPING, async (_event, rawInput: { conversationId: string; isTyping: boolean }) => {
    const messaging = getMessagingService();
    if (messaging) {
      await messaging.sendTyping(rawInput.conversationId, rawInput.isTyping);
    }
  });

  // ==========================================
  // Message actions (context menu)
  // ==========================================

  ipcMain.handle(IpcChannels.MESSAGES_DELETE, async (_event, rawInput: { messageId: string; forEveryone: boolean }) => {
    guardMessage(rawInput.messageId);
    const messaging = getMessagingService();
    if (!messaging) {
      if (rawInput.forEveryone) throw new Error('Messaging service not initialized');
      messageRepo.deleteMessageLocally(rawInput.messageId);
      return null;
    }
    return messaging.deleteMessage(rawInput.messageId, Boolean(rawInput.forEveryone));
  });

  ipcMain.handle(IpcChannels.MESSAGES_EDIT, async (_event, rawInput: { messageId: string; content: string }) => {
    guardMessage(rawInput.messageId);
    const content = String(rawInput.content ?? '').trim();
    if (!content) throw new Error('Message cannot be empty');
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');
    return messaging.editMessage(rawInput.messageId, content.slice(0, 20000));
  });

  ipcMain.handle(IpcChannels.MESSAGES_REACT, async (_event, rawInput: { messageId: string; emoji: string }) => {
    guardMessage(rawInput.messageId);
    const emoji = String(rawInput.emoji ?? '');
    if (!emoji || emoji.length > 16) throw new Error('Invalid reaction');
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');
    return messaging.reactToMessage(rawInput.messageId, emoji);
  });

  ipcMain.handle(IpcChannels.MESSAGES_SET_FLAGS, (_event, rawInput: { messageId: string; isPinned?: boolean; isStarred?: boolean }) => {
    guardMessage(rawInput.messageId);
    const updated = messageRepo.setMessageFlags(rawInput.messageId, {
      isPinned: rawInput.isPinned,
      isStarred: rawInput.isStarred,
    });
    if (!updated) throw new Error('Message not found');
    return updated;
  });

  // ==========================================
  // Conversation actions (context menu)
  // ==========================================

  ipcMain.handle(IpcChannels.CONVERSATIONS_DELETE, (_event, conversationId: string) => {
    guardConversation(conversationId);
    conversationRepo.deleteConversation(conversationId);
    sendToRenderer(IpcChannels.EVENT_CONVERSATION_REMOVED, { conversationId });
  });

  ipcMain.handle(IpcChannels.CONVERSATIONS_CLEAR, (_event, conversationId: string) => {
    guardConversation(conversationId);
    conversationRepo.clearConversation(conversationId);
  });

  ipcMain.handle(
    IpcChannels.CONVERSATIONS_SET_FLAGS,
    (
      _event,
      rawInput: { conversationId: string; isPinned?: boolean; isMuted?: boolean; isArchived?: boolean; isChatLocked?: boolean }
    ) => {
      const { conversationId } = rawInput;
      guardConversation(conversationId);

      if (rawInput.isChatLocked !== undefined) {
        if (privateRepo.isPrivateConversation(conversationId)) {
          throw new Error('Private conversations are always locked');
        }
        if (!privateSession.getStatus().hasCredential) {
          throw new Error('Set up a Private Chats PIN first (open Private Chats), then lock this chat.');
        }
        if (!rawInput.isChatLocked) {
          privateSession.requireUnlocked();
        }
      }

      conversationRepo.setConversationFlags(conversationId, {
        isPinned: rawInput.isPinned,
        isMuted: rawInput.isMuted,
        isArchived: rawInput.isArchived,
        isChatLocked: rawInput.isChatLocked,
      });

      if (rawInput.isChatLocked !== undefined) {
        // The chat moved between the normal and the locked list
        sendToRenderer(IpcChannels.EVENT_CONVERSATION_REMOVED, { conversationId });
        sendToRenderer(IpcChannels.EVENT_PRIVATE_LOCK_STATE, {
          isUnlocked: privateSession.isUnlocked(),
          lockedUntil: privateSession.getStatus().lockedUntil,
        });
      }
      return conversationRepo.getConversationById(conversationId, localDeviceId(), true);
    }
  );

  ipcMain.handle(IpcChannels.CONVERSATIONS_MARK_UNREAD, (_event, rawInput: { conversationId: string; unread: boolean }) => {
    guardConversation(rawInput.conversationId);
    conversationRepo.setConversationFlags(rawInput.conversationId, { isMarkedUnread: Boolean(rawInput.unread) });
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEARCH, (_event, rawInput: unknown) => {
    const input = SearchMessagesInputSchema.parse(rawInput);
    const includePrivate = privateSession.isUnlocked();
    return messageRepo.searchMessages(input.query, input.conversationId, includePrivate);
  });

  // ==========================================
  // Private Chat System (Phase 4)
  // ==========================================

  ipcMain.handle(IpcChannels.PRIVATE_STATUS, () => {
    return privateSession.getStatus();
  });

  ipcMain.handle(IpcChannels.PRIVATE_SETUP_CREDENTIAL, async (_event, rawInput: unknown) => {
    const input = SetupUnlockCredentialInputSchema.parse(rawInput);
    await privateSession.setupCredential(input);
  });

  ipcMain.handle(IpcChannels.PRIVATE_UNLOCK, async (_event, rawInput: unknown) => {
    const input = UnlockPrivateInputSchema.parse(rawInput);
    return privateSession.unlock(input);
  });

  ipcMain.handle(IpcChannels.PRIVATE_LOCK, () => {
    privateSession.lock();
  });

  ipcMain.handle(IpcChannels.PRIVATE_CONVERSATIONS_LIST, () => {
    return privateSession.getPrivateConversations();
  });

  ipcMain.handle(IpcChannels.PRIVATE_CONVERSATIONS_CREATE, (_event, rawInput: unknown) => {
    const input = CreatePrivateConversationInputSchema.parse(rawInput);
    return privateSession.createPrivateConversation(input);
  });

  ipcMain.handle(IpcChannels.PRIVATE_INVITATION_CREATE, (_event, rawInput: unknown) => {
    const input = CreateInvitationInputSchema.parse(rawInput);
    return privateSession.createInvitation(input);
  });

  ipcMain.handle(IpcChannels.PRIVATE_INVITATION_REDEEM, async (_event, rawInput: unknown) => {
    const input = RedeemInvitationInputSchema.parse(rawInput);
    return privateSession.redeemInvitation(input);
  });

  ipcMain.handle(IpcChannels.PRIVATE_INVITATIONS_LIST, (_event, conversationId: string) => {
    return privateSession.listInvitations(conversationId);
  });

  ipcMain.handle(IpcChannels.PRIVATE_INVITATION_REVOKE, (_event, invitationId: string) => {
    privateSession.revokeInvitation(invitationId);
  });

  privateSession.onStateChange((state) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.EVENT_PRIVATE_LOCK_STATE, state);
    }
  });

  // ==========================================
  // File Transfer (Phase 5)
  // ==========================================

  ipcMain.handle(IpcChannels.TRANSFERS_LIST, (_event, conversationId?: string) => {
    return transferRepo.listTransfers(conversationId);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_SEND_FILE, async (_event, rawInput: unknown) => {
    const input = SendFileInputSchema.parse(rawInput);
    guardConversation(input.conversationId);
    return transferService.offerFile(input);
  });

  ipcMain.handle(
    IpcChannels.TRANSFERS_SEND_BUFFER,
    async (
      _event,
      rawInput: { conversationId?: string; filePath?: string; fileName?: string; data?: Uint8Array; caption?: string }
    ) => {
      if (!rawInput?.conversationId) throw new Error('conversationId is required');

      // 1. Real file on disk (file picker, drag & drop, pasted from Explorer)
      if (rawInput.filePath) {
        return sendFileToConversation(rawInput.conversationId, rawInput.filePath, { caption: rawInput.caption });
      }

      // 2. In-memory data (pasted screenshot / image)
      if (!rawInput.data || !rawInput.fileName) throw new Error('A file path or file data is required');
      const bytes = Buffer.from(rawInput.data);
      if (bytes.length > MAX_BUFFER_UPLOAD_BYTES) {
        throw new Error('Pasted file is too large. Use the attach button for files over 512 MB.');
      }
      const safeName = PathTraversalGuard.sanitizeFilename(rawInput.fileName) || `pasted-${Date.now()}`;
      const dir = path.join(AppPaths.get().attachments, crypto.randomUUID());
      await fs.promises.mkdir(dir, { recursive: true });
      const target = path.join(dir, safeName);
      await fs.promises.writeFile(target, bytes);
      return sendFileToConversation(rawInput.conversationId, target, { caption: rawInput.caption });
    }
  );

  ipcMain.handle(IpcChannels.TRANSFERS_ACCEPT, async (_event, rawInput: unknown) => {
    const input = AcceptTransferInputSchema.parse(rawInput);
    await transferService.acceptTransfer(input.transferId, input.savePath);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_REJECT, (_event, transferId: string) => {
    transferService.rejectTransfer(transferId);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_PAUSE, (_event, transferId: string) => {
    transferService.pauseTransfer(transferId);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_RESUME, (_event, transferId: string) => {
    transferService.resumeTransfer(transferId);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_CANCEL, (_event, transferId: string) => {
    transferService.cancelTransfer(transferId);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_SELECT_FILE, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined as any, {
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle(IpcChannels.TRANSFERS_OPEN_FOLDER, async (_event, filePath: string) => {
    if (filePath && isKnownTransferPath(filePath) && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    } else {
      // Fall back to the downloads folder
      const dir = transferService.getDownloadsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
    }
  });

  ipcMain.handle(IpcChannels.TRANSFERS_OPEN_FILE, async (_event, filePath: string) => {
    if (!isKnownTransferPath(filePath)) throw new Error('This file is not part of a transfer');
    if (!fs.existsSync(filePath)) throw new Error('File no longer exists on disk');
    return shell.openPath(filePath);
  });

  ipcMain.handle(IpcChannels.TRANSFERS_SAVE_AS, async (_event, filePath: string) => {
    if (!isKnownTransferPath(filePath) || !fs.existsSync(filePath)) throw new Error('File not available');
    const win = getMainWindow();
    const result = await dialog.showSaveDialog(win || (undefined as any), {
      defaultPath: path.join(app.getPath('downloads'), path.basename(filePath)),
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.copyFile(filePath, result.filePath);
    return result.filePath;
  });

  // ==========================================
  // Media permissions & clipboard
  // ==========================================

  ipcMain.handle(IpcChannels.MEDIA_GET_ACCESS_STATUS, (): MediaAccessStatus => {
    const read = (kind: 'microphone' | 'camera' | 'screen') => {
      try {
        return systemPreferences.getMediaAccessStatus(kind) as MediaAccessStatus['microphone'];
      } catch {
        return 'unknown' as const;
      }
    };
    return { microphone: read('microphone'), camera: read('camera'), screen: read('screen') };
  });

  ipcMain.handle(IpcChannels.MEDIA_OPEN_PRIVACY_SETTINGS, async (_event, kind: 'microphone' | 'camera') => {
    const uri = kind === 'camera' ? 'ms-settings:privacy-webcam' : 'ms-settings:privacy-microphone';
    if (process.platform === 'win32') {
      await shell.openExternal(uri);
    }
  });

  ipcMain.handle(IpcChannels.CLIPBOARD_WRITE_TEXT, (_event, text: string) => {
    clipboard.writeText(String(text ?? ''));
  });

  // ==========================================
  // Windows Firewall (LAN reachability)
  // ==========================================
  const firewall = new FirewallService(() => {
    const st = settingsRepo.getSettings();
    return { tcp: st.tcpPort, udp: st.udpPort, signaling: st.signalingPort };
  });

  ipcMain.handle(IpcChannels.FIREWALL_STATUS, () => firewall.getStatus());

  ipcMain.handle(IpcChannels.FIREWALL_FIX, async () => {
    const status = await firewall.fix();
    // Re-announce so peers discover us right away
    getLanAdapter()?.scanNow();
    return status;
  });

  // Forward transferService events to renderer
  transferService.on('offer', (transfer) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.EVENT_TRANSFER_OFFER, transfer);
    }
  });

  transferService.on('progress', (data) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.EVENT_TRANSFER_PROGRESS, data);
    }
  });

  transferService.on('completed', (transfer) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.EVENT_TRANSFER_COMPLETED, transfer);
    }
  });

  transferService.on('updated', (transfer) => {
    sendToRenderer(IpcChannels.EVENT_TRANSFER_UPDATED, transfer);
  });

  transferService.on('failed', (data) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.EVENT_TRANSFER_FAILED, data);
    }
  });

  // ==========================================
  // Shared Folders (Phase 5)
  // ==========================================

  ipcMain.handle(IpcChannels.FOLDERS_LIST, () => {
    return folderRepo.listSharedFolders();
  });

  ipcMain.handle(IpcChannels.FOLDERS_CREATE, (_event, rawInput: unknown) => {
    const input = CreateSharedFolderInputSchema.parse(rawInput);
    const id = `fld_${Date.now()}`;
    return folderRepo.createSharedFolder({
      id,
      name: input.name,
      localPath: input.localPath,
      defaultPermission: input.defaultPermission,
    });
  });

  ipcMain.handle(IpcChannels.FOLDERS_UPDATE, (_event, rawInput: unknown) => {
    const input = UpdateSharedFolderInputSchema.parse(rawInput);
    return folderRepo.updateSharedFolder(input.id, input);
  });

  ipcMain.handle(IpcChannels.FOLDERS_DELETE, (_event, folderId: string) => {
    return folderRepo.deleteSharedFolder(folderId);
  });

  ipcMain.handle(IpcChannels.FOLDERS_SELECT_DIRECTORY, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win || undefined as any, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle(IpcChannels.FOLDERS_BROWSE_REMOTE, async (_event, rawInput: unknown) => {
    const input = BrowseRemoteFolderInputSchema.parse(rawInput);
    return folderService.browseRemoteFolder(input.peerDeviceId, input.folderId, input.subPath);
  });

  ipcMain.handle(IpcChannels.FOLDERS_CREATE_REMOTE_DIR, async (_event, rawInput: unknown) => {
    const input = RemoteFolderOperationInputSchema.parse(rawInput);
    return folderService.executeRemoteOperation(input.peerDeviceId, input.folderId, 'create_dir', input.targetPath);
  });

  ipcMain.handle(IpcChannels.FOLDERS_DELETE_REMOTE_ITEM, async (_event, rawInput: unknown) => {
    const input = RemoteFolderOperationInputSchema.parse(rawInput);
    return folderService.executeRemoteOperation(input.peerDeviceId, input.folderId, 'delete', input.targetPath);
  });

  ipcMain.handle(IpcChannels.FOLDERS_RENAME_REMOTE_ITEM, async (_event, rawInput: unknown) => {
    const input = RemoteFolderOperationInputSchema.parse(rawInput);
    return folderService.executeRemoteOperation(input.peerDeviceId, input.folderId, 'rename', input.targetPath, input.newPath);
  });
  // ==========================================
  // Calling & WebRTC (Phase 6)
  // ==========================================

  ipcMain.handle(IpcChannels.CALLS_INITIATE, (_event, rawInput: unknown) => {
    const input = InitiateCallInputSchema.parse(rawInput);
    return callService.initiateCall(input);
  });

  ipcMain.handle(IpcChannels.CALLS_ACCEPT, (_event, callId: string) => {
    return callService.acceptCall(callId);
  });

  ipcMain.handle(IpcChannels.CALLS_REJECT, (_event, callId: string) => {
    return callService.rejectCall(callId);
  });

  ipcMain.handle(IpcChannels.CALLS_END, (_event, callId: string) => {
    return callService.endCall(callId);
  });

  ipcMain.handle(IpcChannels.CALLS_SIGNAL, (_event, rawInput: unknown) => {
    const input = CallSignalInputSchema.parse(rawInput);
    return callService.sendSignal(input);
  });

  ipcMain.handle(IpcChannels.CALLS_LIST, (_event, conversationId?: string) => {
    return callRepo.listCalls(conversationId);
  });

  ipcMain.handle(IpcChannels.CALLS_GET_SOURCES, async () => {
    return callService.getDesktopSources();
  });

  ipcMain.handle(IpcChannels.CALLS_START_SCREEN_SHARE, async (_event, { callId, sourceName }: { callId: string; sourceName?: string }) => {
    return callService.startScreenShare(callId, sourceName);
  });

  ipcMain.handle(IpcChannels.CALLS_STOP_SCREEN_SHARE, async (_event, { callId }: { callId: string }) => {
    return callService.stopScreenShare(callId);
  });
}
