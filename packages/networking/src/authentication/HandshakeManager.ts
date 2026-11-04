import crypto from 'node:crypto';
import {
  IpmEventType,
  IPM_PROTOCOL,
  NetworkEnvelope,
  AuthRequestPayloadSchema,
  AuthChallengePayloadSchema,
  AuthResponsePayloadSchema,
  AuthAcceptedPayloadSchema,
} from '@ipm/shared';
import { deriveDeviceId, signData, verifySignature } from '@ipm/security';
import { LanTransportConnection } from '../transport/LanTransportConnection';

export interface LocalIdentity {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

export class HandshakeManager {
  private localIdentity: LocalIdentity;
  private timeoutMs: number;

  constructor(localIdentity: LocalIdentity, timeoutMs: number = 10000) {
    this.localIdentity = localIdentity;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Performs handshake as the initiator (client) of an outbound connection.
   */
  public async performInitiatorHandshake(connection: LanTransportConnection): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let activeNonce: string = '';
      let timer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        connection.off('message', onMessage);
        connection.off('close', onClose);
        connection.off('error', onError);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed before authentication completed'));
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      timer = setTimeout(() => {
        cleanup();
        connection.close();
        reject(new Error(`Handshake timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const onMessage = async (envelope: NetworkEnvelope) => {
        try {
          if (envelope.type === IpmEventType.AUTH_CHALLENGE) {
            const challenge = AuthChallengePayloadSchema.parse(envelope.payload);
            activeNonce = challenge.nonce;

            // Sign the challenge: nonce + senderId + timestamp
            const dataToSign = `${challenge.nonce}:${this.localIdentity.deviceId}:${challenge.timestamp}`;
            const signature = signData(dataToSign, this.localIdentity.privateKey);

            const responseEnvelope: NetworkEnvelope = {
              protocol: IPM_PROTOCOL,
              id: crypto.randomUUID(),
              type: IpmEventType.AUTH_RESPONSE,
              senderId: this.localIdentity.deviceId,
              receiverId: envelope.senderId,
              conversationId: '*',
              timestamp: Date.now(),
              sequence: 0,
              payload: {
                signature,
                publicKey: this.localIdentity.publicKey,
                timestamp: challenge.timestamp,
              },
            };

            await connection.send(responseEnvelope);
          } else if (envelope.type === IpmEventType.AUTH_ACCEPTED) {
            const accepted = AuthAcceptedPayloadSchema.parse(envelope.payload);

            // Verify remote deviceId matches public key
            const derivedId = deriveDeviceId(accepted.publicKey);
            if (derivedId !== accepted.deviceId) {
              throw new Error(`Listener claimed deviceId ${accepted.deviceId} does not match public key ${derivedId}`);
            }

            // Verify listener's signature if provided
            if (accepted.signature && activeNonce) {
              const expectedData = `AUTH_ACCEPTED:${activeNonce}`;
              const isValid = verifySignature(expectedData, accepted.signature, accepted.publicKey);
              if (!isValid) {
                throw new Error('Invalid signature on AUTH_ACCEPTED frame');
              }
            }

            connection.peerId = accepted.deviceId;
            connection.publicKey = accepted.publicKey;
            connection.isAuthenticated = true;

            cleanup();
            resolve(accepted.deviceId);
          }
        } catch (err) {
          cleanup();
          connection.close();
          reject(err);
        }
      };

      connection.on('message', onMessage);
      connection.once('close', onClose);
      connection.once('error', onError);

      // Step 1: Send AUTH_REQUEST
      const requestEnvelope: NetworkEnvelope = {
        protocol: IPM_PROTOCOL,
        id: crypto.randomUUID(),
        type: IpmEventType.AUTH_REQUEST,
        senderId: this.localIdentity.deviceId,
        receiverId: '*',
        conversationId: '*',
        timestamp: Date.now(),
        sequence: 0,
        payload: {
          deviceId: this.localIdentity.deviceId,
          publicKey: this.localIdentity.publicKey,
          timestamp: Date.now(),
        },
      };

      connection.send(requestEnvelope).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Performs handshake as the listener (server) on an incoming connection.
   */
  public async performListenerHandshake(connection: LanTransportConnection): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let initiatorDeviceId = '';
      let initiatorPublicKey = '';
      let activeNonce = '';
      let challengeTimestamp = 0;
      let timer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        connection.off('message', onMessage);
        connection.off('close', onClose);
        connection.off('error', onError);
      };

      const onClose = () => {
        cleanup();
        reject(new Error('Connection closed before authentication completed'));
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      timer = setTimeout(() => {
        cleanup();
        connection.close();
        reject(new Error(`Handshake timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      const onMessage = async (envelope: NetworkEnvelope) => {
        try {
          if (envelope.type === IpmEventType.AUTH_REQUEST) {
            const request = AuthRequestPayloadSchema.parse(envelope.payload);

            // Verify initiator deviceId matches public key
            const derivedId = deriveDeviceId(request.publicKey);
            if (derivedId !== request.deviceId) {
              throw new Error(`Initiator claimed deviceId ${request.deviceId} does not match public key derivation ${derivedId}`);
            }

            initiatorDeviceId = request.deviceId;
            initiatorPublicKey = request.publicKey;

            // Generate cryptographically random 32-byte nonce
            activeNonce = crypto.randomBytes(32).toString('hex');
            challengeTimestamp = Date.now();

            const challengeEnvelope: NetworkEnvelope = {
              protocol: IPM_PROTOCOL,
              id: crypto.randomUUID(),
              type: IpmEventType.AUTH_CHALLENGE,
              senderId: this.localIdentity.deviceId,
              receiverId: initiatorDeviceId,
              conversationId: '*',
              timestamp: challengeTimestamp,
              sequence: 0,
              payload: {
                nonce: activeNonce,
                timestamp: challengeTimestamp,
              },
            };

            await connection.send(challengeEnvelope);
          } else if (envelope.type === IpmEventType.AUTH_RESPONSE) {
            if (!initiatorDeviceId || !activeNonce) {
              throw new Error('Received AUTH_RESPONSE without prior AUTH_REQUEST');
            }

            const response = AuthResponsePayloadSchema.parse(envelope.payload);

            // Verify signature
            const expectedData = `${activeNonce}:${initiatorDeviceId}:${challengeTimestamp}`;
            const isValid = verifySignature(expectedData, response.signature, initiatorPublicKey);

            if (!isValid) {
              throw new Error(`Signature verification failed for peer ${initiatorDeviceId}`);
            }

            // Generate listener confirmation signature
            const acceptSignature = signData(`AUTH_ACCEPTED:${activeNonce}`, this.localIdentity.privateKey);

            const acceptEnvelope: NetworkEnvelope = {
              protocol: IPM_PROTOCOL,
              id: crypto.randomUUID(),
              type: IpmEventType.AUTH_ACCEPTED,
              senderId: this.localIdentity.deviceId,
              receiverId: initiatorDeviceId,
              conversationId: '*',
              timestamp: Date.now(),
              sequence: 0,
              payload: {
                deviceId: this.localIdentity.deviceId,
                publicKey: this.localIdentity.publicKey,
                timestamp: Date.now(),
                signature: acceptSignature,
              },
            };

            await connection.send(acceptEnvelope);

            connection.peerId = initiatorDeviceId;
            connection.publicKey = initiatorPublicKey;
            connection.isAuthenticated = true;

            cleanup();
            resolve(initiatorDeviceId);
          }
        } catch (err) {
          cleanup();
          connection.close();
          reject(err);
        }
      };

      connection.on('message', onMessage);
      connection.once('close', onClose);
      connection.once('error', onError);
    });
  }
}

