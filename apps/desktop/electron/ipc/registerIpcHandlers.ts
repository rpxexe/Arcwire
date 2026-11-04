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
} from '@ipm/shared';
import { SystemInfoService } from '../services/SystemInfoService';
import {
  ProfileRepository,
  SettingsRepository,
  DeviceRepository,
  ConversationRepository,
  MessageRepository,
  GroupRepository,
} from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity, deriveDeviceId } from '@ipm/security';
import type { LanTransportAdapter } from '@ipm/networking';
import type { MessagingService } from '@ipm/messaging';

export interface IpcHandlerDependencies {
  profileRepo: ProfileRepository;
  settingsRepo: SettingsRepository;
  deviceRepo: DeviceRepository;
  conversationRepo: ConversationRepository;
  messageRepo: MessageRepository;
  groupRepo: GroupRepository;
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
    return conversationRepo.getConversations(localDeviceId, rawInput?.includePrivate ?? false);
  });

  ipcMain.handle(IpcChannels.CONVERSATIONS_GET, (_event, conversationId: string) => {
    const profile = profileRepo.getProfile();
    const localDeviceId = profile?.deviceId ?? '';
    return conversationRepo.getConversationById(conversationId, localDeviceId);
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
    return messageRepo.getMessages(rawInput.conversationId, rawInput.limit ?? 100);
  });

  ipcMain.handle(IpcChannels.MESSAGES_SEND, async (_event, rawInput: unknown) => {
    const input = SendMessageInputSchema.parse(rawInput);
    const messaging = getMessagingService();
    if (!messaging) throw new Error('Messaging service not initialized');

    const profile = profileRepo.getProfile();
    const conv = conversationRepo.getConversationById(input.conversationId, profile?.deviceId ?? '');
    if (!conv) throw new Error(`Conversation ${input.conversationId} not found`);

    if (conv.type === 'group') {
      return messaging.sendGroupMessage(conv.id, input.content, input.contentType);
    } else {
      const peerId = conv.peerDeviceId;
      if (!peerId) throw new Error('No peer ID found for direct conversation');
      return messaging.sendDirectMessage(
        conv.id,
        peerId,
        input.content,
        input.contentType,
        input.isEncrypted,
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
    return messageRepo.searchMessages(input.query, input.conversationId);
  });
}
