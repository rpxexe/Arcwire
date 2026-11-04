import { z } from 'zod';
import { IPM_PROTOCOL } from '../constants/index';
import { IpmEventType } from '../events/index';

export const UserStatusEnum = z.enum(['online', 'busy', 'away', 'offline']);
export type UserStatus = z.infer<typeof UserStatusEnum>;

export const NetworkEnvelopeSchema = z.object({
  protocol: z.literal(IPM_PROTOCOL),
  id: z.string().uuid(),
  type: z.nativeEnum(IpmEventType),
  senderId: z.string().min(1),
  receiverId: z.string().min(1),
  conversationId: z.string().min(1),
  timestamp: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
  payload: z.record(z.any()),
});
export type NetworkEnvelope = z.infer<typeof NetworkEnvelopeSchema>;

// Profile & Identity Schemas
export const ProfileSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  displayName: z.string().min(1, 'Display name cannot be empty').max(50),
  username: z.string().min(2, 'Username must be at least 2 characters').max(30),
  avatarUrl: z.string().nullable().optional(),
  status: UserStatusEnum.default('online'),
  customStatus: z.string().max(100).nullable().optional(),
  osUsername: z.string(),
  computerName: z.string(),
  publicKey: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileCreateSchema = z.object({
  displayName: z.string().min(1).max(50),
  username: z.string().min(2).max(30),
  avatarUrl: z.string().nullable().optional(),
  status: UserStatusEnum.default('online'),
  customStatus: z.string().max(100).nullable().optional(),
});
export type ProfileCreateInput = z.infer<typeof ProfileCreateSchema>;

export const ProfileUpdateSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  username: z.string().min(2).max(30).optional(),
  avatarUrl: z.string().nullable().optional(),
  status: UserStatusEnum.optional(),
  customStatus: z.string().max(100).nullable().optional(),
});
export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

// Settings Schema
export const AppSettingsSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).default('system'),
  udpPort: z.number().int().min(1024).max(65535),
  tcpPort: z.number().int().min(1024).max(65535),
  signalingPort: z.number().int().min(1024).max(65535),
  minimizeToTray: z.boolean().default(true),
  startWithWindows: z.boolean().default(false),
  notificationsEnabled: z.boolean().default(true),
  autoDownloadFiles: z.boolean().default(false),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// Discovery Schemas
export const DeviceAnnouncePayloadSchema = z.object({
  deviceId: z.string(),
  displayName: z.string(),
  hostname: z.string(),
  osUser: z.string(),
  tcpPort: z.number().int().positive(),
  signalingPort: z.number().int().positive(),
  publicKey: z.string(),
  avatarHash: z.string().nullable().optional(),
  status: UserStatusEnum,
});
export type DeviceAnnouncePayload = z.infer<typeof DeviceAnnouncePayloadSchema>;

export const DeviceQueryPayloadSchema = z.object({
  timestamp: z.number(),
  requestedDeviceId: z.string().optional(),
});
export type DeviceQueryPayload = z.infer<typeof DeviceQueryPayloadSchema>;

// Authentication Schemas
export const AuthRequestPayloadSchema = z.object({
  deviceId: z.string(),
  publicKey: z.string(),
  timestamp: z.number(),
});
export type AuthRequestPayload = z.infer<typeof AuthRequestPayloadSchema>;

export const AuthChallengePayloadSchema = z.object({
  nonce: z.string(),
  timestamp: z.number(),
});
export type AuthChallengePayload = z.infer<typeof AuthChallengePayloadSchema>;

export const AuthResponsePayloadSchema = z.object({
  signature: z.string(),
  publicKey: z.string(),
  timestamp: z.number(),
});
export type AuthResponsePayload = z.infer<typeof AuthResponsePayloadSchema>;

export const AuthAcceptedPayloadSchema = z.object({
  deviceId: z.string(),
  publicKey: z.string(),
  timestamp: z.number(),
  signature: z.string().optional(),
});
export type AuthAcceptedPayload = z.infer<typeof AuthAcceptedPayloadSchema>;

// Direct Device Connection & Trust
export const DirectConnectInputSchema = z.object({
  ipAddress: z.string().min(1, 'IP address is required'),
  port: z.number().int().min(1024).max(65535).default(45821),
});
export type DirectConnectInput = z.infer<typeof DirectConnectInputSchema>;

export const TrustDeviceInputSchema = z.object({
  deviceId: z.string(),
  isTrusted: z.boolean(),
});
export type TrustDeviceInput = z.infer<typeof TrustDeviceInputSchema>;

// Messaging Schemas (Phase 3)
export const ChatMessagePayloadSchema = z.object({
  messageId: z.string().uuid(),
  content: z.string(),
  contentType: z.enum(['text', 'file', 'system']).default('text'),
  isEncrypted: z.boolean().default(false),
  sentAt: z.number(),
  replyToId: z.string().uuid().nullable().optional(),
});
export type ChatMessagePayload = z.infer<typeof ChatMessagePayloadSchema>;

export const MessageReceiptPayloadSchema = z.object({
  messageId: z.string().uuid(),
  conversationId: z.string().optional(),
  receiptType: z.enum(['ack', 'delivered', 'read']),
  timestamp: z.number(),
});
export type MessageReceiptPayload = z.infer<typeof MessageReceiptPayloadSchema>;

export const TypingIndicatorPayloadSchema = z.object({
  conversationId: z.string(),
  deviceId: z.string(),
  isTyping: z.boolean(),
});
export type TypingIndicatorPayload = z.infer<typeof TypingIndicatorPayloadSchema>;

// Group Messaging Schemas
export const GroupCreatePayloadSchema = z.object({
  groupId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(255).optional(),
  memberDeviceIds: z.array(z.string()),
  hostDeviceId: z.string(),
});
export type GroupCreatePayload = z.infer<typeof GroupCreatePayloadSchema>;

export const GroupJoinPayloadSchema = z.object({
  groupId: z.string(),
  deviceId: z.string(),
  joinedAt: z.number(),
});
export type GroupJoinPayload = z.infer<typeof GroupJoinPayloadSchema>;

export const GroupLeavePayloadSchema = z.object({
  groupId: z.string(),
  deviceId: z.string(),
});
export type GroupLeavePayload = z.infer<typeof GroupLeavePayloadSchema>;

export const GroupMessagePayloadSchema = z.object({
  groupId: z.string(),
  messageId: z.string().uuid(),
  senderId: z.string(),
  sequence: z.number().int().nonnegative(),
  content: z.string(),
  contentType: z.enum(['text', 'file', 'system']).default('text'),
  sentAt: z.number(),
});
export type GroupMessagePayload = z.infer<typeof GroupMessagePayloadSchema>;

export const GroupHostMigratedPayloadSchema = z.object({
  groupId: z.string(),
  previousHostDeviceId: z.string(),
  newHostDeviceId: z.string(),
  highestSequence: z.number().int().nonnegative(),
  timestamp: z.number(),
});
export type GroupHostMigratedPayload = z.infer<typeof GroupHostMigratedPayloadSchema>;

// Renderer IPC Input Schemas
export const SendMessageInputSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1, 'Message content cannot be empty'),
  contentType: z.enum(['text', 'file', 'system']).optional().default('text'),
  isEncrypted: z.boolean().optional().default(false),
  replyToId: z.string().nullable().optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export const CreateConversationInputSchema = z.object({
  type: z.enum(['direct', 'group', 'private']),
  peerDeviceId: z.string().optional(),
  title: z.string().optional(),
  memberDeviceIds: z.array(z.string()).optional(),
  description: z.string().optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationInputSchema>;

export const CreateGroupInputSchema = z.object({
  name: z.string().min(1, 'Group name required').max(100),
  description: z.string().max(255).optional(),
  memberDeviceIds: z.array(z.string()).default([]),
});
export type CreateGroupInput = z.infer<typeof CreateGroupInputSchema>;

export const SearchMessagesInputSchema = z.object({
  query: z.string().min(1),
  conversationId: z.string().optional(),
});
export type SearchMessagesInput = z.infer<typeof SearchMessagesInputSchema>;

// File Streaming Schemas
export const FileOfferPayloadSchema = z.object({
  transferId: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number().int().positive(),
  fileHash: z.string(),
  mimeType: z.string(),
  totalChunks: z.number().int().positive(),
  chunkSize: z.number().int().positive(),
});
export type FileOfferPayload = z.infer<typeof FileOfferPayloadSchema>;

export const FileChunkPayloadSchema = z.object({
  transferId: z.string().uuid(),
  chunkIndex: z.number().int().nonnegative(),
  chunkHash: z.string(),
  data: z.string(), // base64
});
export type FileChunkPayload = z.infer<typeof FileChunkPayloadSchema>;

// System Info
export const SystemInfoSchema = z.object({
  osUsername: z.string(),
  computerName: z.string(),
  platform: z.string(),
  arch: z.string(),
  networkInterfaces: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
      netmask: z.string(),
      family: z.string(),
      mac: z.string(),
      internal: z.boolean(),
    })
  ),
  paths: z.object({
    appData: z.string(),
    data: z.string(),
    attachments: z.string(),
    transfers: z.string(),
    avatars: z.string(),
    logs: z.string(),
    security: z.string(),
  }),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;

// Private Chat Schemas (Phase 4)
export const SetupUnlockCredentialInputSchema = z.object({
  password: z.string().min(4, 'PIN or passphrase must be at least 4 characters').max(64),
  recoveryHint: z.string().max(100).optional(),
});
export type SetupUnlockCredentialInput = z.infer<typeof SetupUnlockCredentialInputSchema>;

export const UnlockPrivateInputSchema = z.object({
  password: z.string().min(1, 'Password required'),
});
export type UnlockPrivateInput = z.infer<typeof UnlockPrivateInputSchema>;

export const CreatePrivateConversationInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
});
export type CreatePrivateConversationInput = z.infer<typeof CreatePrivateConversationInputSchema>;

export const CreateInvitationInputSchema = z.object({
  conversationId: z.string(),
  maxUses: z.number().int().positive().default(1),
  expiresInHours: z.number().int().positive().default(24),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInputSchema>;

export const RedeemInvitationInputSchema = z.object({
  code: z.string().min(1, 'Invitation code required'),
  peerDeviceId: z.string().optional(),
});
export type RedeemInvitationInput = z.infer<typeof RedeemInvitationInputSchema>;

export const PrivateStatusSchema = z.object({
  hasCredential: z.boolean(),
  isUnlocked: z.boolean(),
  lockedUntil: z.number().nullable().optional(),
  failedAttempts: z.number(),
  recoveryHint: z.string().nullable().optional(),
});
export type PrivateStatus = z.infer<typeof PrivateStatusSchema>;

export const PrivateJoinRequestPayloadSchema = z.object({
  codeHash: z.string(),
  requestingDeviceId: z.string(),
  publicKey: z.string(),
  timestamp: z.number(),
});
export type PrivateJoinRequestPayload = z.infer<typeof PrivateJoinRequestPayloadSchema>;

export const PrivateJoinAcceptedPayloadSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  creatorDeviceId: z.string(),
  sessionKeyCipher: z.string(),
  timestamp: z.number(),
});
export type PrivateJoinAcceptedPayload = z.infer<typeof PrivateJoinAcceptedPayloadSchema>;

// Phase 5: File Transfer & Folder Sharing Schemas
export const TransferStatusEnum = z.enum([
  'offered',
  'accepted',
  'transferring',
  'paused',
  'queued',
  'completed',
  'cancelled',
  'rejected',
  'failed',
]);
export type TransferStatus = z.infer<typeof TransferStatusEnum>;

export const TransferItemSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  direction: z.enum(['incoming', 'outgoing']),
  remoteDeviceId: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  fileHash: z.string(),
  tempPath: z.string(),
  finalPath: z.string().nullable().optional(),
  bytesTransferred: z.number().int().nonnegative(),
  status: TransferStatusEnum,
  speed: z.number().nonnegative().default(0), // bytes per second
  remainingTime: z.number().nonnegative().default(0), // seconds
  errorMessage: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TransferItem = z.infer<typeof TransferItemSchema>;

export const SendFileInputSchema = z.object({
  conversationId: z.string(),
  filePath: z.string(),
  peerDeviceId: z.string(),
});
export type SendFileInput = z.infer<typeof SendFileInputSchema>;

export const AcceptTransferInputSchema = z.object({
  transferId: z.string(),
  savePath: z.string().optional(),
});
export type AcceptTransferInput = z.infer<typeof AcceptTransferInputSchema>;

export const FolderPermissionEnum = z.enum(['read_only', 'upload', 'modify', 'full_control']);
export type FolderPermission = z.infer<typeof FolderPermissionEnum>;

export const SharedFolderItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  localPath: z.string(),
  defaultPermission: FolderPermissionEnum.default('read_only'),
  isEnabled: z.boolean().default(true),
  createdAt: z.number(),
});
export type SharedFolderItem = z.infer<typeof SharedFolderItemSchema>;

export const CreateSharedFolderInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  localPath: z.string().min(1, 'Path is required'),
  defaultPermission: FolderPermissionEnum.default('read_only'),
});
export type CreateSharedFolderInput = z.infer<typeof CreateSharedFolderInputSchema>;

export const UpdateSharedFolderInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100).optional(),
  defaultPermission: FolderPermissionEnum.optional(),
  isEnabled: z.boolean().optional(),
});
export type UpdateSharedFolderInput = z.infer<typeof UpdateSharedFolderInputSchema>;

export const RemoteFolderItemSchema = z.object({
  name: z.string(),
  relativePath: z.string(),
  isDirectory: z.boolean(),
  size: z.number().int().nonnegative(),
  modifiedAt: z.number(),
});
export type RemoteFolderItem = z.infer<typeof RemoteFolderItemSchema>;

export const BrowseRemoteFolderInputSchema = z.object({
  peerDeviceId: z.string(),
  folderId: z.string(),
  subPath: z.string().default(''),
});
export type BrowseRemoteFolderInput = z.infer<typeof BrowseRemoteFolderInputSchema>;

export const RemoteFolderOperationInputSchema = z.object({
  peerDeviceId: z.string(),
  folderId: z.string(),
  action: z.enum(['create_dir', 'rename', 'delete', 'download', 'upload']),
  targetPath: z.string(),
  newPath: z.string().optional(),
});
export type RemoteFolderOperationInput = z.infer<typeof RemoteFolderOperationInputSchema>;

export const FolderListPayloadSchema = z.object({
  folderId: z.string(),
  subPath: z.string().default(''),
});
export type FolderListPayload = z.infer<typeof FolderListPayloadSchema>;

export const FolderListResponsePayloadSchema = z.object({
  folderId: z.string(),
  subPath: z.string(),
  items: z.array(RemoteFolderItemSchema),
  permission: FolderPermissionEnum,
  error: z.string().optional(),
});
export type FolderListResponsePayload = z.infer<typeof FolderListResponsePayloadSchema>;

export const FolderModifyPayloadSchema = z.object({
  folderId: z.string(),
  action: z.enum(['create_dir', 'rename', 'delete']),
  targetPath: z.string(),
  newPath: z.string().optional(),
});
export type FolderModifyPayload = z.infer<typeof FolderModifyPayloadSchema>;

export const FolderOperationResponsePayloadSchema = z.object({
  folderId: z.string(),
  action: z.string(),
  targetPath: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});
export type FolderOperationResponsePayload = z.infer<typeof FolderOperationResponsePayloadSchema>;

// Phase 6: WebRTC Voice Calls, Video Calls & Screen Sharing
export const CallTypeEnum = z.enum(['voice', 'video', 'screen']);
export type CallType = z.infer<typeof CallTypeEnum>;

export const CallStatusEnum = z.enum([
  'ringing',
  'ongoing',
  'completed',
  'missed',
  'rejected',
  'failed',
]);
export type CallStatus = z.infer<typeof CallStatusEnum>;

export const CallItemSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  callerDeviceId: z.string(),
  receiverDeviceId: z.string(),
  callType: CallTypeEnum,
  status: CallStatusEnum,
  startedAt: z.number(),
  endedAt: z.number().nullable().optional(),
  durationSeconds: z.number().int().nonnegative().default(0),
});
export type CallItem = z.infer<typeof CallItemSchema>;

export const InitiateCallInputSchema = z.object({
  conversationId: z.string(),
  receiverDeviceId: z.string(),
  callType: CallTypeEnum.default('voice'),
});
export type InitiateCallInput = z.infer<typeof InitiateCallInputSchema>;

export const RespondCallInputSchema = z.object({
  callId: z.string(),
  action: z.enum(['accept', 'reject']),
});
export type RespondCallInput = z.infer<typeof RespondCallInputSchema>;

export const EndCallInputSchema = z.object({
  callId: z.string(),
  reason: z.string().optional(),
});
export type EndCallInput = z.infer<typeof EndCallInputSchema>;

export const CallSignalInputSchema = z.object({
  callId: z.string(),
  targetDeviceId: z.string(),
  signalType: z.enum(['offer', 'answer', 'ice-candidate']),
  data: z.any(),
});
export type CallSignalInput = z.infer<typeof CallSignalInputSchema>;

export const DesktopSourceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  thumbnail: z.string(),
  display_id: z.string().optional(),
});
export type DesktopSourceItem = z.infer<typeof DesktopSourceItemSchema>;
