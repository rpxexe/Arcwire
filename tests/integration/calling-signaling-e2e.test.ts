import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  DatabaseService,
  CallRepository,
  DeviceRepository,
  ConversationRepository,
} from '@ipm/database';
import {
  WebRtcSignalingManager,
  CallSession,
  LanIceConfig,
} from '@ipm/calling';
import { IpmEventType, NetworkEnvelope, IPM_PROTOCOL } from '@ipm/shared';

describe('WebRTC Calling & Screen Sharing LAN Signaling E2E Integration', () => {
  let tempDir: string;
  let dbService: DatabaseService;
  let callRepo: CallRepository;
  let deviceRepo: DeviceRepository;
  let convRepo: ConversationRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-calling-e2e-'));
    const dbPath = path.join(tempDir, 'test.db');
    dbService = DatabaseService.create({ dbPath });
    callRepo = new CallRepository(dbService);
    deviceRepo = new DeviceRepository(dbService);
    convRepo = new ConversationRepository(dbService);

    // Register devices
    deviceRepo.upsertDevice({
      id: 'dev_alice',
      publicKey: 'alice_pubkey_123',
      displayName: 'Alice',
      hostname: 'ALICE-LAPTOP',
    });
    deviceRepo.upsertDevice({
      id: 'dev_bob',
      publicKey: 'bob_pubkey_456',
      displayName: 'Bob',
      hostname: 'BOB-DESKTOP',
    });

    convRepo.getOrCreateDirectConversation('dev_alice', 'dev_bob');
  });

  afterEach(() => {
    dbService.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('executes full call lifecycle: request -> accept -> SDP exchange -> host ICE candidates -> hangup with duration', async () => {
    let aliceManager: WebRtcSignalingManager;
    let bobManager: WebRtcSignalingManager;

    // Simulated LAN Transport routing envelopes directly between Alice and Bob
    const aliceTransport = {
      sendPayload: async (peerId: string, type: IpmEventType, payload: any, convId?: string) => {
        const envelope: NetworkEnvelope = {
          version: IPM_PROTOCOL.VERSION,
          id: `env_${Date.now()}_${Math.random()}`,
          senderDeviceId: 'dev_alice',
          targetDeviceId: peerId,
          type,
          payload,
          conversationId: convId,
          timestamp: Date.now(),
        };
        bobManager.handleIncomingEnvelope(envelope);
      },
    };

    const bobTransport = {
      sendPayload: async (peerId: string, type: IpmEventType, payload: any, convId?: string) => {
        const envelope: NetworkEnvelope = {
          version: IPM_PROTOCOL.VERSION,
          id: `env_${Date.now()}_${Math.random()}`,
          senderDeviceId: 'dev_bob',
          targetDeviceId: peerId,
          type,
          payload,
          conversationId: convId,
          timestamp: Date.now(),
        };
        aliceManager.handleIncomingEnvelope(envelope);
      },
    };

    aliceManager = new WebRtcSignalingManager('dev_alice', () => aliceTransport as any);
    bobManager = new WebRtcSignalingManager('dev_bob', () => bobTransport as any);

    // 1. Alice creates database record and initiates video call
    const conversation = convRepo.getDirectConversationBetween('dev_alice', 'dev_bob');
    expect(conversation).toBeDefined();

    const dbCall = callRepo.createCall({
      conversationId: conversation!.id,
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'video',
      status: 'ringing',
    });

    const aliceSession = new CallSession({
      callId: dbCall.id,
      conversationId: conversation!.id,
      peerDeviceId: 'dev_bob',
      callType: 'video',
      direction: 'outgoing',
    });

    // 2. Track Bob's received signals
    let bobReceivedRequest: any = null;
    let bobSession: CallSession | null = null;
    const bobReceivedSignals: any[] = [];

    bobManager.on('callRequest', (req) => {
      bobReceivedRequest = req;
      bobSession = new CallSession({
        callId: req.callId,
        conversationId: req.conversationId,
        peerDeviceId: req.callerDeviceId,
        callType: req.callType,
        direction: 'incoming',
      });
    });

    bobManager.on('callSignal', (signal) => {
      bobReceivedSignals.push(signal);
    });

    // Track Alice's received signals
    let aliceReceivedAccept = false;
    const aliceReceivedSignals: any[] = [];
    let aliceReceivedEnd = false;

    aliceManager.on('callAccept', (data) => {
      if (data.callId === dbCall.id) {
        aliceReceivedAccept = true;
        aliceSession.connect();
        callRepo.updateCallStatus(dbCall.id, 'ongoing');
      }
    });

    aliceManager.on('callSignal', (signal) => {
      aliceReceivedSignals.push(signal);
    });

    aliceManager.on('callEnd', (data) => {
      if (data.callId === dbCall.id) {
        aliceReceivedEnd = true;
        aliceSession.end('completed');
        callRepo.endCall(dbCall.id, 'completed');
      }
    });

    // Step A: Alice dispatches call request
    await aliceManager.sendCallRequest('dev_bob', conversation!.id, 'video', dbCall.id);

    expect(bobReceivedRequest).not.toBeNull();
    expect(bobReceivedRequest.callId).toBe(dbCall.id);
    expect(bobReceivedRequest.callType).toBe('video');
    expect(bobSession).not.toBeNull();
    expect(bobSession!.status).toBe('ringing');

    // Step B: Bob accepts the call
    bobSession!.accept();
    await bobManager.sendCallAccept('dev_alice', dbCall.id, conversation!.id);

    expect(aliceReceivedAccept).toBe(true);
    expect(aliceSession.status).toBe('ongoing');

    // Check database call status is now ongoing
    const ongoingCall = callRepo.getCallById(dbCall.id);
    expect(ongoingCall?.status).toBe('ongoing');

    // Step C: Alice sends SDP offer
    const mockOfferSdp = {
      type: 'offer',
      sdp: 'v=0\r\no=- 12345 2 IN IP4 192.168.1.100\r\ns=-\r\nt=0 0\r\nm=audio 50000 UDP/TLS/RTP/SAVPF 111\r\n',
    };
    await aliceManager.sendSignal('dev_bob', dbCall.id, 'offer', mockOfferSdp, conversation!.id);

    expect(bobReceivedSignals.length).toBe(1);
    expect(bobReceivedSignals[0].signalType).toBe('offer');
    expect(bobReceivedSignals[0].data.sdp).toContain('192.168.1.100');

    // Step D: Bob sends SDP answer
    const mockAnswerSdp = {
      type: 'answer',
      sdp: 'v=0\r\no=- 67890 2 IN IP4 192.168.1.105\r\ns=-\r\nt=0 0\r\nm=audio 50002 UDP/TLS/RTP/SAVPF 111\r\n',
    };
    await bobManager.sendSignal('dev_alice', dbCall.id, 'answer', mockAnswerSdp, conversation!.id);

    expect(aliceReceivedSignals.length).toBe(1);
    expect(aliceReceivedSignals[0].signalType).toBe('answer');

    // Step E: Both exchange local host ICE candidates (Pure LAN validation)
    const hostCandidateAlice =
      'candidate:1001 1 udp 2122260223 192.168.1.100 50000 typ host generation 0';
    const hostCandidateBob =
      'candidate:1002 1 udp 2122260223 192.168.1.105 50002 typ host generation 0';

    expect(LanIceConfig.isHostCandidate(hostCandidateAlice)).toBe(true);
    expect(LanIceConfig.isHostCandidate(hostCandidateBob)).toBe(true);

    await aliceManager.sendSignal(
      'dev_bob',
      dbCall.id,
      'ice-candidate',
      { candidate: hostCandidateAlice },
      conversation!.id
    );
    await bobManager.sendSignal(
      'dev_alice',
      dbCall.id,
      'ice-candidate',
      { candidate: hostCandidateBob },
      conversation!.id
    );

    expect(bobReceivedSignals.length).toBe(2);
    expect(bobReceivedSignals[1].signalType).toBe('ice-candidate');
    expect(aliceReceivedSignals.length).toBe(2);
    expect(aliceReceivedSignals[1].signalType).toBe('ice-candidate');

    // Simulate duration
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Step F: Bob hangs up
    bobSession!.end('completed');
    await bobManager.sendCallEnd('dev_alice', dbCall.id, conversation!.id, 'normal_hangup');

    expect(aliceReceivedEnd).toBe(true);
    expect(aliceSession.status).toBe('completed');
    expect(bobSession!.status).toBe('completed');

    // Step G: Check call in database
    const completedCall = callRepo.getCallById(dbCall.id);
    expect(completedCall).not.toBeNull();
    expect(completedCall?.status).toBe('completed');
    expect(completedCall?.endedAt).toBeDefined();

    // Check list calls history
    const history = callRepo.listCalls(conversation!.id);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(dbCall.id);
  });

  it('handles call rejection correctly and logs status as rejected', async () => {
    let aliceManager: WebRtcSignalingManager;
    let bobManager: WebRtcSignalingManager;

    const aliceTransport = {
      sendPayload: async (peerId: string, type: IpmEventType, payload: any, convId?: string) => {
        bobManager.handleIncomingEnvelope({
          version: IPM_PROTOCOL.VERSION,
          id: `env_${Date.now()}`,
          senderDeviceId: 'dev_alice',
          targetDeviceId: peerId,
          type,
          payload,
          conversationId: convId,
          timestamp: Date.now(),
        });
      },
    };

    const bobTransport = {
      sendPayload: async (peerId: string, type: IpmEventType, payload: any, convId?: string) => {
        aliceManager.handleIncomingEnvelope({
          version: IPM_PROTOCOL.VERSION,
          id: `env_${Date.now()}`,
          senderDeviceId: 'dev_bob',
          targetDeviceId: peerId,
          type,
          payload,
          conversationId: convId,
          timestamp: Date.now(),
        });
      },
    };

    aliceManager = new WebRtcSignalingManager('dev_alice', () => aliceTransport as any);
    bobManager = new WebRtcSignalingManager('dev_bob', () => bobTransport as any);

    const conv = convRepo.getDirectConversationBetween('dev_alice', 'dev_bob')!;
    expect(conv).toBeDefined();

    const call = callRepo.createCall({
      conversationId: conv.id,
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'voice',
    });

    let rejectionReceived = false;
    aliceManager.on('callReject', (data) => {
      if (data.callId === call.id) {
        rejectionReceived = true;
        callRepo.updateCallStatus(call.id, 'rejected', Date.now(), 0);
      }
    });

    bobManager.on('callRequest', async (req) => {
      // Bob rejects
      await bobManager.sendCallReject('dev_alice', req.callId, req.conversationId);
    });

    await aliceManager.sendCallRequest('dev_bob', conv.id, 'voice', call.id);

    expect(rejectionReceived).toBe(true);

    const rejectedCall = callRepo.getCallById(call.id);
    expect(rejectedCall?.status).toBe('rejected');
    expect(rejectedCall?.durationSeconds).toBe(0);
  });
});
