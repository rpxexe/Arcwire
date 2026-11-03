export const IPM_PROTOCOL = 'IPM/1';

export const DEFAULT_PORTS = {
  UDP_DISCOVERY: 45820,
  TCP_MAIN: 45821,
  TCP_SIGNALING: 45822,
} as const;

export const STREAM_LIMITS = {
  CHUNK_SIZE: 256 * 1024, // 256 KB
  MAX_CONCURRENT_TRANSFERS: 3,
  MAX_MESSAGE_FRAME_BYTES: 1024 * 1024, // 1 MB
  SLIDING_WINDOW_SIZE: 4,
} as const;

export const DIRECTORY_NAMES = {
  DATA: 'data',
  ATTACHMENTS: 'attachments',
  TRANSFERS: 'transfers',
  AVATARS: 'avatars',
  LOGS: 'logs',
  BACKUPS: 'backups',
  SECURITY: 'security',
} as const;

export const DEFAULT_APP_SETTINGS = {
  theme: 'system' as 'system' | 'dark' | 'light',
  udpPort: DEFAULT_PORTS.UDP_DISCOVERY,
  tcpPort: DEFAULT_PORTS.TCP_MAIN,
  signalingPort: DEFAULT_PORTS.TCP_SIGNALING,
  minimizeToTray: true,
  startWithWindows: false,
  notificationsEnabled: true,
  autoDownloadFiles: false,
} as const;

