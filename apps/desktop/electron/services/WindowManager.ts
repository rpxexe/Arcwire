import path from 'node:path';
import { app, BrowserWindow, shell, session } from 'electron';
import { SettingsRepository } from '@ipm/database';

export class WindowManager {
  private static instance: WindowManager | null = null;
  private mainWindow: BrowserWindow | null = null;
  private settingsRepo: SettingsRepository | null = null;

  private constructor() {}

  public static getInstance(): WindowManager {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager();
    }
    return WindowManager.instance;
  }

  public setSettingsRepository(repo: SettingsRepository): void {
    this.settingsRepo = repo;
  }

  public createMainWindow(): BrowserWindow {
    const iconPath = path.resolve(__dirname, '../../resources/icon.png');

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 780,
      minWidth: 980,
      minHeight: 640,
      frame: false,
      title: 'Arcwire',
      icon: iconPath,
      show: false,
      backgroundColor: '#0f172a',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
      },
    });

    this.setupSecurityGuards(this.mainWindow);

    this.mainWindow.on('ready-to-show', () => {
      const isHidden = process.argv.includes('--hidden');
      if (!isHidden) {
        this.mainWindow?.show();
      }
    });

    this.mainWindow.on('close', (event) => {
      const isQuitting = (app as unknown as { isQuitting?: boolean }).isQuitting;
      const minimizeToTray = this.settingsRepo ? this.settingsRepo.getSettings().minimizeToTray : true;

      if (!isQuitting && minimizeToTray) {
        event.preventDefault();
        this.mainWindow?.hide();
      }
    });

    // Load dev URL or built index.html
    if (process.env['ELECTRON_RENDERER_URL']) {
      this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    } else {
      this.mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }

    return this.mainWindow;
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  private setupSecurityGuards(window: BrowserWindow): void {
    // 1. Block unauthorized window opens & navigate external links safely
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    window.webContents.on('will-navigate', (event, url) => {
      const allowedOrigins = [process.env['ELECTRON_RENDERER_URL'] || ''];
      if (!allowedOrigins.some((origin) => origin && url.startsWith(origin))) {
        event.preventDefault();
        if (url.startsWith('https://')) {
          shell.openExternal(url);
        }
      }
    });

    // 2. Strict media permission handler
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') {
        // Approve camera & microphone for WebRTC calls within our app
        callback(true);
        return;
      }
      callback(false);
    });
  }
}
