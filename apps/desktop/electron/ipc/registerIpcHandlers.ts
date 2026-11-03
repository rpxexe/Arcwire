import { ipcMain, BrowserWindow } from 'electron';
import { IpcChannels, ProfileCreateSchema, ProfileUpdateSchema, AppSettingsSchema } from '@ipm/shared';
import { SystemInfoService } from '../services/SystemInfoService';
import { ProfileRepository, SettingsRepository } from '@ipm/database';
import { SecretKeyStore, generateDeviceIdentity, deriveDeviceId } from '@ipm/security';

export interface IpcHandlerDependencies {
  profileRepo: ProfileRepository;
  settingsRepo: SettingsRepository;
  secretStore: SecretKeyStore;
  getMainWindow: () => BrowserWindow | null;
}

export function registerIpcHandlers(deps: IpcHandlerDependencies): void {
  const { profileRepo, settingsRepo, secretStore, getMainWindow } = deps;

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

  ipcMain.handle(IpcChannels.PROFILE_CREATE, (_event, rawInput: unknown) => {
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

    return profileRepo.createProfile(
      validated,
      { osUsername: systemInfo.osUsername, computerName: systemInfo.computerName },
      { deviceId, publicKey }
    );
  });

  ipcMain.handle(IpcChannels.PROFILE_UPDATE, (_event, rawInput: unknown) => {
    const validated = ProfileUpdateSchema.parse(rawInput);
    return profileRepo.updateProfile(validated);
  });

  // Settings Management
  ipcMain.handle(IpcChannels.SETTINGS_GET, () => {
    return settingsRepo.getSettings();
  });

  ipcMain.handle(IpcChannels.SETTINGS_UPDATE, (_event, rawInput: unknown) => {
    const validated = AppSettingsSchema.partial().parse(rawInput);
    return settingsRepo.updateSettings(validated);
  });
}
