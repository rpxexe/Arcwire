import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels, IpcApi, DeviceInfo, MessageItem } from '@ipm/shared';

const api: IpcApi = {
  // Window
  minimizeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IpcChannels.WINDOW_CLOSE),
  minimizeToTray: () => ipcRenderer.invoke(IpcChannels.WINDOW_MINIMIZE_TO_TRAY),

  // System
  getSystemInfo: () => ipcRenderer.invoke(IpcChannels.SYSTEM_GET_INFO),

  // Profile
  getProfile: () => ipcRenderer.invoke(IpcChannels.PROFILE_GET),
  createProfile: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_CREATE, input),
  updateProfile: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_UPDATE, input),

  // Settings
  getSettings: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET),
  updateSettings: (input) => ipcRenderer.invoke(IpcChannels.SETTINGS_UPDATE, input),

  // Devices & Network (Phase 2)
  getDevices: () => ipcRenderer.invoke(IpcChannels.DEVICES_LIST),
  refreshDevices: () => ipcRenderer.invoke(IpcChannels.DEVICES_REFRESH),
  connectManual: (input) => ipcRenderer.invoke(IpcChannels.DEVICES_CONNECT_MANUAL, input),
  toggleDeviceTrust: (input) => ipcRenderer.invoke(IpcChannels.DEVICES_TOGGLE_TRUST, input),

  // Event Listeners
  onNetworkStatusChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { online: boolean; ip?: string }) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_NETWORK_STATUS, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_NETWORK_STATUS, handler);
  },
  onDeviceDiscovered: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DeviceInfo) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_DEVICE_DISCOVERED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_DEVICE_DISCOVERED, handler);
  },
  onDeviceUpdated: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: DeviceInfo) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_DEVICE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_DEVICE_UPDATED, handler);
  },
  onMessageReceived: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: MessageItem) => callback(data);
    ipcRenderer.on(IpcChannels.EVENT_MESSAGE_RECEIVED, handler);
    return () => ipcRenderer.removeListener(IpcChannels.EVENT_MESSAGE_RECEIVED, handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
