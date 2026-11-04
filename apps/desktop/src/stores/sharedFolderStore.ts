import { create } from 'zustand';
import {
  SharedFolderItem,
  CreateSharedFolderInput,
  UpdateSharedFolderInput,
  RemoteFolderItem,
  FolderPermission,
  DeviceInfo,
} from '@ipm/shared';

interface SharedFolderState {
  sharedFolders: SharedFolderItem[];
  remoteBrowseItems: RemoteFolderItem[];
  remoteCurrentPath: string;
  remoteEffectivePermission: FolderPermission;
  activeRemoteDeviceId: string | null;
  activeRemoteFolderId: string | null;
  pathBreadcrumbs: string[];
  isLoading: boolean;
  error: string | null;

  fetchSharedFolders: () => Promise<void>;
  createSharedFolder: (input: CreateSharedFolderInput) => Promise<SharedFolderItem | null>;
  selectDirectory: () => Promise<string | null>;
  updateSharedFolder: (input: UpdateSharedFolderInput) => Promise<void>;
  deleteSharedFolder: (folderId: string) => Promise<void>;

  browseRemote: (peerDeviceId: string, folderId: string, subPath?: string) => Promise<void>;
  navigateRemoteBreadcrumb: (index: number) => Promise<void>;
  createRemoteDir: (name: string) => Promise<void>;
  deleteRemoteItem: (itemPath: string) => Promise<void>;
  renameRemoteItem: (itemPath: string, newName: string) => Promise<void>;
}

export const useSharedFolderStore = create<SharedFolderState>((set, get) => ({
  sharedFolders: [],
  remoteBrowseItems: [],
  remoteCurrentPath: '',
  remoteEffectivePermission: 'read_only',
  activeRemoteDeviceId: null,
  activeRemoteFolderId: null,
  pathBreadcrumbs: [],
  isLoading: false,
  error: null,

  fetchSharedFolders: async () => {
    set({ isLoading: true, error: null });
    try {
      if (window.api?.getSharedFolders) {
        const folders = await window.api.getSharedFolders();
        set({ sharedFolders: folders, isLoading: false });
      }
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to fetch shared folders' });
    }
  },

  createSharedFolder: async (input: CreateSharedFolderInput) => {
    set({ error: null });
    try {
      if (!window.api?.createSharedFolder) throw new Error('Create shared folder API not available');
      const folder = await window.api.createSharedFolder(input);
      set((state) => ({ sharedFolders: [folder, ...state.sharedFolders] }));
      return folder;
    } catch (err: any) {
      set({ error: err.message || 'Failed to create shared folder' });
      return null;
    }
  },

  selectDirectory: async () => {
    if (!window.api?.selectDirectory) return null;
    return window.api.selectDirectory();
  },

  updateSharedFolder: async (input: UpdateSharedFolderInput) => {
    try {
      if (!window.api?.updateSharedFolder) throw new Error('Update shared folder API not available');
      const updated = await window.api.updateSharedFolder(input);
      set((state) => ({
        sharedFolders: state.sharedFolders.map((f) => (f.id === updated.id ? updated : f)),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to update shared folder' });
    }
  },

  deleteSharedFolder: async (folderId: string) => {
    try {
      if (!window.api?.deleteSharedFolder) throw new Error('Delete shared folder API not available');
      await window.api.deleteSharedFolder(folderId);
      set((state) => ({
        sharedFolders: state.sharedFolders.filter((f) => f.id !== folderId),
      }));
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete shared folder' });
    }
  },

  browseRemote: async (peerDeviceId: string, folderId: string, subPath: string = '') => {
    set({ isLoading: true, error: null });
    try {
      if (!window.api?.browseRemoteFolder) throw new Error('Browse remote folder API not available');
      const response = await window.api.browseRemoteFolder({
        peerDeviceId,
        folderId,
        subPath,
      });

      const crumbs = subPath ? subPath.split(/[/\\]/).filter(Boolean) : [];

      set({
        isLoading: false,
        activeRemoteDeviceId: peerDeviceId,
        activeRemoteFolderId: folderId,
        remoteCurrentPath: subPath,
        remoteBrowseItems: response.items,
        remoteEffectivePermission: response.permission,
        pathBreadcrumbs: crumbs,
      });
    } catch (err: any) {
      set({ isLoading: false, error: err.message || 'Failed to browse remote folder' });
    }
  },

  navigateRemoteBreadcrumb: async (index: number) => {
    const { activeRemoteDeviceId, activeRemoteFolderId, pathBreadcrumbs } = get();
    if (!activeRemoteDeviceId || !activeRemoteFolderId) return;

    if (index === -1) {
      // Root
      await get().browseRemote(activeRemoteDeviceId, activeRemoteFolderId, '');
    } else {
      const targetSubPath = pathBreadcrumbs.slice(0, index + 1).join('/');
      await get().browseRemote(activeRemoteDeviceId, activeRemoteFolderId, targetSubPath);
    }
  },

  createRemoteDir: async (name: string) => {
    const { activeRemoteDeviceId, activeRemoteFolderId, remoteCurrentPath } = get();
    if (!activeRemoteDeviceId || !activeRemoteFolderId) return;

    const targetPath = remoteCurrentPath ? `${remoteCurrentPath}/${name}` : name;
    try {
      await window.api.executeRemoteFolderOp({
        peerDeviceId: activeRemoteDeviceId,
        folderId: activeRemoteFolderId,
        action: 'create_dir',
        targetPath,
      });
      // Refresh current directory
      await get().browseRemote(activeRemoteDeviceId, activeRemoteFolderId, remoteCurrentPath);
    } catch (err: any) {
      set({ error: err.message || 'Failed to create directory' });
    }
  },

  deleteRemoteItem: async (itemPath: string) => {
    const { activeRemoteDeviceId, activeRemoteFolderId, remoteCurrentPath } = get();
    if (!activeRemoteDeviceId || !activeRemoteFolderId) return;

    try {
      await window.api.executeRemoteFolderOp({
        peerDeviceId: activeRemoteDeviceId,
        folderId: activeRemoteFolderId,
        action: 'delete',
        targetPath: itemPath,
      });
      // Refresh current directory
      await get().browseRemote(activeRemoteDeviceId, activeRemoteFolderId, remoteCurrentPath);
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete remote item' });
    }
  },

  renameRemoteItem: async (itemPath: string, newName: string) => {
    const { activeRemoteDeviceId, activeRemoteFolderId, remoteCurrentPath } = get();
    if (!activeRemoteDeviceId || !activeRemoteFolderId) return;

    const parent = remoteCurrentPath;
    const newPath = parent ? `${parent}/${newName}` : newName;

    try {
      await window.api.executeRemoteFolderOp({
        peerDeviceId: activeRemoteDeviceId,
        folderId: activeRemoteFolderId,
        action: 'rename',
        targetPath: itemPath,
        newPath,
      });
      // Refresh current directory
      await get().browseRemote(activeRemoteDeviceId, activeRemoteFolderId, remoteCurrentPath);
    } catch (err: any) {
      set({ error: err.message || 'Failed to rename remote item' });
    }
  },
}));

