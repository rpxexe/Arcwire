import EventEmitter from 'node:events';
import {
  FolderBrowser,
  FolderSecurityManager,
  PathTraversalGuard,
} from '@ipm/file-sharing';
import type { SharedFolderRepository } from '@ipm/database';
import type { LanTransportAdapter } from '@ipm/networking';
import {
  IpmEventType,
  FolderListPayload,
  FolderListResponsePayload,
  FolderModifyPayload,
  FolderOperationResponsePayload,
  NetworkEnvelope,
} from '@ipm/shared';

export interface FolderSharingServiceOptions {
  localDeviceId: string;
  folderRepo: SharedFolderRepository;
  getLanAdapter: () => LanTransportAdapter | null;
}

export class FolderSharingService extends EventEmitter {
  private localDeviceId: string;
  private folderRepo: SharedFolderRepository;
  private getLanAdapter: () => LanTransportAdapter | null;
  private pendingListRequests = new Map<string, (response: FolderListResponsePayload) => void>();
  private pendingModifyRequests = new Map<string, (response: FolderOperationResponsePayload) => void>();

  constructor(options: FolderSharingServiceOptions) {
    super();
    this.localDeviceId = options.localDeviceId;
    this.folderRepo = options.folderRepo;
    this.getLanAdapter = options.getLanAdapter;
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  // ==========================================
  // Incoming Request Handlers (Server-side)
  // ==========================================

  public async handleFolderListRequest(
    senderDeviceId: string,
    conversationId: string,
    payload: FolderListPayload
  ): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) return;

    const folder = this.folderRepo.getSharedFolderById(payload.folderId);
    if (!folder || !folder.isEnabled) {
      adapter.sendPayload(
        senderDeviceId,
        IpmEventType.FOLDER_LIST_RESPONSE,
        {
          folderId: payload.folderId,
          subPath: payload.subPath,
          items: [],
          permission: 'read_only',
          error: 'Shared folder not found or currently disabled',
        },
        conversationId
      );
      return;
    }

    const permission = this.folderRepo.getEffectivePermission(folder.id, senderDeviceId);

    try {
      const items = await FolderBrowser.listDirectory(folder.localPath, payload.subPath);
      adapter.sendPayload(
        senderDeviceId,
        IpmEventType.FOLDER_LIST_RESPONSE,
        {
          folderId: payload.folderId,
          subPath: payload.subPath,
          items,
          permission,
        },
        conversationId
      );
    } catch (err: any) {
      adapter.sendPayload(
        senderDeviceId,
        IpmEventType.FOLDER_LIST_RESPONSE,
        {
          folderId: payload.folderId,
          subPath: payload.subPath,
          items: [],
          permission,
          error: err.message || 'Failed to list directory contents',
        },
        conversationId
      );
    }
  }

  public async handleFolderModifyRequest(
    senderDeviceId: string,
    conversationId: string,
    payload: FolderModifyPayload
  ): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) return;

    const folder = this.folderRepo.getSharedFolderById(payload.folderId);
    if (!folder || !folder.isEnabled) {
      adapter.sendPayload(
        senderDeviceId,
        IpmEventType.FOLDER_OPERATION_RESPONSE,
        {
          folderId: payload.folderId,
          action: payload.action,
          targetPath: payload.targetPath,
          success: false,
          error: 'Shared folder not found or disabled',
        },
        conversationId
      );
      return;
    }

    const permission = this.folderRepo.getEffectivePermission(folder.id, senderDeviceId);

    try {
      if (payload.action === 'create_dir') {
        FolderSecurityManager.assertPermission('create_dir', permission);
        await FolderBrowser.createDirectory(folder.localPath, payload.targetPath);
      } else if (payload.action === 'rename') {
        FolderSecurityManager.assertPermission('rename', permission);
        if (!payload.newPath) throw new Error('New path required for rename operation');
        await FolderBrowser.renameItem(folder.localPath, payload.targetPath, payload.newPath);
      } else if (payload.action === 'delete') {
        FolderSecurityManager.assertPermission('delete', permission);
        await FolderBrowser.deleteItem(folder.localPath, payload.targetPath);
      }

      adapter.sendPayload(
        senderDeviceId,
        IpmEventType.FOLDER_OPERATION_RESPONSE,
        {
          folderId: payload.folderId,
          action: payload.action,
          targetPath: payload.targetPath,
          success: true,
        },
        conversationId
      );
    } catch (err: any) {
      adapter.sendPayload(
        senderDeviceId,
        IpmEventType.FOLDER_OPERATION_RESPONSE,
        {
          folderId: payload.folderId,
          action: payload.action,
          targetPath: payload.targetPath,
          success: false,
          error: err.message || 'Operation failed',
        },
        conversationId
      );
    }
  }

  // ==========================================
  // Outgoing Client Requests (Client-side)
  // ==========================================

  public async browseRemoteFolder(
    peerDeviceId: string,
    folderId: string,
    subPath: string = ''
  ): Promise<FolderListResponsePayload> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('Networking adapter not available');

    return new Promise((resolve, reject) => {
      const key = `${peerDeviceId}_${folderId}_${subPath}`;
      const timeout = setTimeout(() => {
        this.pendingListRequests.delete(key);
        reject(new Error('Timed out waiting for remote folder listing'));
      }, 10000);

      this.pendingListRequests.set(key, (res) => {
        clearTimeout(timeout);
        this.pendingListRequests.delete(key);
        if (res.error) {
          reject(new Error(res.error));
        } else {
          resolve(res);
        }
      });

      adapter.sendPayload(peerDeviceId, IpmEventType.FOLDER_LIST, { folderId, subPath });
    });
  }

  public handleFolderListResponse(senderDeviceId: string, payload: FolderListResponsePayload): void {
    const key = `${senderDeviceId}_${payload.folderId}_${payload.subPath}`;
    const cb = this.pendingListRequests.get(key);
    if (cb) {
      cb(payload);
    }
  }

  public async executeRemoteOperation(
    peerDeviceId: string,
    folderId: string,
    action: 'create_dir' | 'rename' | 'delete',
    targetPath: string,
    newPath?: string
  ): Promise<FolderOperationResponsePayload> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('Networking adapter not available');

    return new Promise((resolve, reject) => {
      const key = `${peerDeviceId}_${folderId}_${action}_${targetPath}`;
      const timeout = setTimeout(() => {
        this.pendingModifyRequests.delete(key);
        reject(new Error('Timed out waiting for remote operation response'));
      }, 10000);

      this.pendingModifyRequests.set(key, (res) => {
        clearTimeout(timeout);
        this.pendingModifyRequests.delete(key);
        if (!res.success) {
          reject(new Error(res.error || 'Operation failed on remote peer'));
        } else {
          resolve(res);
        }
      });

      adapter.sendPayload(peerDeviceId, IpmEventType.FOLDER_MODIFY, {
        folderId,
        action,
        targetPath,
        newPath,
      });
    });
  }

  public handleFolderOperationResponse(senderDeviceId: string, payload: FolderOperationResponsePayload): void {
    const key = `${senderDeviceId}_${payload.folderId}_${payload.action}_${payload.targetPath}`;
    const cb = this.pendingModifyRequests.get(key);
    if (cb) {
      cb(payload);
    }
  }

  public async handleIncomingEnvelope(envelope: NetworkEnvelope): Promise<void> {
    switch (envelope.type) {
      case IpmEventType.FOLDER_LIST:
        await this.handleFolderListRequest(
          envelope.senderId,
          envelope.conversationId,
          envelope.payload as FolderListPayload
        );
        break;

      case IpmEventType.FOLDER_LIST_RESPONSE:
        this.handleFolderListResponse(
          envelope.senderId,
          envelope.payload as FolderListResponsePayload
        );
        break;

      case IpmEventType.FOLDER_MODIFY:
        await this.handleFolderModifyRequest(
          envelope.senderId,
          envelope.conversationId,
          envelope.payload as FolderModifyPayload
        );
        break;

      case IpmEventType.FOLDER_OPERATION_RESPONSE:
        this.handleFolderOperationResponse(
          envelope.senderId,
          envelope.payload as FolderOperationResponsePayload
        );
        break;

      default:
        break;
    }
  }

  public destroy(): void {
    this.pendingListRequests.clear();
    this.pendingModifyRequests.clear();
    this.removeAllListeners();
  }
}
