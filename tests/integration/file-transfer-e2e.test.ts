import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  FileChunkStreamer,
  TransferManager,
  PathTraversalGuard,
} from '@ipm/file-sharing';
import {
  FileOfferPayload,
  FileChunkPayload,
  IpmEventType,
  NetworkEnvelope,
  IPM_PROTOCOL,
} from '@ipm/shared';

describe('End-to-End File Transfer Workflow (Section 8 Streaming & Verification)', () => {
  let senderDir: string;
  let receiverDir: string;
  let sourceFilePath: string;
  const CHUNK_SIZE = 256 * 1024; // 256 KB

  beforeEach(() => {
    senderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-e2e-sender-'));
    receiverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-e2e-receiver-'));

    sourceFilePath = path.join(senderDir, 'arcwire-setup.iso');
    // Generate 600 KB file (3 chunks: 256KB, 256KB, 88KB)
    const testData = crypto.randomBytes(600 * 1024);
    fs.writeFileSync(sourceFilePath, testData);
  });

  afterEach(() => {
    try {
      fs.rmSync(senderDir, { recursive: true, force: true });
      fs.rmSync(receiverDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('successfully streams, verifies individual chunks, and assembles file with SHA-256 match', async () => {
    // 1. Sender inspects file
    const inspect = await FileChunkStreamer.inspectFile(sourceFilePath, CHUNK_SIZE);
    expect(inspect.fileSize).toBe(600 * 1024);
    expect(inspect.totalChunks).toBe(3);

    const transferId = crypto.randomUUID();
    const fileName = path.basename(sourceFilePath);

    // 2. Sender prepares offer packet
    const offer: FileOfferPayload = {
      transferId,
      fileName,
      fileSize: inspect.fileSize,
      fileHash: inspect.fileHash,
      mimeType: 'application/octet-stream',
      totalChunks: inspect.totalChunks,
      chunkSize: CHUNK_SIZE,
    };

    // 3. Receiver accepts offer and initializes destination & temp paths
    const receiverTempPart = path.join(receiverDir, `${transferId}.part`);
    const receiverFinalDest = path.join(receiverDir, fileName);

    const receiverManager = new TransferManager();
    const mockReceiverTransfer = {
      id: transferId,
      conversationId: 'conv-test',
      direction: 'incoming' as const,
      remoteDeviceId: 'sender-device-id',
      fileName,
      fileSize: inspect.fileSize,
      fileHash: inspect.fileHash,
      tempPath: receiverTempPart,
      finalPath: receiverFinalDest,
      bytesTransferred: 0,
      status: 'transferring' as const,
      speed: 0,
      remainingTime: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    receiverManager.registerTransfer(mockReceiverTransfer, inspect.totalChunks);

    // 4. Stream chunks from sender to receiver
    for (let chunkIdx = 0; chunkIdx < inspect.totalChunks; chunkIdx++) {
      // Sender reads chunk
      const chunk = await FileChunkStreamer.readChunk(sourceFilePath, chunkIdx, CHUNK_SIZE);

      // Packet in flight (base64 encoded as in real wire protocol)
      const packet: FileChunkPayload = {
        transferId,
        chunkIndex: chunkIdx,
        chunkHash: chunk.chunkHash,
        data: chunk.data.toString('base64'),
      };

      // Receiver receives packet and decodes
      const decodedBuffer = Buffer.from(packet.data, 'base64');
      await FileChunkStreamer.writeChunk(
        receiverTempPart,
        packet.chunkIndex,
        decodedBuffer,
        packet.chunkHash,
        CHUNK_SIZE
      );

      receiverManager.recordChunkTransferred(transferId, packet.chunkIndex, decodedBuffer.length);
    }

    // 5. Receiver verifies assembled file SHA-256 integrity
    const isIntegrityValid = await FileChunkStreamer.verifyAssembledFile(
      receiverTempPart,
      inspect.fileHash
    );
    expect(isIntegrityValid).toBe(true);

    // 6. Receiver atomically finalizes file
    await FileChunkStreamer.finalizeFile(receiverTempPart, receiverFinalDest);
    receiverManager.completeTransfer(transferId, receiverFinalDest);

    // 7. Verify receiver final file
    expect(fs.existsSync(receiverFinalDest)).toBe(true);
    expect(fs.existsSync(receiverTempPart)).toBe(false);

    const senderBytes = fs.readFileSync(sourceFilePath);
    const receiverBytes = fs.readFileSync(receiverFinalDest);
    expect(receiverBytes.equals(senderBytes)).toBe(true);
  });
});

