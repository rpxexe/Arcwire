import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  encodeFrame,
  FramingDecoder,
  MAX_FRAME_SIZE,
} from '@ipm/networking';
import {
  IPM_PROTOCOL,
  IpmEventType,
  NetworkEnvelope,
} from '@ipm/shared';

describe('FramingCodec - Length Prefixed Framing', () => {
  const sampleEnvelope: NetworkEnvelope = {
    protocol: IPM_PROTOCOL,
    id: crypto.randomUUID(),
    type: IpmEventType.CHAT_MESSAGE,
    senderId: 'dev_0123456789abcdef0123',
    receiverId: 'dev_9876543210fedcba9876',
    conversationId: crypto.randomUUID(),
    timestamp: Date.now(),
    sequence: 1,
    payload: {
      messageId: crypto.randomUUID(),
      content: 'Hello, world over LAN!',
      contentType: 'text',
      isEncrypted: false,
      sentAt: Date.now(),
    },
  };

  it('encodes envelope with 4-byte big-endian length prefix', () => {
    const encoded = encodeFrame(sampleEnvelope);
    expect(encoded.length).toBeGreaterThan(4);

    const lengthPrefix = encoded.readUInt32BE(0);
    const payloadBytes = encoded.subarray(4);
    expect(lengthPrefix).toBe(payloadBytes.length);

    const parsed = JSON.parse(payloadBytes.toString('utf8'));
    expect(parsed.id).toBe(sampleEnvelope.id);
    expect(parsed.type).toBe(sampleEnvelope.type);
    expect(parsed.payload.content).toBe('Hello, world over LAN!');
  });

  it('decodes a complete frame in a single push', () => {
    const decoder = new FramingDecoder();
    const encoded = encodeFrame(sampleEnvelope);

    const receivedFrames: NetworkEnvelope[] = [];
    decoder.on('frame', (f) => receivedFrames.push(f));

    decoder.push(encoded);

    expect(receivedFrames).toHaveLength(1);
    expect(receivedFrames[0].id).toBe(sampleEnvelope.id);
    expect(receivedFrames[0].senderId).toBe(sampleEnvelope.senderId);
  });

  it('decodes fragmented frames split across multiple chunks', () => {
    const decoder = new FramingDecoder();
    const encoded = encodeFrame(sampleEnvelope);

    const receivedFrames: NetworkEnvelope[] = [];
    decoder.on('frame', (f) => receivedFrames.push(f));

    // Split encoded buffer into small 7-byte slices
    const chunkSize = 7;
    for (let i = 0; i < encoded.length; i += chunkSize) {
      const slice = encoded.subarray(i, i + chunkSize);
      decoder.push(slice);
    }

    expect(receivedFrames).toHaveLength(1);
    expect(receivedFrames[0].id).toBe(sampleEnvelope.id);
  });

  it('decodes multiple frames concatenated in a single buffer', () => {
    const decoder = new FramingDecoder();
    const env1: NetworkEnvelope = { ...sampleEnvelope, id: crypto.randomUUID(), sequence: 1 };
    const env2: NetworkEnvelope = { ...sampleEnvelope, id: crypto.randomUUID(), sequence: 2 };
    const env3: NetworkEnvelope = { ...sampleEnvelope, id: crypto.randomUUID(), sequence: 3 };

    const concatenated = Buffer.concat([
      encodeFrame(env1),
      encodeFrame(env2),
      encodeFrame(env3),
    ]);

    const receivedFrames: NetworkEnvelope[] = [];
    decoder.on('frame', (f) => receivedFrames.push(f));

    decoder.push(concatenated);

    expect(receivedFrames).toHaveLength(3);
    expect(receivedFrames[0].id).toBe(env1.id);
    expect(receivedFrames[1].id).toBe(env2.id);
    expect(receivedFrames[2].id).toBe(env3.id);
  });

  it('rejects frames exceeding maximum frame limit (1 MB)', () => {
    const oversizedHeader = Buffer.alloc(4);
    oversizedHeader.writeUInt32BE(MAX_FRAME_SIZE + 100, 0);

    const decoder = new FramingDecoder();
    let emittedError: Error | null = null;
    decoder.on('error', (err) => {
      emittedError = err;
    });

    decoder.push(oversizedHeader);

    expect(emittedError).toBeDefined();
    expect(emittedError?.message).toContain('exceeds maximum limit');
  });

  it('emits error on invalid JSON payload', () => {
    const invalidJsonPayload = Buffer.from('{ bad: json: syntax ]', 'utf8');
    const buf = Buffer.alloc(4 + invalidJsonPayload.length);
    buf.writeUInt32BE(invalidJsonPayload.length, 0);
    invalidJsonPayload.copy(buf, 4);

    const decoder = new FramingDecoder();
    let emittedError: Error | null = null;
    decoder.on('error', (err) => {
      emittedError = err;
    });

    decoder.push(buf);

    expect(emittedError).toBeDefined();
    expect(emittedError?.message).toContain('Invalid frame payload');
  });
});

