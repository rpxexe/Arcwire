import { contextBridge, ipcRenderer } from 'electron';
import {
  IpcChannels,
  IpcApi,
  DeviceInfo,
  MessageItem,
  ConversationItem,
  ReceiptEventData,
  TypingEventData,
} from '@ipm/shared';

const api: IpcApi = {
  // Window
  minimizeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_CLOSE),
  minimizeToTray: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE_TO_TRAY),

  // System
  getSystemInfo: () => ipcRenderer.invoke(IpcChannels.SYSTEM_GET_INFO),

  // Profile
  getProfile: () => ipcRenderer.invoke(IpcChannels.PROFILE_GET),
  createProfile: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_CREATE, input),
  updateProfile: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_UPDATE, input),

  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  updateSettings: (input) => ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, input),

  // Devices & Network (Phase 2)
  getDevices: () => ipcRenderer.invoke(IpcChannels.DEVICES_LIST),
  refreshDevices: () => ipcRenderer.invoke(IpcChannels.DEVICES_REFRESH),
  connectManual: (input) => ipcRenderer.invoke(IpcChannels.DEVICES_CONNECT_MANUAL, input),
  toggleDeviceTrust: (input) => ipcRenderer.invoke(IpcChannels.DEVICES_TOGGLE_TRUST, input),

  // Conversations & Messaging (Phase 3)
  getConversations: (includePrivate) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_LIST, { includePrivate }),
  getConversation: (id) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_GET, id),
  createDirectConversation: (peerDeviceId) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_CREATE_DIRECT, peerDeviceId),
  createGroupConversation: (input) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_CREATE_GROUP, input),
  getMessages: (conversationId, limit) => ipcRenderer.invoke(IpcChannels.MESSAGES_LIST, { conversationId, limit }),
  sendMessage: (input) => ipcRenderer.invoke(IpcChannels.MESSAGES_SEND, input),
  markMessagesRead: (conversationId) => ipcRenderer.invoke(IpcChannels.MESSAGES_SEND_READ, { conversationId }),
  sendTyping: (conversationId, isTyping) => ipcRenderer.invoke(IpcChannels.MESSAGES_SEND_TYPING, { conversationId, isTyping }),
  searchMessages: (input) => ipcRenderer.invoke(IpcChannels.MESSAGES_SEARCH, input),

  // Private Chat System (Phase 4)
  getPrivateStatus: () => ipcRenderer.invoke(IpcChannels.PRIVATE_STATUS),
  setupPrivateCredential: (input) => ipcRenderer.invoke(IpcChannels.PRIVATE_SETUP_CREDENTIAL, input),
  unlockPrivate: (input) => ipcRenderer.invoke(IpcChannels.PRIVATE_UNLOCK, input),
  lockPrivate: () => ipcRenderer.invoke(IpcChannels.PRIVATE_LOCK),
  getPrivateConversations: () => ipcRenderer.invoke(IpcChannels.PRIVATE_CONVERSATIONS_LIST),
  createPrivateConversation: (input) => ipcRenderer.invoke(IpcChannels.PRIVATE_CONVERSATIONS_CREATE, input),
  createPrivateInvitation: (input) => ipcRenderer.invoke(IpcChannels.PRIVATE_INVITATION_CREATE, input),
  redeemPrivateInvitation: (input) => ipcRenderer.invoke(IpcChannels.PRIVATE_INVITATION_REDEEM, input),
  listPrivateInvitations: (conversationId) => ipcRenderer.invoke(IpcChannels.PRIVATE_INVITATIONS_LIST, conversationId),
  revokePrivateInvitation: (invitationId) => ipcRenderer.invoke(IpcChannels.PRIVATE_INVITATION_REVOKE, invitationId),

  // Event Listeners
  onNetworkStatusChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { online: boolean; ip?: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_NETWORK_STATUS, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_NETWORK_STATUS, handler);
  },
  onDeviceDiscovered: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DeviceInfo) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_DEVICE_DISCOVERED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_DEVICE_DISCOVERED, handler);
  },
  onDeviceUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DeviceInfo) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_DEVICE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_DEVICE_UPDATED, handler);
  },
  onMessageReceived: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: MessageItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_MESSAGE_RECEIVED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_MESSAGE_RECEIVED, handler);
  },
  onMessageReceipt: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ReceiptEventData) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_MESSAGE_RECEIPT, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_MESSAGE_RECEIPT, handler);
  },
  onTypingIndicator: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TypingEventData) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_TYPING_INDICATOR, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_TYPING_INDICATOR, handler);
  },
  onConversationUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ConversationItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CONVERSATION_UPDATED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CONVERSATION_UPDATED, handler);
  },
  onPrivateLockStateChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { isUnlocked: boolean; lockedUntil?: number | null }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_PRIVATE_LOCK_STATE, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_PRIVATE_LOCK_STATE, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
