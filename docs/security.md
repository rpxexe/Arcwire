# IP Messenger - Security Architecture & Threat Model

## 1. Cryptographic Primitives & Key Management

| Purpose | Algorithm / Standard | Specification / Parameters |
|---|---|---|
| Permanent Device Identity | Ed25519 (RFC 8032) | Public key exported as base64; Device ID derived as `dev_` + SHA-256(pubKey)[0..20]. |
| Key Exchange & Ephemeral Sessions | X25519 (RFC 7748) | Diffie-Hellman ephemeral key generation for session establishment. |
| Key Derivation | HKDF-SHA-256 (RFC 5869) | Salted, context-bound derivation of symmetric keys. |
| Transport Layer Security | TLS 1.3 | Self-signed ephemeral certificates pinned to Ed25519 identity key. |
| Message & Session Encryption | AES-256-GCM / ChaCha20-Poly1305 | 12-byte random IV/nonce per message, authenticated ciphertext. |
| Unlock Password Storage | Argon2id | Memory cost: 64 MB, Time cost: 3 iterations, Parallelism: 4 threads. |
| File & Chunk Integrity | SHA-256 | Hash calculated per 256 KB chunk and cumulative across entire file. |
| Protected Secrets Storage | Windows DPAPI | Electron `safeStorage.encryptString()` / `decryptString()`. |

---

## 2. Windows DPAPI Protected Key Storage

Cryptographic key pairs (specifically the private Ed25519 identity key and private chat master keys) are never stored in plaintext inside the SQLite database or configuration files.

### Storage Scheme:
1. When a new identity is generated, the Ed25519 private key is converted to a binary buffer.
2. The buffer is encrypted using Windows Data Protection API (`safeStorage.encryptString(key)`).
3. The resulting ciphertext is stored in `%APPDATA%/IPMessenger/security/identity.dat`.
4. On startup, the key is decrypted into memory (`safeStorage.decryptString()`) and wiped upon application exit.

---

## 3. Private Chat Security Model

### Two-Tier Authentication & Access Rules:
1. **Private Invitation Token (Network Layer):**
   - Cryptographically random token (e.g., `PRV-82K9-X7QM`).
   - Plaintext code is never stored; only its SHA-256 hash is recorded in the `invitations` table.
   - Strictly rate-limited: Maximum 5 failed join attempts per peer per hour before temporary IP throttling.
   - Supports single-use (`maxUses = 1`) and automatic expiration timestamps.
2. **Private Chat Unlock Credential (Local Layer):**
   - Master unlock PIN/Password hashed with Argon2id.
   - Throttling: Exponential backoff after 3 failed attempts (30s, 60s, 300s, lockout).
   - Credential is never transmitted across the network under any circumstance.

### Isolation Rules:
- Private conversations are marked with `isPrivate = 1` and queries are strictly filtered out by default database repositories.
- Normal chat search, unread badge accumulators, and standard Windows toast notifications are forbidden from indexing or displaying private message snippets.
- Unlocking private chats maintains state only in ephemeral memory (cleared on window lock, app idle, or process shutdown).

---

## 4. Shared Folder Path Traversal Mitigation

Folder sharing exposes specific local paths over the LAN. To prevent remote malicious traversal attacks (`../`, symlink attacks, Windows reparse points):

1. **Root Confinement Verification:**
   Before executing any filesystem operation (`stat`, `readdir`, `readFile`, `writeFile`), the target path is resolved using `path.resolve()` and `fs.realpathSync()`.
   ```typescript
   export function validatePathWithinRoot(targetPath: string, rootDir: string): string {
     const resolvedRoot = path.resolve(rootDir);
     const resolvedTarget = path.resolve(targetPath);
     const relative = path.relative(resolvedRoot, resolvedTarget);
     
     if (relative.startsWith('..') || path.isAbsolute(relative)) {
       throw new SecurityException("Path traversal attempt detected");
     }
     return resolvedTarget;
   }
   ```
2. **Reparse Point / Symlink Defense:** Symlinks pointing outside the shared folder boundary are rejected immediately.
3. **Restricted Paths:** Windows system directories (`C:\Windows`, `Program Files`, User AppData roots, and Root drive `C:\`) cannot be configured as shared roots.

---

## 5. Electron Hardening & IPC Security

- **Context Isolation:** Enabled (`contextIsolation: true`).
- **Node Integration:** Disabled (`nodeIntegration: false`).
- **Sandboxing:** Enabled (`sandbox: true`).
- **Preload API Surface:** Only explicit channel wrappers with input validation. `ipcRenderer` is never exposed directly.
- **Content Security Policy (CSP):**
  ```http
  default-src 'none';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  media-src 'self' blob:;
  connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*;
  ```
- **Navigation Guard:** `will-navigate` and `setWindowOpenHandler` are intercepted and blocked. External links are opened using safe shell openers with protocol validation (`https:` only).
- **Media Permission Guard:** `session.defaultSession.setPermissionRequestHandler` explicitly handles camera and microphone grants.
