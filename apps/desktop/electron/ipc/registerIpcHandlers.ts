import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
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
} from '@ipm/shared';
import { SystemInfoService } from '../services/SystemInfoService';
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
} from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity, deriveDeviceId } from '@ipm/security';
import type { LanTransportAdapter } from '@ipm/networking';
import type { MessagingService } from '@ipm/messaging';
import type { PrivateSessionManager } from '../services/PrivateSessionManager';
import type { FileTransferService } from '../services/FileTransferService';
import type { FolderSharingService } from '../services/FolderSharingService';

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
    secretStore,
    getMainWindow,
    getLanAdapter,
    initLanAdapter,
    getMessagingService,
  } = deps;

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
    return settingsRepo.updateSettings(validated);
  });

  // Devices & Network (Phase 2)
  ipcMain.handle(IpcChannels.DEVICES_LIST, () => {
    return deviceRepo.getAllDevices();
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
    return adapter.connectDirect(validated.ipAddress, validated.port);
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
    const isPrivate = privateRepo.isPrivateConversation(conversationId);
    if (isPrivate) {
      privateSession.requireUnlocked();
    }
    const profile = profileRepo.getProfile();
    const localDeviceId = profile?.deviceId ?? '';
    return conversationRepo.getConversationById(conversationId, localDeviceId, isPrivate);
  });

  ipcMain.handle(IpcChannels.CONVERSATIONS_CREATE_DIRECT, (_event, peerDeviceId: string) => {
    const profile = profileRepo.getProfile();
    if (!profile) throw new Error('Profile required to create conversation');
    const peer = deviceRepo.getDeviceById(peerDeviceId);
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
    const isPrivate = privateRepo.isPrivateConversation(rawInput.conversationId);
    if (isPrivate) {
      privateSession.requireUnlocked();
    }
    return messageRepo.getMessages(rawInput.conversationId, rawInput.limit ?? 100);
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEND, async (_event, rawInput: unknown) => {
    const input = SendMessageInputSchema.parse(rawInput);
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');

    const isPrivate = privateRepo.isPrivateConversation(input.conversationId);
    if (isPrivate) {
      privateSession.requireUnlocked();
    }

    const profile = profileRepo.getProfile();
    const conv = conversationRepo.getConversationById(input.conversationId, profile?.deviceId ?? '', isPrivate);
    if (!conv) throw new Error(`Conversation ${input.conversationId} not found`);

    if (conv.type === 'group') {
      return messaging.sendGroupMessage(conv.id, input.content, input.contentType);
    } else {
      const peerId = conv.peerDeviceId || conv.memberDeviceIds?.find((id) => id !== profile?.deviceId);
      if (!peerId) throw new Error('No peer ID found for conversation');
      return messaging.sendDirectMessage(
        conv.id,
        peerId,
        input.content,
        input.contentType,
        input.isEncrypted || isPrivate,
        input.replyToId
      );
    }
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEND_READ, async (_event, rawInput: { conversationId: string; peerDeviceId?: string }) => {
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

  ipcMain.handle(IpcChannels.PRIVATE_INVITATION_REDEEM, (_event, rawInput: unknown) => {
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
    return transferService.offerFile(input);
  });

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
    shell.showItemInFolder(filePath);
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
}
