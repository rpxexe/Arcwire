import type { CallStats, CallStreamStats } from '@ipm/shared';

interface ByteSample {
  bytes: number;
  timestamp: number;
}

/**
 * Turns RTCStatsReports into user-facing call diagnostics.
 *
 * Sending (outbound) and receiving (inbound) video are reported separately so that
 * statistics stay correct when a screen share replaces or is added next to the camera.
 * Bitrates are computed per RTP stream id from the report's own timestamps.
 */
export class CallStatsMonitor {
  private samples = new Map<string, ByteSample>();

  private bitrateFor(id: string, bytes: number | undefined, timestamp: number): number {
    if (typeof bytes !== 'number') return 0;
    const prev = this.samples.get(id);
    this.samples.set(id, { bytes, timestamp });
    if (!prev || timestamp <= prev.timestamp || bytes < prev.bytes) return 0;
    const seconds = (timestamp - prev.timestamp) / 1000;
    return Math.round(((bytes - prev.bytes) * 8) / seconds / 1000);
  }

  public parseStatsReport(statsReport: any): CallStats {
    const reports: any[] = [];
    if (statsReport && typeof statsReport.forEach === 'function') {
      statsReport.forEach((r: any) => reports.push(r));
    }
    const byId = new Map<string, any>(reports.map((r) => [r.id, r]));
    const codecName = (codecId?: string) => {
      const c = codecId ? byId.get(codecId) : undefined;
      return c?.mimeType ? String(c.mimeType).split('/')[1] : undefined;
    };

    let outbound: CallStreamStats | null = null;
    let inbound: CallStreamStats | null = null;
    let outboundScore = -1;
    let inboundScore = -1;
    let audioBitrateKbps = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let jitterMs: number | undefined;
    let latencyMs: number | undefined;

    for (const r of reports) {
      const ts = typeof r.timestamp === 'number' ? r.timestamp : Date.now();

      if (r.type === 'outbound-rtp' && r.kind === 'video') {
        const bitrate = this.bitrateFor(r.id, r.bytesSent, ts);
        // Resolution may live on the media-source report (when no frames encoded yet)
        const source = r.mediaSourceId ? byId.get(r.mediaSourceId) : undefined;
        const width = r.frameWidth ?? source?.width;
        const height = r.frameHeight ?? source?.height;
        const fps = r.framesPerSecond ?? source?.framesPerSecond ?? 0;
        // Pick the stream actually carrying data (an idle transceiver reports 0)
        const score = bitrate + (width ? 1 : 0);
        if (width && height && score > outboundScore) {
          outboundScore = score;
          outbound = {
            resolution: `${width}x${height}`,
            fps: Math.round(fps),
            bitrateKbps: bitrate,
            codec: codecName(r.codecId),
          };
        }
      } else if (r.type === 'inbound-rtp' && r.kind === 'video') {
        const bitrate = this.bitrateFor(r.id, r.bytesReceived, ts);
        if (typeof r.packetsLost === 'number') packetsLost += Math.max(0, r.packetsLost);
        if (typeof r.packetsReceived === 'number') packetsReceived += r.packetsReceived;
        if (typeof r.jitter === 'number') jitterMs = Math.round(r.jitter * 1000);
        const score = bitrate + (r.frameWidth ? 1 : 0);
        if (r.frameWidth && r.frameHeight && score > inboundScore) {
          inboundScore = score;
          inbound = {
            resolution: `${r.frameWidth}x${r.frameHeight}`,
            fps: Math.round(r.framesPerSecond ?? 0),
            bitrateKbps: bitrate,
            codec: codecName(r.codecId),
          };
        }
      } else if (r.type === 'inbound-rtp' && r.kind === 'audio') {
        audioBitrateKbps += this.bitrateFor(r.id, r.bytesReceived, ts);
        if (typeof r.packetsLost === 'number') packetsLost += Math.max(0, r.packetsLost);
        if (typeof r.packetsReceived === 'number') packetsReceived += r.packetsReceived;
        if (jitterMs === undefined && typeof r.jitter === 'number') jitterMs = Math.round(r.jitter * 1000);
      } else if (r.type === 'outbound-rtp' && r.kind === 'audio') {
        audioBitrateKbps += this.bitrateFor(r.id, r.bytesSent, ts);
      } else if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated !== false) {
        if (typeof r.currentRoundTripTime === 'number') {
          latencyMs = Math.round(r.currentRoundTripTime * 1000);
        }
      }
    }

    // Fallback RTT from transport's selected pair
    if (latencyMs === undefined) {
      const transport = reports.find((r) => r.type === 'transport' && r.selectedCandidatePairId);
      const pair = transport ? byId.get(transport.selectedCandidatePairId) : undefined;
      if (pair && typeof pair.currentRoundTripTime === 'number') {
        latencyMs = Math.round(pair.currentRoundTripTime * 1000);
      }
    }

    const totalPackets = packetsReceived + packetsLost;
    const packetLossPercentage = totalPackets > 0 ? Math.round((packetsLost / totalPackets) * 1000) / 10 : 0;

    // Headline values prefer what the user is looking at: the incoming video,
    // otherwise what we are sending.
    const primary = inbound ?? outbound;
    const totalVideoKbps = (inbound?.bitrateKbps ?? 0) + (outbound?.bitrateKbps ?? 0);

    return {
      resolution: primary?.resolution ?? '—',
      fps: primary?.fps ?? 0,
      bitrateKbps: totalVideoKbps + audioBitrateKbps,
      packetLossPercentage,
      latencyMs,
      outbound,
      inbound,
      audioBitrateKbps,
      jitterMs,
    };
  }

  public reset(): void {
    this.samples.clear();
  }
}
