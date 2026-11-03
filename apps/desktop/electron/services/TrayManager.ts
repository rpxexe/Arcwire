import path from 'node:path';
import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron';

export class TrayManager {
  private static instance: TrayManager | null = null;
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;

  private constructor() {}

  public static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  public initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    const iconPath = path.resolve(__dirname, '../../resources/icon.png');
    let icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
      // 16x16 standard valid PNG fallback for Windows notification tray
      icon = nativeImage.createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVR42mNk+M9QzwABRgYGBhIS/xgYGBj//yckwTDqAlpYwMDAwAjTw0YtwGElHwAAe+EQ5B9sIpsAAAAASUVORK5CYII=',
          'base64'
        )
      );
    }

    try {
      this.tray = new Tray(icon.resize({ width: 16, height: 16 }));
      this.tray.setToolTip('IP Messenger - LAN Desktop Communication');

      this.updateContextMenu('online');

      this.tray.on('click', () => {
        this.toggleWindow();
      });

      this.tray.on('double-click', () => {
        this.showWindow();
      });
    } catch (err) {
      console.warn('Tray initialization notice:', err);
    }
  }

  public updateContextMenu(status: string = 'online'): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open IP Messenger',
        click: () => this.showWindow(),
      },
      { type: 'separator' },
      {
        label: 'Status: Online',
        type: 'radio',
        checked: status === 'online',
        click: () => {
          // Status update callback if needed
        },
      },
      {
        label: 'Status: Busy',
        type: 'radio',
        checked: status === 'busy',
        click: () => {},
      },
      {
        label: 'Status: Away',
        type: 'radio',
        checked: status === 'away',
        click: () => {},
      },
      { type: 'separator' },
      {
        label: 'Quit IP Messenger',
        click: () => {
          (app as unknown as { isQuitting: boolean }).isQuitting = true;
          app.quit();
        },
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public showWindow(): void {
    if (!this.mainWindow) return;
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  public hideWindow(): void {
    if (!this.mainWindow) return;
    this.mainWindow.hide();
  }

  public toggleWindow(): void {
    if (!this.mainWindow) return;
    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.showWindow();
    }
  }

  public destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
