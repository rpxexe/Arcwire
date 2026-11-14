import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IpcChannels,
  IpcApi,
  DeviceInfo,
  MessageItem,
  ConversationItem,
  ReceiptEventData,
  TypingEventData,
  TransferItem,
  TransferProgressEventData,
  CallItem,
  CallSignalInput,
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
  deleteMessage: (input) => ipcRenderer.invoke(IpcChannels.MESSAGES_DELETE, input),
  editMessage: (input) => ipcRenderer.invoke(IpcChannels.MESSAGES_EDIT, input),
  reactToMessage: (input) => ipcRenderer.invoke(IpcChannels.MESSAGES_REACT, input),
  setMessageFlags: (input) => ipcRenderer.invoke(IpcChannels.MESSAGES_SET_FLAGS, input),
  deleteConversation: (conversationId) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_DELETE, conversationId),
  clearConversation: (conversationId) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_CLEAR, conversationId),
  setConversationFlags: (input) => ipcRenderer.invoke(IpcChannels.CONVERSATIONS_SET_FLAGS, input),
  markConversationUnread: (conversationId, unread) =>
    ipcRenderer.invoke(IpcChannels.CONVERSATIONS_MARK_UNREAD, { conversationId, unread }),

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

  // File Transfer (Phase 5)
  getTransfers: (conversationId) => ipcRenderer.invoke(IpcChannels.TRANSFERS_LIST, conversationId),
  sendFile: (input) => ipcRenderer.invoke(IpcChannels.TRANSFERS_SEND_FILE, input),
  acceptTransfer: (transferId, savePath) => ipcRenderer.invoke(IpcChannels.TRANSFERS_ACCEPT, { transferId, savePath }),
  rejectTransfer: (transferId) => ipcRenderer.invoke(IpcChannels.TRANSFERS_REJECT, transferId),
  pauseTransfer: (transferId) => ipcRenderer.invoke(IpcChannels.TRANSFERS_PAUSE, transferId),
  resumeTransfer: (transferId) => ipcRenderer.invoke(IpcChannels.TRANSFERS_RESUME, transferId),
  cancelTransfer: (transferId) => ipcRenderer.invoke(IpcChannels.TRANSFERS_CANCEL, transferId),
  selectFile: () => ipcRenderer.invoke(IpcChannels.TRANSFERS_SELECT_FILE),
  openTransferFolder: (filePath) => ipcRenderer.invoke(IpcChannels.TRANSFERS_OPEN_FOLDER, filePath),
  openTransferFile: (filePath) => ipcRenderer.invoke(IpcChannels.TRANSFERS_OPEN_FILE, filePath),
  saveTransferAs: (filePath) => ipcRenderer.invoke(IpcChannels.TRANSFERS_SAVE_AS, filePath),
  sendFileToConversation: (input) => ipcRenderer.invoke(IpcChannels.TRANSFERS_SEND_BUFFER, input),
  sendBufferToConversation: (input) => ipcRenderer.invoke(IpcChannels.TRANSFERS_SEND_BUFFER, input),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // Media permissions & clipboard
  getMediaAccessStatus: () => ipcRenderer.invoke(IpcChannels.MEDIA_GET_ACCESS_STATUS),
  openPrivacySettings: (kind) => ipcRenderer.invoke(IpcChannels.MEDIA_OPEN_PRIVACY_SETTINGS, kind),
  writeClipboardText: (text) => ipcRenderer.invoke(IpcChannels.CLIPBOARD_WRITE_TEXT, text),
  getFirewallStatus: () => ipcRenderer.invoke(IpcChannels.FIREWALL_STATUS),
  fixFirewall: () => ipcRenderer.invoke(IpcChannels.FIREWALL_FIX),

  // Shared Folders (Phase 5)
  getSharedFolders: () => ipcRenderer.invoke(IpcChannels.FOLDERS_LIST),
  createSharedFolder: (input) => ipcRenderer.invoke(IpcChannels.FOLDERS_CREATE, input),
  updateSharedFolder: (input) => ipcRenderer.invoke(IpcChannels.FOLDERS_UPDATE, input),
  deleteSharedFolder: (folderId) => ipcRenderer.invoke(IpcChannels.FOLDERS_DELETE, folderId),
  selectDirectory: () => ipcRenderer.invoke(IpcChannels.FOLDERS_SELECT_DIRECTORY),
  browseRemoteFolder: (input) => ipcRenderer.invoke(IpcChannels.FOLDERS_BROWSE_REMOTE, input),
  executeRemoteFolderOp: (input) => {
    if (input.action === 'create_dir') {
      return ipcRenderer.invoke(IpcChannels.FOLDERS_CREATE_REMOTE_DIR, input);
    } else if (input.action === 'rename') {
      return ipcRenderer.invoke(IpcChannels.FOLDERS_RENAME_REMOTE_ITEM, input);
    } else {
      return ipcRenderer.invoke(IpcChannels.FOLDERS_DELETE_REMOTE_ITEM, input);
    }
  },

  // Calling & WebRTC (Phase 6)
  initiateCall: (input) => ipcRenderer.invoke(IpcChannels.CALLS_INITIATE, input),
  acceptCall: (callId) => ipcRenderer.invoke(IpcChannels.CALLS_ACCEPT, callId),
  rejectCall: (callId) => ipcRenderer.invoke(IpcChannels.CALLS_REJECT, callId),
  endCall: (callId) => ipcRenderer.invoke(IpcChannels.CALLS_END, callId),
  sendCallSignal: (input) => ipcRenderer.invoke(IpcChannels.CALLS_SIGNAL, input),
  getCalls: (conversationId) => ipcRenderer.invoke(IpcChannels.CALLS_LIST, conversationId),
  getDesktopSources: () => ipcRenderer.invoke(IpcChannels.CALLS_GET_SOURCES),
  startScreenShare: (callId, sourceName) => ipcRenderer.invoke(IpcChannels.CALLS_START_SCREEN_SHARE, { callId, sourceName }),
  stopScreenShare: (callId) => ipcRenderer.invoke(IpcChannels.CALLS_STOP_SCREEN_SHARE, { callId }),

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
  onMessageUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: MessageItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_MESSAGE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_MESSAGE_UPDATED, handler);
  },
  onConversationRemoved: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CONVERSATION_REMOVED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CONVERSATION_REMOVED, handler);
  },
  onTransferUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TransferItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_TRANSFER_UPDATED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_TRANSFER_UPDATED, handler);
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
  onTransferOffer: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TransferItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_TRANSFER_OFFER, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_TRANSFER_OFFER, handler);
  },
  onTransferProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TransferProgressEventData) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_TRANSFER_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_TRANSFER_PROGRESS, handler);
  },
  onTransferCompleted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TransferItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_TRANSFER_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_TRANSFER_COMPLETED, handler);
  },
  onTransferFailed: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { transferId: string; error: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_TRANSFER_FAILED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_TRANSFER_FAILED, handler);
  },
  onCallIncoming: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CallItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CALL_INCOMING, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CALL_INCOMING, handler);
  },
  onCallAccepted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { callId: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CALL_ACCEPTED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CALL_ACCEPTED, handler);
  },
  onCallRejected: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { callId: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CALL_REJECTED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CALL_REJECTED, handler);
  },
  onCallEnded: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { callId: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CALL_ENDED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CALL_ENDED, handler);
  },
  onCallSignal: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CallSignalInput) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_CALL_SIGNAL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_CALL_SIGNAL, handler);
  },
  onScreenShareStarted: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { callId: string; sourceName?: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_SCREEN_SHARE_STARTED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_SCREEN_SHARE_STARTED, handler);
  },
  onScreenShareStopped: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { callId: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_SCREEN_SHARE_STOPPED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_SCREEN_SHARE_STOPPED, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
