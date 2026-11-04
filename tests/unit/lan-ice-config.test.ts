import { describe, it, expect } from 'vitest';
import { LanIceConfig } from '@ipm/calling';

describe('LanIceConfig (Pure LAN WebRTC Constraint)', () => {
  it('returns WebRTC configuration strictly with empty iceServers array', () => {
    const config = LanIceConfig.getConfiguration();

    // Section 12 Specification:
    // "Do not silently use external STUN or TURN services in LAN-only mode."
    expect(config.iceServers).toBeDefined();
    expect(config.iceServers).toHaveLength(0);
    expect(config.iceTransportPolicy).toBe('all');
  });

  it('correctly identifies local host ICE candidates and rejects remote relay/reflexive candidates', () => {
    const hostCandidate =
      'candidate:842163049 1 udp 1677729535 192.168.1.150 54321 typ host generation 0';
    const srflxCandidate =
      'candidate:169278128 1 udp 2113937151 203.0.113.195 54321 typ srflx raddr 192.168.1.150 rport 54321 generation 0';
    const relayCandidate =
      'candidate:329182390 1 udp 16777215 198.51.100.2 54321 typ relay raddr 203.0.113.195 rport 54321 generation 0';

    expect(LanIceConfig.isHostCandidate(hostCandidate)).toBe(true);
    expect(LanIceConfig.isHostCandidate(srflxCandidate)).toBe(false);
    expect(LanIceConfig.isHostCandidate(relayCandidate)).toBe(false);
  });
});
