import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { FileChunkStreamer } from '@ipm/file-sharing';

describe('FileChunkStreamer (Section 8 256 KB Chunked Streaming & Verification)', () => {
  let tempDir: string;
  let testFilePath: string;
  const CHUNK_SIZE = 256 * 1024; // 256 KB

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-chunk-test-'));
    testFilePath = path.join(tempDir, 'sample-data.bin');

    // Create a 700 KB file (requires 3 chunks: 256 KB, 256 KB, 188 KB)
    const buffer = crypto.randomBytes(700 * 1024);
    fs.writeFileSync(testFilePath, buffer);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('inspectFile computes correct fileSize, totalChunks, and SHA-256 via streams', async () => {
    const inspect = await FileChunkStreamer.inspectFile(testFilePath, CHUNK_SIZE);

    expect(inspect.fileSize).toBe(700 * 1024);
    expect(inspect.totalChunks).toBe(3);

    // Verify SHA-256 matches independent node crypto hash
    const rawData = fs.readFileSync(testFilePath);
    const expectedHash = crypto.createHash('sha256').update(rawData).digest('hex');
    expect(inspect.fileHash).toBe(expectedHash);
  });

  it('reads chunks sequentially with valid chunk hashes', async () => {
    const chunk0 = await FileChunkStreamer.readChunk(testFilePath, 0, CHUNK_SIZE);
    expect(chunk0.data.length).toBe(256 * 1024);
    const hash0 = crypto.createHash('sha256').update(chunk0.data).digest('hex');
    expect(chunk0.chunkHash).toBe(hash0);

    const chunk1 = await FileChunkStreamer.readChunk(testFilePath, 1, CHUNK_SIZE);
    expect(chunk1.data.length).toBe(256 * 1024);

    const chunk2 = await FileChunkStreamer.readChunk(testFilePath, 2, CHUNK_SIZE);
    expect(chunk2.data.length).toBe(188 * 1024); // remaining bytes
  });

  it('writes and verifies assembled chunks in a .part file', async () => {
    const tempPartPath = path.join(tempDir, 'transfer-123.part');
    const finalDestPath = path.join(tempDir, 'received-data.bin');

    const inspect = await FileChunkStreamer.inspectFile(testFilePath, CHUNK_SIZE);

    // Write chunks out of order (e.g. chunk 1, then chunk 0, then chunk 2)
    const indices = [1, 0, 2];
    for (const idx of indices) {
      const chunk = await FileChunkStreamer.readChunk(testFilePath, idx, CHUNK_SIZE);
      await FileChunkStreamer.writeChunk(
        tempPartPath,
        idx,
        chunk.data,
        chunk.chunkHash,
        CHUNK_SIZE
      );
    }

    // Verify assembled SHA-256
    const isVerified = await FileChunkStreamer.verifyAssembledFile(
      tempPartPath,
      inspect.fileHash
    );
    expect(isVerified).toBe(true);

    // Atomically finalize file
    await FileChunkStreamer.finalizeFile(tempPartPath, finalDestPath);
    expect(fs.existsSync(tempPartPath)).toBe(false);
    expect(fs.existsSync(finalDestPath)).toBe(true);

    // Verify destination byte-for-byte matches source
    const originalBuf = fs.readFileSync(testFilePath);
    const finalBuf = fs.readFileSync(finalDestPath);
    expect(finalBuf.equals(originalBuf)).toBe(true);
  });

  it('rejects chunks with corrupted chunk hashes', async () => {
    const tempPartPath = path.join(tempDir, 'corrupt.part');
    const chunk0 = await FileChunkStreamer.readChunk(testFilePath, 0, CHUNK_SIZE);

    const badHash = 'deadbeef'.repeat(8);
    await expect(
      FileChunkStreamer.writeChunk(tempPartPath, 0, chunk0.data, badHash, CHUNK_SIZE)
    ).rejects.toThrow(/integrity mismatch/i);
  });
});
