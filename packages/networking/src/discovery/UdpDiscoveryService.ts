import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_PORTS,
  IPM_PROTOCOL,
  IpmEventType,
  NetworkEnvelope,
  NetworkEnvelopeSchema,
  DeviceAnnouncePayloadSchema,
  DeviceAnnouncePayload,
  UserStatus,
} from '@ipm/shared';
import { deriveDeviceId } from '@ipm/security';
import { NetworkInterfaceManager } from './NetworkInterfaceManager';

export interface LocalDeviceMetadata {
  deviceId: string;
  publicKey: string;
  displayName: string;
  hostname: string;
  osUser: string;
  tcpPort: number;
  signalingPort: number;
  status: UserStatus;
  avatarHash?: string | null;
}

export interface DiscoveredPeerData {
  deviceId: string;
  publicKey: string;
  displayName: string;
  hostname: string;
  osUser: string;
  tcpPort: number;
  signalingPort: number;
  status: UserStatus;
  avatarHash?: string | null;
  remoteAddress: string;
  lastSeen: number;
}

export interface UdpDiscoveryOptions {
  port?: number;
  broadcastIntervalMs?: number;
  networkManager?: NetworkInterfaceManager;
}

export class UdpDiscoveryService extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private port: number;
  private broadcastIntervalMs: number;
  private networkManager: NetworkInterfaceManager;
  private localMetadata: LocalDeviceMetadata;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(localMetadata: LocalDeviceMetadata, options: UdpDiscoveryOptions = {}) {
    super();
    this.localMetadata = localMetadata;
    this.port = options.port ?? DEFAULT_PORTS.UDP_DISCOVERY;
    this.broadcastIntervalMs = options.broadcastIntervalMs ?? 30000;
    this.networkManager = options.networkManager ?? new NetworkInterfaceManager();
  }

  public updateLocalMetadata(metadata: Partial<LocalDeviceMetadata>): void {
    this.localMetadata = { ...this.localMetadata, ...metadata };
    if (this.isRunning) {
      this.broadcastAnnounce();
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise<void>((resolve, reject) => {
      try {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.socket.on('error', (err: NodeJS.ErrnoException) => {
          this.emit('error', err);
          if (err.code === 'EADDRINUSE') {
            this.emit('portConflict', this.port, err);
          }
        });

        this.socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
          this.handleIncomingPacket(msg, rinfo);
        });

        this.socket.bind(this.port, '0.0.0.0', () => {
          if (!this.socket) return;
          try {
            this.socket.setBroadcast(true);
          } catch (e) {
            console.warn('[UDP Discovery] Failed to setBroadcast:', e);
          }
          this.isRunning = true;

          // Initial discovery burst
          this.broadcastAnnounce();
          this.broadcastQuery();

          // Recurring broadcast timer
          this.timer = setInterval(() => {
            this.broadcastAnnounce();
          }, this.broadcastIntervalMs);

          // Handle interface changes
          this.networkManager.on('networkChange', () => {
            this.broadcastAnnounce();
            this.broadcastQuery();
          });
          this.networkManager.startMonitoring();

          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleIncomingPacket(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const json = JSON.parse(msg.toString('utf8'));
      const envelope = NetworkEnvelopeSchema.parse(json);

      // Ignore our own broadcast loops
      if (envelope.senderId === this.localMetadata.deviceId) {
        return;
      }

      if (envelope.type === IpmEventType.DEVICE_ANNOUNCE) {
        const payload = DeviceAnnouncePayloadSchema.parse(envelope.payload);

        // Verify cryptographic deviceId derivation
        const derivedId = deriveDeviceId(payload.publicKey);
        if (derivedId !== payload.deviceId) {
          console.warn(`[UDP Discovery] Rejected announce with spoofed deviceId from ${rinfo.address}`);
          return;
        }

        const peerData: DiscoveredPeerData = {
          deviceId: payload.deviceId,
          publicKey: payload.publicKey,
          displayName: payload.displayName,
          hostname: payload.hostname,
          osUser: payload.osUser,
          tcpPort: payload.tcpPort,
          signalingPort: payload.signalingPort,
          status: payload.status,
          avatarHash: payload.avatarHash,
          remoteAddress: rinfo.address,
          lastSeen: Date.now(),
        };

        this.emit('peerDiscovered', peerData);
      } else if (envelope.type === IpmEventType.DEVICE_QUERY) {
        // Peer is querying LAN; reply immediately with announcement
        this.sendAnnounceTo(rinfo.address, rinfo.port);
      }
    } catch {
      // Discard malformed, non-IPM, or corrupted UDP packets
    }
  }

  public broadcastAnnounce(): void {
    if (!this.socket || !this.isRunning) return;

    const payload: DeviceAnnouncePayload = {
      deviceId: this.localMetadata.deviceId,
      displayName: this.localMetadata.displayName,
      hostname: this.localMetadata.hostname,
      osUser: this.localMetadata.osUser,
      tcpPort: this.localMetadata.tcpPort,
      signalingPort: this.localMetadata.signalingPort,
      publicKey: this.localMetadata.publicKey,
      avatarHash: this.localMetadata.avatarHash,
      status: this.localMetadata.status,
    };

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.DEVICE_ANNOUNCE,
      senderId: this.localMetadata.deviceId,
      receiverId: '*',
      conversationId: '*',
      timestamp: Date.now(),
      sequence: 0,
      payload,
    };

    const packet = Buffer.from(JSON.stringify(envelope), 'utf8');
    const destinations = this.networkManager.getBroadcastAddresses();

    for (const dest of destinations) {
      try {
        this.socket.send(packet, 0, packet.length, this.port, dest);
      } catch (err) {
        console.warn(`[UDP Discovery] Broadcast failed to ${dest}:`, err);
      }
    }
  }

  public broadcastQuery(): void {
    if (!this.socket || !this.isRunning) return;

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.DEVICE_QUERY,
      senderId: this.localMetadata.deviceId,
      receiverId: '*',
      conversationId: '*',
      timestamp: Date.now(),
      sequence: 0,
      payload: {
        timestamp: Date.now(),
      },
    };

    const packet = Buffer.from(JSON.stringify(envelope), 'utf8');
    const destinations = this.networkManager.getBroadcastAddresses();

    for (const dest of destinations) {
      try {
        this.socket.send(packet, 0, packet.length, this.port, dest);
      } catch {
        // Ignore single broadcast errors
      }
    }
  }

  public sendAnnounceTo(ipAddress: string, port: number): void {
    if (!this.socket || !this.isRunning) return;

    const payload: DeviceAnnouncePayload = {
      deviceId: this.localMetadata.deviceId,
      displayName: this.localMetadata.displayName,
      hostname: this.localMetadata.hostname,
      osUser: this.localMetadata.osUser,
      tcpPort: this.localMetadata.tcpPort,
      signalingPort: this.localMetadata.signalingPort,
      publicKey: this.localMetadata.publicKey,
      avatarHash: this.localMetadata.avatarHash,
      status: this.localMetadata.status,
    };

    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.DEVICE_ANNOUNCE,
      senderId: this.localMetadata.deviceId,
      receiverId: '*',
      conversationId: '*',
      timestamp: Date.now(),
      sequence: 0,
      payload,
    };

    const packet = Buffer.from(JSON.stringify(envelope), 'utf8');
    try {
      this.socket.send(packet, 0, packet.length, port, ipAddress);
    } catch {
      // Ignore
    }
  }

  public async stop(): Promise<void> {
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.networkManager.stopMonitoring();

    return new Promise<void>((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      this.socket.close(() => {
        this.socket = null;
        resolve();
      });
    });
  }
}

