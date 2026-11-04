import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { NetworkEnvelope } from '@ipm/shared';
import { FramingDecoder, encodeFrame } from './FramingCodec';
import { TransportConnection } from '../interfaces/TransportAdapter';

export class LanTransportConnection extends EventEmitter implements TransportConnection {
  public peerId: string = '';
  public publicKey: string = '';
  public isAuthenticated: boolean = false;
  public readonly remoteAddress: string;
  public readonly remotePort: number;
  public readonly isEncrypted: boolean;

  private socket: Socket | TLSSocket;
  private decoder: FramingDecoder;
  private isClosing: boolean = false;

  constructor(socket: Socket | TLSSocket) {
    super();
    this.socket = socket;
    this.remoteAddress = socket.remoteAddress ?? 'unknown';
    this.remotePort = socket.remotePort ?? 0;
    this.isEncrypted = 'encrypted' in socket && Boolean((socket as TLSSocket).encrypted);

    this.decoder = new FramingDecoder();

    this.setupSocket();
  }

  private setupSocket(): void {
    // Disable Nagle's algorithm for immediate packet dispatch
    this.socket.setNoDelay(true);
    this.socket.setKeepAlive(true, 10000);

    this.socket.on('data', (chunk: Buffer) => {
      this.decoder.push(chunk);
    });

    this.decoder.on('frame', (envelope: NetworkEnvelope) => {
      this.emit('message', envelope);
    });

    this.decoder.on('error', (err: Error) => {
      this.emit('error', err);
      this.close();
    });

    this.socket.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      this.emit('close');
    });

    this.socket.on('timeout', () => {
      this.emit('timeout');
      this.close();
    });
  }

  public async send(message: NetworkEnvelope): Promise<void> {
    if (this.isClosing || this.socket.destroyed) {
      throw new Error(`Cannot send message on closed socket to peer ${this.peerId || this.remoteAddress}`);
    }

    const frameBuf = encodeFrame(message);

    return new Promise<void>((resolve, reject) => {
      let isDone = false;
      const success = this.socket.write(frameBuf, (err) => {
        if (err) {
          if (!isDone) {
            isDone = true;
            reject(err);
          }
        } else if (success) {
          if (!isDone) {
            isDone = true;
            resolve();
          }
        }
      });

      if (!success) {
        this.socket.once('drain', () => {
          if (!isDone) {
            isDone = true;
            resolve();
          }
        });
      }
    });
  }

  public getRawSocket(): Socket | TLSSocket {
    return this.socket;
  }

  public async close(): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;

    return new Promise<void>((resolve) => {
      if (this.socket.destroyed) {
        resolve();
        return;
      }

      this.socket.end(() => {
        this.socket.destroy();
        resolve();
      });
    });
  }
}

