import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import EventEmitter from 'node:events';
import {
  FileChunkStreamer,
  TransferManager,
  PathTraversalGuard,
} from '@ipm/file-sharing';
import type { TransferRepository, SettingsRepository } from '@ipm/database';
import type { LanTransportAdapter } from '@ipm/networking';
import {
  IpmEventType,
  TransferItem,
  TransferStatus,
  FileOfferPayload,
  FileChunkPayload,
  NetworkEnvelope,
} from '@ipm/shared';

export interface FileTransferServiceOptions {
  localDeviceId: string;
  /** Staging directory for in-flight `.part` files */
  transfersDir: string;
  /** Final destination for received files (e.g. %USERPROFILE%/Downloads/Arcwire) */
  downloadsDir: string;
  transferRepo: TransferRepository;
  settingsRepo: SettingsRepository;
  getLanAdapter: () => LanTransportAdapter | null;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
};

export function guessMimeType(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Orchestrates chunked LAN file transfers.
 *
 * Events: `offer` (TransferItem), `progress`, `completed` (TransferItem),
 * `failed` ({transferId, error}), `updated` (TransferItem — any status change).
 */
export class FileTransferService extends EventEmitter {
  private localDeviceId: string;
  private transfersDir: string;
  private downloadsDir: string;
  private transferRepo: TransferRepository;
  private settingsRepo: SettingsRepository;
  private getLanAdapter: () => LanTransportAdapter | null;
  private manager: TransferManager;
  private outgoingFilePaths = new Map<string, string>(); // transferId -> source filePath
  /** Per-transfer promise chain: incoming chunks are written strictly one at a time. */
  private chunkQueues = new Map<string, Promise<void>>();

  constructor(options: FileTransferServiceOptions) {
    super();
    this.localDeviceId = options.localDeviceId;
    this.transfersDir = options.transfersDir;
    this.downloadsDir = options.downloadsDir;
    this.transferRepo = options.transferRepo;
    this.settingsRepo = options.settingsRepo;
    this.getLanAdapter = options.getLanAdapter;
    this.manager = new TransferManager();

    for (const dir of [this.transfersDir, this.downloadsDir]) {
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        console.error('[FileTransferService] Could not create directory', dir, err);
      }
    }

    this.manager.on('progress', (data) => {
      this.transferRepo.updateTransferProgress(data.transferId, data.bytesTransferred, 'transferring');
      this.emit('progress', data);
    });

    this.manager.on('completed', (id: string, finalPath: string) => {
      this.transferRepo.completeTransfer(id, finalPath);
      this.chunkQueues.delete(id);
      const updated = this.transferRepo.getTransferById(id);
      if (updated) {
        this.emit('completed', updated);
        this.emit('updated', updated);
      }
    });

    this.manager.on('failed', (id: string, error: string) => {
      this.transferRepo.failTransfer(id, error);
      this.chunkQueues.delete(id);
      this.emit('failed', { transferId: id, error });
      this.emitUpdated(id);
    });

    this.manager.on('dequeued', (id: string) => {
      const session = this.manager.getSession(id);
      if (session?.item.direction === 'outgoing') {
        void this.startSendingChunks(id);
      }
    });
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  public getDownloadsDir(): string {
    return this.downloadsDir;
  }

  private emitUpdated(transferId: string): void {
    const item = this.transferRepo.getTransferById(transferId);
    if (item) this.emit('updated', item);
  }

  private setStatus(transferId: string, status: TransferStatus): void {
    this.transferRepo.setStatus(transferId, status);
    this.emitUpdated(transferId);
  }

  private async send(peerId: string, type: IpmEventType, payload: Record<string, any>, conversationId: string): Promise<void> {
    const adapter = this.getLanAdapter();
    if (!adapter) throw new Error('Networking adapter not available');
    await adapter.sendPayload(peerId, type, payload, conversationId);
  }

  /** Fire-and-forget control message; failures are logged, never thrown. */
  private sendQuiet(peerId: string, type: IpmEventType, payload: Record<string, any>, conversationId: string): void {
    this.send(peerId, type, payload, conversationId).catch((err) => {
      console.warn(`[FileTransferService] Failed to send ${type} to ${peerId}:`, err?.message ?? err);
    });
  }

  // ==========================================
  // Outgoing File Transfer
  // ==========================================

  public async offerFile(options: {
    conversationId: string;
    peerDeviceId: string;
    filePath: string;
    fileName?: string;
  }): Promise<TransferItem> {
    if (!this.getLanAdapter()) {
      throw new Error('Networking is not ready yet. Complete onboarding and try again.');
    }
    if (!fs.existsSync(options.filePath)) {
      throw new Error(`File not found: ${options.filePath}`);
    }
    const stat = fs.statSync(options.filePath);
    if (stat.isDirectory()) {
      throw new Error('Folders cannot be sent directly. Zip the folder or use Shared Folders.');
    }

    const cleanName = PathTraversalGuard.sanitizeFilename(options.fileName || path.basename(options.filePath));
    const inspect = await FileChunkStreamer.inspectFile(options.filePath);
    const transferId = crypto.randomUUID();
    const tempPath = path.join(this.transfersDir, `${transferId}.part`);

    const transfer = this.transferRepo.createTransfer({
      id: transferId,
      conversationId: options.conversationId,
      direction: 'outgoing',
      remoteDeviceId: options.peerDeviceId,
      fileName: cleanName,
      fileSize: inspect.fileSize,
      fileHash: inspect.fileHash,
      tempPath,
      finalPath: options.filePath,
      status: 'offered',
    });

    this.outgoingFilePaths.set(transferId, options.filePath);
    this.manager.registerTransfer(transfer, inspect.totalChunks);

    const offerPayload: FileOfferPayload = {
      transferId,
      fileName: cleanName,
      fileSize: inspect.fileSize,
      fileHash: inspect.fileHash,
      mimeType: guessMimeType(cleanName),
      totalChunks: inspect.totalChunks,
      chunkSize: FileChunkStreamer.DEFAULT_CHUNK_SIZE,
    };

    try {
      await this.send(options.peerDeviceId, IpmEventType.FILE_OFFER, offerPayload, options.conversationId);
    } catch (err: any) {
      const reason = `Peer unreachable: ${err?.message ?? 'connection failed'}`;
      this.manager.failTransfer(transferId, reason);
      return this.transferRepo.getTransferById(transferId) ?? transfer;
    }

    this.emit('updated', transfer);
    return transfer;
  }

  public async startSendingChunks(transferId: string): Promise<void> {
    let session = this.manager.getSession(transferId);
    let filePath = this.outgoingFilePaths.get(transferId);

    if (!session) {
      const dbTransfer = this.transferRepo.getTransferById(transferId);
      if (dbTransfer) {
        const totalChunks = Math.max(1, Math.ceil(dbTransfer.fileSize / FileChunkStreamer.DEFAULT_CHUNK_SIZE));
        session = this.manager.registerTransfer(dbTransfer, totalChunks);
      }
    }

    if (!filePath) {
      const dbTransfer = this.transferRepo.getTransferById(transferId);
      if (dbTransfer?.finalPath && fs.existsSync(dbTransfer.finalPath)) {
        filePath = dbTransfer.finalPath;
        this.outgoingFilePaths.set(transferId, filePath);
      }
    }

    if (!session || !filePath) {
      if (session) this.manager.failTransfer(transferId, 'Source file is no longer available');
      return;
    }
    if (session.isSending) return; // already streaming
    session.isSending = true;
    session.isPaused = false;
    session.item.status = 'transferring';
    this.setStatus(transferId, 'transferring');

    try {
      let chunkIdx = this.manager.getNextMissingChunkIndex(transferId);
      while (chunkIdx !== null) {
        const live = this.manager.getSession(transferId);
        if (!live || live.isPaused || live.isCancelled) break;

        const chunk = await FileChunkStreamer.readChunk(filePath, chunkIdx, FileChunkStreamer.DEFAULT_CHUNK_SIZE);
        const chunkPayload: FileChunkPayload = {
          transferId,
          chunkIndex: chunkIdx,
          chunkHash: chunk.chunkHash,
          data: chunk.data.toString('base64'),
        };

        await this.send(live.item.remoteDeviceId, IpmEventType.FILE_CHUNK, chunkPayload, live.item.conversationId);
        this.manager.recordChunkTransferred(transferId, chunkIdx, chunk.data.length);
        chunkIdx = this.manager.getNextMissingChunkIndex(transferId);

        // Yield to keep the main process responsive between 256 KB frames
        await new Promise((r) => setImmediate(r));
      }
    } catch (err: any) {
      this.manager.failTransfer(transferId, `Transfer interrupted: ${err?.message ?? err}`);
    } finally {
      const live = this.manager.getSession(transferId);
      if (live) live.isSending = false;
    }
  }

  // ==========================================
  // Incoming File Transfer
  // ==========================================

  public async handleFileOffer(
    senderDeviceId: string,
    conversationId: string,
    payload: FileOfferPayload
  ): Promise<void> {
    if (this.transferRepo.getTransferById(payload.transferId)) return; // duplicate offer

    const safeName = PathTraversalGuard.sanitizeFilename(payload.fileName);
    const tempPath = path.join(this.transfersDir, `${payload.transferId}.part`);
    const finalDest = path.join(this.downloadsDir, safeName);

    const transfer = this.transferRepo.createTransfer({
      id: payload.transferId,
      conversationId,
      direction: 'incoming',
      remoteDeviceId: senderDeviceId,
      fileName: safeName,
      fileSize: payload.fileSize,
      fileHash: payload.fileHash,
      tempPath,
      finalPath: finalDest,
      status: 'offered',
    });

    this.manager.registerTransfer(transfer, payload.totalChunks);

    const settings = this.settingsRepo.getSettings();
    this.emit('offer', transfer);
    if (settings.autoDownloadFiles) {
      await this.acceptTransfer(payload.transferId);
    }
  }

  public async acceptTransfer(transferId: string, customSavePath?: string): Promise<void> {
    const transfer = this.transferRepo.getTransferById(transferId);
    if (!transfer) throw new Error(`Transfer ${transferId} not found`);

    let session = this.manager.getSession(transferId);
    if (!session) {
      const totalChunks = Math.max(1, Math.ceil(transfer.fileSize / FileChunkStreamer.DEFAULT_CHUNK_SIZE));
      session = this.manager.registerTransfer(transfer, totalChunks);
    }

    if (customSavePath) {
      session.item.finalPath = customSavePath;
    }

    session.item.status = 'transferring';
    this.setStatus(transferId, 'accepted');

    // Zero-byte files still receive one empty chunk; completion happens in processChunk.
    await this.send(transfer.remoteDeviceId, IpmEventType.FILE_ACCEPT, { transferId }, transfer.conversationId);
  }

  public rejectTransfer(transferId: string): void {
    const transfer = this.transferRepo.getTransferById(transferId);
    if (transfer) {
      this.setStatus(transferId, 'rejected');
      this.sendQuiet(transfer.remoteDeviceId, IpmEventType.FILE_REJECT, { transferId }, transfer.conversationId);
    }
    this.manager.cancelTransfer(transferId);
  }

  private enqueueChunk(transferId: string, task: () => Promise<void>): Promise<void> {
    const prev = this.chunkQueues.get(transferId) ?? Promise.resolve();
    const next = prev.then(task, task);
    this.chunkQueues.set(transferId, next.catch(() => {}));
    return next;
  }

  public async handleFileChunk(payload: FileChunkPayload): Promise<void> {
    return this.enqueueChunk(payload.transferId, () => this.processChunk(payload));
  }

  private async processChunk(payload: FileChunkPayload): Promise<void> {
    const session = this.manager.getSession(payload.transferId);
    if (!session || session.isCancelled) return;

    const data = Buffer.from(payload.data, 'base64');
    try {
      await FileChunkStreamer.writeChunk(
        session.item.tempPath,
        payload.chunkIndex,
        data,
        payload.chunkHash,
        FileChunkStreamer.DEFAULT_CHUNK_SIZE
      );
    } catch (err: any) {
      this.manager.failTransfer(payload.transferId, err?.message ?? 'Chunk write failed');
      this.sendQuiet(session.item.remoteDeviceId, IpmEventType.FILE_CANCEL, { transferId: payload.transferId }, session.item.conversationId);
      return;
    }

    this.manager.recordChunkTransferred(payload.transferId, payload.chunkIndex, data.length);

    if (session.completedChunks.size < session.totalChunks) return;

    const isVerified = await FileChunkStreamer.verifyAssembledFile(session.item.tempPath, session.item.fileHash);
    if (!isVerified) {
      this.manager.failTransfer(payload.transferId, 'File integrity check failed: assembled SHA-256 mismatch');
      this.sendQuiet(session.item.remoteDeviceId, IpmEventType.FILE_CANCEL, { transferId: payload.transferId }, session.item.conversationId);
      return;
    }

    const requestedPath = session.item.finalPath || path.join(this.downloadsDir, session.item.fileName);
    const finalPath = await FileChunkStreamer.finalizeFile(session.item.tempPath, requestedPath);
    const remoteDeviceId = session.item.remoteDeviceId;
    const conversationId = session.item.conversationId;
    this.manager.completeTransfer(payload.transferId, finalPath);

    this.sendQuiet(remoteDeviceId, IpmEventType.FILE_COMPLETE, { transferId: payload.transferId }, conversationId);
  }

  public pauseTransfer(transferId: string): void {
    const session = this.manager.getSession(transferId);
    this.manager.pauseTransfer(transferId);
    this.setStatus(transferId, 'paused');
    if (session) {
      this.sendQuiet(session.item.remoteDeviceId, IpmEventType.FILE_PAUSE, { transferId }, session.item.conversationId);
    }
  }

  public resumeTransfer(transferId: string): void {
    const session = this.manager.getSession(transferId);
    if (!session) return;
    const canResume = this.manager.resumeTransfer(transferId);
    if (!canResume) {
      this.setStatus(transferId, 'queued');
      return;
    }
    this.setStatus(transferId, 'transferring');
    this.sendQuiet(session.item.remoteDeviceId, IpmEventType.FILE_RESUME, { transferId }, session.item.conversationId);
    if (session.item.direction === 'outgoing') {
      void this.startSendingChunks(transferId);
    }
  }

  public cancelTransfer(transferId: string): void {
    const session = this.manager.getSession(transferId);
    const transfer = session?.item ?? this.transferRepo.getTransferById(transferId);
    if (transfer) {
      this.sendQuiet(transfer.remoteDeviceId, IpmEventType.FILE_CANCEL, { transferId }, transfer.conversationId);
    }
    this.manager.cancelTransfer(transferId);
    this.transferRepo.cancelTransfer(transferId);
    this.emitUpdated(transferId);
    this.cleanupTemp(transfer?.direction === 'incoming' ? transfer.tempPath : undefined);
  }

  private cleanupTemp(tempPath?: string): void {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }
  }

  public async handleIncomingEnvelope(envelope: NetworkEnvelope): Promise<void> {
    const transferId = (envelope.payload as { transferId?: string })?.transferId;
    // Only the peer the transfer belongs to may control it.
    if (transferId && envelope.type !== IpmEventType.FILE_OFFER) {
      const known = this.transferRepo.getTransferById(transferId);
      if (known && known.remoteDeviceId !== envelope.senderId) return;
    }

    switch (envelope.type) {
      case IpmEventType.FILE_OFFER:
        await this.handleFileOffer(envelope.senderId, envelope.conversationId, envelope.payload as FileOfferPayload);
        break;
      case IpmEventType.FILE_ACCEPT:
        if (transferId) await this.startSendingChunks(transferId);
        break;
      case IpmEventType.FILE_REJECT:
        if (transferId) {
          this.manager.cancelTransfer(transferId);
          this.setStatus(transferId, 'rejected');
        }
        break;
      case IpmEventType.FILE_CHUNK:
        await this.handleFileChunk(envelope.payload as FileChunkPayload);
        break;
      case IpmEventType.FILE_PAUSE:
        if (transferId) {
          this.manager.pauseTransfer(transferId);
          this.setStatus(transferId, 'paused');
        }
        break;
      case IpmEventType.FILE_RESUME:
        if (transferId) {
          const session = this.manager.getSession(transferId);
          if (this.manager.resumeTransfer(transferId)) {
            this.setStatus(transferId, 'transferring');
            if (session?.item.direction === 'outgoing') void this.startSendingChunks(transferId);
          }
        }
        break;
      case IpmEventType.FILE_CANCEL:
        if (transferId) {
          const session = this.manager.getSession(transferId);
          this.manager.cancelTransfer(transferId);
          this.transferRepo.cancelTransfer(transferId);
          this.emitUpdated(transferId);
          if (session?.item.direction === 'incoming') this.cleanupTemp(session.item.tempPath);
        }
        break;
      case IpmEventType.FILE_COMPLETE:
        if (transferId) {
          const session = this.manager.getSession(transferId);
          const dbItem = this.transferRepo.getTransferById(transferId);
          const finalPath = session?.item.finalPath || dbItem?.finalPath || '';
          if (session) {
            this.manager.completeTransfer(transferId, finalPath);
          } else if (dbItem && dbItem.status !== 'completed') {
            this.transferRepo.completeTransfer(transferId, finalPath);
            this.emitUpdated(transferId);
          }
        }
        break;
      default:
        break;
    }
  }

  public destroy(): void {
    this.manager.destroy();
    this.outgoingFilePaths.clear();
    this.chunkQueues.clear();
    this.removeAllListeners();
  }
}
