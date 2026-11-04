/**
 * LAN ICE Configuration.
 * 
 * Per project specification:
 * "Use the authenticated local signaling service.
 *  Do not silently use external STUN or TURN services in LAN-only mode."
 * 
 * Empty iceServers forces WebRTC to gather host candidates directly on local
 * network interfaces (Ethernet / Wi-Fi) without contacting external stun servers.
 */
export class LanIceConfig {
  public static getConfiguration(): { iceServers: any[]; iceTransportPolicy: 'all' } {
    return {
      iceServers: [],
      iceTransportPolicy: 'all',
    };
  }

  public static isHostCandidate(candidateStr: string): boolean {
    return candidateStr.includes('typ host');
  }
}

