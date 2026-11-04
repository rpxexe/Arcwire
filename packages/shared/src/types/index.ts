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

  // Listeners
  onNetworkStatusChange: (callback: (status: { online: boolean; ip?: string }) => void) => () => void;
  onDeviceDiscovered: (callback: (device: DeviceInfo) => void) => () => void;
  onDeviceUpdated: (callback: (device: DeviceInfo) => void) => () => void;
  onMessageReceived: (callback: (message: MessageItem) => void) => () => void;
  onMessageReceipt: (callback: (receipt: ReceiptEventData) => void) => () => void;
  onTypingIndicator: (callback: (typing: TypingEventData) => void) => () => void;
  onConversationUpdated: (callback: (conversation: ConversationItem) => void) => () => void;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
