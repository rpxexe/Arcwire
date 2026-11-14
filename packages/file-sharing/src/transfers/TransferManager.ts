import { EventEmitter } from 'node:events';
import { TransferItem, TransferStatus, STREAM_LIMITS } from '@ipm/shared';

export interface TransferSession {
  item: TransferItem;
  totalChunks: number;
  completedChunks: Set<number>;
  isPaused: boolean;
  isCancelled: boolean;
  isSending: boolean;
  startedAt: number;
  lastProgressEmitAt: number;
  speedSampleAt: number;
  speedSampleBytes: number;
}

export interface TransferProgressData {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
  speed: number;
  remainingTime: number;
  status: TransferStatus;
}

const PROGRESS_THROTTLE_MS = 150;

/**
 * In-memory registry of in-flight transfers.
 * Tracks chunk completion, computes throughput metrics and enforces the
 * maximum number of concurrently active transfers (queued transfers are
 * promoted automatically when a slot frees up).
 */
export class TransferManager extends EventEmitter {
  private sessions = new Map<string, TransferSession>();
  private active = new Set<string>();
  private queue: string[] = [];
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number = STREAM_LIMITS.MAX_CONCURRENT_TRANSFERS ?? 3) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  public registerTransfer(item: TransferItem, totalChunks: number): TransferSession {
    const existing = this.sessions.get(item.id);
    if (existing) {
      existing.item = { ...existing.item, ...item };
      existing.totalChunks = totalChunks;
      return existing;
    }

    const now = Date.now();
    const session: TransferSession = {
      item: { ...item, bytesTransferred: item.bytesTransferred ?? 0 },
      totalChunks: Math.max(1, totalChunks),
      completedChunks: new Set<number>(),
      isPaused: false,
      isCancelled: false,
      isSending: false,
      startedAt: now,
      lastProgressEmitAt: 0,
      speedSampleAt: now,
      speedSampleBytes: 0,
    };

    this.sessions.set(item.id, session);
    if (this.canStartTransfer()) {
      this.active.add(item.id);
    }
    return session;
  }

  public getSession(transferId: string): TransferSession | undefined {
    return this.sessions.get(transferId);
  }

  public getActiveCount(): number {
    return this.active.size;
  }

  public canStartTransfer(): boolean {
    return this.active.size < this.maxConcurrent;
  }

  public recordChunkTransferred(transferId: string, chunkIndex: number, bytes: number): void {
    const session = this.sessions.get(transferId);
    if (!session || session.isCancelled) return;
    if (session.completedChunks.has(chunkIndex)) return;

    session.completedChunks.add(chunkIndex);
    session.item.bytesTransferred = Math.min(
      session.item.fileSize,
      session.item.bytesTransferred + bytes
    );

    const now = Date.now();
    const elapsedSec = Math.max((now - session.startedAt) / 1000, 0.001);
    const speed = session.item.bytesTransferred / elapsedSec;
    const remainingBytes = Math.max(0, session.item.fileSize - session.item.bytesTransferred);
    const remainingTime = speed > 0 ? remainingBytes / speed : 0;

    session.item.speed = speed;
    session.item.remainingTime = remainingTime;

    const isFinal = session.completedChunks.size >= session.totalChunks;
    if (isFinal || now - session.lastProgressEmitAt >= PROGRESS_THROTTLE_MS) {
      session.lastProgressEmitAt = now;
      const data: TransferProgressData = {
        transferId,
        bytesTransferred: session.item.bytesTransferred,
        totalBytes: session.item.fileSize,
        percentage:
          session.item.fileSize > 0
            ? Math.round((session.item.bytesTransferred / session.item.fileSize) * 100)
            : 100,
        speed,
        remainingTime,
        status: 'transferring',
      };
      this.emit('progress', data);
    }
  }

  public getNextMissingChunkIndex(transferId: string): number | null {
    const session = this.sessions.get(transferId);
    if (!session) return null;
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.completedChunks.has(i)) return i;
    }
    return null;
  }

  public pauseTransfer(transferId: string): void {
    const session = this.sessions.get(transferId);
    if (!session) return;
    session.isPaused = true;
    session.item.status = 'paused';
    this.release(transferId);
  }

  /**
   * Resumes a paused/queued transfer. Returns false when no slot is available
   * (the transfer is then queued and promoted automatically later).
   */
  public resumeTransfer(transferId: string): boolean {
    const session = this.sessions.get(transferId);
    if (!session || session.isCancelled) return false;

    if (this.active.has(transferId)) {
      session.isPaused = false;
      session.item.status = 'transferring';
      return true;
    }

    if (this.canStartTransfer()) {
      this.active.add(transferId);
      this.queue = this.queue.filter((id) => id !== transferId);
      session.isPaused = false;
      session.item.status = 'transferring';
      return true;
    }

    if (!this.queue.includes(transferId)) this.queue.push(transferId);
    session.item.status = 'queued';
    return false;
  }

  public cancelTransfer(transferId: string): void {
    const session = this.sessions.get(transferId);
    if (session) {
      session.isCancelled = true;
      session.item.status = 'cancelled';
    }
    this.release(transferId);
    this.sessions.delete(transferId);
  }

  public completeTransfer(transferId: string, finalPath: string): void {
    const session = this.sessions.get(transferId);
    if (session) {
      session.item.status = 'completed';
      session.item.finalPath = finalPath;
      session.item.bytesTransferred = session.item.fileSize;
    }
    this.release(transferId);
    this.sessions.delete(transferId);
    this.emit('completed', transferId, finalPath);
  }

  public failTransfer(transferId: string, error: string): void {
    const session = this.sessions.get(transferId);
    if (session) {
      session.item.status = 'failed';
      session.item.errorMessage = error;
      session.isCancelled = true;
    }
    this.release(transferId);
    this.sessions.delete(transferId);
    this.emit('failed', transferId, error);
  }

  public destroy(): void {
    this.sessions.clear();
    this.active.clear();
    this.queue = [];
    this.removeAllListeners();
  }

  private release(transferId: string): void {
    this.active.delete(transferId);
    this.queue = this.queue.filter((id) => id !== transferId);
    this.promoteQueued();
  }

  private promoteQueued(): void {
    while (this.canStartTransfer() && this.queue.length > 0) {
      const nextId = this.queue.shift()!;
      const next = this.sessions.get(nextId);
      if (!next || next.isCancelled) continue;
      this.active.add(nextId);
      next.isPaused = false;
      next.item.status = 'transferring';
      this.emit('dequeued', nextId);
    }
  }
}
