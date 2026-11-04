import mdns from 'multicast-dns';
import { EventEmitter } from 'node:events';
import { deriveDeviceId } from '@ipm/security';
import { UserStatus } from '@ipm/shared';
import { LocalDeviceMetadata, DiscoveredPeerData } from './UdpDiscoveryService';
import { NetworkInterfaceManager } from './NetworkInterfaceManager';

export const MDNS_SERVICE_NAME = '_ipm._tcp.local';

export class MdnsDiscoveryService extends EventEmitter {
  private mDnsInstance: any = null;
  private localMetadata: LocalDeviceMetadata;
  private networkManager: NetworkInterfaceManager;
  private isRunning: boolean = false;

  constructor(localMetadata: LocalDeviceMetadata, networkManager?: NetworkInterfaceManager) {
    super();
    this.localMetadata = localMetadata;
    this.networkManager = networkManager ?? new NetworkInterfaceManager();
  }

  public updateLocalMetadata(metadata: Partial<LocalDeviceMetadata>): void {
    this.localMetadata = { ...this.localMetadata, ...metadata };
    if (this.isRunning) {
      this.announce();
    }
  }

  public start(): void {
    if (this.isRunning) return;

    try {
      this.mDnsInstance = mdns();

      this.mDnsInstance.on('query', (query: any) => {
        this.handleQuery(query);
      });

      this.mDnsInstance.on('response', (response: any) => {
        this.handleResponse(response);
      });

      this.isRunning = true;
      this.announce();
      this.query();
    } catch (err) {
      console.warn('[mDNS Discovery] Failed to initialize multicast-dns:', err);
    }
  }

  private handleQuery(query: any): void {
    if (!this.isRunning || !this.mDnsInstance) return;

    const questions = query.questions || [];
    const isInterested = questions.some((q: any) => q.name === MDNS_SERVICE_NAME);

    if (isInterested) {
      this.announce();
    }
  }

  private handleResponse(response: any): void {
    try {
      const answers = response.answers || [];
      const additionals = response.additionals || [];
      const allRecords = [...answers, ...additionals];

      const txtRecord = allRecords.find((r) => r.type === 'TXT' && r.name === MDNS_SERVICE_NAME);
      const srvRecord = allRecords.find((r) => r.type === 'SRV');
      const aRecord = allRecords.find((r) => r.type === 'A');

      if (!txtRecord || !txtRecord.data) return;

      const txtMap: Record<string, string> = {};
      const entries: (Buffer | string)[] = Array.isArray(txtRecord.data) ? txtRecord.data : [txtRecord.data];

      for (const entry of entries) {
        const str = Buffer.isBuffer(entry) ? entry.toString('utf8') : String(entry);
        const [k, ...rest] = str.split('=');
        if (k) txtMap[k] = rest.join('=');
      }

      const deviceId = txtMap.id;
      const publicKey = txtMap.pub;
      const displayName = txtMap.name;
      const osUser = txtMap.user ?? 'unknown';
      const status = (txtMap.status as UserStatus) ?? 'online';
      const signalingPort = Number(txtMap.sig || 45822);
      const tcpPort = srvRecord?.data?.port ? Number(srvRecord.data.port) : Number(txtMap.port || 45821);
      const ipAddress = aRecord?.data || '127.0.0.1';

      if (!deviceId || !publicKey || !displayName) return;

      // Ignore our own announcement
      if (deviceId === this.localMetadata.deviceId) return;

      // Validate deviceId derivation
      const derivedId = deriveDeviceId(publicKey);
      if (derivedId !== deviceId) {
        console.warn(`[mDNS Discovery] Rejected spoofed deviceId from ${ipAddress}`);
        return;
      }

      const peerData: DiscoveredPeerData = {
        deviceId,
        publicKey,
        displayName,
        hostname: srvRecord?.data?.target?.replace(/\.local$/, '') ?? 'unknown',
        osUser,
        tcpPort,
        signalingPort,
        status,
        remoteAddress: ipAddress,
        lastSeen: Date.now(),
      };

      this.emit('peerDiscovered', peerData);
    } catch {
      // Discard invalid mDNS packets
    }
  }

  public announce(): void {
    if (!this.mDnsInstance || !this.isRunning) return;

    const ifaces = this.networkManager.getActiveInterfaces();
    const primaryIp = ifaces[0]?.address ?? '127.0.0.1';
    const hostTarget = `${this.localMetadata.hostname}.local`;

    const txtData = [
      `id=${this.localMetadata.deviceId}`,
      `name=${this.localMetadata.displayName}`,
      `user=${this.localMetadata.osUser}`,
      `pub=${this.localMetadata.publicKey}`,
      `status=${this.localMetadata.status}`,
      `port=${this.localMetadata.tcpPort}`,
      `sig=${this.localMetadata.signalingPort}`,
    ];

    try {
      this.mDnsInstance.respond({
        answers: [
          {
            name: MDNS_SERVICE_NAME,
            type: 'PTR',
            data: MDNS_SERVICE_NAME,
          },
          {
            name: MDNS_SERVICE_NAME,
            type: 'SRV',
            data: {
              port: this.localMetadata.tcpPort,
              weight: 0,
              priority: 10,
              target: hostTarget,
            },
          },
          {
            name: MDNS_SERVICE_NAME,
            type: 'TXT',
            data: txtData,
          },
          {
            name: hostTarget,
            type: 'A',
            data: primaryIp,
          },
        ],
      });
    } catch (e) {
      console.warn('[mDNS Discovery] Failed to send mDNS response:', e);
    }
  }

  public query(): void {
    if (!this.mDnsInstance || !this.isRunning) return;

    try {
      this.mDnsInstance.query({
        questions: [
          {
            name: MDNS_SERVICE_NAME,
            type: 'PTR',
          },
        ],
      });
    } catch (e) {
      console.warn('[mDNS Discovery] Failed to send mDNS query:', e);
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.mDnsInstance) {
      try {
        this.mDnsInstance.destroy();
      } catch {
        // Ignore
      }
      this.mDnsInstance = null;
    }
  }
}

