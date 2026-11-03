import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// 1. Profiles Table (Local user identity)
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  status: text('status').notNull().default('online'),
  customStatus: text('custom_status'),
  osUsername: text('os_username').notNull(),
  computerName: text('computer_name').notNull(),
  publicKey: text('public_key').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 2. Devices Table (Remote peers discovered on LAN)
export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  displayName: text('display_name').notNull(),
  hostname: text('hostname').notNull(),
  lastSeen: integer('last_seen').notNull(),
  status: text('status').notNull().default('offline'),
  isBlocked: integer('is_blocked').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 3. Device Addresses Table
export const deviceAddresses = sqliteTable('device_addresses', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  ipAddress: text('ip_address').notNull(),
  tcpPort: integer('tcp_port').notNull().default(45821),
  signalingPort: integer('signaling_port').notNull().default(45822),
  interfaceName: text('interface_name'),
  isReachable: integer('is_reachable').notNull().default(1),
  lastConnectedAt: integer('last_connected_at'),
}, (t) => [
  index('idx_device_addresses_dev').on(t.deviceId),
]);

// 4. Trusted Devices Table
export const trustedDevices = sqliteTable('trusted_devices', {
  id: text('id').primaryKey(),
  deviceId: text('device_id').notNull().unique().references(() => devices.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint').notNull(),
  verificationState: text('verification_state').notNull().default('unverified'),
  verifiedAt: integer('verified_at'),
});

// 5. Conversations Table
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'direct' | 'group' | 'private'
  title: text('title'),
  lastMessageId: text('last_message_id'),
  lastActivityAt: integer('last_activity_at').notNull(),
  isArchived: integer('is_archived').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [
  index('idx_conversations_activity').on(t.lastActivityAt),
]);

// 6. Conversation Members Table
export const conversationMembers = sqliteTable('conversation_members', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  joinedAt: integer('joined_at').notNull(),
}, (t) => [
  uniqueIndex('idx_conv_member_unique').on(t.conversationId, t.deviceId),
]);

// 7. Messages Table
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull(),
  sequence: integer('sequence').notNull(),
  content: text('content').notNull(),
  contentType: text('content_type').notNull().default('text'), // 'text' | 'file' | 'system'
  deliveryStatus: text('delivery_status').notNull().default('pending'), // 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  sentAt: integer('sent_at').notNull(),
  deliveredAt: integer('delivered_at'),
  readAt: integer('read_at'),
  isEncrypted: integer('is_encrypted').notNull().default(0),
}, (t) => [
  index('idx_messages_conversation').on(t.conversationId, t.sequence),
  index('idx_messages_status').on(t.deliveryStatus),
]);

// 8. Message Receipts Table
export const messageReceipts = sqliteTable('message_receipts', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  receiptType: text('receipt_type').notNull(), // 'ack' | 'delivered' | 'read'
  receivedAt: integer('received_at').notNull(),
}, (t) => [
  uniqueIndex('idx_receipts_unique').on(t.messageId, t.deviceId, t.receiptType),
]);

// 9. Groups Table
export const groups = sqliteTable('groups', {
  id: text('id').primaryKey().references(() => conversations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  hostDeviceId: text('host_device_id').notNull().references(() => devices.id),
  isHost: integer('is_host').notNull().default(0),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull(),
});

// 10. Group Members Table
export const groupMembers = sqliteTable('group_members', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => devices.id),
  role: text('role').notNull().default('member'),
  joinedAt: integer('joined_at').notNull(),
});

// 11. Private Conversations Table
export const privateConversations = sqliteTable('private_conversations', {
  id: text('id').primaryKey().references(() => conversations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  creatorDeviceId: text('creator_device_id').notNull(),
  sessionKeyHash: text('session_key_hash').notNull(),
  isLocked: integer('is_locked').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

// 12. Private Members Table
export const privateMembers = sqliteTable('private_members', {
  id: text('id').primaryKey(),
  privateConversationId: text('private_conversation_id').notNull().references(() => privateConversations.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => devices.id),
  approvedAt: integer('approved_at').notNull(),
  status: text('status').notNull().default('active'),
});

// 13. Private Credentials Table
export const privateCredentials = sqliteTable('private_credentials', {
  id: text('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until'),
  recoveryHint: text('recovery_hint'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 14. Invitations Table
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  privateConversationId: text('private_conversation_id').notNull().references(() => privateConversations.id, { onDelete: 'cascade' }),
  creatorDeviceId: text('creator_device_id').notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: integer('expires_at').notNull(),
  isRevoked: integer('is_revoked').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// 15. Attachments Table
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  mimeType: text('mime_type').notNull(),
  localPath: text('local_path').notNull(),
  fileHash: text('file_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

// 16. Transfers Table
export const transfers = sqliteTable('transfers', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  direction: text('direction').notNull(), // 'incoming' | 'outgoing'
  remoteDeviceId: text('remote_device_id').notNull(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  fileHash: text('file_hash').notNull(),
  tempPath: text('temp_path').notNull(),
  finalPath: text('final_path'),
  bytesTransferred: integer('bytes_transferred').notNull().default(0),
  status: text('status').notNull().default('offered'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// 17. Shared Folders Table
export const sharedFolders = sqliteTable('shared_folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  localPath: text('local_path').notNull(),
  defaultPermission: text('default_permission').notNull().default('read_only'),
  isEnabled: integer('is_enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

// 18. Folder Permissions Table
export const folderPermissions = sqliteTable('folder_permissions', {
  id: text('id').primaryKey(),
  folderId: text('folder_id').notNull().references(() => sharedFolders.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  permissionLevel: text('permission_level').notNull(),
  grantedAt: integer('granted_at').notNull(),
}, (t) => [
  uniqueIndex('idx_folder_perm_unique').on(t.folderId, t.deviceId),
]);

// 19. Calls Table
export const calls = sqliteTable('calls', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  callerDeviceId: text('caller_device_id').notNull(),
  receiverDeviceId: text('receiver_device_id').notNull(),
  callType: text('call_type').notNull(), // 'voice' | 'video' | 'screen'
  status: text('status').notNull(), // 'missed' | 'rejected' | 'completed' | 'failed'
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  durationSeconds: integer('duration_seconds').default(0),
});

// 20. Settings Table
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

