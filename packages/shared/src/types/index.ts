import {
  Profile,
  ProfileCreateInput,
  ProfileUpdateInput,
  AppSettings,
  SystemInfo,
  NetworkEnvelope,
  UserStatus,
  DirectConnectInput,
  TrustDeviceInput,
  SendMessageInput,
  CreateConversationInput,
  SearchMessagesInput,
  SetupUnlockCredentialInput,
  UnlockPrivateInput,
  CreatePrivateConversationInput,
  CreateInvitationInput,
  RedeemInvitationInput,
  PrivateStatus,
  TransferItem,
  TransferStatus,
  SendFileInput,
  SharedFolderItem,
  CreateSharedFolderInput,
  UpdateSharedFolderInput,
  RemoteFolderItem,
  BrowseRemoteFolderInput,
  RemoteFolderOperationInput,
  FolderListResponsePayload,
  FolderOperationResponsePayload,
  CallItem,
  InitiateCallInput,
  RespondCallInput,
  EndCallInput,
  CallSignalInput,
  DesktopSourceItem,
  ScreenShareOptions,
  ScreenSharePreset,
  CallStats,
} from '../schemas/index';

export * from '../schemas/index';
export * from '../constants/index';
export * from '../events/index';

export interface DeviceInfo {
  id: string;
  publicKey: string;
  displayName: string;
  hostname: string;
  ipAddress: string;
  tcpPort: number;
  signalingPort: number;
  lastSeen: number;
  status: UserStatus;
  isTrusted: boolean;
}

export interface ConversationItem {
  id: string;
  type: 'direct' | 'group' | 'private';
  title: string;
  avatarUrl?: string | null;
  lastMessage?: string | null;
  lastActivityAt: number;
  unreadCount: number;
  isLocked?: boolean;
  peerDeviceId?: string; // for direct chats
  memberDeviceIds?: string[];
  hostDeviceId?: string; // for group chats
  isHost?: boolean;
  description?: string | null;
}

export interface MessageItem {
  id: string;
  conversationId: string;
  senderId: string;
  sequence: number;
  content: string;
  contentType: 'text' | 'file' | 'system';
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: number;
  deliveredAt?: number | null;
  readAt?: number | null;
  isEncrypted: boolean;
  replyToId?: string | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
}

export interface ReceiptEventData {
  messageId: string;
  conversationId: string;
  receiptType: 'ack' | 'delivered' | 'read';
  timestamp: number;
}

export interface TypingEventData {
  conversationId: string;
  deviceId: string;
  isTyping: boolean;
}

export interface InvitationItem {
  id: string;
  code?: string;
  codeHash: string;
  conversationId: string;
  creatorDeviceId: string;
  maxUses: number;
  usedCount: number;
  expiresAt: number;
  isRevoked: boolean;
  createdAt: number;
}

export interface TransferProgressEventData {
  transferId: string;
  bytesTransferred: number;
  speed: number;
  remainingTime: number;
  status: TransferStatus;
}

export interface IpcApi {
  // Window
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  minimizeToTray: () => Promise<void>;

  // System
  getSystemInfo: () => Promise<SystemInfo>;

  // Profile
  getProfile: () => Promise<Profile | null>;
  createProfile: (input: ProfileCreateInput) => Promise<Profile>;
  updateProfile: (input: ProfileUpdateInput) => Promise<Profile>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  updateSettings: (input: Partial<AppSettings>) => Promise<AppSettings>;

  // Devices & Network (Phase 2)
  getDevices: () => Promise<DeviceInfo[]>;
  refreshDevices: () => Promise<void>;
  connectManual: (input: DirectConnectInput) => Promise<DeviceInfo>;
  toggleDeviceTrust: (input: TrustDeviceInput) => Promise<void>;

  // Conversations & Messaging (Phase 3)
  getConversations: (includePrivate?: boolean) => Promise<ConversationItem[]>;
  getConversation: (id: string) => Promise<ConversationItem | null>;
  createDirectConversation: (peerDeviceId: string) => Promise<ConversationItem>;
  createGroupConversation: (input: { name: string; description?: string; memberDeviceIds: string[] }) => Promise<ConversationItem>;
  getMessages: (conversationId: string, limit?: number) => Promise<MessageItem[]>;
  sendMessage: (input: SendMessageInput) => Promise<MessageItem>;
  markMessagesRead: (conversationId: string) => Promise<void>;
  sendTyping: (conversationId: string, isTyping: boolean) => Promise<void>;
  searchMessages: (input: SearchMessagesInput) => Promise<MessageItem[]>;

  // Private Chat System (Phase 4)
  getPrivateStatus: () => Promise<PrivateStatus>;
  setupPrivateCredential: (input: SetupUnlockCredentialInput) => Promise<void>;
  unlockPrivate: (input: UnlockPrivateInput) => Promise<{ success: boolean; error?: string; lockedUntil?: number | null }>;
  lockPrivate: () => Promise<void>;
  getPrivateConversations: () => Promise<ConversationItem[]>;
  createPrivateConversation: (input: CreatePrivateConversationInput) => Promise<ConversationItem>;
  createPrivateInvitation: (input: CreateInvitationInput) => Promise<{ code: string; expiresAt: number; id: string }>;
  redeemPrivateInvitation: (input: RedeemInvitationInput) => Promise<ConversationItem>;
  listPrivateInvitations: (conversationId: string) => Promise<InvitationItem[]>;
  revokePrivateInvitation: (invitationId: string) => Promise<void>;

  // File Transfer (Phase 5)
  getTransfers: (conversationId?: string) => Promise<TransferItem[]>;
  sendFile: (input: SendFileInput) => Promise<TransferItem>;
  acceptTransfer: (transferId: string, savePath?: string) => Promise<void>;
  rejectTransfer: (transferId: string) => Promise<void>;
  pauseTransfer: (transferId: string) => Promise<void>;
  resumeTransfer: (transferId: string) => Promise<void>;
  cancelTransfer: (transferId: string) => Promise<void>;
  selectFile: () => Promise<string[] | null>;
  openTransferFolder: (filePath: string) => Promise<void>;

  // Shared Folders (Phase 5)
  getSharedFolders: () => Promise<SharedFolderItem[]>;
  createSharedFolder: (input: CreateSharedFolderInput) => Promise<SharedFolderItem>;
  updateSharedFolder: (input: UpdateSharedFolderInput) => Promise<SharedFolderItem>;
  deleteSharedFolder: (folderId: string) => Promise<void>;
  selectDirectory: () => Promise<string | null>;
  browseRemoteFolder: (input: BrowseRemoteFolderInput) => Promise<FolderListResponsePayload>;
  executeRemoteFolderOp: (input: RemoteFolderOperationInput) => Promise<FolderOperationResponsePayload>;

  // Calling & WebRTC (Phase 6)
  initiateCall: (input: InitiateCallInput) => Promise<CallItem>;
  acceptCall: (callId: string) => Promise<void>;
  rejectCall: (callId: string) => Promise<void>;
  endCall: (callId: string) => Promise<void>;
  sendCallSignal: (input: CallSignalInput) => Promise<void>;
  getCalls: (conversationId?: string) => Promise<CallItem[]>;
  getDesktopSources: () => Promise<DesktopSourceItem[]>;
  startScreenShare: (callId: string, sourceName?: string) => Promise<void>;
  stopScreenShare: (callId: string) => Promise<void>;

  // Event Listeners
  onNetworkStatusChange: (callback: (status: { online: boolean; ip?: string }) => void) => () => void;
  onDeviceDiscovered: (callback: (device: DeviceInfo) => void) => () => void;
  onDeviceUpdated: (callback: (device: DeviceInfo) => void) => () => void;
  onMessageReceived: (callback: (message: MessageItem) => void) => () => void;
  onMessageReceipt: (callback: (receipt: ReceiptEventData) => void) => () => void;
  onTypingIndicator: (callback: (typing: TypingEventData) => void) => () => void;
  onConversationUpdated: (callback: (conversation: ConversationItem) => void) => () => void;
  onPrivateLockStateChange: (callback: (state: { isUnlocked: boolean; lockedUntil?: number | null }) => void) => () => void;
  onTransferOffer: (callback: (transfer: TransferItem) => void) => () => void;
  onTransferProgress: (callback: (progress: TransferProgressEventData) => void) => () => void;
  onTransferCompleted: (callback: (transfer: TransferItem) => void) => () => void;
  onTransferFailed: (callback: (data: { transferId: string; error: string }) => void) => () => void;
  onCallIncoming: (callback: (call: CallItem) => void) => () => void;
  onCallAccepted: (callback: (data: { callId: string }) => void) => () => void;
  onCallRejected: (callback: (data: { callId: string }) => void) => () => void;
  onCallEnded: (callback: (data: { callId: string }) => void) => () => void;
  onCallSignal: (callback: (signal: CallSignalInput) => void) => () => void;
  onScreenShareStarted: (callback: (data: { callId: string; sourceName?: string }) => void) => () => void;
  onScreenShareStopped: (callback: (data: { callId: string }) => void) => () => void;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
