import { describe, it, expect, vi } from 'vitest';
import { CallStatsMonitor, CallSession, WebRtcSignalingManager } from '@ipm/calling';
import {
  ScreenShareOptionsSchema,
  DesktopSourceItemSchema,
  IpmEventType,
  NetworkEnvelope,
  IPM_PROTOCOL,
} from '@ipm/shared';

describe('Screen Sharing (Phase 7 - Architecture Section 12)', () => {
  describe('CallStatsMonitor', () => {
    it('parses RTCStatsReport into clean CallStats structure', () => {
      const monitor = new CallStatsMonitor();

      // Mock RTCStatsReport Map
      const mockReport = new Map<string, any>([
        [
          'inbound-video-1',
          {
            type: 'inbound-rtp',
            kind: 'video',
            frameWidth: 1920,
            frameHeight: 1080,
            framesPerSecond: 60,
            bytesReceived: 500000,
            packetsLost: 2,
            packetsReceived: 98,
          },
        ],
        [
          'candidate-pair-1',
          {
            type: 'candidate-pair',
            state: 'succeeded',
            currentRoundTripTime: 0.005, // 5 ms
          },
        ],
      ]);

      const stats = monitor.parseStatsReport(mockReport);

      expect(stats).toBeDefined();
      expect(stats.resolution).toBe('1920x1080');
      expect(stats.fps).toBe(60);
      expect(stats.packetLossPercentage).toBe(2);
      expect(stats.latencyMs).toBe(5);
    });

    it('handles empty or missing stats report with sensible fallbacks', () => {
      const monitor = new CallStatsMonitor();
      const stats = monitor.parseStatsReport(null);

      expect(stats.resolution).toBe('1280x720');
      expect(stats.fps).toBe(30);
      expect(stats.packetLossPercentage).toBe(0);
      expect(stats.latencyMs).toBe(2);
    });
  });

  describe('CallSession Screen Sharing State Machine', () => {
    it('toggles screen sharing state and emits screenShareToggled event with source name', () => {
      const session = new CallSession({
        callId: 'call_share_1',
        conversationId: 'conv_1',
        peerDeviceId: 'dev_bob',
        callType: 'voice',
        direction: 'outgoing',
      });

      expect(session.isScreenSharing).toBe(false);
      expect(session.sharedSourceName).toBeNull();

      const onToggled = vi.fn();
      session.on('screenShareToggled', onToggled);

      // Start screen sharing
      session.setScreenSharing(true, 'Visual Studio Code - Arcwire');
      expect(session.isScreenSharing).toBe(true);
      expect(session.sharedSourceName).toBe('Visual Studio Code - Arcwire');
      expect(session.callType).toBe('screen');
      expect(onToggled).toHaveBeenCalledWith({
        isScreenSharing: true,
        sourceName: 'Visual Studio Code - Arcwire',
      });

      // Stop screen sharing
      session.setScreenSharing(false);
      expect(session.isScreenSharing).toBe(false);
      expect(session.sharedSourceName).toBeNull();
      expect(onToggled).toHaveBeenCalledWith({
        isScreenSharing: false,
        sourceName: null,
      });
    });
  });

  describe('WebRtcSignalingManager Screen Sharing Packets', () => {
    it('sends SCREEN_SHARE_START and SCREEN_SHARE_STOP over LAN transport adapter', async () => {
      const mockSendPayload = vi.fn().mockResolvedValue(undefined);
      const mockAdapter = {
        sendPayload: mockSendPayload,
      } as any;

      const manager = new WebRtcSignalingManager('dev_alice', () => mockAdapter);

      // Send start screen share
      await manager.sendScreenShareStart(
        'dev_bob',
        'call_123',
        'Display 1 (1920x1080)',
        'conv_main'
      );

      expect(mockSendPayload).toHaveBeenCalledWith(
        'dev_bob',
        IpmEventType.SCREEN_SHARE_START,
        {
          callId: 'call_123',
          senderDeviceId: 'dev_alice',
          sourceName: 'Display 1 (1920x1080)',
          isSharing: true,
        },
        'conv_main'
      );

      // Send stop screen share
      await manager.sendScreenShareStop('dev_bob', 'call_123', 'conv_main');

      expect(mockSendPayload).toHaveBeenCalledWith(
        'dev_bob',
        IpmEventType.SCREEN_SHARE_STOP,
        {
          callId: 'call_123',
          senderDeviceId: 'dev_alice',
          isSharing: false,
        },
        'conv_main'
      );
    });

    it('emits screenShareStart and screenShareStop on incoming network envelopes', () => {
      const manager = new WebRtcSignalingManager('dev_bob', () => null);

      const onStart = vi.fn();
      const onStop = vi.fn();

      manager.on('screenShareStart', onStart);
      manager.on('screenShareStop', onStop);

      // Incoming SCREEN_SHARE_START
      manager.handleIncomingEnvelope({
        version: IPM_PROTOCOL.VERSION,
        id: 'env_start',
        senderDeviceId: 'dev_alice',
        targetDeviceId: 'dev_bob',
        type: IpmEventType.SCREEN_SHARE_START,
        payload: {
          callId: 'call_abc',
          senderDeviceId: 'dev_alice',
          sourceName: 'Figma - UI Design',
          isSharing: true,
        },
        timestamp: Date.now(),
      });

      expect(onStart).toHaveBeenCalledWith({
        callId: 'call_abc',
        senderDeviceId: 'dev_alice',
        sourceName: 'Figma - UI Design',
        isSharing: true,
      });

      // Incoming SCREEN_SHARE_STOP
      manager.handleIncomingEnvelope({
        version: IPM_PROTOCOL.VERSION,
        id: 'env_stop',
        senderDeviceId: 'dev_alice',
        targetDeviceId: 'dev_bob',
        type: IpmEventType.SCREEN_SHARE_STOP,
        payload: {
          callId: 'call_abc',
          senderDeviceId: 'dev_alice',
          isSharing: false,
        },
        timestamp: Date.now(),
      });

      expect(onStop).toHaveBeenCalledWith({
        callId: 'call_abc',
        senderDeviceId: 'dev_alice',
        isSharing: false,
      });
    });
  });

  describe('ScreenShareOptionsSchema & DesktopSourceItemSchema', () => {
    it('validates screen share options with presets and applies defaults', () => {
      const parsedDefault = ScreenShareOptionsSchema.parse({
        sourceId: 'screen:0:0',
      });

      expect(parsedDefault.sourceId).toBe('screen:0:0');
      expect(parsedDefault.preset).toBe('balanced');
      expect(parsedDefault.maxFrameRate).toBe(30);
      expect(parsedDefault.contentHint).toBe('detail');
      expect(parsedDefault.withAudio).toBe(false);

      const parsedSmooth = ScreenShareOptionsSchema.parse({
        sourceId: 'window:1234:0',
        preset: 'smooth',
        maxFrameRate: 60,
        contentHint: 'motion',
        withAudio: true,
      });

      expect(parsedSmooth.preset).toBe('smooth');
      expect(parsedSmooth.maxFrameRate).toBe(60);
      expect(parsedSmooth.contentHint).toBe('motion');
      expect(parsedSmooth.withAudio).toBe(true);
    });

    it('validates DesktopSourceItem schema with appIcon and source type', () => {
      const source = DesktopSourceItemSchema.parse({
        id: 'window:456:0',
        name: 'Google Chrome',
        thumbnail: 'data:image/png;base64,abc...',
        appIcon: 'data:image/png;base64,icon...',
        type: 'window',
      });

      expect(source.type).toBe('window');
      expect(source.appIcon).toContain('icon');
    });
  });
});
