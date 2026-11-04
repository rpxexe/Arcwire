import { EventEmitter } from 'node:events';
import { NetworkEnvelopeSchema, NetworkEnvelope, STREAM_LIMITS } from '@ipm/shared';

export const MAX_FRAME_SIZE = STREAM_LIMITS.MAX_MESSAGE_FRAME_BYTES; // 1 MB

/**
 * Encodes a NetworkEnvelope or payload into a 4-byte big-endian length-prefixed buffer.
 */
export function encodeFrame(message: NetworkEnvelope | Record<string, unknown>): Buffer {
  const jsonStr = JSON.stringify(message);
  const payloadBuf = Buffer.from(jsonStr, 'utf8');

  if (payloadBuf.length > MAX_FRAME_SIZE) {
    throw new Error(`Frame payload exceeds maximum size of ${MAX_FRAME_SIZE} bytes (got ${payloadBuf.length})`);
  }

  const frameBuf = Buffer.allocUnsafe(4 + payloadBuf.length);
  frameBuf.writeUInt32BE(payloadBuf.length, 0);
  payloadBuf.copy(frameBuf, 4);
  return frameBuf;
}

/**
 * Streaming decoder that accumulates TCP stream buffers, extracts length-prefixed frames,
 * parses JSON, and validates via Zod schema.
 */
export class FramingDecoder extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Pushes incoming TCP chunk into accumulator and parses any complete frames.
   */
  public push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0);

      if (frameLength > MAX_FRAME_SIZE) {
        this.emit('error', new Error(`Received frame length ${frameLength} exceeds maximum limit of ${MAX_FRAME_SIZE} bytes`));
        this.buffer = Buffer.alloc(0);
        return;
      }

      if (this.buffer.length < 4 + frameLength) {
        // Frame not fully received yet, wait for more chunks
        break;
      }

      const frameData = this.buffer.subarray(4, 4 + frameLength);
      this.buffer = this.buffer.subarray(4 + frameLength);

      try {
        const jsonStr = frameData.toString('utf8');
        const parsed = JSON.parse(jsonStr);
        const validated = NetworkEnvelopeSchema.parse(parsed);
        this.emit('frame', validated);
      } catch (err) {
        this.emit('error', new Error(`Invalid frame payload: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
  }

  /**
   * Resets the internal accumulator buffer.
   */
  public reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

