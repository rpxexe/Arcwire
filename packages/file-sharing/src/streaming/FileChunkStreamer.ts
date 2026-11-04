import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class FileChunkStreamer {
  public static readonly DEFAULT_CHUNK_SIZE = 256 * 1024; // 256 KB per spec

  /**
   * Calculates overall file SHA-256 hash, size, and total chunks without loading file into memory.
   */
  public static async inspectFile(
    filePath: string,
    chunkSize = FileChunkStreamer.DEFAULT_CHUNK_SIZE
  ): Promise<{ fileHash: string; fileSize: number; totalChunks: number }> {
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => {
        resolve({
          fileHash: hash.digest('hex'),
          fileSize,
          totalChunks,
        });
      });
    });
  }

  /**
   * Reads a single chunk of data at chunkIndex.
   */
  public static async readChunk(
    filePath: string,
    chunkIndex: number,
    chunkSize = FileChunkStreamer.DEFAULT_CHUNK_SIZE
  ): Promise<{ data: Buffer; chunkHash: string }> {
    const fileHandle = await fs.promises.open(filePath, 'r');
    try {
      const stat = await fileHandle.stat();
      const offset = chunkIndex * chunkSize;
      if (offset >= stat.size) {
        throw new Error(`Chunk offset ${offset} exceeds file size ${stat.size}`);
      }

      const lengthToRead = Math.min(chunkSize, stat.size - offset);
      const buffer = Buffer.alloc(lengthToRead);
      const { bytesRead } = await fileHandle.read(buffer, 0, lengthToRead, offset);

      const actualData = bytesRead === lengthToRead ? buffer : buffer.subarray(0, bytesRead);
      const chunkHash = crypto.createHash('sha256').update(actualData).digest('hex');

      return { data: actualData, chunkHash };
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Writes a verified chunk of data to the temporary file at specific byte position.
   */
  public static async writeChunk(
    tempFilePath: string,
    chunkIndex: number,
    data: Buffer,
    expectedChunkHash: string,
    chunkSize = FileChunkStreamer.DEFAULT_CHUNK_SIZE
  ): Promise<boolean> {
    const actualHash = crypto.createHash('sha256').update(data).digest('hex');
    if (actualHash.toLowerCase() !== expectedChunkHash.toLowerCase()) {
      throw new Error(`Chunk ${chunkIndex} integrity mismatch: expected ${expectedChunkHash}, got ${actualHash}`);
    }

    // Ensure directory exists
    const dir = path.dirname(tempFilePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    // Ensure file exists
    if (!fs.existsSync(tempFilePath)) {
      await fs.promises.writeFile(tempFilePath, Buffer.alloc(0));
    }

    const fileHandle = await fs.promises.open(tempFilePath, 'r+');
    try {
      const offset = chunkIndex * chunkSize;
      await fileHandle.write(data, 0, data.length, offset);
      return true;
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Verifies the complete assembled temporary file matches the global expected SHA-256 hash.
   */
  public static async verifyAssembledFile(tempFilePath: string, expectedFileHash: string): Promise<boolean> {
    if (!fs.existsSync(tempFilePath)) return false;

    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(tempFilePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => {
        const actualHash = hash.digest('hex');
        resolve(actualHash.toLowerCase() === expectedFileHash.toLowerCase());
      });
    });
  }

  /**
   * Atomically finalizes the temporary file by moving it to the destination path.
   */
  public static async finalizeFile(tempFilePath: string, destinationFilePath: string): Promise<void> {
    const destDir = path.dirname(destinationFilePath);
    if (!fs.existsSync(destDir)) {
      await fs.promises.mkdir(destDir, { recursive: true });
    }

    // If destination already exists, generate unique suffix
    let finalPath = destinationFilePath;
    if (fs.existsSync(finalPath)) {
      const parsed = path.parse(destinationFilePath);
      let counter = 1;
      while (fs.existsSync(finalPath)) {
        finalPath = path.join(parsed.dir, `${parsed.name} (${counter})${parsed.ext}`);
        counter++;
      }
    }

    try {
      await fs.promises.rename(tempFilePath, finalPath);
    } catch (err) {
      // Cross-device fallback
      await fs.promises.copyFile(tempFilePath, finalPath);
      await fs.promises.unlink(tempFilePath);
    }
  }
}

