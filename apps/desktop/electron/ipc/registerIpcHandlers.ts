import { ipcMain, BrowserWindow } from 'electron';
import {
  IpcChannels,
  ProfileCreateSchema,
  ProfileUpdateSchema,
  AppSettingsSchema,
  DirectConnectInputSchema,
  TrustDeviceInputSchema,
} from '@ipm/shared';
import { SystemInfoService } from '../services/SystemInfoService';
import { ProfileRepository, SettingsRepository, DeviceRepository } from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity, deriveDeviceId } from '@ipm/security';
import type { LanTransportAdapter } from '@ipm/networking';

export interface IpcHandlerDependencies {
  profileRepo: ProfileRepository;
  settingsRepo: SettingsRepository;
  deviceRepo: DeviceRepository;
  secretStore: SecretKeyStore;
  getMainWindow: () => BrowserWindow | null;
  getLanAdapter: () => LanTransportAdapter | null;
  initLanAdapter: () => Promise<LanTransportAdapter | null>;
}

export function registerIpcHandlers(deps: IpcHandlerDependencies): void {
  const {
    profileRepo,
    settingsRepo,
    deviceRepo,
    secretStore,
    getMainWindow,
    getLanAdapter,
    initLanAdapter,
  } = deps;

  // Window Controls
  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE, () => {
    const win = getMainWindow();
    if (win) win.minimize();
  });

  ipcMain.handle(IpcChannels.WINDOW_MAXIMIZE, () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle(IpcChannels.WINDOW_CLOSE, () => {
    const win = getMainWindow();
    if (win) win.close();
  });

  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE_TO_TRAY, () => {
    const win = getMainWindow();
    if (win) win.hide();
  });

  // System Information
  ipcMain.handle(IpcChannels.SYSTEM_GET_INFO, () => {
    return SystemInfoService.getSystemInfo();
  });

  // Profile Management
  ipcMain.handle(IpcChannels.PROFILE_GET, () => {
    return profileRepo.getProfile();
  });

  ipcMain.handle(IpcChannels.PROFILE_CREATE, async (_event, rawInput: unknown) => {
    const validated = ProfileCreateSchema.parse(rawInput);
    const systemInfo = SystemInfoService.getSystemInfo();

    // Check if cryptographic identity already exists or generate new one
    let privateKey = secretStore.loadIdentityKey();
    let publicKey = '';
    let deviceId = '';

    if (!privateKey) {
      // First-time cryptographic identity generation
      const newIdentity = generateDeviceIdentity();
      privateKey = newIdentity.privateKey;
      publicKey = newIdentity.publicKey;
      deviceId = newIdentity.deviceId;
      secretStore.saveIdentityKey(privateKey);
    } else {
      // Re-derive public key from existing identity if available
      const identity = generateDeviceIdentity();
      publicKey = identity.publicKey;
      deviceId = deriveDeviceId(publicKey);
    }

    const created = profileRepo.createProfile(
      validated,
      { osUsername: systemInfo.osUsername, computerName: systemInfo.computerName },
      { deviceId, publicKey }
    );

    // Initialize LAN networking right after onboarding
    await initLanAdapter();

    return created;
  });

  ipcMain.handle(IpcChannels.PROFILE_UPDATE, (_event, rawInput: unknown) => {
    const validated = ProfileUpdateSchema.parse(rawInput);
    const updated = profileRepo.updateProfile(validated);

    // Update LAN adapter metadata if active
    const adapter = getLanAdapter();
    if (adapter && updated) {
      adapter.updateProfile({
        displayName: updated.displayName,
        status: updated.status as any,
      });
    }

    return updated;
  });

  // Settings Management
  ipcMain.handle(IpcChannels.SETTINGS_GET, () => {
    return settingsRepo.getSettings();
  });

  ipcMain.handle(IpcChannels.SETTINGS_UPDATE, (_event, rawInput: unknown) => {
    const validated = AppSettingsSchema.partial().parse(rawInput);
    return settingsRepo.updateSettings(validated);
  });

  // Devices & Network (Phase 2)
  ipcMain.handle(IpcChannels.DEVICES_LIST, () => {
    return deviceRepo.getAllDevices();
  });

  ipcMain.handle(IpcChannels.DEVICES_REFRESH, async () => {
    const adapter = getLanAdapter();
    if (adapter) {
      adapter.scanNow();
    }
  });

  ipcMain.handle(IpcChannels.DEVICES_CONNECT_MANUAL, async (_event, rawInput: unknown) => {
    const validated = DirectConnectInputSchema.parse(rawInput);
    const adapter = getLanAdapter();
    if (!adapter) {
      throw new Error('LAN networking is not initialized. Please complete onboarding first.');
    }
    return adapter.connectDirect(validated.ipAddress, validated.port);
  });

  ipcMain.handle(IpcChannels.DEVICES_TOGGLE_TRUST, (_event, rawInput: unknown) => {
    const validated = TrustDeviceInputSchema.parse(rawInput);
    deviceRepo.setDeviceTrust(validated.deviceId, validated.isTrusted);
    const updated = deviceRepo.getDeviceById(validated.deviceId);
    if (updated) {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(IpcChannels.EVENT_DEVICE_UPDATED, updated);
      }
    }
  });
}
