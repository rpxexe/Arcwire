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

  // Group Messaging
  GROUP_CREATE = 'GROUP_CREATE',
  GROUP_JOIN = 'GROUP_JOIN',
  GROUP_LEAVE = 'GROUP_LEAVE',
  GROUP_MESSAGE = 'GROUP_MESSAGE',
  GROUP_HOST_MIGRATED = 'GROUP_HOST_MIGRATED',

  // Private Conversations
  PRIVATE_INVITE = 'PRIVATE_INVITE',
  PRIVATE_JOIN_REQUEST = 'PRIVATE_JOIN_REQUEST',
  PRIVATE_JOIN_ACCEPTED = 'PRIVATE_JOIN_ACCEPTED',
  PRIVATE_UNLOCK = 'PRIVATE_UNLOCK',
  PRIVATE_MESSAGE = 'PRIVATE_MESSAGE',

  // File Transfer
  FILE_OFFER = 'FILE_OFFER',
  FILE_ACCEPT = 'FILE_ACCEPT',
  FILE_REJECT = 'FILE_REJECT',
  FILE_CHUNK = 'FILE_CHUNK',
  FILE_CHUNK_ACK = 'FILE_CHUNK_ACK',
  FILE_COMPLETE = 'FILE_COMPLETE',
  FILE_CANCEL = 'FILE_CANCEL',

  // Folder Sharing
  FOLDER_LIST = 'FOLDER_LIST',
  FOLDER_LIST_RESPONSE = 'FOLDER_LIST_RESPONSE',
  FOLDER_DOWNLOAD = 'FOLDER_DOWNLOAD',
  FOLDER_UPLOAD = 'FOLDER_UPLOAD',
  FOLDER_MODIFY = 'FOLDER_MODIFY',

  // Calling & WebRTC Signaling
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

  // Devices & Network (Phase 2+)
  DEVICES_LIST = 'devices:list',
  DEVICES_REFRESH = 'devices:refresh',
  DEVICES_CONNECT_MANUAL = 'devices:connect-manual',

  // Events emitted from Main to Renderer
  EVENT_NETWORK_STATUS = 'event:network-status',
  EVENT_DEVICE_DISCOVERED = 'event:device-discovered',
  EVENT_MESSAGE_RECEIVED = 'event:message-received',
}

