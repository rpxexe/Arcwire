export * from '@ipm/shared';

export interface TransportAdapter {
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  send(peerId: string, message: unknown): Promise<void>;
  onMessage(callback: (message: unknown) => void): void;
}

