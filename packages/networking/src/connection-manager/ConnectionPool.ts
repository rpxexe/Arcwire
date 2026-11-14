import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import { NetworkEnvelope } from '@ipm/shared';
import { LanTransportConnection } from '../transport/LanTransportConnection';
import { HandshakeManager, LocalIdentity } from '../authentication/HandshakeManager';

export interface PeerTarget {
  peerId: string;
  ipAddress: string;
  port: number;
}

export class ConnectionPool extends EventEmitter {
  private connections: Map<string, LanTransportConnection> = new Map();
  private peerTargets: Map<string, PeerTarget> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private localIdentity: LocalIdentity;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isDestroyed: boolean = false;

  constructor(localIdentity: LocalIdentity) {
    super();
    this.localIdentity = localIdentity;
    this.startHeartbeat();
  }

  public registerPeerTarget(target: PeerTarget): void {
    this.peerTargets.set(target.peerId, target);
  }

  public getPeerTarget(peerId: string): PeerTarget | undefined {
    return this.peerTargets.get(peerId);
  }

  public addConnection(connection: LanTransportConnection): void {
    const peerId = connection.peerId;
    if (!peerId) {
      throw new Error('Cannot add connection with empty peerId');
    }

    // Duplicate connection tie-breaker
    const existing = this.connections.get(peerId);
    if (existing) {
      // Deterministic tie-breaker: compare string IDs
      // If local is smaller, incoming wins; if local is greater, existing wins
      if (this.localIdentity.deviceId < peerId) {
        existing.close();
      } else {
        connection.close();
        return;
      }
    }

    this.connections.set(peerId, connection);
    this.clearReconnect(peerId);

    connection.on('message', (message: NetworkEnvelope) => {
      this.emit('message', peerId, message);
    });

    connection.on('close', () => {
      // Only react if this is still the active connection — a replaced duplicate
      // closing late must not evict the healthy connection that superseded it.
      if (this.connections.get(peerId) === connection) {
        this.handleConnectionDrop(peerId);
      }
    });

    connection.on('error', (err) => {
      this.emit('connectionError', peerId, err);
    });

    this.emit('peerConnected', peerId, connection);
  }

  public getConnection(peerId: string): LanTransportConnection | undefined {
    return this.connections.get(peerId);
  }

  public hasConnection(peerId: string): boolean {
    const conn = this.connections.get(peerId);
    return Boolean(conn && this.isUsable(conn));
  }

  private isUsable(conn: LanTransportConnection): boolean {
    return conn.isAuthenticated && conn.isOpen;
  }

  /** Returns a usable connection, evicting a dead one and reconnecting on demand. */
  private async getUsableConnection(peerId: string): Promise<LanTransportConnection> {
    const current = this.connections.get(peerId);
    if (current && this.isUsable(current)) return current;
    if (current) {
      this.connections.delete(peerId);
      current.close();
    }
    const target = this.peerTargets.get(peerId);
    if (!target) {
      throw new Error(`No active connection or known IP target for peer ${peerId}`);
    }
    return this.connectToPeer(target.peerId, target.ipAddress, target.port);
  }

  public getConnectedPeerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  public async send(peerId: string, message: NetworkEnvelope): Promise<void> {
    const connection = await this.getUsableConnection(peerId);
    try {
      await connection.send(message);
    } catch (err) {
      // The socket died between the check and the write: reconnect once and retry.
      if (this.connections.get(peerId) === connection) this.connections.delete(peerId);
      const fresh = await this.getUsableConnection(peerId);
      await fresh.send(message);
    }
  }

  public async connectToPeer(
    peerId: string,
    ipAddress: string,
    port: number,
    timeoutMs: number = 8000
  ): Promise<LanTransportConnection> {
    // If already connected, return existing
    const existing = this.connections.get(peerId);
    if (existing && this.isUsable(existing)) {
      return existing;
    }

    this.registerPeerTarget({ peerId, ipAddress, port });

    return new Promise<LanTransportConnection>((resolve, reject) => {
      let isSettled = false;

      const rawSocket = tls.connect(
        {
          host: ipAddress,
          port,
          minVersion: 'TLSv1.3',
          rejectUnauthorized: false,
        },
        async () => {
          try {
            const connection = new LanTransportConnection(rawSocket);
            const handshakeManager = new HandshakeManager(this.localIdentity, timeoutMs);
            const authenticatedId = await handshakeManager.performInitiatorHandshake(connection);

            if (authenticatedId !== peerId) {
              connection.close();
              const err = new Error(`Connected peer authenticated as ${authenticatedId}, expected ${peerId}`);
              if (!isSettled) {
                isSettled = true;
                reject(err);
              }
              return;
            }

            this.addConnection(connection);
            if (!isSettled) {
              isSettled = true;
              resolve(connection);
            }
          } catch (err) {
            rawSocket.destroy();
            if (!isSettled) {
              isSettled = true;
              reject(err);
            }
          }
        }
      );

      rawSocket.setTimeout(timeoutMs, () => {
        rawSocket.destroy();
        if (!isSettled) {
          isSettled = true;
          reject(new Error(`Connection to ${ipAddress}:${port} timed out after ${timeoutMs}ms`));
        }
      });

      rawSocket.on('error', (err) => {
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });
    });
  }

  private handleConnectionDrop(peerId: string): void {
    this.connections.delete(peerId);
    this.emit('peerDisconnected', peerId);

    if (this.isDestroyed) return;

    // Trigger reconnect backoff if peer is a registered target
    const target = this.peerTargets.get(peerId);
    if (target) {
      this.scheduleReconnect(target);
    }
  }

  private scheduleReconnect(target: PeerTarget): void {
    if (this.isDestroyed) return;
    this.clearReconnect(target.peerId);

    const attempts = this.reconnectAttempts.get(target.peerId) ?? 0;
    // Exponential backoff: 2s, 4s, 8s, 16s, up to 30s max
    const delay = Math.min(2000 * Math.pow(2, attempts), 30000);
    this.reconnectAttempts.set(target.peerId, attempts + 1);

    const timer = setTimeout(async () => {
      try {
        await this.connectToPeer(target.peerId, target.ipAddress, target.port, 5000);
        this.reconnectAttempts.delete(target.peerId);
      } catch {
        // Will retry on next schedule if still registered
      }
    }, delay);

    this.reconnectTimers.set(target.peerId, timer);
  }

  private clearReconnect(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isDestroyed) return;

      for (const [peerId, conn] of this.connections.entries()) {
        const raw = conn.getRawSocket();
        if (raw.destroyed || !raw.writable) {
          conn.close();
          this.handleConnectionDrop(peerId);
        }
      }
    }, 15000);
  }

  public async disconnect(peerId: string): Promise<void> {
    this.clearReconnect(peerId);
    this.peerTargets.delete(peerId);
    const conn = this.connections.get(peerId);
    if (conn) {
      await conn.close();
      this.connections.delete(peerId);
      this.emit('peerDisconnected', peerId);
    }
  }

  public async destroy(): Promise<void> {
    this.isDestroyed = true;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    this.peerTargets.clear();

    const closePromises = Array.from(this.connections.values()).map((c) => c.close());
    this.connections.clear();
    await Promise.allSettled(closePromises);
  }
}

