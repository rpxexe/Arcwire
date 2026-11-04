import { describe, it, expect, afterAll } from 'vitest';
import { generateDeviceIdentity } from '@ipm/security';
import {
  UdpDiscoveryService,
  LocalDeviceMetadata,
  DiscoveredPeerData,
} from '@ipm/networking';

describe('Integration - UDP Discovery Service', () => {
  let nodeA: UdpDiscoveryService | null = null;
  let nodeB: UdpDiscoveryService | null = null;

  afterAll(async () => {
    if (nodeA) await nodeA.stop();
    if (nodeB) await nodeB.stop();
  });

  it('discovers peer on LAN and verifies cryptographic identity derivation', async () => {
    const identA = generateDeviceIdentity();
    const identB = generateDeviceIdentity();

    const metaA: LocalDeviceMetadata = {
      deviceId: identA.deviceId,
      publicKey: identA.publicKey,
      displayName: 'Alice Computer',
      hostname: 'ALICE-PC',
      osUser: 'alice',
      tcpPort: 45821,
      signalingPort: 45822,
      status: 'online',
    };

    const metaB: LocalDeviceMetadata = {
      deviceId: identB.deviceId,
      publicKey: identB.publicKey,
      displayName: 'Bob Laptop',
      hostname: 'BOB-LAPTOP',
      osUser: 'bob',
      tcpPort: 45823,
      signalingPort: 45824,
      status: 'online',
    };

    // Use test UDP ports
    const portA = 45831;
    const portB = 45832;

    nodeA = new UdpDiscoveryService(metaA, { port: portA });
    nodeB = new UdpDiscoveryService(metaB, { port: portB });

    await nodeA.start();
    await nodeB.start();

    // Node B listens for Node A's announcement
    const nodeBDiscoveredPromise = new Promise<DiscoveredPeerData>((resolve) => {
      nodeB!.once('peerDiscovered', (peer) => {
        resolve(peer);
      });
    });

    // Node A unicasts announce directly to Node B's port
    nodeA.sendAnnounceTo('127.0.0.1', portB);

    const discoveredPeer = await nodeBDiscoveredPromise;

    expect(discoveredPeer.deviceId).toBe(identA.deviceId);
    expect(discoveredPeer.displayName).toBe('Alice Computer');
    expect(discoveredPeer.hostname).toBe('ALICE-PC');
    expect(discoveredPeer.tcpPort).toBe(45821);
    expect(discoveredPeer.status).toBe('online');
  });
});

