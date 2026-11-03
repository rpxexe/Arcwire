import {
  Profile,
  ProfileCreateInput,
  ProfileUpdateInput,
  AppSettings,
  SystemInfo,
  NetworkEnvelope,
  UserStatus,
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

  // Listeners
  onNetworkStatusChange: (callback: (status: { online: boolean; ip?: string }) => void) => () => void;
  onDeviceDiscovered: (callback: (device: DeviceInfo) => void) => () => void;
  onMessageReceived: (callback: (message: MessageItem) => void) => () => void;
}

declare global {
  interface Window {
    api: IpcApi;
  }
}
