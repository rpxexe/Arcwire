import { app, BrowserWindow, safeStorage } from 'electron';
import { AppPaths } from '../services/AppPaths';
import { WindowManager } from '../services/WindowManager';
import { TrayManager } from '../services/TrayManager';
import { registerIpcHandlers } from '../ipc/registerIpcHandlers';
import { DatabaseService, ProfileRepository, SettingsRepository, DeviceRepository } from '@ipm/database';
import { SecretKeyStore } from '@ipm/security';
import { LanTransportAdapter } from '@ipm/networking';
import { DEFAULT_PORTS, IpcChannels } from '@ipm/shared';

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let dbService: DatabaseService | null = null;
  let profileRepo: ProfileRepository | null = null;
  let settingsRepo: SettingsRepository | null = null;
  let deviceRepo: DeviceRepository | null = null;
  let secretStore: SecretKeyStore | null = null;
  let lanAdapter: LanTransportAdapter | null = null;

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

    try {
      await lanAdapter.start();
      console.log(`[Main] LAN Transport Adapter active on TCP ${tcpPort}, UDP ${udpPort}`);
    } catch (err) {
      console.error('[Main] Failed to start LAN Transport Adapter:', err);
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

    // 3. Initialize DPAPI Key Store
    secretStore = new SecretKeyStore({
      storageDir: paths.security,
      safeStorage,
    });

    // 4. Initialize Window Manager
    const windowManager = WindowManager.getInstance();
    windowManager.setSettingsRepository(settingsRepo);
    const mainWindow = windowManager.createMainWindow();

    // 5. Initialize System Tray
    const trayManager = TrayManager.getInstance();
    trayManager.initialize(mainWindow);

    // 6. Register Typed IPC Handlers
    registerIpcHandlers({
      profileRepo,
      settingsRepo,
      deviceRepo,
      secretStore,
      getMainWindow: () => windowManager.getMainWindow(),
      getLanAdapter: () => lanAdapter,
      initLanAdapter,
    });

    // 7. Auto-start LAN Transport Adapter if profile already exists
    if (profileRepo.getProfile()) {
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
    // On Windows, keep running in system tray if minimizeToTray is enabled
    const settings = settingsRepo ? settingsRepo.getSettings() : { minimizeToTray: true };
    if (!settings.minimizeToTray) {
      app.quit();
    }
  });

  app.on('before-quit', async () => {
    (app as unknown as { isQuitting: boolean }).isQuitting = true;
    TrayManager.getInstance().destroy();
    if (lanAdapter) {
      await lanAdapter.stop();
      lanAdapter = null;
    }
    if (dbService) {
      dbService.close();
    }
  });
}
