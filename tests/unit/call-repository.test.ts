import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseService, CallRepository, DeviceRepository, ConversationRepository } from '@ipm/database';

describe('CallRepository', () => {
  let tempDir: string;
  let dbService: DatabaseService;
  let callRepo: CallRepository;
  let deviceRepo: DeviceRepository;
  let convRepo: ConversationRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-call-repo-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    dbService = DatabaseService.create({ dbPath });
    callRepo = new CallRepository(dbService);
    deviceRepo = new DeviceRepository(dbService);
    convRepo = new ConversationRepository(dbService);

    // Setup dummy devices and conversation
    deviceRepo.upsertDevice({
      id: 'dev_alice',
      publicKey: 'pub_alice_key',
      displayName: 'Alice',
      hostname: 'ALICE-PC',
    });
    deviceRepo.upsertDevice({
      id: 'dev_bob',
      publicKey: 'pub_bob_key',
      displayName: 'Bob',
      hostname: 'BOB-PC',
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

  it('creates a new call record with default ringing status and duration 0', () => {
    const call = callRepo.createCall({
      conversationId: 'conv_1',
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'voice',
    });

    expect(call).toBeDefined();
    expect(call.id).toBeDefined();
    expect(call.conversationId).toBe('conv_1');
    expect(call.callerDeviceId).toBe('dev_alice');
    expect(call.receiverDeviceId).toBe('dev_bob');
    expect(call.callType).toBe('voice');
    expect(call.status).toBe('ringing');
    expect(call.durationSeconds).toBe(0);
    expect(call.endedAt).toBeNull();
  });

  it('retrieves call by ID', () => {
    const created = callRepo.createCall({
      conversationId: 'conv_2',
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'video',
    });

    const fetched = callRepo.getCallById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.callType).toBe('video');
    expect(fetched?.status).toBe('ringing');

    const nonExistent = callRepo.getCallById('non_existent_id');
    expect(nonExistent).toBeNull();
  });

  it('updates call status to ongoing and completed', () => {
    const created = callRepo.createCall({
      conversationId: 'conv_3',
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'screen',
    });

    const updated = callRepo.updateCallStatus(created.id, 'ongoing');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('ongoing');

    const ended = callRepo.updateCallStatus(created.id, 'completed', Date.now(), 45);
    expect(ended?.status).toBe('completed');
    expect(ended?.durationSeconds).toBe(45);
    expect(ended?.endedAt).toBeDefined();
  });

  it('ends call and calculates duration correctly from startedAt timestamp', () => {
    const tenSecondsAgo = Date.now() - 10000;
    const created = callRepo.createCall({
      conversationId: 'conv_4',
      callerDeviceId: 'dev_bob',
      receiverDeviceId: 'dev_alice',
      callType: 'voice',
      startedAt: tenSecondsAgo,
    });

    const ended = callRepo.endCall(created.id, 'completed');
    expect(ended).not.toBeNull();
    expect(ended?.status).toBe('completed');
    expect(ended?.durationSeconds).toBeGreaterThanOrEqual(9);
    expect(ended?.durationSeconds).toBeLessThanOrEqual(12);
    expect(ended?.endedAt).toBeGreaterThanOrEqual(tenSecondsAgo);
  });

  it('lists calls filtered by conversationId and orders by startedAt desc', () => {
    const call1 = callRepo.createCall({
      conversationId: 'conv_list_A',
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'voice',
      startedAt: 1000,
    });

    const call2 = callRepo.createCall({
      conversationId: 'conv_list_A',
      callerDeviceId: 'dev_bob',
      receiverDeviceId: 'dev_alice',
      callType: 'video',
      startedAt: 2000,
    });

    const call3 = callRepo.createCall({
      conversationId: 'conv_list_B',
      callerDeviceId: 'dev_alice',
      receiverDeviceId: 'dev_bob',
      callType: 'voice',
      startedAt: 3000,
    });

    const convACalls = callRepo.listCalls('conv_list_A');
    expect(convACalls.length).toBe(2);
    expect(convACalls[0].id).toBe(call2.id); // Newer call first
    expect(convACalls[1].id).toBe(call1.id);

    const allCalls = callRepo.listCalls();
    expect(allCalls.length).toBe(3);
    expect(allCalls[0].id).toBe(call3.id);
  });
});
