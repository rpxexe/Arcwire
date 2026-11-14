import { EventEmitter } from 'node:events';
import { UdpDiscoveryService, LocalDeviceMetadata, DiscoveredPeerData } from './UdpDiscoveryService';
import { MdnsDiscoveryService } from './MdnsDiscoveryService';
import { NetworkInterfaceManager } from './NetworkInterfaceManager';
import { DeviceInfo } from '@ipm/shared';

export interface DevicePersister {
  upsertDevice(data: {
    id: string;
    publicKey: string;
    displayName: string;
    hostname: string;
    ipAddress: string;
    tcpPort: number;
    signalingPort: number;
    status: any;
  }): DeviceInfo;
  markDevicesOfflineOlderThan(thresholdMs: number): string[];
  markAllOffline?(exceptIds?: string[]): void;
  getAllDevices(): DeviceInfo[];
  getDeviceById(id: string): DeviceInfo | null;
}

export interface DiscoveryCoordinatorOptions {
  udpPort?: number;
  broadcastIntervalMs?: number;
  offlineTtlMs?: number;
  deviceRepo?: DevicePersister;
}

export class DiscoveryCoordinator extends EventEmitter {
  private udpService: UdpDiscoveryService;
  private mdnsService: MdnsDiscoveryService;
  private networkManager: NetworkInterfaceManager;
  private deviceRepo: DevicePersister | null = null;
  private peers: Map<string, DiscoveredPeerData> = new Map();
  private ttlInterval: NodeJS.Timeout | null = null;
  private offlineTtlMs: number;

  constructor(localMetadata: LocalDeviceMetadata, options: DiscoveryCoordinatorOptions = {}) {
    super();
    this.networkManager = new NetworkInterfaceManager();
    // Peers announce every 10 s; three missed announcements => offline
    this.offlineTtlMs = options.offlineTtlMs ?? 35000;
    this.deviceRepo = options.deviceRepo ?? null;

    this.udpService = new UdpDiscoveryService(localMetadata, {
      port: options.udpPort,
      broadcastIntervalMs: options.broadcastIntervalMs ?? 10000,
      networkManager: this.networkManager,
    });

    this.mdnsService = new MdnsDiscoveryService(localMetadata, this.networkManager);

    this.setupListeners();
  }

  public setDeviceRepository(repo: DevicePersister): void {
    this.deviceRepo = repo;
  }

  private setupListeners(): void {
    const handleDiscovered = (peer: DiscoveredPeerData) => {
      this.handlePeerSeen(peer);
    };

    this.udpService.on('peerDiscovered', handleDiscovered);
    this.mdnsService.on('peerDiscovered', handleDiscovered);

    this.udpService.on('portConflict', (port, err) => {
      this.emit('portConflict', port, err);
    });
  }

  private handlePeerSeen(peer: DiscoveredPeerData): void {
    const existing = this.peers.get(peer.deviceId);
    const isNew = !existing;

    this.peers.set(peer.deviceId, peer);

    let savedDevice: DeviceInfo | null = null;
    if (this.deviceRepo) {
      try {
        savedDevice = this.deviceRepo.upsertDevice({
          id: peer.deviceId,
          publicKey: peer.publicKey,
          displayName: peer.displayName,
          hostname: peer.hostname,
          ipAddress: peer.remoteAddress,
          tcpPort: peer.tcpPort,
          signalingPort: peer.signalingPort,
          status: peer.status,
        });
      } catch (err) {
        console.error('[Discovery Coordinator] Failed to persist device to DB:', err);
      }
    }

    // Always report the address this announcement actually came from (the DB may still
    // hold addresses from other networks the device was on before).
    const payload: DeviceInfo = savedDevice
      ? {
          ...savedDevice,
          ipAddress: peer.remoteAddress,
          tcpPort: peer.tcpPort,
          signalingPort: peer.signalingPort,
          status: peer.status,
        }
      : {
      id: peer.deviceId,
      publicKey: peer.publicKey,
      displayName: peer.displayName,
      hostname: peer.hostname,
      ipAddress: peer.remoteAddress,
      tcpPort: peer.tcpPort,
      signalingPort: peer.signalingPort,
      lastSeen: peer.lastSeen,
      status: peer.status,
      isTrusted: false,
    };

    if (isNew) {
      this.emit('peerDiscovered', payload);
    } else {
      this.emit('peerUpdated', payload);
    }
  }

  public async start(): Promise<void> {
    // Statuses persisted by a previous session are stale: only peers heard from now are online.
    try {
      this.deviceRepo?.markAllOffline?.();
    } catch (err) {
      console.error('[Discovery Coordinator] Failed to reset device statuses:', err);
    }
    await this.udpService.start();
    this.mdnsService.start();

    // Start offline TTL check
    if (this.ttlInterval) clearInterval(this.ttlInterval);
    this.ttlInterval = setInterval(() => {
      this.checkOfflinePeers();
    }, 15000);
  }

  public scanNow(): void {
    this.udpService.broadcastQuery();
    this.udpService.broadcastAnnounce();
    this.mdnsService.query();
    this.mdnsService.announce();
  }

  public updateLocalMetadata(metadata: Partial<LocalDeviceMetadata>): void {
    this.udpService.updateLocalMetadata(metadata);
    this.mdnsService.updateLocalMetadata(metadata);
  }

  private checkOfflinePeers(): void {
    const now = Date.now();
    for (const [deviceId, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > this.offlineTtlMs && peer.status !== 'offline') {
        peer.status = 'offline';
        this.emit('peerOffline', deviceId);
      }
    }

    if (this.deviceRepo) {
      const offlineIds = this.deviceRepo.markDevicesOfflineOlderThan(this.offlineTtlMs);
      for (const id of offlineIds) {
        this.emit('peerOffline', id);
      }
    }
  }

  public getDiscoveredPeers(): DiscoveredPeerData[] {
    return Array.from(this.peers.values());
  }

  public async stop(): Promise<void> {
    if (this.ttlInterval) {
      clearInterval(this.ttlInterval);
      this.ttlInterval = null;
    }
    await this.udpService.stop();
    this.mdnsService.stop();
    this.peers.clear();
  }
}

