export enum IpmEventType {
  // Discovery
  DEVICE_ANNOUNCE = 'DEVICE_ANNOUNCE',
  DEVICE_QUERY = 'DEVICE_QUERY',

  // Authentication & Handshake
  AUTH_REQUEST = 'AUTH_REQUEST',
  AUTH_CHALLENGE = 'AUTH_CHALLENGE',
  AUTH_RESPONSE = 'AUTH_RESPONSE',
  AUTH_ACCEPTED = 'AUTH_ACCEPTED',

  // 1-to-1 Messaging
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  MESSAGE_ACK = 'MESSAGE_ACK',
  MESSAGE_DELIVERED = 'MESSAGE_DELIVERED',
  MESSAGE_READ = 'MESSAGE_READ',
  TYPING_INDICATOR = 'TYPING_INDICATOR',
  MESSAGE_DELETE = 'MESSAGE_DELETE',
  MESSAGE_EDIT = 'MESSAGE_EDIT',
  MESSAGE_REACTION = 'MESSAGE_REACTION',

  // Group Messaging
  GROUP_CREATE = 'GROUP_CREATE',
  GROUP_JOIN = 'GROUP_JOIN',
  GROUP_LEAVE = 'GROUP_LEAVE',
  GROUP_MESSAGE = 'GROUP_MESSAGE',
  GROUP_HOST_MIGRATED = 'GROUP_HOST_MIGRATED',

  // Private Conversations (Phase 4)
  PRIVATE_INVITE = 'PRIVATE_INVITE',
  PRIVATE_JOIN_REQUEST = 'PRIVATE_JOIN_REQUEST',
  PRIVATE_JOIN_ACCEPTED = 'PRIVATE_JOIN_ACCEPTED',
  PRIVATE_JOIN_REJECTED = 'PRIVATE_JOIN_REJECTED',
  PRIVATE_MEMBER_ADDED = 'PRIVATE_MEMBER_ADDED',
  PRIVATE_UNLOCK = 'PRIVATE_UNLOCK',
  PRIVATE_MESSAGE = 'PRIVATE_MESSAGE',

  // File Transfer (Phase 5)
  FILE_OFFER = 'FILE_OFFER',
  FILE_ACCEPT = 'FILE_ACCEPT',
  FILE_REJECT = 'FILE_REJECT',
  FILE_CHUNK = 'FILE_CHUNK',
  FILE_CHUNK_ACK = 'FILE_CHUNK_ACK',
  FILE_COMPLETE = 'FILE_COMPLETE',
  FILE_CANCEL = 'FILE_CANCEL',
  FILE_PAUSE = 'FILE_PAUSE',
  FILE_RESUME = 'FILE_RESUME',

  // Folder Sharing (Phase 5)
  FOLDER_LIST = 'FOLDER_LIST',
  FOLDER_LIST_RESPONSE = 'FOLDER_LIST_RESPONSE',
  FOLDER_DOWNLOAD = 'FOLDER_DOWNLOAD',
  FOLDER_UPLOAD = 'FOLDER_UPLOAD',
  FOLDER_MODIFY = 'FOLDER_MODIFY',
  FOLDER_OPERATION_RESPONSE = 'FOLDER_OPERATION_RESPONSE',

  // Calling & WebRTC Signaling (Phase 6)
  CALL_REQUEST = 'CALL_REQUEST',
  CALL_ACCEPT = 'CALL_ACCEPT',
  CALL_REJECT = 'CALL_REJECT',
  CALL_END = 'CALL_END',
  CALL_SIGNAL = 'CALL_SIGNAL',
  SCREEN_SHARE_START = 'SCREEN_SHARE_START',
  SCREEN_SHARE_STOP = 'SCREEN_SHARE_STOP',
}

export enum IpcChannels {
  // System & Window
  WINDOW_MINIMIZE = 'window:minimize',
  WINDOW_MAXIMIZE = 'window:maximize',
  WINDOW_CLOSE = 'window:close',
  WINDOW_MINIMIZE_TO_TRAY = 'window:minimize-to-tray',
  SYSTEM_GET_INFO = 'system:get-info',
  SYSTEM_GET_INTERFACES = 'system:get-interfaces',
  SYSTEM_GET_PATHS = 'system:get-paths',

  // Profile & Identity
  PROFILE_GET = 'profile:get',
  PROFILE_CREATE = 'profile:create',
  PROFILE_UPDATE = 'profile:update',

  // Settings
  SETTINGS_GET = 'settings:get',
  SETTINGS_UPDATE = 'settings:update',

  // Devices & Network (Phase 2)
  DEVICES_LIST = 'devices:list',
  DEVICES_REFRESH = 'devices:refresh',
  DEVICES_CONNECT_MANUAL = 'devices:connect-manual',
  DEVICES_TOGGLE_TRUST = 'devices:toggle-trust',

  // Conversations & Messaging (Phase 3)
  CONVERSATIONS_LIST = 'conversations:list',
  CONVERSATIONS_GET = 'conversations:get',
  CONVERSATIONS_CREATE_DIRECT = 'conversations:create-direct',
  CONVERSATIONS_CREATE_GROUP = 'conversations:create-group',
  MESSAGES_LIST = 'messages:list',
  MESSAGES_SEND = 'messages:send',
  MESSAGES_SEND_ACK = 'messages:send-ack',
  MESSAGES_SEND_DELIVERED = 'messages:send-delivered',
  MESSAGES_SEND_READ = 'messages:send-read',
  MESSAGES_SEND_TYPING = 'messages:send-typing',
  MESSAGES_SEARCH = 'messages:search',
  MESSAGES_DELETE = 'messages:delete',
  MESSAGES_EDIT = 'messages:edit',
  MESSAGES_REACT = 'messages:react',
  MESSAGES_SET_FLAGS = 'messages:set-flags',
  CONVERSATIONS_DELETE = 'conversations:delete',
  CONVERSATIONS_CLEAR = 'conversations:clear',
  CONVERSATIONS_SET_FLAGS = 'conversations:set-flags',
  CONVERSATIONS_MARK_UNREAD = 'conversations:mark-unread',

  // Private Chat System (Phase 4)
  PRIVATE_STATUS = 'private:status',
  PRIVATE_SETUP_CREDENTIAL = 'private:setup-credential',
  PRIVATE_UNLOCK = 'private:unlock',
  PRIVATE_LOCK = 'private:lock',
  PRIVATE_CONVERSATIONS_LIST = 'private:conversations-list',
  PRIVATE_CONVERSATIONS_CREATE = 'private:conversations-create',
  PRIVATE_INVITATION_CREATE = 'private:invitation-create',
  PRIVATE_INVITATION_REDEEM = 'private:invitation-redeem',
  PRIVATE_INVITATIONS_LIST = 'private:invitations-list',
  PRIVATE_INVITATION_REVOKE = 'private:invitation-revoke',

  // File Transfer (Phase 5)
  TRANSFERS_LIST = 'transfers:list',
  TRANSFERS_SEND_FILE = 'transfers:send-file',
  TRANSFERS_ACCEPT = 'transfers:accept',
  TRANSFERS_REJECT = 'transfers:reject',
  TRANSFERS_PAUSE = 'transfers:pause',
  TRANSFERS_RESUME = 'transfers:resume',
  TRANSFERS_CANCEL = 'transfers:cancel',
  TRANSFERS_SELECT_FILE = 'transfers:select-file',
  TRANSFERS_OPEN_FOLDER = 'transfers:open-folder',
  TRANSFERS_OPEN_FILE = 'transfers:open-file',
  TRANSFERS_SEND_BUFFER = 'transfers:send-buffer',
  TRANSFERS_SAVE_AS = 'transfers:save-as',

  // Media permissions
  MEDIA_GET_ACCESS_STATUS = 'media:get-access-status',
  MEDIA_OPEN_PRIVACY_SETTINGS = 'media:open-privacy-settings',

  // Clipboard
  CLIPBOARD_WRITE_TEXT = 'clipboard:write-text',

  // Windows Firewall
  FIREWALL_STATUS = 'firewall:status',
  FIREWALL_FIX = 'firewall:fix',

  // Shared Folders (Phase 5)
  FOLDERS_LIST = 'folders:list',
  FOLDERS_CREATE = 'folders:create',
  FOLDERS_UPDATE = 'folders:update',
  FOLDERS_DELETE = 'folders:delete',
  FOLDERS_SELECT_DIRECTORY = 'folders:select-directory',
  FOLDERS_BROWSE_REMOTE = 'folders:browse-remote',
  FOLDERS_DOWNLOAD_FILE = 'folders:download-file',
  FOLDERS_UPLOAD_FILE = 'folders:upload-file',
  FOLDERS_CREATE_REMOTE_DIR = 'folders:create-remote-dir',
  FOLDERS_DELETE_REMOTE_ITEM = 'folders:delete-remote-item',
  FOLDERS_RENAME_REMOTE_ITEM = 'folders:rename-remote-item',

  // Calling & WebRTC Signaling (Phase 6)
  CALLS_INITIATE = 'calls:initiate',
  CALLS_ACCEPT = 'calls:accept',
  CALLS_REJECT = 'calls:reject',
  CALLS_END = 'calls:end',
  CALLS_SIGNAL = 'calls:signal',
  CALLS_LIST = 'calls:list',
  CALLS_GET_SOURCES = 'calls:get-sources',
  CALLS_START_SCREEN_SHARE = 'calls:start-screen-share',
  CALLS_STOP_SCREEN_SHARE = 'calls:stop-screen-share',

  // Events emitted from Main to Renderer
  EVENT_NETWORK_STATUS = 'event:network-status',
  EVENT_DEVICE_DISCOVERED = 'event:device-discovered',
  EVENT_DEVICE_UPDATED = 'event:device-updated',
  EVENT_MESSAGE_RECEIVED = 'event:message-received',
  EVENT_MESSAGE_RECEIPT = 'event:message-receipt',
  EVENT_MESSAGE_UPDATED = 'event:message-updated',
  EVENT_CONVERSATION_REMOVED = 'event:conversation-removed',
  EVENT_TRANSFER_UPDATED = 'event:transfer-updated',
  EVENT_TYPING_INDICATOR = 'event:typing-indicator',
  EVENT_CONVERSATION_UPDATED = 'event:conversation-updated',
  EVENT_PRIVATE_LOCK_STATE = 'event:private-lock-state',
  EVENT_TRANSFER_OFFER = 'event:transfer-offer',
  EVENT_TRANSFER_PROGRESS = 'event:transfer-progress',
  EVENT_TRANSFER_COMPLETED = 'event:transfer-completed',
  EVENT_TRANSFER_FAILED = 'event:transfer-failed',
  EVENT_TRANSFER_CANCELLED = 'event:transfer-cancelled',
  EVENT_CALL_INCOMING = 'event:call-incoming',
  EVENT_CALL_ACCEPTED = 'event:call-accepted',
  EVENT_CALL_REJECTED = 'event:call-rejected',
  EVENT_CALL_ENDED = 'event:call-ended',
  EVENT_CALL_SIGNAL = 'event:call-signal',
  EVENT_SCREEN_SHARE_STARTED = 'event:screen-share-started',
  EVENT_SCREEN_SHARE_STOPPED = 'event:screen-share-stopped',
}
