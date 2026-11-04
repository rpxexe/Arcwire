import { describe, it, expect, afterAll } from 'vitest';
import crypto from 'node:crypto';
import tls from 'node:tls';
import {
  generateDeviceIdentity,
  generateSelfSignedCertificate,
} from '@ipm/security';
import {
  TlsServer,
  LanTransportConnection,
  HandshakeManager,
} from '@ipm/networking';
import {
  IPM_PROTOCOL,
  IpmEventType,
  NetworkEnvelope,
} from '@ipm/shared';

describe('Integration - TLS 1.3 & Mutual Ed25519 Handshake', () => {
  let bobServer: TlsServer | null = null;
  let aliceConn: LanTransportConnection | null = null;
  let bobAcceptedConn: LanTransportConnection | null = null;

  afterAll(async () => {
    if (aliceConn) await aliceConn.close();
    if (bobAcceptedConn) await bobAcceptedConn.close();
    if (bobServer) await bobServer.stop();
  });

  it('establishes TLS 1.3 socket, completes Ed25519 mutual handshake, and exchanges packets', async () => {
    // 1. Generate cryptographic identities
    const aliceIdentity = generateDeviceIdentity();
    const bobIdentity = generateDeviceIdentity();

    // 2. Generate TLS certificates
    const bobCert = await generateSelfSignedCertificate({ commonName: 'bob.local' });

    // 3. Start Bob's TLS Server on ephemeral port (port 0)
    bobServer = new TlsServer({
      port: 0,
      host: '127.0.0.1',
      tlsCert: bobCert,
      localIdentity: bobIdentity,
      handshakeTimeoutMs: 5000,
    });

    const bobListeningPort = await bobServer.start();
    expect(bobListeningPort).toBeGreaterThan(0);

    // Promise that resolves when Bob's server accepts and authenticates an incoming connection
    const bobAuthenticatedPromise = new Promise<{ connection: LanTransportConnection; peerId: string }>(
      (resolve) => {
        bobServer!.once('connection', (conn, peerId) => {
          bobAcceptedConn = conn;
          resolve({ connection: conn, peerId });
        });
      }
    );

    // 4. Alice connects to Bob over TLS 1.3 and completes handshake
    const aliceAuthenticatedPromise = new Promise<string>((resolve, reject) => {
      const aliceSocket = tls.connect(
        {
          host: '127.0.0.1',
          port: bobListeningPort,
          minVersion: 'TLSv1.3',
          rejectUnauthorized: false, // Self-signed certs over LAN, authenticated by Ed25519
        },
        async () => {
          try {
            aliceConn = new LanTransportConnection(aliceSocket);
            const aliceHandshake = new HandshakeManager(aliceIdentity, 5000);
            const authenticatedId = await aliceHandshake.performInitiatorHandshake(aliceConn);
            resolve(authenticatedId);
          } catch (err) {
            reject(err);
          }
        }
      );
      aliceSocket.on('error', reject);
    });

    // Wait for both sides to finish mutual authentication
    const [bobResult, alicePeerId] = await Promise.all([
      bobAuthenticatedPromise,
      aliceAuthenticatedPromise,
    ]);

    // 5. Verify peer identities
    expect(bobResult.peerId).toBe(aliceIdentity.deviceId);
    expect(bobResult.connection.isAuthenticated).toBe(true);
    expect(bobResult.connection.isEncrypted).toBe(true);

    expect(alicePeerId).toBe(bobIdentity.deviceId);
    expect(aliceConn!.peerId).toBe(bobIdentity.deviceId);
    expect(aliceConn!.isAuthenticated).toBe(true);
    expect(aliceConn!.isEncrypted).toBe(true);

    // 6. Test message transmission from Alice to Bob
    const testMessage: NetworkEnvelope = {
      protocol: IPM_PROTOCOL,
      id: crypto.randomUUID(),
      type: IpmEventType.CHAT_MESSAGE,
      senderId: aliceIdentity.deviceId,
      receiverId: bobIdentity.deviceId,
      conversationId: crypto.randomUUID(),
      timestamp: Date.now(),
      sequence: 1,
      payload: {
        messageId: crypto.randomUUID(),
        content: 'Authenticated TLS packet from Alice to Bob',
        contentType: 'text',
        isEncrypted: false,
        sentAt: Date.now(),
      },
    };

    const bobReceivedPromise = new Promise<NetworkEnvelope>((resolve) => {
      bobAcceptedConn!.once('message', (msg) => {
        resolve(msg);
      });
    });

    await aliceConn!.send(testMessage);
    const receivedByBob = await bobReceivedPromise;

    expect(receivedByBob.id).toBe(testMessage.id);
    expect(receivedByBob.senderId).toBe(aliceIdentity.deviceId);
    expect(receivedByBob.payload.content).toBe('Authenticated TLS packet from Alice to Bob');
  });

  it('rejects connection if client presents invalid signature in handshake', async () => {
    const maliciousIdentity = generateDeviceIdentity();
    const bobIdentity = generateDeviceIdentity();
    const bobCert = await generateSelfSignedCertificate({ commonName: 'bob.local' });

    const server = new TlsServer({
      port: 0,
      host: '127.0.0.1',
      tlsCert: bobCert,
      localIdentity: bobIdentity,
      handshakeTimeoutMs: 3000,
    });

    const port = await server.start();

    // Client connects and sends invalid signature
    const clientSocket = tls.connect(
      {
        host: '127.0.0.1',
        port,
        minVersion: 'TLSv1.3',
        rejectUnauthorized: false,
      },
      () => {
        const clientConn = new LanTransportConnection(clientSocket);
        // Send AUTH_REQUEST
        clientConn.send({
          protocol: IPM_PROTOCOL,
          id: crypto.randomUUID(),
          type: IpmEventType.AUTH_REQUEST,
          senderId: maliciousIdentity.deviceId,
          receiverId: '*',
          conversationId: '*',
          timestamp: Date.now(),
          sequence: 0,
          payload: {
            deviceId: maliciousIdentity.deviceId,
            publicKey: maliciousIdentity.publicKey,
            timestamp: Date.now(),
          },
        });

        // When challenge arrives, reply with bogus signature
        clientConn.on('message', (msg) => {
          if (msg.type === IpmEventType.AUTH_CHALLENGE) {
            clientConn.send({
              protocol: IPM_PROTOCOL,
              id: crypto.randomUUID(),
              type: IpmEventType.AUTH_RESPONSE,
              senderId: maliciousIdentity.deviceId,
              receiverId: bobIdentity.deviceId,
              conversationId: '*',
              timestamp: Date.now(),
              sequence: 0,
              payload: {
                signature: Buffer.from('invalid-signature-bytes').toString('base64'),
                publicKey: maliciousIdentity.publicKey,
                timestamp: msg.payload.timestamp,
              },
            });
          }
        });
      }
    );

    const closedPromise = new Promise<boolean>((resolve) => {
      clientSocket.on('close', () => resolve(true));
      clientSocket.on('error', () => resolve(true));
    });

    const wasClosed = await closedPromise;
    expect(wasClosed).toBe(true);

    await server.stop();
  });
});
