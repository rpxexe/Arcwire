import { app, BrowserWindow, safeStorage, Notification } from 'electron';
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
} from '@ipm/database';
import { SecretKeyStore } from '@ipm/security';
import { LanTransportAdapter } from '@ipm/networking';
import { MessagingService } from '@ipm/messaging';
import { DEFAULT_PORTS, IpcChannels, IpmEventType } from '@ipm/shared';
import { PrivateSessionManager } from '../services/PrivateSessionManager';
import { FileTransferService } from '../services/FileTransferService';
import { FolderSharingService } from '../services/FolderSharingService';

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

          default:
            break;
        }
      } catch (err) {
        console.error('[Main] Error handling network envelope in Phase 5 services:', err);
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
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_MESSAGE_RECEIVED, msg);
        }

        // Show Windows desktop notification if window is not focused
        const currentSettings = settingsRepo?.getSettings();
        const shouldNotify = currentSettings?.notificationsEnabled ?? true;
        if (shouldNotify && win && !win.isFocused()) {
          const isPrivate = privateRepo?.isPrivateConversation(msg.conversationId) ?? false;
          if (isPrivate) {
            new Notification({
              title: 'Arcwire Private Chat',
              body: 'New secure private message received',
            }).show();
          } else {
            const sender = deviceRepo?.getDeviceById(msg.senderId);
            const title = sender?.displayName || 'New Message';
            new Notification({
              title,
              body: msg.contentType === 'file' ? '[File Attachment]' : msg.content,
            }).show();
          }
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
          win.webContents.send(IpcChannels.EVENT_CONVERSATION_UPDATED);
        }
      });

      messagingService.on('hostMigrated', () => {
        const win = WindowManager.getInstance().getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send(IpcChannels.EVENT_CONVERSATION_UPDATED);
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
    profileRepo = new ProfileRepository(dbService);
    settingsRepo = new SettingsRepository(dbService);
    deviceRepo = new DeviceRepository(dbService);
    conversationRepo = new ConversationRepository(dbService);
    messageRepo = new MessageRepository(dbService);
    groupRepo = new GroupRepository(dbService);
    privateRepo = new PrivateChatRepository(dbService);
    transferRepo = new TransferRepository(dbService);
    folderRepo = new SharedFolderRepository(dbService);

    // 3. Initialize DPAPI Key Store
    secretStore = new SecretKeyStore({
      storageDir: paths.security,
      safeStorage,
    });

    const localProfile = profileRepo.getProfile();
    privateSession = new PrivateSessionManager(privateRepo, localProfile?.deviceId ?? '');

    // 4. Initialize Phase 5 File Transfer & Folder Sharing Services
    transferService = new FileTransferService({
      localDeviceId: localProfile?.deviceId ?? '',
      transfersDir: paths.transfers,
      transferRepo,
      settingsRepo,
      getLanAdapter: () => lanAdapter,
    });

    folderService = new FolderSharingService({
      localDeviceId: localProfile?.deviceId ?? '',
      folderRepo,
      getLanAdapter: () => lanAdapter,
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
