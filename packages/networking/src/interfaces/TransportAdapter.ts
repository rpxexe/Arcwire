import { NetworkEnvelope } from '@ipm/shared';

export interface TransportConnection {
  readonly peerId: string;
  readonly remoteAddress: string;
  readonly isEncrypted: boolean;
  readonly isAuthenticated: boolean;
  send(message: NetworkEnvelope): Promise<void>;
  close(): Promise<void>;
}

/**
 * Transport abstraction as required by IPM Architecture Section 18.
 * Allows decoupling higher-level messaging, file, and signaling protocols
 * from concrete LAN or future Internet transports.
 */
export interface TransportAdapter {
  connect(peerId: string): Promise<void>;
  disconnect(peerId: string): Promise<void>;
  send(peerId: string, message: NetworkEnvelope): Promise<void>;
  onMessage(callback: (message: NetworkEnvelope) => void): void;
}

