import { generateKeyPairSync, createHash, sign, verify } from 'node:crypto';

export interface DeviceKeyIdentity {
  deviceId: string;
  publicKey: string;  // Base64 encoded SPKI
  privateKey: string; // Base64 encoded PKCS8
}

/**
 * Derives a deterministic device ID from an Ed25519 public key.
 */
export function deriveDeviceId(publicKeyBase64: string): string {
  const hash = createHash('sha256')
    .update(Buffer.from(publicKeyBase64, 'base64'))
    .digest('hex');
  return `dev_${hash.substring(0, 20)}`;
}

/**
 * Generates an Ed25519 keypair for device identity and signing.
 */
export function generateDeviceIdentity(): DeviceKeyIdentity {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
    },
  });

  const publicKeyBase64 = publicKey.toString('base64');
  const privateKeyBase64 = privateKey.toString('base64');
  const deviceId = deriveDeviceId(publicKeyBase64);

  return {
    deviceId,
    publicKey: publicKeyBase64,
    privateKey: privateKeyBase64,
  };
}

/**
 * Signs payload data with the private Ed25519 key.
 */
export function signData(data: Buffer | string, privateKeyDerBase64: string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const privateKey = {
    key: Buffer.from(privateKeyDerBase64, 'base64'),
    format: 'der' as const,
    type: 'pkcs8' as const,
  };
  const signature = sign(null, buffer, privateKey);
  return signature.toString('base64');
}

/**
 * Verifies payload signature with the public Ed25519 key.
 */
export function verifySignature(
  data: Buffer | string,
  signatureBase64: string,
  publicKeyDerBase64: string
): boolean {
  try {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const signature = Buffer.from(signatureBase64, 'base64');
    const publicKey = {
      key: Buffer.from(publicKeyDerBase64, 'base64'),
      format: 'der' as const,
      type: 'spki' as const,
    };
    return verify(null, buffer, publicKey, signature);
  } catch {
    return false;
  }
}
