import { describe, it, expect } from 'vitest';
import {
  calculateBroadcastAddress,
  NetworkInterfaceManager,
} from '@ipm/networking';

describe('NetworkInterfaceManager - Broadcast Calculations', () => {
  it('correctly calculates standard /24 subnet broadcast', () => {
    const broadcast = calculateBroadcastAddress('192.168.1.50', '255.255.255.0');
    expect(broadcast).toBe('192.168.1.255');
  });

  it('correctly calculates standard /16 subnet broadcast', () => {
    const broadcast = calculateBroadcastAddress('172.16.20.10', '255.255.0.0');
    expect(broadcast).toBe('172.16.255.255');
  });

  it('correctly calculates standard /8 subnet broadcast', () => {
    const broadcast = calculateBroadcastAddress('10.5.20.1', '255.0.0.0');
    expect(broadcast).toBe('10.255.255.255');
  });

  it('correctly calculates non-standard /28 subnet broadcast', () => {
    // 255.255.255.240 = /28 mask. For 192.168.1.18, subnet is 192.168.1.16/28, broadcast is 192.168.1.31
    const broadcast = calculateBroadcastAddress('192.168.1.18', '255.255.255.240');
    expect(broadcast).toBe('192.168.1.31');
  });

  it('falls back to 255.255.255.255 on malformed inputs', () => {
    const broadcast = calculateBroadcastAddress('not-an-ip', '255.255.255.0');
    expect(broadcast).toBe('255.255.255.255');
  });

  it('enumerates active non-internal interfaces and includes broadcast addresses', () => {
    const manager = new NetworkInterfaceManager();
    const ifaces = manager.getActiveInterfaces();

    // Verify all returned interfaces are valid IPv4 and non-internal
    for (const iface of ifaces) {
      expect(iface.family).toBe('IPv4');
      expect(iface.address).toBeDefined();
      expect(iface.broadcast).toBeDefined();
    }

    const broadcasts = manager.getBroadcastAddresses();
    expect(broadcasts).toContain('255.255.255.255');
  });
});

