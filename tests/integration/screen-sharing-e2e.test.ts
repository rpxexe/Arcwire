import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
} from '@ipm/calling';
import { IpmEventType, NetworkEnvelope, IPM_PROTOCOL } from '@ipm/shared';

describe('Screen Sharing LAN Signaling E2E Integration (Phase 7)', () => {
  let tempDir: string;
  let dbService: DatabaseService;
  let callRepo: CallRepository;
  let deviceRepo: DeviceRepository;
  let convRepo: ConversationRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-screenshare-e2e-'));
    const dbPath = path.join(tempDir, 'test.db');
    dbService = DatabaseService.create({ dbPath });
    callRepo = new CallRepository(dbService);
    deviceRepo = new DeviceRepository(dbService);
    convRepo = new ConversationRepository(dbService);

    // Register devices
    deviceRepo.upsertDevice({
      id: 'dev_alice',
      publicKey: 'alice_pubkey_789',
      displayName: 'Alice (Presenter)',
      hostname: 'ALICE-RIG',
    });
    deviceRepo.upsertDevice({
      id: 'dev_bob',
      publicKey: 'bob_pubkey_101',
      displayName: 'Bob (Viewer)',
      hostname: 'BOB-WORKSTATION',
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

  it('completes entire screen sharing lifecycle: call setup -> start sharing -> switch source -> stop sharing -> hangup', async () => {
    let aliceSignaling: WebRtcSignalingManager;
    let bobSignaling: WebRtcSignalingManager;

    // Simulated LAN Transport Routing
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
        bobSignaling.handleIncomingEnvelope(envelope);
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
        aliceSignaling.handleIncomingEnvelope(envelope);
      },
    };

    aliceSignaling = new WebRtcSignalingManager('dev_alice', () => aliceTransport as any);
    bobSignaling = new WebRtcSignalingManager('dev_bob', () => bobTransport as any);

    const conv = convRepo.getDirectConversationBetween('dev_alice', 'dev_bob')!;
    expect(conv).toBeDefined();

    // 1. Initial Call Initiation
    const dbCall = callRepo.createCall({
      conversationId: conv.id,
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'video',
      status: 'ringing',
    });

    const aliceSession = new CallSession({
      callId: dbCall.id,
      conversationId: conv.id,
      peerDeviceId: 'dev_bob',
      callType: 'video',
      direction: 'outgoing',
    });

    const bobSession = new CallSession({
      callId: dbCall.id,
      conversationId: conv.id,
      peerDeviceId: 'dev_alice',
      callType: 'video',
      direction: 'incoming',
    });

    // Both accept
    aliceSession.accept();
    bobSession.accept();
    callRepo.updateCallStatus(dbCall.id, 'ongoing');

    // 2. Track Bob's received presentation state
    let bobPresentationStarted = false;
    let bobReceivedSourceName: string | null = null;
    let bobPresentationStopped = false;

    bobSignaling.on('screenShareStart', (data) => {
      bobPresentationStarted = true;
      bobReceivedSourceName = data.sourceName || null;
    });

    bobSignaling.on('screenShareStop', () => {
      bobPresentationStopped = true;
    });

    // 3. Alice starts sharing screen (window: VS Code)
    aliceSession.setScreenSharing(true, 'Visual Studio Code - Arcwire');
    expect(aliceSession.isScreenSharing).toBe(true);
    expect(aliceSession.sharedSourceName).toBe('Visual Studio Code - Arcwire');

    await aliceSignaling.sendScreenShareStart(
      'dev_bob',
      dbCall.id,
      'Visual Studio Code - Arcwire',
      conv.id
    );

    expect(bobPresentationStarted).toBe(true);
    expect(bobReceivedSourceName).toBe('Visual Studio Code - Arcwire');

    // 4. Alice switches screen source to another display (Display 2 - 4K)
    aliceSession.setScreenSharing(true, 'Display 2 (3840x2160)');
    expect(aliceSession.sharedSourceName).toBe('Display 2 (3840x2160)');

    await aliceSignaling.sendScreenShareStart(
      'dev_bob',
      dbCall.id,
      'Display 2 (3840x2160)',
      conv.id
    );

    expect(bobReceivedSourceName).toBe('Display 2 (3840x2160)');

    // 5. Alice stops screen sharing
    aliceSession.setScreenSharing(false);
    expect(aliceSession.isScreenSharing).toBe(false);
    expect(aliceSession.sharedSourceName).toBeNull();

    await aliceSignaling.sendScreenShareStop('dev_bob', dbCall.id, conv.id);
    expect(bobPresentationStopped).toBe(true);

    // 6. End Call
    aliceSession.end('completed');
    bobSession.end('completed');
    const completedCall = callRepo.endCall(dbCall.id, 'completed');

    expect(completedCall).not.toBeNull();
    expect(completedCall?.status).toBe('completed');
    expect(completedCall?.endedAt).toBeDefined();

    const history = callRepo.listCalls(conv.id);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(dbCall.id);
  });
});
