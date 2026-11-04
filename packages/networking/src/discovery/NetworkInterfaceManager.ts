import os from 'node:os';
import { EventEmitter } from 'node:events';

export interface ActiveInterface {
  name: string;
  address: string;
  netmask: string;
  broadcast: string;
  mac: string;
  family: string;
}

/**
 * Computes IPv4 subnet broadcast address from IP address and netmask.
 * Example: IP 192.168.1.50 with Netmask 255.255.255.0 yields 192.168.1.255.
 */
export function calculateBroadcastAddress(ip: string, netmask: string): string {
  const ipOctets = ip.split('.').map(Number);
  const maskOctets = netmask.split('.').map(Number);

  if (ipOctets.length !== 4 || maskOctets.length !== 4) {
    return '255.255.255.255';
  }

  const broadcastOctets = ipOctets.map((octet, index) => {
    const mask = maskOctets[index] ?? 255;
    const invertedMask = (~mask) & 0xff;
    return octet | invertedMask;
  });

  return broadcastOctets.join('.');
}

export class NetworkInterfaceManager extends EventEmitter {
  private lastKnownAddresses: Set<string> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Enumerates all active non-internal IPv4 interfaces and determines their broadcast addresses.
   */
  public getActiveInterfaces(): ActiveInterface[] {
    const interfaces = os.networkInterfaces();
    const active: ActiveInterface[] = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;

      for (const info of addrs) {
        // Only select non-internal IPv4 interfaces
        if (info.family === 'IPv4' && !info.internal && info.address) {
          const netmask = info.netmask || '255.255.255.0';
          const broadcast = calculateBroadcastAddress(info.address, netmask);

          active.push({
            name,
            address: info.address,
            netmask,
            broadcast,
            mac: info.mac,
            family: info.family,
          });
        }
      }
    }

    return active;
  }

  /**
   * Retrieves unique broadcast destinations across all active adapters plus global broadcast.
   */
  public getBroadcastAddresses(): string[] {
    const active = this.getActiveInterfaces();
    const broadcasts = new Set<string>();

    for (const iface of active) {
      broadcasts.add(iface.broadcast);
    }
    // Always include standard LAN fallback broadcast
    broadcasts.add('255.255.255.255');

    return Array.from(broadcasts);
  }

  /**
   * Starts monitoring for network changes (e.g. connecting to Wi-Fi, plugging Ethernet cable).
   */
  public startMonitoring(intervalMs: number = 5000): void {
    this.updateKnownAddresses();

    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(() => {
      const current = this.getActiveInterfaces();
      const currentAddrs = new Set(current.map((i) => i.address));

      let hasChanged = false;
      if (currentAddrs.size !== this.lastKnownAddresses.size) {
        hasChanged = true;
      } else {
        for (const addr of currentAddrs) {
          if (!this.lastKnownAddresses.has(addr)) {
            hasChanged = true;
            break;
          }
        }
      }

      if (hasChanged) {
        this.lastKnownAddresses = currentAddrs;
        this.emit('networkChange', current);
      }
    }, intervalMs);
  }

  public stopMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private updateKnownAddresses(): void {
    const current = this.getActiveInterfaces();
    this.lastKnownAddresses = new Set(current.map((i) => i.address));
  }
}

