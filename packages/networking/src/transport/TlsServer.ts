import tls from 'node:tls';
import { EventEmitter } from 'node:events';
import { LanTransportConnection } from './LanTransportConnection';
import { HandshakeManager, LocalIdentity } from '../authentication/HandshakeManager';
import { TlsCertificate } from '@ipm/security';
import { DEFAULT_PORTS } from '@ipm/shared';

export interface TlsServerOptions {
  port?: number;
  host?: string;
  tlsCert: TlsCertificate;
  localIdentity: LocalIdentity;
  handshakeTimeoutMs?: number;
}

export class TlsServer extends EventEmitter {
  private server: tls.Server | null = null;
  private options: TlsServerOptions;
  private handshakeManager: HandshakeManager;
  private activePort: number = 0;

  constructor(options: TlsServerOptions) {
    super();
    this.options = options;
    this.handshakeManager = new HandshakeManager(options.localIdentity, options.handshakeTimeoutMs);
  }

  public async start(): Promise<number> {
    const port = this.options.port ?? DEFAULT_PORTS.TCP_MAIN;
    const host = this.options.host ?? '0.0.0.0';

    return new Promise<number>((resolve, reject) => {
      try {
        this.server = tls.createServer(
          {
            cert: this.options.tlsCert.cert,
            key: this.options.tlsCert.key,
            minVersion: 'TLSv1.3',
            requestCert: false,
            rejectUnauthorized: false,
          },
          (rawSocket) => {
            this.handleIncomingSocket(rawSocket);
          }
        );

        this.server.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            this.emit('portConflict', port, err);
          }
          this.emit('error', err);
          reject(err);
        });

        this.server.listen(port, host, () => {
          const addr = this.server?.address();
          if (addr && typeof addr === 'object') {
            this.activePort = addr.port;
          } else {
            this.activePort = port;
          }
          this.emit('listening', this.activePort);
          resolve(this.activePort);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private async handleIncomingSocket(socket: tls.TLSSocket): Promise<void> {
    const connection = new LanTransportConnection(socket);

    try {
      // Authenticate incoming connection using Ed25519 challenge-response handshake
      const authenticatedPeerId = await this.handshakeManager.performListenerHandshake(connection);
      this.emit('connection', connection, authenticatedPeerId);
    } catch (err) {
      this.emit('handshakeError', err, socket.remoteAddress);
      connection.close();
    }
  }

  public getPort(): number {
    return this.activePort;
  }

  public isListening(): boolean {
    return Boolean(this.server?.listening);
  }

  public async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        this.activePort = 0;
        resolve();
      });
    });
  }
}

