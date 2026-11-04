import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import {
  DatabaseService,
  ConversationRepository,
  MessageRepository,
  GroupRepository,
  DeviceRepository,
} from '@ipm/database';
import { MessagingService } from '@ipm/messaging';
import { TransportAdapter } from '@ipm/networking';
import { NetworkEnvelope } from '@ipm/shared';

// High-fidelity connected in-memory transport pair simulating LAN connection
class PairedLoopbackTransport extends EventEmitter implements TransportAdapter {
  public peerTransport: PairedLoopbackTransport | null = null;
  public localPeerId: string;
  private messageCallbacks: Array<(msg: NetworkEnvelope) => void> = [];
  public isDisposed = false;

  constructor(localPeerId: string) {
    super();
    this.localPeerId = localPeerId;
  }

  public setPeer(peer: PairedLoopbackTransport) {
    this.peerTransport = peer;
  }

  public async connect(_peerId: string): Promise<void> {}
  public async disconnect(_peerId: string): Promise<void> {}

  public onMessage(callback: (message: NetworkEnvelope) => void): void {
    this.messageCallbacks.push(callback);
  }

  public async send(peerId: string, envelope: NetworkEnvelope): Promise<void> {
    if (this.isDisposed || !this.peerTransport || this.peerTransport.isDisposed) {
      return;
    }
    // Deliver synchronously to prevent timer leakage across tests
    this.peerTransport.deliver(envelope);
  }

  public deliver(envelope: NetworkEnvelope): void {
    if (this.isDisposed) return;
    for (const cb of this.messageCallbacks) {
      cb(envelope);
    }
    this.emit('envelope', envelope);
  }

  public getActiveConnections(): string[] {
    return this.peerTransport ? [this.peerTransport.localPeerId] : [];
  }

  public isConnected(peerId: string): boolean {
    return this.peerTransport?.localPeerId === peerId;
  }

  public dispose(): void {
    this.isDisposed = true;
    this.peerTransport = null;
    this.messageCallbacks = [];
    this.removeAllListeners();
  }
}

describe('Phase 3 Integration - End-to-End Direct & Group Messaging', () => {
  let tempBase: string;
  let aliceDbService: DatabaseService;
  let bobDbService: DatabaseService;

  let aliceConvRepo: ConversationRepository;
  let aliceMsgRepo: MessageRepository;
  let aliceGroupRepo: GroupRepository;
  let aliceDeviceRepo: DeviceRepository;
  let aliceTransport: PairedLoopbackTransport;
  let aliceMessaging: MessagingService;

  let bobConvRepo: ConversationRepository;
  let bobMsgRepo: MessageRepository;
  let bobGroupRepo: GroupRepository;
  let bobDeviceRepo: DeviceRepository;
  let bobTransport: PairedLoopbackTransport;
  let bobMessaging: MessagingService;

  const aliceId = 'dev_alice_node_0001';
  const bobId = 'dev_bob_node_0002';

  beforeEach(() => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ipm-e2e-msg-'));

    // 1. Initialize Alice's node
    const aliceDbPath = path.join(tempBase, 'alice', 'ipm.db');
    aliceDbService = DatabaseService.create({ dbPath: aliceDbPath });
    aliceConvRepo = new ConversationRepository(aliceDbService);
    aliceMsgRepo = new MessageRepository(aliceDbService);
    aliceGroupRepo = new GroupRepository(aliceDbService);
    aliceDeviceRepo = new DeviceRepository(aliceDbService);
    aliceTransport = new PairedLoopbackTransport(aliceId);

    // 2. Initialize Bob's node
    const bobDbPath = path.join(tempBase, 'bob', 'ipm.db');
    bobDbService = DatabaseService.create({ dbPath: bobDbPath });
    bobConvRepo = new ConversationRepository(bobDbService);
    bobMsgRepo = new MessageRepository(bobDbService);
    bobGroupRepo = new GroupRepository(bobDbService);
    bobDeviceRepo = new DeviceRepository(bobDbService);
    bobTransport = new PairedLoopbackTransport(bobId);

    // Register devices in respective databases for foreign key satisfaction
    aliceDeviceRepo.upsertDevice({
      id: aliceId,
      publicKey: 'pk_alice',
      displayName: 'Alice (Host)',
      hostname: 'ALICE-PC',
      ipAddress: '192.168.1.10',
      tcpPort: 45821,
      signalingPort: 45822,
      status: 'online',
    });
    aliceDeviceRepo.upsertDevice({
      id: bobId,
      publicKey: 'pk_bob',
      displayName: 'Bob (Peer)',
      hostname: 'BOB-PC',
      ipAddress: '192.168.1.20',
      tcpPort: 45821,
      signalingPort: 45822,
      status: 'online',
    });

    bobDeviceRepo.upsertDevice({
      id: aliceId,
      publicKey: 'pk_alice',
      displayName: 'Alice (Peer)',
      hostname: 'ALICE-PC',
      ipAddress: '192.168.1.10',
      tcpPort: 45821,
      signalingPort: 45822,
      status: 'online',
    });
    bobDeviceRepo.upsertDevice({
      id: bobId,
      publicKey: 'pk_bob',
      displayName: 'Bob (Host)',
      hostname: 'BOB-PC',
      ipAddress: '192.168.1.20',
      tcpPort: 45821,
      signalingPort: 45822,
      status: 'online',
    });

    // 3. Connect pair transports
    aliceTransport.setPeer(bobTransport);
    bobTransport.setPeer(aliceTransport);

    // 4. Initialize messaging services
    aliceMessaging = new MessagingService({
      localDeviceId: aliceId,
      dbService: aliceDbService,
      transport: aliceTransport,
    });

    bobMessaging = new MessagingService({
      localDeviceId: bobId,
      dbService: bobDbService,
      transport: bobTransport,
    });
  });

  afterEach(() => {
    aliceTransport.dispose();
    bobTransport.dispose();
    aliceMessaging.destroy();
    bobMessaging.destroy();
    aliceDbService.close();
    bobDbService.close();
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  it('completes full direct messaging lifecycle: send -> persist -> deliver receipt -> read receipt', async () => {
    // 1. Set up conversation on both sides
    const aliceConv = aliceConvRepo.getOrCreateDirectConversation(aliceId, bobId, 'Bob LAN Peer');
    const bobConv = bobConvRepo.getOrCreateDirectConversation(bobId, aliceId, 'Alice LAN Peer');

    // 2. Prepare listeners
    const bobMessagePromise = new Promise<{ id: string; content: string }>((resolve) => {
      bobMessaging.once('messageReceived', (msg) => {
        resolve({ id: msg.id, content: msg.content });
      });
    });

    const aliceDeliveredReceiptPromise = new Promise<{ messageId: string; status: string }>((resolve) => {
      aliceMessaging.on('receipt', (r) => {
        if (r.receiptType === 'delivered') {
          resolve({ messageId: r.messageId, status: r.receiptType });
        }
      });
    });

    // 3. Alice sends message to Bob
    const sentMessage = await aliceMessaging.sendDirectMessage(
      aliceConv.id,
      bobId,
      'Hello Bob! Welcome to Arcwire IP Messenger.'
    );

    expect(sentMessage.id).toBeDefined();
    expect(sentMessage.content).toBe('Hello Bob! Welcome to Arcwire IP Messenger.');
    expect(['pending', 'sent', 'delivered']).toContain(sentMessage.deliveryStatus);

    // 4. Bob receives and commits message to local SQLite
    const receivedByBob = await bobMessagePromise;
    expect(receivedByBob.id).toBe(sentMessage.id);
    expect(receivedByBob.content).toBe(sentMessage.content);

    const bobDbMessage = bobMsgRepo.getMessageById(sentMessage.id);
    expect(bobDbMessage).not.toBeNull();
    expect(bobDbMessage?.content).toBe(sentMessage.content);

    // 5. Alice receives delivery receipt from Bob and updates SQLite
    const deliveredReceipt = await aliceDeliveredReceiptPromise;
    expect(deliveredReceipt.messageId).toBe(sentMessage.id);

    const aliceDbMessageAfterDelivery = aliceMsgRepo.getMessageById(sentMessage.id);
    expect(aliceDbMessageAfterDelivery?.deliveryStatus).toBe('delivered');
    expect(aliceDbMessageAfterDelivery?.deliveredAt).toBeDefined();

    // 6. Bob marks conversation as read -> triggers read receipt to Alice
    const aliceReadReceiptPromise = new Promise<{ messageId: string; status: string }>((resolve) => {
      aliceMessaging.on('receipt', (r) => {
        if (r.receiptType === 'read') {
          resolve({ messageId: r.messageId, status: r.receiptType });
        }
      });
    });

    await bobMessaging.markConversationRead(bobConv.id, aliceId);

    const readReceipt = await aliceReadReceiptPromise;
    expect(readReceipt.messageId).toBe(sentMessage.id);

    const aliceDbMessageAfterRead = aliceMsgRepo.getMessageById(sentMessage.id);
    expect(aliceDbMessageAfterRead?.deliveryStatus).toBe('read');
    expect(aliceDbMessageAfterRead?.readAt).toBeDefined();
  });

  it('relays typing indicators between peers in real time', async () => {
    const convId = 'conv_typing_integration';
    aliceConvRepo.createConversation({ id: convId, type: 'direct', title: 'Typing Test' });
    bobConvRepo.createConversation({ id: convId, type: 'direct', title: 'Typing Test' });

    const bobTypingPromise = new Promise<{ isTyping: boolean; deviceId: string }>((resolve) => {
      bobMessaging.once('typing', (t) => {
        resolve({ isTyping: t.isTyping, deviceId: t.deviceId });
      });
    });

    // Alice begins typing
    await aliceMessaging.sendTyping(convId, true, [bobId]);

    const typingReceived = await bobTypingPromise;
    expect(typingReceived.deviceId).toBe(aliceId);
    expect(typingReceived.isTyping).toBe(true);
  });
});
