import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OfflineMessageQueue } from '@ipm/messaging';
import { TransportAdapter } from '@ipm/networking';
import { NetworkEnvelope, IPM_PROTOCOL, IpmEventType } from '@ipm/shared';

describe('Phase 3 Unit - Offline Message Queue', () => {
  let mockTransport: TransportAdapter;
  let queue: OfflineMessageQueue;
  let sentEnvelopes: Array<{ peerId: string; envelope: NetworkEnvelope }>;

  beforeEach(() => {
    sentEnvelopes = [];
    mockTransport = {
      send: vi.fn(async (peerId: string, envelope: NetworkEnvelope) => {
        sentEnvelopes.push({ peerId, envelope });
      }),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    } as unknown as TransportAdapter;

    queue = new OfflineMessageQueue(mockTransport, 60000); // long interval to control retries
  });

  afterEach(() => {
    queue.destroy();
  });

  const createDummyEnvelope = (id: string, text: string): NetworkEnvelope => ({
    protocol: IPM_PROTOCOL,
    id,
    type: IpmEventType.CHAT_MESSAGE,
    senderId: 'dev_alice',
    receiverId: 'dev_bob',
    timestamp: Date.now(),
    payload: {
      messageId: id,
      content: text,
      contentType: 'text',
      isEncrypted: false,
      sentAt: Date.now(),
    },
  });

  it('enqueues messages and tracks pending counts', () => {
    const env1 = createDummyEnvelope('msg_q1', 'First queued message');
    const env2 = createDummyEnvelope('msg_q2', 'Second queued message');

    queue.enqueue('dev_bob', env1);
    queue.enqueue('dev_bob', env2);

    expect(queue.getPendingCount('dev_bob')).toBe(2);
    expect(queue.getPendingCount()).toBe(2);
    expect(queue.getPendingCount('dev_charlie')).toBe(0);
  });

  it('deduplicates envelopes with identical ID within queue', () => {
    const env1 = createDummyEnvelope('msg_duplicate', 'Message text');
    queue.enqueue('dev_bob', env1);
    queue.enqueue('dev_bob', env1); // Duplicate attempt

    expect(queue.getPendingCount('dev_bob')).toBe(1);
  });

  it('flushes pending queue in FIFO order when peer connects', async () => {
    const env1 = createDummyEnvelope('msg_1', 'Message 1');
    const env2 = createDummyEnvelope('msg_2', 'Message 2');
    const env3 = createDummyEnvelope('msg_3', 'Message 3');

    queue.enqueue('dev_bob', env1);
    queue.enqueue('dev_bob', env2);
    queue.enqueue('dev_bob', env3);

    const flushedCount = await queue.flushPeer('dev_bob');
    expect(flushedCount).toBe(3);
    expect(queue.getPendingCount('dev_bob')).toBe(0);

    expect(sentEnvelopes.length).toBe(3);
    expect((sentEnvelopes[0]?.envelope.payload as any).content).toBe('Message 1');
    expect((sentEnvelopes[1]?.envelope.payload as any).content).toBe('Message 2');
    expect((sentEnvelopes[2]?.envelope.payload as any).content).toBe('Message 3');
  });

  it('retains remaining messages if transport fails midway', async () => {
    let callCount = 0;
    mockTransport.send = vi.fn(async (peerId: string, envelope: NetworkEnvelope) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Socket disconnected');
      }
      sentEnvelopes.push({ peerId, envelope });
    });

    const env1 = createDummyEnvelope('msg_ok', 'Message OK');
    const env2 = createDummyEnvelope('msg_fail', 'Message Fail');
    const env3 = createDummyEnvelope('msg_unattempted', 'Message Unattempted');

    queue.enqueue('dev_bob', env1);
    queue.enqueue('dev_bob', env2);
    queue.enqueue('dev_bob', env3);

    const sent = await queue.flushPeer('dev_bob');
    expect(sent).toBe(1);
    // env2 failed and env3 was unattempted; both should remain queued
    expect(queue.getPendingCount('dev_bob')).toBe(2);
  });

  it('removes confirmed message from queue on ACK or receipt', () => {
    const env = createDummyEnvelope('msg_to_remove', 'Content');
    queue.enqueue('dev_bob', env);
    expect(queue.getPendingCount('dev_bob')).toBe(1);

    queue.removeMessage('dev_bob', 'msg_to_remove');
    expect(queue.getPendingCount('dev_bob')).toBe(0);
  });
});

