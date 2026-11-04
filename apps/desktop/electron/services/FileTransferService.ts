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
  transfersDir: string;
  transferRepo: TransferRepository;
  settingsRepo: SettingsRepository;
  getLanAdapter: () => LanTransportAdapter | null;
}

export class FileTransferService extends EventEmitter {
  private localDeviceId: string;
  private transfersDir: string;
  private transferRepo: TransferRepository;
  private settingsRepo: SettingsRepository;
  private getLanAdapter: () => LanTransportAdapter | null;
  private manager: TransferManager;
  private outgoingFilePaths = new Map<string, string>(); // transferId -> source filePath

  constructor(options: FileTransferServiceOptions) {
    super();
    this.localDeviceId = options.localDeviceId;
    this.transfersDir = options.transfersDir;
    this.transferRepo = options.transferRepo;
    this.settingsRepo = options.settingsRepo;
    this.getLanAdapter = options.getLanAdapter;
    this.manager = new TransferManager();

    if (!fs.existsSync(this.transfersDir)) {
      fs.mkdirSync(this.transfersDir, { recursive: true });
    }

    // Forward manager progress
    this.manager.on('progress', (data) => {
      this.transferRepo.updateTransferProgress(data.transferId, data.bytesTransferred, 'transferring');
      this.emit('progress', data);
    });

    this.manager.on('completed', (id, finalPath) => {
      this.transferRepo.completeTransfer(id, finalPath);
      const updated = this.transferRepo.getTransferById(id);
      if (updated) {
        this.emit('completed', updated);
      }
    });

    this.manager.on('failed', (id, error) => {
      this.transferRepo.failTransfer(id, error);
      this.emit('failed', { transferId: id, error });
    });
  }

  public updateLocalDeviceId(deviceId: string): void {
    this.localDeviceId = deviceId;
  }

  // ==========================================
  // Outgoing File Transfer
  // ==========================================

  public async offerFile(options: {
    conversationId: string;
    peerDeviceId: string;
    filePath: string;
  }): Promise<TransferItem> {
    const adapter = this.getLanAdapter();
    if (!adapter) {
      throw new Error('Networking adapter not available');
    }

    const cleanName = PathTraversalGuard.sanitizeFilename(path.basename(options.filePath));
    const inspect = await FileChunkStreamer.inspectFile(options.filePath);
    const transferId = crypto.randomUUID();
    const tempPath = path.join(this.transfersDir, `${transferId}.part`);

    // Record outgoing transfer in database
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
      status: 'accepted',
    });

    this.outgoingFilePaths.set(transferId, options.filePath);
    this.manager.registerTransfer(transfer, inspect.totalChunks);

    // Send FILE_OFFER packet to peer
    const offerPayload: FileOfferPayload = {
      transferId,
      fileName: cleanName,
      fileSize: inspect.fileSize,
      fileHash: inspect.fileHash,
      mimeType: 'application/octet-stream',
      totalChunks: inspect.totalChunks,
      chunkSize: FileChunkStreamer.DEFAULT_CHUNK_SIZE,
    };

    adapter.sendPayload(options.peerDeviceId, IpmEventType.FILE_OFFER, offerPayload, options.conversationId);
    return transfer;
  }

  public async startSendingChunks(transferId: string): Promise<void> {
    let session = this.manager.getSession(transferId);
    let filePath = this.outgoingFilePaths.get(transferId);
    const adapter = this.getLanAdapter();

    if (!session) {
      const dbTransfer = this.transferRepo.getTransferById(transferId);
      if (dbTransfer) {
        const totalChunks = Math.ceil(dbTransfer.fileSize / FileChunkStreamer.DEFAULT_CHUNK_SIZE);
        this.manager.registerTransfer(dbTransfer, totalChunks);
        session = this.manager.getSession(transferId);
      }
    }

    if (!filePath) {
      const dbTransfer = this.transferRepo.getTransferById(transferId);
      if (dbTransfer?.finalPath && fs.existsSync(dbTransfer.finalPath)) {
        filePath = dbTransfer.finalPath;
        this.outgoingFilePaths.set(transferId, filePath);
      }
    }

    if (!session || !filePath || !adapter) return;

    session.item.status = 'transferring';
    this.transferRepo.setStatus(transferId, 'transferring');

    for (let chunkIdx = 0; chunkIdx < session.totalChunks; chunkIdx++) {
      if (session.isPaused || session.isCancelled) break;

      const chunk = await FileChunkStreamer.readChunk(
        filePath,
        chunkIdx,
        FileChunkStreamer.DEFAULT_CHUNK_SIZE
      );

      const chunkPayload: FileChunkPayload = {
        transferId,
        chunkIndex: chunkIdx,
        chunkHash: chunk.chunkHash,
        data: chunk.data.toString('base64'),
      };

      adapter.sendPayload(
        session.item.remoteDeviceId,
        IpmEventType.FILE_CHUNK,
        chunkPayload,
        session.item.conversationId
      );

      this.manager.recordChunkTransferred(transferId, chunkIdx, chunk.data.length);

      // Yield event loop slightly between chunks to maintain UI responsiveness
      await new Promise((r) => setTimeout(r, 2));
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
    const safeName = PathTraversalGuard.sanitizeFilename(payload.fileName);
    const tempPath = path.join(this.transfersDir, `${payload.transferId}.part`);
    const finalDest = path.join(this.transfersDir, safeName);

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

    // Auto-accept if setting is enabled
    const settings = this.settingsRepo.getSettings();
    if (settings.autoDownloadFiles) {
      await this.acceptTransfer(payload.transferId);
    } else {
      this.emit('offer', transfer);
    }
  }

  public async acceptTransfer(transferId: string, customSavePath?: string): Promise<void> {
    const session = this.manager.getSession(transferId);
    const transfer = this.transferRepo.getTransferById(transferId);
    const adapter = this.getLanAdapter();

    if (!session || !transfer || !adapter) {
      throw new Error(`Transfer ${transferId} not found or network unavailable`);
    }

    if (customSavePath) {
      transfer.finalPath = customSavePath;
    }

    session.item.status = 'transferring';
    this.transferRepo.setStatus(transferId, 'transferring');

    // Send FILE_ACCEPT to sender
    adapter.sendPayload(
      transfer.remoteDeviceId,
      IpmEventType.FILE_ACCEPT,
      { transferId },
      transfer.conversationId
    );
  }

  public rejectTransfer(transferId: string): void {
    const transfer = this.transferRepo.getTransferById(transferId);
    const adapter = this.getLanAdapter();
    if (transfer && adapter) {
      this.transferRepo.setStatus(transferId, 'rejected');
      adapter.sendPayload(
        transfer.remoteDeviceId,
        IpmEventType.FILE_REJECT,
        { transferId },
        transfer.conversationId
      );
    }
    this.manager.cancelTransfer(transferId);
  }

  public async handleFileChunk(payload: FileChunkPayload): Promise<void> {
    const session = this.manager.getSession(payload.transferId);
    if (!session || session.isPaused || session.isCancelled) return;

    const data = Buffer.from(payload.data, 'base64');
    await FileChunkStreamer.writeChunk(
      session.item.tempPath,
      payload.chunkIndex,
      data,
      payload.chunkHash,
      FileChunkStreamer.DEFAULT_CHUNK_SIZE
    );

    this.manager.recordChunkTransferred(payload.transferId, payload.chunkIndex, data.length);

    // Send FILE_CHUNK_ACK
    const adapter = this.getLanAdapter();
    if (adapter) {
      adapter.sendPayload(
        session.item.remoteDeviceId,
        IpmEventType.FILE_CHUNK_ACK,
        { transferId: payload.transferId, chunkIndex: payload.chunkIndex },
        session.item.conversationId
      );
    }

    // Check if all chunks received
    if (session.completedChunks.size === session.totalChunks) {
      const isVerified = await FileChunkStreamer.verifyAssembledFile(
        session.item.tempPath,
        session.item.fileHash
      );

      if (!isVerified) {
        this.manager.failTransfer(
          payload.transferId,
          'File integrity check failed: assembled SHA-256 mismatch'
        );
        return;
      }

      const finalPath = session.item.finalPath || path.join(this.transfersDir, session.item.fileName);
      await FileChunkStreamer.finalizeFile(session.item.tempPath, finalPath);
      this.manager.completeTransfer(payload.transferId, finalPath);

      if (adapter) {
        adapter.sendPayload(
          session.item.remoteDeviceId,
          IpmEventType.FILE_COMPLETE,
          { transferId: payload.transferId },
          session.item.conversationId
        );
      }
    }
  }

  public pauseTransfer(transferId: string): void {
    this.manager.pauseTransfer(transferId);
    this.transferRepo.setStatus(transferId, 'paused');
    const session = this.manager.getSession(transferId);
    const adapter = this.getLanAdapter();
    if (session && adapter) {
      adapter.sendPayload(
        session.item.remoteDeviceId,
        IpmEventType.FILE_PAUSE,
        { transferId },
        session.item.conversationId
      );
    }
  }

  public resumeTransfer(transferId: string): void {
    const canResume = this.manager.resumeTransfer(transferId);
    if (canResume) {
      this.transferRepo.setStatus(transferId, 'transferring');
      const session = this.manager.getSession(transferId);
      const adapter = this.getLanAdapter();
      if (session && adapter) {
        adapter.sendPayload(
          session.item.remoteDeviceId,
          IpmEventType.FILE_RESUME,
          { transferId },
          session.item.conversationId
        );
      }
    }
  }

  public cancelTransfer(transferId: string): void {
    const session = this.manager.getSession(transferId);
    const adapter = this.getLanAdapter();
    if (session && adapter) {
      adapter.sendPayload(
        session.item.remoteDeviceId,
        IpmEventType.FILE_CANCEL,
        { transferId },
        session.item.conversationId
      );
    }
    this.manager.cancelTransfer(transferId);
    this.transferRepo.cancelTransfer(transferId);

    // Clean up temporary file
    if (session && fs.existsSync(session.item.tempPath)) {
      try {
        fs.unlinkSync(session.item.tempPath);
      } catch {
        // ignore
      }
    }
  }

  public async handleIncomingEnvelope(envelope: NetworkEnvelope): Promise<void> {
    switch (envelope.type) {
      case IpmEventType.FILE_OFFER:
        await this.handleFileOffer(envelope.senderId, envelope.conversationId, envelope.payload as FileOfferPayload);
        break;
      case IpmEventType.FILE_ACCEPT: {
        const { transferId } = envelope.payload as { transferId: string };
        await this.startSendingChunks(transferId);
        break;
      }
      case IpmEventType.FILE_REJECT: {
        const { transferId } = envelope.payload as { transferId: string };
        this.manager.cancelTransfer(transferId);
        this.transferRepo.setStatus(transferId, 'rejected');
        break;
      }
      case IpmEventType.FILE_CHUNK:
        await this.handleFileChunk(envelope.payload as FileChunkPayload);
        break;
      case IpmEventType.FILE_PAUSE: {
        const { transferId } = envelope.payload as { transferId: string };
        this.manager.pauseTransfer(transferId);
        this.transferRepo.setStatus(transferId, 'paused');
        break;
      }
      case IpmEventType.FILE_RESUME: {
        const { transferId } = envelope.payload as { transferId: string };
        this.manager.resumeTransfer(transferId);
        this.transferRepo.setStatus(transferId, 'transferring');
        break;
      }
      case IpmEventType.FILE_CANCEL: {
        const { transferId } = envelope.payload as { transferId: string };
        this.manager.cancelTransfer(transferId);
        this.transferRepo.cancelTransfer(transferId);
        break;
      }
      case IpmEventType.FILE_COMPLETE: {
        const { transferId } = envelope.payload as { transferId: string };
        const session = this.manager.getSession(transferId);
        if (session) {
          this.manager.completeTransfer(transferId, session.item.finalPath || '');
          this.transferRepo.completeTransfer(transferId, session.item.finalPath || '');
        }
        break;
      }
    }
  }

  public destroy(): void {
    this.manager.destroy();
    this.outgoingFilePaths.clear();
    this.removeAllListeners();
  }
}
