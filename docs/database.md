# IP Messenger - Database Schema & Storage Architecture

## 1. Database Engine & ORM

- **Storage Engine:** SQLite 3 (via `better-sqlite3` native Node.js driver)
- **Configuration:** Write-Ahead Logging (`PRAGMA journal_mode = WAL;`), Synchronous Normal (`PRAGMA synchronous = NORMAL;`), Foreign Keys enabled (`PRAGMA foreign_keys = ON;`), Busy timeout 5000ms.
- **ORM:** Drizzle ORM (`drizzle-orm/better-sqlite3`) with schema migrations managed via `drizzle-kit`.
- **Database Location:** `%APPDATA%/IPMessenger/data/ipm.db`.

---

## 2. Table Specifications & Schema Definitions

### 2.1 Identity & Device Tables

#### `profiles`
Stores the local user's customizable identity profiles.
- `id` (TEXT, PRIMARY KEY, e.g. `prof_local`)
- `deviceId` (TEXT, UNIQUE, NOT NULL) - Permanent device identifier derived from public key.
- `displayName` (TEXT, NOT NULL) - Display name shown in chats.
- `username` (TEXT, NOT NULL) - Handle/username.
- `avatarUrl` (TEXT) - Relative path or null.
- `status` (TEXT, DEFAULT 'online') - 'online' | 'busy' | 'away' | 'offline'.
- `customStatus` (TEXT) - Optional status message.
- `osUsername` (TEXT, NOT NULL) - Windows login name (informative only).
- `computerName` (TEXT, NOT NULL) - Windows NetBIOS/hostname.
- `createdAt` (INTEGER, NOT NULL) - UTC millisecond timestamp.
- `updatedAt` (INTEGER, NOT NULL) - UTC millisecond timestamp.

#### `devices`
Known remote LAN devices discovered via UDP broadcast, mDNS, or manual connection.
- `id` (TEXT, PRIMARY KEY) - Device ID.
- `publicKey` (TEXT, NOT NULL) - Base64 encoded Ed25519 public key.
- `displayName` (TEXT, NOT NULL)
- `hostname` (TEXT, NOT NULL)
- `lastSeen` (INTEGER, NOT NULL)
- `status` (TEXT, NOT NULL DEFAULT 'offline') - 'online' | 'offline'.
- `isBlocked` (INTEGER, NOT NULL DEFAULT 0) - 1 if blocked.
- `createdAt` (INTEGER, NOT NULL)
- `updatedAt` (INTEGER, NOT NULL)

#### `device_addresses`
Historical and active IP addresses and port bindings for discovered devices.
- `id` (TEXT, PRIMARY KEY)
- `deviceId` (TEXT, NOT NULL, REFERENCES devices(id) ON DELETE CASCADE)
- `ipAddress` (TEXT, NOT NULL)
- `tcpPort` (INTEGER, NOT NULL DEFAULT 45821)
- `signalingPort` (INTEGER, NOT NULL DEFAULT 45822)
- `interfaceName` (TEXT) - e.g. "Ethernet", "Wi-Fi"
- `isReachable` (INTEGER, NOT NULL DEFAULT 1)
- `lastConnectedAt` (INTEGER)
- Indexes: `idx_device_addresses_device (deviceId)`

#### `trusted_devices`
Cryptographically verified devices with verified identity keys.
- `id` (TEXT, PRIMARY KEY)
- `deviceId` (TEXT, UNIQUE, NOT NULL, REFERENCES devices(id) ON DELETE CASCADE)
- `fingerprint` (TEXT, NOT NULL) - SHA-256 fingerprint of public key.
- `verificationState` (TEXT, NOT NULL DEFAULT 'unverified') - 'verified' | 'unverified' | 'rejected'
- `verifiedAt` (INTEGER)

---

### 2.2 Conversations & Messaging Tables

#### `conversations`
Metadata for 1-to-1 and group chats.
- `id` (TEXT, PRIMARY KEY)
- `type` (TEXT, NOT NULL) - 'direct' | 'group' | 'private'
- `title` (TEXT) - For groups or private chats.
- `lastMessageId` (TEXT)
- `lastActivityAt` (INTEGER, NOT NULL)
- `isArchived` (INTEGER, NOT NULL DEFAULT 0)
- `createdAt` (INTEGER, NOT NULL)
- `updatedAt` (INTEGER, NOT NULL)
- Indexes: `idx_conversations_activity (lastActivityAt)`

#### `conversation_members`
Association between conversation instances and participating devices.
- `id` (TEXT, PRIMARY KEY)
- `conversationId` (TEXT, NOT NULL, REFERENCES conversations(id) ON DELETE CASCADE)
- `deviceId` (TEXT, NOT NULL, REFERENCES devices(id) ON DELETE CASCADE)
- `role` (TEXT, NOT NULL DEFAULT 'member') - 'owner' | 'admin' | 'member'
- `joinedAt` (INTEGER, NOT NULL)
- UNIQUE constraint: `(conversationId, deviceId)`

#### `messages`
Individual message records.
- `id` (TEXT, PRIMARY KEY) - RFC4122 UUID.
- `conversationId` (TEXT, NOT NULL, REFERENCES conversations(id) ON DELETE CASCADE)
- `senderId` (TEXT, NOT NULL)
- `sequence` (INTEGER, NOT NULL)
- `content` (TEXT, NOT NULL)
- `contentType` (TEXT, NOT NULL DEFAULT 'text') - 'text' | 'file' | 'system'
- `deliveryStatus` (TEXT, NOT NULL DEFAULT 'pending') - 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
- `sentAt` (INTEGER, NOT NULL)
- `deliveredAt` (INTEGER)
- `readAt` (INTEGER)
- `isEncrypted` (INTEGER, NOT NULL DEFAULT 0)
- Indexes: `idx_messages_conversation (conversationId, sequence)`, `idx_messages_status (deliveryStatus)`

#### `message_receipts`
Detailed receipts per participant.
- `id` (TEXT, PRIMARY KEY)
- `messageId` (TEXT, NOT NULL, REFERENCES messages(id) ON DELETE CASCADE)
- `deviceId` (TEXT, NOT NULL, REFERENCES devices(id) ON DELETE CASCADE)
- `receiptType` (TEXT, NOT NULL) - 'ack' | 'delivered' | 'read'
- `receivedAt` (INTEGER, NOT NULL)
- UNIQUE constraint: `(messageId, deviceId, receiptType)`

---

### 2.3 Group Conversations Tables

#### `groups`
Group session coordination metadata.
- `id` (TEXT, PRIMARY KEY, REFERENCES conversations(id) ON DELETE CASCADE)
- `name` (TEXT, NOT NULL)
- `description` (TEXT)
- `hostDeviceId` (TEXT, NOT NULL, REFERENCES devices(id))
- `isHost` (INTEGER, NOT NULL DEFAULT 0)
- `avatarUrl` (TEXT)
- `createdAt` (INTEGER, NOT NULL)

#### `group_members`
- `id` (TEXT, PRIMARY KEY)
- `groupId` (TEXT, NOT NULL, REFERENCES groups(id) ON DELETE CASCADE)
- `deviceId` (TEXT, NOT NULL, REFERENCES devices(id))
- `role` (TEXT, NOT NULL DEFAULT 'member')
- `joinedAt` (INTEGER, NOT NULL)

---

### 2.4 Private Conversations & Access Control

#### `private_conversations`
Dedicated private chats isolated from standard views.
- `id` (TEXT, PRIMARY KEY, REFERENCES conversations(id) ON DELETE CASCADE)
- `title` (TEXT, NOT NULL)
- `creatorDeviceId` (TEXT, NOT NULL)
- `sessionKeyHash` (TEXT, NOT NULL) - SHA-256 verification hash of conversation ratchet/session key.
- `isLocked` (INTEGER, NOT NULL DEFAULT 1)
- `createdAt` (INTEGER, NOT NULL)

#### `private_members`
- `id` (TEXT, PRIMARY KEY)
- `privateConversationId` (TEXT, NOT NULL, REFERENCES private_conversations(id) ON DELETE CASCADE)
- `deviceId` (TEXT, NOT NULL, REFERENCES devices(id))
- `approvedAt` (INTEGER, NOT NULL)
- `status` (TEXT, NOT NULL DEFAULT 'active') - 'active' | 'revoked'

#### `private_credentials`
Master Argon2id unlock credentials for private workspace.
- `id` (TEXT, PRIMARY KEY)
- `passwordHash` (TEXT, NOT NULL) - Argon2id serialized hash string.
- `salt` (TEXT, NOT NULL)
- `failedAttempts` (INTEGER, NOT NULL DEFAULT 0)
- `lockedUntil` (INTEGER)
- `recoveryHint` (TEXT)
- `createdAt` (INTEGER, NOT NULL)
- `updatedAt` (INTEGER, NOT NULL)

#### `invitations`
One-time invitation tokens for joining private chats.
- `id` (TEXT, PRIMARY KEY)
- `codeHash` (TEXT, UNIQUE, NOT NULL) - SHA-256 hash of plaintext invitation code (e.g. PRV-82K9-X7QM).
- `privateConversationId` (TEXT, NOT NULL, REFERENCES private_conversations(id) ON DELETE CASCADE)
- `creatorDeviceId` (TEXT, NOT NULL)
- `maxUses` (INTEGER, NOT NULL DEFAULT 1)
- `usedCount` (INTEGER, NOT NULL DEFAULT 0)
- `expiresAt` (INTEGER, NOT NULL)
- `isRevoked` (INTEGER, NOT NULL DEFAULT 0)
- `createdAt` (INTEGER, NOT NULL)

---

### 2.5 File Transfers & Shared Folders

#### `attachments`
- `id` (TEXT, PRIMARY KEY)
- `messageId` (TEXT, REFERENCES messages(id) ON DELETE CASCADE)
- `fileName` (TEXT, NOT NULL)
- `fileSize` (INTEGER, NOT NULL)
- `mimeType` (TEXT, NOT NULL)
- `localPath` (TEXT, NOT NULL)
- `fileHash` (TEXT, NOT NULL) - Full SHA-256 hash.
- `createdAt` (INTEGER, NOT NULL)

#### `transfers`
State of streaming file downloads/uploads.
- `id` (TEXT, PRIMARY KEY)
- `conversationId` (TEXT, NOT NULL)
- `direction` (TEXT, NOT NULL) - 'incoming' | 'outgoing'
- `remoteDeviceId` (TEXT, NOT NULL)
- `fileName` (TEXT, NOT NULL)
- `fileSize` (INTEGER, NOT NULL)
- `fileHash` (TEXT, NOT NULL)
- `tempPath` (TEXT, NOT NULL)
- `finalPath` (TEXT)
- `bytesTransferred` (INTEGER, NOT NULL DEFAULT 0)
- `status` (TEXT, NOT NULL DEFAULT 'offered') - 'offered' | 'transferring' | 'paused' | 'completed' | 'cancelled' | 'failed'
- `errorMessage` (TEXT)
- `createdAt` (INTEGER, NOT NULL)
- `updatedAt` (INTEGER, NOT NULL)

#### `shared_folders`
Local directories shared to the LAN.
- `id` (TEXT, PRIMARY KEY)
- `name` (TEXT, NOT NULL)
- `localPath` (TEXT, NOT NULL)
- `defaultPermission` (TEXT, NOT NULL DEFAULT 'read_only') - 'read_only' | 'upload' | 'modify' | 'full_control'
- `isEnabled` (INTEGER, NOT NULL DEFAULT 1)
- `createdAt` (INTEGER, NOT NULL)

#### `folder_permissions`
Granular device-level permissions for shared folders.
- `id` (TEXT, PRIMARY KEY)
- `folderId` (TEXT, NOT NULL, REFERENCES shared_folders(id) ON DELETE CASCADE)
- `deviceId` (TEXT, NOT NULL, REFERENCES devices(id) ON DELETE CASCADE)
- `permissionLevel` (TEXT, NOT NULL) - 'read_only' | 'upload' | 'modify' | 'full_control'
- `grantedAt` (INTEGER, NOT NULL)
- UNIQUE constraint: `(folderId, deviceId)`

---

### 2.6 Calls & System Settings

#### `calls`
Call history log.
- `id` (TEXT, PRIMARY KEY)
- `conversationId` (TEXT, NOT NULL)
- `callerDeviceId` (TEXT, NOT NULL)
- `receiverDeviceId` (TEXT, NOT NULL)
- `callType` (TEXT, NOT NULL) - 'voice' | 'video' | 'screen'
- `status` (TEXT, NOT NULL) - 'missed' | 'rejected' | 'completed' | 'failed'
- `startedAt` (INTEGER, NOT NULL)
- `endedAt` (INTEGER)
- `durationSeconds` (INTEGER, DEFAULT 0)

#### `settings`
Key-value configuration store.
- `key` (TEXT, PRIMARY KEY)
- `value` (TEXT, NOT NULL) - JSON string.
- `updatedAt` (INTEGER, NOT NULL)
