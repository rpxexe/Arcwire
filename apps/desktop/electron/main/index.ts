import { app, BrowserWindow, safeStorage } from 'electron';
import { AppPaths } from '../services/AppPaths';
import { WindowManager } from '../services/WindowManager';
import { TrayManager } from '../services/TrayManager';
import { registerIpcHandlers } from '../ipc/registerIpcHandlers';
import { DatabaseService, ProfileRepository, SettingsRepository } from '@ipm/database';
import { SecretKeyStore } from '@ipm/security';

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  let dbService: DatabaseService | null = null;
  let profileRepo: ProfileRepository | null = null;
  let settingsRepo: SettingsRepository | null = null;
  let secretStore: SecretKeyStore | null = null;

  app.on('second-instance', () => {
    const mainWindow = WindowManager.getInstance().getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 1. Initialize Paths & Directories
    const paths = AppPaths.get();

    // 2. Initialize Database & Repositories
    dbService = DatabaseService.initialize({ dbPath: paths.databaseFile });
    profileRepo = new ProfileRepository(dbService);
    settingsRepo = new SettingsRepository(dbService);

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
      secretStore,
      getMainWindow: () => windowManager.getMainWindow(),
    });

    if (process.argv.includes('--smoke-test')) {
      console.log('[SMOKE TEST] Verifying database tables and DPAPI store...');
      const raw = dbService.getRawSqlite();
      const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log('[SMOKE TEST] Database initialized. Table count:', tables.length);
      console.log('[SMOKE TEST] DPAPI safeStorage is available:', safeStorage.isEncryptionAvailable());
      console.log('[SMOKE TEST] SUCCESS. Quitting Electron.');
      (app as unknown as { isQuitting: boolean }).isQuitting = true;
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

  app.on('before-quit', () => {
    (app as unknown as { isQuitting: boolean }).isQuitting = true;
    TrayManager.getInstance().destroy();
    if (dbService) {
      dbService.close();
    }
  });
}
