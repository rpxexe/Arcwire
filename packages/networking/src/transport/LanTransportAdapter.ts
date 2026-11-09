import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import tls from 'node:tls';
import { NetworkEnvelope, DeviceInfo, DEFAULT_PORTS, IpmEventType, IPM_PROTOCOL } from '@ipm/shared';
import { generateSelfSignedCertificate, TlsCertificate } from '@ipm/security';
import { TransportAdapter } from '../interfaces/TransportAdapter';
import { TlsServer } from './TlsServer';
import { ConnectionPool } from '../connection-manager/ConnectionPool';
import { DiscoveryCoordinator, DevicePersister } from '../discovery/DiscoveryCoordinator';
import { LocalIdentity, HandshakeManager } from '../authentication/HandshakeManager';
import { LocalDeviceMetadata } from '../discovery/UdpDiscoveryService';
import { LanTransportConnection } from './LanTransportConnection';

export interface LanTransportAdapterOptions {
  localIdentity: LocalIdentity;
  localMetadata: LocalDeviceMetadata;
  tcpPort?: number;
  udpPort?: number;
  tlsCert?: TlsCertificate;
  deviceRepo?: DevicePersister;
}

export class LanTransportAdapter extends EventEmitter implements TransportAdapter {
  private localIdentity: LocalIdentity;
  private localMetadata: LocalDeviceMetadata;
  private tlsCert: TlsCertificate | null = null;
  private tlsServer: TlsServer | null = null;
  private connectionPool: ConnectionPool;
  private discoveryCoordinator: DiscoveryCoordinator;
  private messageCallbacks: ((message: NetworkEnvelope) => void)[] = [];
  private isRunning: boolean = false;
  private deviceRepo: DevicePersister | null = null;
  private tcpPort: number;
  private udpPort: number;

  constructor(options: LanTransportAdapterOptions) {
    super();
    this.localIdentity = options.localIdentity;
    this.localMetadata = options.localMetadata;
    this.deviceRepo = options.deviceRepo ?? null;
    this.tlsCert = options.tlsCert ?? null;

    this.tcpPort = options.tcpPort ?? options.localMetadata.tcpPort ?? DEFAULT_PORTS.TCP_MAIN;
    this.udpPort = options.udpPort ?? DEFAULT_PORTS.UDP_DISCOVERY;

    this.connectionPool = new ConnectionPool(this.localIdentity);

    this.discoveryCoordinator = new DiscoveryCoordinator(this.localMetadata, {
      udpPort: this.udpPort,
      deviceRepo: this.deviceRepo ?? undefined,
    });

    this.setupInternalEvents();
  }

  private setupInternalEvents(): void {
    // 1. Incoming messages from ConnectionPool -> Dispatch to listeners & callbacks
    this.connectionPool.on('message', (_peerId, message: NetworkEnvelope) => {
      for (const cb of this.messageCallbacks) {
        try {
          cb(message);
        } catch (err) {
          console.error('[LanTransportAdapter] Error in message callback:', err);
        }
      }
      this.emit('message', message);
    });

    this.connectionPool.on('peerConnected', (peerId, connection) => {
      this.emit('peerConnected', peerId, connection);
    });

    this.connectionPool.on('peerDisconnected', (peerId) => {
      this.emit('peerDisconnected', peerId);
    });

    // 2. Discovery events -> Register with ConnectionPool targets & emit
    this.discoveryCoordinator.on('peerDiscovered', (device: DeviceInfo) => {
      this.connectionPool.registerPeerTarget({
        peerId: device.id,
        ipAddress: device.ipAddress,
        port: device.tcpPort,
      });
      this.emit('deviceDiscovered', device);
    });

    this.discoveryCoordinator.on('peerUpdated', (device: DeviceInfo) => {
      this.connectionPool.registerPeerTarget({
        peerId: device.id,
        ipAddress: device.ipAddress,
        port: device.tcpPort,
      });
      this.emit('deviceUpdated', device);
    });

    this.discoveryCoordinator.on('peerOffline', (deviceId: string) => {
      this.emit('deviceOffline', deviceId);
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    // Generate self-signed TLS cert if not provided
    if (!this.tlsCert) {
      this.tlsCert = await generateSelfSignedCertificate({ commonName: this.localMetadata.hostname });
    }

    this.tlsServer = new TlsServer({
      port: this.tcpPort,
      tlsCert: this.tlsCert,
      localIdentity: this.localIdentity,
    });

    this.tlsServer.on('connection', (connection) => {
      this.connectionPool.addConnection(connection);
    });

    this.tlsServer.on('portConflict', (port, err) => {
      this.emit('portConflict', 'tcp', port, err);
    });

    // Start TLS server
    const actualTcpPort = await this.tlsServer.start();
    this.localMetadata.tcpPort = actualTcpPort;

    // Start Discovery Coordinator
    await this.discoveryCoordinator.start();

    this.isRunning = true;
    this.emit('ready', { tcpPort: actualTcpPort });
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    await this.discoveryCoordinator.stop();
    await this.connectionPool.destroy();
    if (this.tlsServer) {
      await this.tlsServer.stop();
      this.tlsServer = null;
    }
  }

  public async connect(peerId: string): Promise<void> {
    const target = this.connectionPool.getPeerTarget(peerId);
    if (!target) {
      const device = this.deviceRepo?.getDeviceById(peerId);
      if (device && device.ipAddress && device.ipAddress !== 'unknown') {
        await this.connectionPool.connectToPeer(peerId, device.ipAddress, device.tcpPort);
        return;
      }
      throw new Error(`Cannot connect to unknown peer ${peerId}`);
    }

    await this.connectionPool.connectToPeer(target.peerId, target.ipAddress, target.port);
  }

  /**
   * Connects directly to a specific IP address and port (Manual Direct Connect).
   * Executes TLS handshake and retrieves remote device identity.
   */
  public async connectDirect(ipAddress: string, port: number = DEFAULT_PORTS.TCP_MAIN): Promise<DeviceInfo> {
    const tempConnection = await this.connectionPool.connectToPeer('*_direct', ipAddress, port, 8000).catch(() => {
      return new Promise<LanTransportConnection>((resolve, reject) => {
        const rawSocket = tls.connect(
          {
            host: ipAddress,
            port,
            minVersion: 'TLSv1.3',
            rejectUnauthorized: false,
          },
          async () => {
            try {
              const conn = new LanTransportConnection(rawSocket);
              const handshake = new HandshakeManager(this.localIdentity, 8000);
              await handshake.performInitiatorHandshake(conn);
              this.connectionPool.addConnection(conn);
              resolve(conn);
            } catch (err) {
              rawSocket.destroy();
              reject(err);
            }
          }
        );

        rawSocket.setTimeout(8000, () => {
          rawSocket.destroy();
          reject(new Error(`Direct connection to ${ipAddress}:${port} timed out`));
        });

        rawSocket.on('error', (err) => {
          reject(err);
        });
      });
    });

    const peerId = tempConnection.peerId;
    const publicKey = tempConnection.publicKey;

    let device = this.deviceRepo?.getDeviceById(peerId);
    if (!device && this.deviceRepo) {
      device = this.deviceRepo.upsertDevice({
        id: peerId,
        publicKey,
        displayName: `Peer (${ipAddress})`,
        hostname: ipAddress,
        ipAddress,
        tcpPort: port,
        signalingPort: DEFAULT_PORTS.TCP_SIGNALING,
        status: 'online',
      });
    }

    const resultDevice: DeviceInfo = device ?? {
      id: peerId,
      publicKey,
      displayName: `Peer (${ipAddress})`,
      hostname: ipAddress,
      ipAddress,
      tcpPort: port,
      signalingPort: DEFAULT_PORTS.TCP_SIGNALING,
      lastSeen: Date.now(),
      status: 'online',
      isTrusted: false,
    };

    this.connectionPool.registerPeerTarget({
      peerId,
      ipAddress,
      port,
    });

    this.emit('deviceDiscovered', resultDevice);
    return resultDevice;
  }

  public async disconnect(peerId: string): Promise<void> {
    await this.connectionPool.disconnect(peerId);
  }

  public async send(peerId: string, message: NetworkEnvelope): Promise<void> {
    if (!this.connectionPool.getPeerTarget(peerId) && this.deviceRepo) {
      const device = this.deviceRepo.getDeviceById(peerId);
      if (device && device.ipAddress && device.ipAddress !== 'unknown') {
        this.connectionPool.registerPeerTarget({
          peerId,
          ipAddress: device.ipAddress,
          port: device.tcpPort || DEFAULT_PORTS.TCP_MAIN,
        });
      }
    }
    await this.connectionPool.send(peerId, message);
  }

  /**
   * Helper to construct a standard NetworkEnvelope and send it to a peer.
   */
  public async sendPayload(
    peerId: string,
    type: IpmEventType,
    payload: Record<string, any>,
    conversationId: string = 'global'
  ): Promise<void> {
    const envelope: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: randomUUID(),
      type,
      senderId: this.localIdentity.deviceId,
      receiverId: peerId,
      conversationId,
      timestamp: Date.now(),
      sequence: 0,
      payload,
    };
    await this.send(peerId, envelope);
  }

  public onMessage(callback: (message: NetworkEnvelope) => void): void {
    this.messageCallbacks.push(callback);
  }

  public scanNow(): void {
    this.discoveryCoordinator.scanNow();
  }

  public updateProfile(metadata: Partial<LocalDeviceMetadata>): void {
    this.localMetadata = { ...this.localMetadata, ...metadata };
    this.discoveryCoordinator.updateLocalMetadata(metadata);
  }

  public getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }

  public getDiscoveryCoordinator(): DiscoveryCoordinator {
    return this.discoveryCoordinator;
  }

  public getTlsServer(): TlsServer | null {
    return this.tlsServer;
  }
}
