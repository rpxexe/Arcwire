import { EventEmitter } from 'node:events';
import { NetworkEnvelope } from '@ipm/shared';
import { TransportAdapter } from '@ipm/networking';

export interface QueuedMessage {
  id: string;
  peerId: string;
  envelope: NetworkEnvelope;
  enqueuedAt: number;
  attempts: number;
}

export class OfflineMessageQueue extends EventEmitter {
  private queue: Map<string, QueuedMessage[]> = new Map();
  private transport: TransportAdapter;
  private retryInterval: NodeJS.Timeout | null = null;
  private isProcessing: Map<string, boolean> = new Map();

  constructor(transport: TransportAdapter, retryIntervalMs: number = 8000) {
    super();
    this.transport = transport;

    this.retryInterval = setInterval(() => {
      this.retryAll();
    }, retryIntervalMs);
  }

  public enqueue(peerId: string, envelope: NetworkEnvelope): void {
    const list = this.queue.get(peerId) ?? [];

    // Deduplication within queue
    if (list.some((item) => item.id === envelope.id)) {
      return;
    }

    // Limit queue size per peer to 500
    if (list.length >= 500) {
      list.shift();
    }

    list.push({
      id: envelope.id,
      peerId,
      envelope,
      enqueuedAt: Date.now(),
      attempts: 0,
    });

    this.queue.set(peerId, list);
    this.emit('enqueued', peerId, envelope);
  }

  public async flushPeer(peerId: string): Promise<number> {
    if (this.isProcessing.get(peerId)) return 0;
    this.isProcessing.set(peerId, true);

    const list = this.queue.get(peerId);
    if (!list || list.length === 0) {
      this.isProcessing.set(peerId, false);
      return 0;
    }

    let sentCount = 0;
    const remaining: QueuedMessage[] = [];

    for (const item of list) {
      try {
        item.attempts += 1;
        await this.transport.send(peerId, item.envelope);
        sentCount += 1;
        this.emit('flushed', peerId, item.envelope);
      } catch {
        // Send failed: retain this item and all remaining unattempted messages in queue
        const currentIndex = list.indexOf(item);
        remaining.push(...list.slice(currentIndex));
        break; // Stop flushing this peer until next connection/retry
      }
    }

    if (remaining.length > 0) {
      this.queue.set(peerId, remaining);
    } else {
      this.queue.delete(peerId);
    }

    this.isProcessing.set(peerId, false);
    return sentCount;
  }

  public retryAll(): void {
    for (const peerId of this.queue.keys()) {
      this.flushPeer(peerId).catch(() => {});
    }
  }

  public removeMessage(peerId: string, messageId: string): void {
    const list = this.queue.get(peerId);
    if (!list) return;

    const filtered = list.filter((i) => (i.envelope.payload as any)?.messageId !== messageId && i.id !== messageId);
    if (filtered.length > 0) {
      this.queue.set(peerId, filtered);
    } else {
      this.queue.delete(peerId);
    }
  }

  public getPendingCount(peerId?: string): number {
    if (peerId) {
      return this.queue.get(peerId)?.length ?? 0;
    }
    let total = 0;
    for (const list of this.queue.values()) {
      total += list.length;
    }
    return total;
  }

  public destroy(): void {
    if (this.retryInterval) {
      clearInterval(this.retryInterval);
      this.retryInterval = null;
    }
    this.queue.clear();
  }
}

