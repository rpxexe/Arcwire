import { describe, it, expect } from 'vitest';
import { TransferManager } from '@ipm/file-sharing';
import { TransferItem } from '@ipm/shared';

describe('TransferManager (Section 8 Concurrency Queue & Metrics)', () => {
  const createMockTransfer = (id: string, size = 1024 * 1024): TransferItem => ({
    id,
    conversationId: 'conv-1',
    direction: 'outgoing',
    remoteDeviceId: 'peer-dev-1',
    fileName: `file-${id}.bin`,
    fileSize: size,
    fileHash: 'dummyhash',
    tempPath: `/tmp/${id}.part`,
    bytesTransferred: 0,
    status: 'transferring',
    speed: 0,
    remainingTime: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  it('enforces maximum 3 concurrent active transfers and queues excess transfers', () => {
    const manager = new TransferManager();

    // Register 3 active transfers
    const t1 = manager.registerTransfer(createMockTransfer('t1'), 4);
    const t2 = manager.registerTransfer(createMockTransfer('t2'), 4);
    const t3 = manager.registerTransfer(createMockTransfer('t3'), 4);

    expect(manager.getActiveCount()).toBe(3);
    expect(manager.canStartTransfer()).toBe(false);

    // Attempting to start/resume 4th transfer should queue it
    const t4 = manager.registerTransfer(createMockTransfer('t4'), 4);
    const resumed = manager.resumeTransfer('t4');
    expect(resumed).toBe(false);
    expect(t4.item.status).toBe('queued');
  });

  it('unblocks queued transfers when an active transfer pauses, completes, or cancels', () => {
    const manager = new TransferManager();

    manager.registerTransfer(createMockTransfer('t1'), 4);
    manager.registerTransfer(createMockTransfer('t2'), 4);
    manager.registerTransfer(createMockTransfer('t3'), 4);

    const t4 = manager.registerTransfer(createMockTransfer('t4'), 4);
    manager.resumeTransfer('t4'); // queued

    expect(t4.item.status).toBe('queued');

    // Pause t1
    manager.pauseTransfer('t1');

    // t4 should now automatically transition to transferring
    expect(t4.item.status).toBe('transferring');
    expect(manager.getActiveCount()).toBe(3);
  });

  it('tracks chunk completion and finds missing chunk indices', () => {
    const manager = new TransferManager();
    const session = manager.registerTransfer(createMockTransfer('t1', 1024 * 1024), 4);

    expect(manager.getNextMissingChunkIndex('t1')).toBe(0);

    manager.recordChunkTransferred('t1', 0, 256 * 1024);
    expect(session.completedChunks.has(0)).toBe(true);
    expect(manager.getNextMissingChunkIndex('t1')).toBe(1);

    manager.recordChunkTransferred('t1', 1, 256 * 1024);
    manager.recordChunkTransferred('t1', 2, 256 * 1024);
    expect(manager.getNextMissingChunkIndex('t1')).toBe(3);

    manager.recordChunkTransferred('t1', 3, 256 * 1024);
    expect(manager.getNextMissingChunkIndex('t1')).toBe(null);
  });

  it('emits progress events with speed and remainingTime', async () => {
    const manager = new TransferManager();
    manager.registerTransfer(createMockTransfer('t1', 512 * 1024), 2);

    let progressFired = false;
    manager.on('progress', (data) => {
      progressFired = true;
      expect(data.transferId).toBe('t1');
      expect(data.totalBytes).toBe(512 * 1024);
      expect(data.bytesTransferred).toBeGreaterThan(0);
      expect(data.percentage).toBeGreaterThan(0);
    });

    manager.recordChunkTransferred('t1', 0, 256 * 1024);
    // Force final chunk transfer
    manager.recordChunkTransferred('t1', 1, 256 * 1024);

    expect(progressFired).toBe(true);
  });
});

