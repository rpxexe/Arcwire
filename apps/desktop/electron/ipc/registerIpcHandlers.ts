import { ipcMain, BrowserWindow } from 'electron';
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
} from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity, deriveDeviceId } from '@ipm/security';
import type { LanTransportAdapter } from '@ipm/networking';
import type { MessagingService } from '@ipm/messaging';
import type { PrivateSessionManager } from '../services/PrivateSessionManager';

export interface IpcHandlerDependencies {
  profileRepo: ProfileRepository;
  settingsRepo: SettingsRepository;
  deviceRepo: DeviceRepository;
  conversationRepo: ConversationRepository;
  messageRepo: MessageRepository;
  groupRepo: GroupRepository;
  privateRepo: PrivateChatRepository;
  privateSession: PrivateSessionManager;
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
    // Enforce private isolation: only include private if explicitly authorized and unlocked
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

  // Listen to privateSession lock state changes and forward to renderer
  privateSession.onStateChange((state) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IpcChannels.EVENT_PRIVATE_LOCK_STATE, state);
    }
  });
}
