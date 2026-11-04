import selfsigned from 'selfsigned';

export interface TlsCertificate {
  cert: string;
  key: string;
}

export interface TlsCertOptions {
  commonName?: string;
  days?: number;
  keySize?: number;
}

/**
 * Generates an in-memory self-signed TLS certificate for local peer-to-peer TLS 1.3 connections.
 */
export async function generateSelfSignedCertificate(options: TlsCertOptions = {}): Promise<TlsCertificate> {
  const commonName = options.commonName ?? 'ipm.local';
  const days = options.days ?? 365;
  const keySize = options.keySize ?? 2048;

  const now = new Date();
  const notAfter = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const attrs = [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'IP Messenger LAN' },
  ];

  const pems = await selfsigned.generate(attrs, {
    notBeforeDate: now,
    notAfterDate: notAfter,
    keySize,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'basicConstraints',
        cA: true,
      },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });

  return {
    cert: pems.cert,
    key: pems.private,
  };
}
