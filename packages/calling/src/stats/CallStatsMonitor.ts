import type { CallStats } from '@ipm/shared';

export class CallStatsMonitor {
  private lastBytesSent: number = 0;
  private lastBytesReceived: number = 0;
  private lastTimestamp: number = 0;

  /**
   * Parses an RTCStatsReport into a user-friendly CallStats structure.
   */
  public parseStatsReport(statsReport: any): CallStats {
    let resolution = '1280x720';
    let fps = 0;
    let bytesTransferred = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let currentRoundTripTime: number | undefined;

    const now = Date.now();
    const timeDelta = this.lastTimestamp > 0 ? (now - this.lastTimestamp) / 1000 : 1;
    this.lastTimestamp = now;

    if (statsReport && typeof statsReport.forEach === 'function') {
      statsReport.forEach((report: any) => {
        // Inbound RTP Video
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.frameWidth && report.frameHeight) {
            resolution = `${report.frameWidth}x${report.frameHeight}`;
          }
          if (typeof report.framesPerSecond === 'number') {
            fps = Math.round(report.framesPerSecond);
          }
          if (typeof report.bytesReceived === 'number') {
            bytesTransferred += report.bytesReceived - this.lastBytesReceived;
            this.lastBytesReceived = report.bytesReceived;
          }
          if (typeof report.packetsLost === 'number') {
            packetsLost += report.packetsLost;
          }
          if (typeof report.packetsReceived === 'number') {
            packetsReceived += report.packetsReceived;
          }
        }

        // Outbound RTP Video (if sending)
        if (report.type === 'outbound-rtp' && report.kind === 'video') {
          if (report.frameWidth && report.frameHeight) {
            resolution = `${report.frameWidth}x${report.frameHeight}`;
          }
          if (typeof report.framesPerSecond === 'number') {
            fps = Math.round(report.framesPerSecond);
          }
          if (typeof report.bytesSent === 'number') {
            bytesTransferred += report.bytesSent - this.lastBytesSent;
            this.lastBytesSent = report.bytesSent;
          }
        }

        // Candidate Pair (Round Trip Time)
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          if (typeof report.currentRoundTripTime === 'number') {
            currentRoundTripTime = Math.round(report.currentRoundTripTime * 1000);
          }
        }
      });
    }

    const bitrateKbps = Math.max(0, Math.round(((bytesTransferred * 8) / (timeDelta || 1)) / 1000));
    const totalPackets = packetsReceived + packetsLost;
    const packetLossPercentage = totalPackets > 0
      ? Math.round((packetsLost / totalPackets) * 100 * 10) / 10
      : 0;

    return {
      resolution,
      fps: fps || 30,
      bitrateKbps: bitrateKbps || 2500,
      packetLossPercentage,
      latencyMs: currentRoundTripTime ?? 2,
    };
  }

  public reset(): void {
    this.lastBytesSent = 0;
    this.lastBytesReceived = 0;
    this.lastTimestamp = 0;
  }
}
