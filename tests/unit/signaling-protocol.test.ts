import { describe, it, expect, vi } from 'vitest';
import { WebRtcSignalingManager, CallSession } from '@ipm/calling';
import { IpmEventType } from '@ipm/shared';

describe('WebRtcSignalingManager & CallSession State Machine', () => {
  it('dispatches CALL_REQUEST payload over LAN adapter', async () => {
    const mockSendPayload = vi.fn().mockResolvedValue(undefined);
    const mockAdapter = {
      sendPayload: mockSendPayload,
    } as any;

    const manager = new WebRtcSignalingManager('dev_alice', () => mockAdapter);
    const callId = await manager.sendCallRequest('dev_bob', 'conv_123', 'video');

    expect(callId).toBeDefined();
    expect(mockSendPayload).toHaveBeenCalledWith(
      'dev_bob',
      IpmEventType.CALL_REQUEST,
      {
        callId,
        conversationId: 'conv_123',
        callerDeviceId: 'dev_alice',
        callType: 'video',
      },
      'conv_123'
    );
  });

  it('dispatches CALL_ACCEPT, CALL_REJECT, and CALL_END over LAN adapter', async () => {
    const mockSendPayload = vi.fn().mockResolvedValue(undefined);
    const mockAdapter = {
      sendPayload: mockSendPayload,
    } as any;

    const manager = new WebRtcSignalingManager('dev_bob', () => mockAdapter);

    await manager.sendCallAccept('dev_alice', 'call_abc', 'conv_123');
    expect(mockSendPayload).toHaveBeenCalledWith(
      'dev_alice',
      IpmEventType.CALL_ACCEPT,
      { callId: 'call_abc', responderDeviceId: 'dev_bob' },
      'conv_123'
    );

    await manager.sendCallReject('dev_alice', 'call_abc', 'conv_123');
    expect(mockSendPayload).toHaveBeenCalledWith(
      'dev_alice',
      IpmEventType.CALL_REJECT,
      { callId: 'call_abc', responderDeviceId: 'dev_bob' },
      'conv_123'
    );

    await manager.sendCallEnd('dev_alice', 'call_abc', 'conv_123', 'user_hangup');
    expect(mockSendPayload).toHaveBeenCalledWith(
      'dev_alice',
      IpmEventType.CALL_END,
      { callId: 'call_abc', senderDeviceId: 'dev_bob', reason: 'user_hangup' },
      'conv_123'
    );
  });

  it('dispatches WebRTC signals (offer, answer, ice-candidate) over LAN transport', async () => {
    const mockSendPayload = vi.fn().mockResolvedValue(undefined);
    const mockAdapter = {
      sendPayload: mockSendPayload,
    } as any;

    const manager = new WebRtcSignalingManager('dev_alice', () => mockAdapter);

    const fakeSdp = { type: 'offer', sdp: 'v=0...' };
    await manager.sendSignal('dev_bob', 'call_abc', 'offer', fakeSdp, 'conv_123');

    expect(mockSendPayload).toHaveBeenCalledWith(
      'dev_bob',
      IpmEventType.CALL_SIGNAL,
      {
        callId: 'call_abc',
        targetDeviceId: 'dev_bob',
        signalType: 'offer',
        data: fakeSdp,
      },
      'conv_123'
    );
  });

  it('emits events correctly when routing incoming network envelopes', () => {
    const manager = new WebRtcSignalingManager('dev_bob', () => null);

    const onRequest = vi.fn();
    const onAccept = vi.fn();
    const onReject = vi.fn();
    const onEnd = vi.fn();
    const onSignal = vi.fn();

    manager.on('callRequest', onRequest);
    manager.on('callAccept', onAccept);
    manager.on('callReject', onReject);
    manager.on('callEnd', onEnd);
    manager.on('callSignal', onSignal);

    // Incoming request
    manager.handleIncomingEnvelope({
      version: '1.0.0',
      id: 'env_1',
      senderDeviceId: 'dev_alice',
      targetDeviceId: 'dev_bob',
      type: IpmEventType.CALL_REQUEST,
      payload: {
        callId: 'call_1',
        conversationId: 'conv_1',
        callerDeviceId: 'dev_alice',
        callType: 'voice',
      },
      timestamp: Date.now(),
    });
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call_1', callType: 'voice' })
    );

    // Incoming accept
    manager.handleIncomingEnvelope({
      version: '1.0.0',
      id: 'env_2',
      senderDeviceId: 'dev_bob',
      targetDeviceId: 'dev_alice',
      type: IpmEventType.CALL_ACCEPT,
      payload: { callId: 'call_1', responderDeviceId: 'dev_bob' },
      timestamp: Date.now(),
    });
    expect(onAccept).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call_1', responderDeviceId: 'dev_bob' })
    );

    // Incoming signal
    manager.handleIncomingEnvelope({
      version: '1.0.0',
      id: 'env_3',
      senderDeviceId: 'dev_alice',
      targetDeviceId: 'dev_bob',
      type: IpmEventType.CALL_SIGNAL,
      payload: {
        callId: 'call_1',
        targetDeviceId: 'dev_bob',
        signalType: 'answer',
        data: { sdp: 'v=0...' },
      },
      timestamp: Date.now(),
    });
    expect(onSignal).toHaveBeenCalledWith(
      expect.objectContaining({ signalType: 'answer' })
    );

    // Incoming end
    manager.handleIncomingEnvelope({
      version: '1.0.0',
      id: 'env_4',
      senderDeviceId: 'dev_alice',
      targetDeviceId: 'dev_bob',
      type: IpmEventType.CALL_END,
      payload: { callId: 'call_1', senderDeviceId: 'dev_alice', reason: 'completed' },
      timestamp: Date.now(),
    });
    expect(onEnd).toHaveBeenCalledWith(
      expect.objectContaining({ callId: 'call_1', reason: 'completed' })
    );
  });

  it('tracks CallSession state machine, audio/video toggles, and duration', () => {
    const session = new CallSession({
      callId: 'call_sess_1',
      conversationId: 'conv_sess_1',
      peerDeviceId: 'dev_bob',
      callType: 'video',
      direction: 'outgoing',
    });

    expect(session.status).toBe('ringing');
    expect(session.isVideoEnabled).toBe(true);
    expect(session.isMuted).toBe(false);

    // Accept & connect
    session.accept();
    expect(session.status).toBe('ongoing');
    expect(session.connectedAt).toBeDefined();

    // Toggle mute and video
    const muted = session.toggleMute();
    expect(muted).toBe(true);
    expect(session.isMuted).toBe(true);

    const videoDisabled = session.toggleVideo(false);
    expect(videoDisabled).toBe(false);
    expect(session.isVideoEnabled).toBe(false);

    // End session
    session.end('completed');
    expect(session.status).toBe('completed');
    expect(session.endedAt).toBeDefined();
  });
});

