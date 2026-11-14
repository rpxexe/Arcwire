import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, safeStorage, Notification, powerMonitor, protocol, net } from 'electron';
import { AppPaths } from '../services/AppPaths';
import { WindowManager } from '../services/WindowManager';
import { TrayManager } from '../services/TrayManager';
import { registerIpcHandlers } from '../ipc/registerIpcHandlers';
import {
  DatabaseService,
  ProfileRepository,
  SettingsRepository,
  DeviceRepository,
  ConversationRepository,
  MessageRepository,
  GroupRepository,
  PrivateChatRepository,
  TransferRepository,
  SharedFolderRepository,
  CallRepository,
} from '@ipm/database';
import { SecretKeyStore } from '@ipm/security';
import { LanTransportAdapter } from '@ipm/networking';
import { MessagingService } from '@ipm/messaging';
import { DEFAULT_PORTS, IpcChannels, IpmEventType } from '@ipm/shared';
import { PrivateSessionManager } from '../services/PrivateSessionManager';
import { FileTransferService } from '../services/FileTransferService';
import { FolderSharingService } from '../services/FolderSharingService';
import { CallSignalingService } from '../services/CallSignalingService';

function logCrash(type: string, error: unknown): void {
  try {
    let logsDir: string;
    try {
      logsDir = AppPaths.get().logs;
    } catch {
      const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library/Application Support') : path.join(process.env.HOME || '', '.config'));
      logsDir = path.join(appData, 'IPMessenger', 'logs');
    }
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const crashFile = path.join(logsDir, 'crash.log');
    const timestamp = new Date().toISOString();
    const stack = error instanceof Error ? (error.stack || error.message) : String(error);
    const entry = `[${timestamp}] [${type}] ${stack}\n\n`;
    fs.appendFileSync(crashFile, entry, 'utf8');
  } catch (e) {
    console.error('[Main] Failed to write to crash log:', e);
  }
}

process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  logCrash('UNCAUGHT_EXCEPTION', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
  logCrash('UNHANDLED_REJECTION', reason);
});

// WebRTC on a LAN: expose real host IPs in ICE candidates instead of random "<uuid>.local"
// mDNS names. Windows PCs frequently cannot resolve those names from each other, which
// leaves calls stuck in "Connecting…". Arcwire never contacts STUN/TURN servers, so these
// candidates only ever travel to authenticated peers over the local signaling channel.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// Privileged scheme used to preview transferred media (images/video/audio) inside chat bubbles.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'arcwire-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let dbService: DatabaseService | null = null;
  let profileRepo: ProfileRepository | null = null;
  let settingsRepo: SettingsRepository | null = null;
  let deviceRepo: DeviceRepository | null = null;
  let conversationRepo: ConversationRepository | null = null;
  let messageRepo: MessageRepository | null = null;
  let groupRepo: GroupRepository | null = null;
  let privateRepo: PrivateChatRepository | null = null;
  let transferRepo: TransferRepository | null = null;
  let folderRepo: SharedFolderRepository | null = null;
  let privateSession: PrivateSessionManager | null = null;
  let transferService: FileTransferService | null = null;
  let folderService: FolderSharingService | null = null;
  let callRepo: CallRepository | null = null;
  let callService: CallSignalingService | null = null;
  let secretStore: SecretKeyStore | null = null;
  let lanAdapter: LanTransportAdapter | null = null;
  let messagingService: MessagingService | null = null;

  const initLanAdapter = async (): Promise<LanTransportAdapter | null> => {
    if (lanAdapter) return lanAdapter;
    const profile = profileRepo?.getProfile();
    const privateKey = secretStore?.loadIdentityKey();
    if (!profile || !privateKey) return null;

    const settings = settingsRepo?.getSettings();
    const tcpPort = settings?.tcpPort ?? DEFAULT_PORTS.TCP_MAIN;
    const udpPort = settings?.udpPort ?? DEFAULT_PORTS.UDP_DISCOVERY;

    lanAdapter = new LanTransportAdapter({
      localIdentity: {
        deviceId: profile.deviceId,
        publicKey: profile.publicKey,
        privateKey,
      },
      localMetadata: {
        deviceId: profile.deviceId,
        publicKey: profile.publicKey,
        displayName: profile.displayName,
        hostname: profile.computerName,
        osUser: profile.osUsername,
        tcpPort,
        signalingPort: settings?.signalingPort ?? DEFAULT_PORTS.TCP_SIGNALING,
        status: profile.status as any,
      },
      tcpPort,
      udpPort,
      deviceRepo: deviceRepo ?? undefined,
    });

    if (transferService) {
      transferService.updateLocalDeviceId(profile.deviceId);
    }
    if (folderService) {
      folderService.updateLocalDeviceId(profile.deviceId);
    }
    if (callService) {
      callService.updateLocalDeviceId(profile.deviceId);
    }

    lanAdapter.on('deviceDiscovered', (device) => {
      const win = WindowManager.getInstance().getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.EVENT_DEVICE_DISCOVERED, device);
      }
    });

    lanAdapter.on('deviceUpdated', (device) => {
      const win = WindowManager.getInstance().getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.EVENT_DEVICE_UPDATED, device);
      }
    });

    lanAdapter.on('deviceOffline', (deviceId) => {
      const dev = deviceRepo?.getDeviceById(deviceId);
      if (dev) {
        const win = WindowManager.getInstance().getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_DEVICE_UPDATED, dev);
        }
      }
    });

    // Route incoming network packets to appropriate services
    lanAdapter.on('message', async (envelope) => {
      try {
        switch (envelope.type) {
          case IpmEventType.FILE_OFFER:
          case IpmEventType.FILE_ACCEPT:
          case IpmEventType.FILE_REJECT:
          case IpmEventType.FILE_CHUNK:
          case IpmEventType.FILE_PAUSE:
          case IpmEventType.FILE_RESUME:
          case IpmEventType.FILE_CANCEL:
          case IpmEventType.FILE_COMPLETE:
            if (transferService) {
              await transferService.handleIncomingEnvelope(envelope);
            }
            break;

          case IpmEventType.FOLDER_LIST:
          case IpmEventType.FOLDER_LIST_RESPONSE:
          case IpmEventType.FOLDER_MODIFY:
          case IpmEventType.FOLDER_OPERATION_RESPONSE:
            if (folderService) {
              await folderService.handleIncomingEnvelope(envelope);
            }
            break;
          case IpmEventType.CALL_REQUEST:
          case IpmEventType.CALL_ACCEPT:
          case IpmEventType.CALL_REJECT:
          case IpmEventType.CALL_END:
          case IpmEventType.CALL_SIGNAL:
          case IpmEventType.SCREEN_SHARE_START:
          case IpmEventType.SCREEN_SHARE_STOP:
            if (callService) {
              await callService.handleIncomingEnvelope(envelope);
            }
            break;

          case IpmEventType.PRIVATE_JOIN_REQUEST:
          case IpmEventType.PRIVATE_JOIN_ACCEPTED:
          case IpmEventType.PRIVATE_JOIN_REJECTED:
          case IpmEventType.PRIVATE_MEMBER_ADDED:
            if (privateSession) {
              await privateSession.handleIncomingEnvelope(envelope);
            }
            break;


          default:
            break;
        }
      } catch (err) {
        console.error('[Main] Error handling network envelope:', err);
      }
    });

    try {
      await lanAdapter.start();
      console.log(`[Main] LAN Transport Adapter active on TCP ${tcpPort}, UDP ${udpPort}`);
    } catch (err) {
      console.error('[Main] Failed to start LAN Transport Adapter:', err);
    }

    // Initialize Messaging Service
    if (!messagingService && dbService) {
      messagingService = new MessagingService({
        localDeviceId: profile.deviceId,
        dbService,
        transport: lanAdapter,
      });

      messagingService.on('messageReceived', (msg) => {
        const win = WindowManager.getInstance().getMainWindow();
        const isProtected = privateSession?.isProtectedConversation(msg.conversationId) ?? false;
        const isUnlocked = privateSession?.isUnlocked() ?? false;

        // Never push protected (private / locked) content to the renderer while locked.
        if (win && !win.isDestroyed() && (!isProtected || isUnlocked)) {
          win.webContents.send(IpcChannels.EVENT_MESSAGE_RECEIVED, msg);
        }

        // Show Windows desktop notification if window is not focused
        const currentSettings = settingsRepo?.getSettings();
        const conv = conversationRepo?.getConversationById(msg.conversationId, profileRepo?.getProfile()?.deviceId ?? '', true);
        const shouldNotify = (currentSettings?.notificationsEnabled ?? true) && !conv?.isMuted;
        if (shouldNotify && win && !win.isFocused()) {
          if (isProtected) {
            new Notification({
              title: 'Arcwire Private Chat',
              body: 'New secure private message received',
            }).show();
          } else {
            const sender = deviceRepo?.getDeviceById(msg.senderId);
            const title = sender?.displayName || 'New Message';
            let body = msg.content;
            if (msg.contentType === 'file') {
              try {
                body = `Sent a file: ${JSON.parse(msg.content).fileName ?? 'attachment'}`;
              } catch {
                body = 'Sent a file';
              }
            }
            new Notification({ title, body }).show();
          }
        }
      });

      messagingService.on('messageUpdated', (msg) => {
        const win = WindowManager.getInstance().getMainWindow();
        const isProtected = privateSession?.isProtectedConversation(msg.conversationId) ?? false;
        if (win && !win.isDestroyed() && (!isProtected || privateSession?.isUnlocked())) {
          win.webContents.send(IpcChannels.EVENT_MESSAGE_UPDATED, msg);
        }
      });

      messagingService.on('receipt', (receipt) => {
        const win = WindowManager.getInstance().getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_MESSAGE_RECEIPT, receipt);
        }
      });

      messagingService.on('typing', (typing) => {
        const win = WindowManager.getInstance().getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_TYPING_INDICATOR, typing);
        }
      });

      messagingService.on('groupCreated', () => {
        const win = WindowManager.getInstance().getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CONVERSATION_UPDATED, null);
        }
      });

      messagingService.on('hostMigrated', () => {
        const win = WindowManager.getInstance().getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CONVERSATION_UPDATED, null);
        }
      });
    }

    return lanAdapter;
  };

  app.on('second-instance', () => {
    const mainWindow = WindowManager.getInstance().getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 1. Initialize Paths & Directories
    const paths = AppPaths.get();

    // 2. Initialize Database & Repositories
    dbService = DatabaseService.initialize({ dbPath: paths.databaseFile });
    // Run SQLite PRAGMA integrity check on startup
    try {
      const integrity = dbService.getRawSqlite().pragma('integrity_check') as Array<{ integrity_check: string }>;
      const isOk = Array.isArray(integrity) && integrity.length > 0 && integrity[0]?.integrity_check === 'ok';
      if (!isOk) {
        console.error('[Database] SQLite integrity check failed:', integrity);
        logCrash('SQLITE_CORRUPTION', new Error(`Database integrity check failed: ${JSON.stringify(integrity)}`));
      } else {
        console.log('[Database] SQLite PRAGMA integrity_check passed (ok).');
      }
    } catch (err) {
      console.error('[Database] Error running integrity check:', err);
    }
    profileRepo = new ProfileRepository(dbService);
    settingsRepo = new SettingsRepository(dbService);
    // Configure Windows login auto-start based on user preference
    const initialSettings = settingsRepo.getSettings();
    try {
      app.setLoginItemSettings({
        openAtLogin: initialSettings.startWithWindows,
        args: ['--hidden'],
      });
    } catch (err) {
      console.error('[Main] Failed to configure initial login item settings:', err);
    }
    deviceRepo = new DeviceRepository(dbService);
    conversationRepo = new ConversationRepository(dbService);
    messageRepo = new MessageRepository(dbService);
    groupRepo = new GroupRepository(dbService);
    privateRepo = new PrivateChatRepository(dbService);
    transferRepo = new TransferRepository(dbService);
    folderRepo = new SharedFolderRepository(dbService);
    callRepo = new CallRepository(dbService);

    // 3. Initialize DPAPI Key Store
    secretStore = new SecretKeyStore({
      storageDir: paths.security,
      safeStorage,
    });

    const localProfile = profileRepo.getProfile();
    privateSession = new PrivateSessionManager(privateRepo, localProfile?.deviceId ?? '', {
      conversationRepo,
      deviceRepo,
      getLanAdapter: () => lanAdapter,
    });

    // Lock private chats whenever Windows is locked or the machine sleeps
    powerMonitor.on('lock-screen', () => privateSession?.lock());
    powerMonitor.on('suspend', () => privateSession?.lock());

    // 4. Initialize Phase 5 File Transfer & Folder Sharing Services
    transferService = new FileTransferService({
      localDeviceId: localProfile?.deviceId ?? '',
      transfersDir: paths.transfers,
      downloadsDir: path.join(app.getPath('downloads'), 'Arcwire'),
      transferRepo,
      settingsRepo,
      getLanAdapter: () => lanAdapter,
    });

    folderService = new FolderSharingService({
      localDeviceId: localProfile?.deviceId ?? '',
      folderRepo,
      getLanAdapter: () => lanAdapter,
    });

    callService = new CallSignalingService({
      localDeviceId: localProfile?.deviceId ?? '',
      callRepo,
      settingsRepo,
      getLanAdapter: () => lanAdapter,
      getMainWindow: () => windowManager.getMainWindow(),
    });

    // Serve previews for transferred media. Only files that belong to a known transfer
    // (a received file, or the original file we sent) with a media extension are readable.
    protocol.handle('arcwire-media', async (request) => {
      try {
        const url = new URL(request.url);
        const transferId = decodeURIComponent(url.hostname || url.pathname.replace(/^\/+/, ''));
        const transfer = transferRepo?.getTransferById(transferId);
        const filePath = transfer?.finalPath;
        const isMedia = /\.(png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|mp3|wav|ogg)$/i.test(filePath ?? '');
        const ready = transfer && (transfer.direction === 'outgoing' || transfer.status === 'completed');
        if (!filePath || !isMedia || !ready || !fs.existsSync(filePath)) {
          return new Response('Not found', { status: 404 });
        }
        return net.fetch(pathToFileURL(filePath).toString());
      } catch {
        return new Response('Bad request', { status: 400 });
      }
    });

    // 5. Initialize Window Manager
    const windowManager = WindowManager.getInstance();
    windowManager.setSettingsRepository(settingsRepo);
    const mainWindow = windowManager.createMainWindow();

    // 6. Initialize System Tray
    const trayManager = TrayManager.getInstance();
    trayManager.initialize(mainWindow);

    // 7. Register Typed IPC Handlers
    registerIpcHandlers({
      profileRepo,
      settingsRepo,
      deviceRepo,
      conversationRepo,
      messageRepo,
      groupRepo,
      privateRepo,
      privateSession,
      transferRepo,
      folderRepo,
      transferService,
      folderService,
      callRepo,
      callService,
      secretStore,
      getMainWindow: () => windowManager.getMainWindow(),
      getLanAdapter: () => lanAdapter,
      initLanAdapter,
      getMessagingService: () => messagingService,
    });

    // 8. Auto-start LAN Transport Adapter if profile already exists
    if (localProfile) {
      await initLanAdapter();
    }

    if (process.argv.includes('--smoke-test')) {
      console.log('[SMOKE TEST] Verifying database tables and DPAPI store...');
      const raw = dbService.getRawSqlite();
      const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log('[SMOKE TEST] Database initialized. Table count:', tables.length);
      console.log('[SMOKE TEST] DPAPI safeStorage is available:', safeStorage.isEncryptionAvailable());
      console.log('[SMOKE TEST] SUCCESS. Quitting Electron.');
      (app as unknown as { isQuitting: boolean }).isQuitting = true;
      if (transferService) {
        transferService.destroy();
      }
      if (folderService) {
        folderService.destroy();
      }
      if (callService) {
        callService.destroy();
      }
      if (messagingService) {
        messagingService.destroy();
      }
      if (lanAdapter) {
        await lanAdapter.stop();
      }
      setTimeout(() => {
        app.quit();
        process.exit(0);
      }, 500);
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        windowManager.createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    const settings = settingsRepo ? settingsRepo.getSettings() : { minimizeToTray: true };
    if (!settings.minimizeToTray) {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    (app as unknown as { isQuitting: boolean }).isQuitting = true;
    TrayManager.getInstance().destroy();
    if (transferService) {
      transferService.destroy();
      transferService = null;
    }
    if (folderService) {
      folderService.destroy();
      folderService = null;
    }
    if (callService) {
      callService.destroy();
      callService = null;
    }
    if (privateSession) {
      privateSession.destroy();
    }
    if (messagingService) {
      messagingService.destroy();
      messagingService = null;
    }
    if (lanAdapter) {
      await lanAdapter.stop();
      lanAdapter = null;
    }
    if (dbService) {
      dbService.close();
    }
  });
}
