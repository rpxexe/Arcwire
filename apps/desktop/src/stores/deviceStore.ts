import { create } from 'zustand';
import { DeviceInfo } from '@ipm/shared';

interface DeviceState {
  devices: DeviceInfo[];
  isLoading: boolean;
  isScanning: boolean;
  error: string | null;

  fetchDevices: () => Promise<void>;
  scanLan: () => Promise<void>;
  connectManual: (ipAddress: string, port?: number) => Promise<DeviceInfo>;
  toggleTrust: (deviceId: string, isTrusted: boolean) => Promise<void>;
  handleDeviceDiscovered: (device: DeviceInfo) => void;
  handleDeviceUpdated: (device: DeviceInfo) => void;
  initListeners: () => () => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  isLoading: false,
  isScanning: false,
  error: null,

  fetchDevices: async () => {
    set({ isLoading: true, error: null });
    try {
      if (window.api?.getDevices) {
        const devices = await window.api.getDevices();
        set({ devices, isLoading: false });
      }
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch devices',
      });
    }
  },

  scanLan: async () => {
    set({ isScanning: true });
    try {
      if (window.api?.refreshDevices) {
        await window.api.refreshDevices();
      }
      setTimeout(() => {
        set({ isScanning: false });
      }, 2000);
    } catch {
      set({ isScanning: false });
    }
  },

  connectManual: async (ipAddress: string, port: number = 45821) => {
    set({ error: null });
    try {
      if (!window.api?.connectManual) {
        throw new Error('Direct connection API not available');
      }
      const device = await window.api.connectManual({ ipAddress, port });
      get().handleDeviceDiscovered(device);
      return device;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect to device';
      set({ error: msg });
      throw err;
    }
  },

  toggleTrust: async (deviceId: string, isTrusted: boolean) => {
    try {
      if (window.api?.toggleDeviceTrust) {
        await window.api.toggleDeviceTrust({ deviceId, isTrusted });
        set((state) => ({
          devices: state.devices.map((d) => (d.id === deviceId ? { ...d, isTrusted } : d)),
        }));
      }
    } catch (err) {
      console.error('Failed to toggle device trust:', err);
    }
  },

  handleDeviceDiscovered: (device: DeviceInfo) => {
    set((state) => {
      const existsIndex = state.devices.findIndex((d) => d.id === device.id);
      if (existsIndex >= 0) {
        const updated = [...state.devices];
        updated[existsIndex] = device;
        return { devices: updated };
      }
      return { devices: [device, ...state.devices] };
    });
  },

  handleDeviceUpdated: (device: DeviceInfo) => {
    set((state) => {
      const existsIndex = state.devices.findIndex((d) => d.id === device.id);
      if (existsIndex >= 0) {
        const updated = [...state.devices];
        updated[existsIndex] = device;
        return { devices: updated };
      }
      return { devices: [device, ...state.devices] };
    });
  },

  initListeners: () => {
    if (!window.api) return () => {};

    const unsubDiscovered = window.api.onDeviceDiscovered?.((device) => {
      get().handleDeviceDiscovered(device);
    });

    const unsubUpdated = window.api.onDeviceUpdated?.((device) => {
      get().handleDeviceUpdated(device);
    });

    // Initial fetch
    get().fetchDevices();

    return () => {
      unsubDiscovered?.();
      unsubUpdated?.();
    };
  },
}));

