# IP Messenger - System Architecture Specification

## 1. Overview & Architectural Goals

IP Messenger is an offline-first, peer-to-peer Windows LAN desktop communication platform designed for corporate and local network environments without internet dependencies. 

### Key Architectural Pillars:
- **Zero Internet Requirement:** Completely operational across Wi-Fi and Ethernet subnets without cloud infrastructure, central directory servers, or external telemetry.
- **Hybrid P2P Network Topology:** Direct node-to-node TCP/TLS links for 1-to-1 messaging, file transfer, and media streams; temporary distributed group hosts for multi-party group messaging with automatic failover and host migration.
- **Strict Security Architecture:** Hardened Electron runtime (context isolation, sandboxing, strict CSP), application-level encryption for private chats, Ed25519 cryptographic device identities, and Windows DPAPI protected key storage.
- **Transport Agnostic Core:** Core messaging, calling, and file pipelines communicate over a pluggable `TransportAdapter` interface (`LanTransportAdapter` current; `InternetTransportAdapter` reserved for future releases).
- **Windows-First Experience:** Tailored for Windows 10 (22H2+) and Windows 11 x64, supporting native notifications, system tray lifecycle, desktop capturer, and hardware acceleration.

---

## 2. Monorepo Organization & Workspace Boundaries

The codebase is organized as a strict pnpm monorepo separating domain packages from desktop shell runtimes:

```
ip-messenger/
├── apps/
│   └── desktop/                     # Electron + React application
│       ├── electron/
│       │   ├── main/                # Main process entry, window & tray lifecycle
│       │   ├── preload/             # Sandboxed context bridge, typed API surface
│       │   ├── services/            # Node-level service coordination
│       │   └── ipc/                 # Strongly typed IPC channel handlers
│       ├── src/                     # React UI application
│       │   ├── app/                 # Providers, router, global layout
│       │   ├── components/          # Reusable design system & UI components
│       │   ├── features/            # Domain UI modules (auth, chats, files, calls, etc.)
│       │   ├── hooks/               # Custom React hooks
│       │   ├── stores/              # Zustand client stores
│       │   ├── services/            # Client IPC wrapper clients
│       │   ├── styles/              # Tailwind CSS styles & variables
│       │   └── types/               # Renderer-only UI types
│       ├── electron.vite.config.ts  # Build configuration
│       └── package.json
│
├── packages/
│   ├── shared/                      # Types, schemas, constants, errors
│   │   ├── types/
│   │   ├── schemas/                 # Zod validation schemas
│   │   ├── constants/               # Port constants, protocol constants
│   │   └── events/                  # Event name declarations
│   │
│   ├── networking/                  # LAN transport & device discovery
│   │   ├── discovery/               # UDP broadcast + mDNS listener/announcer
│   │   ├── transport/               # Framing, TLS TCP transport, TransportAdapter
│   │   ├── connection-manager/      # Peer pool, heartbeats, reconnect backoff
│   │   ├── authentication/          # Ed25519 mutual authentication handshake
│   │   └── protocol/                # IPM/1 wire codec & dispatchers
│   │
│   ├── messaging/                   # Chat logic & orchestration
│   │   ├── direct/                  # Direct message pipeline & deduplication
│   │   ├── group/                   # Group coordinator & host migration state machine
│   │   ├── private/                 # Hidden private chat authorization & ratchets
│   │   └── receipts/                # Delivery & read receipt acknowledgments
│   │
│   ├── file-sharing/                # File and folder streaming
│   │   ├── transfers/               # Chunked stream engine (256 KB chunks)
│   │   ├── chunks/                  # SHA-256 chunk validation & temporary store
│   │   ├── folder-index/            # LAN shared virtual folder explorer
│   │   └── permissions/             # Read/Upload/Modify/Full-control validator
│   │
│   ├── calling/                     # Audio, Video & Screen sharing
│   │   ├── signaling/               # Local TCP signaling channel
│   │   ├── sessions/                # WebRTC RTCPeerConnection manager
│   │   ├── voice/                   # Audio pipeline & media constraints
│   │   ├── video/                   # Video pipeline & render pipelines
│   │   └── screen-sharing/          # DesktopCapturer source streams
│   │
│   ├── database/                    # SQLite storage layer
│   │   ├── schema/                  # Drizzle ORM schema definitions
│   │   ├── migrations/              # Drizzle SQL migration files
│   │   ├── repositories/            # Repository pattern data access objects
│   │   └── encryption/              # Secure key store integration
│   │
│   └── security/                    # Cryptography & Windows secrets
│       ├── identity/                # Ed25519 device key generation & export
│       ├── certificates/            # Self-signed TLS 1.3 cert generation
│       ├── key-management/          # Windows DPAPI / safeStorage wrapper
│       └── permissions/             # Filesystem path traversal guard
│
├── tests/                           # Cross-package & e2e testing
│   ├── unit/                        # Independent unit tests
│   ├── integration/                 # Multi-package integration tests
│   ├── network/                     # Simulated 2-peer network test suites
│   ├── security/                    # Path traversal & cryptographic tests
│   └── e2e/                         # Playwright Electron tests
│
├── docs/                            # Architectural & protocol specifications
└── scripts/                         # Build, release, and migration tooling
```

---

## 3. Electron Multi-Process Architecture

To prevent attack vectors and guarantee 60fps UI performance, Electron's responsibilities are divided into distinct execution tiers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Main Process (Node.js)                         │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │   Discovery Engine    │  │  Connection Mgr │  │ Drizzle / SQLite │  │
│  │ (UDP:45820, mDNS:5353)│  │ (TLS TCP:45821) │  │  better-sqlite3  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │    Signaling Server   │  │ Chunked Stream  │  │  Windows DPAPI   │  │
│  │     (TCP:45822)       │  │  (File/Folder)  │  │  Key Management  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │  System Tray & Menus  │  │ Notifications   │  │ Power & Network  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ IPC (Strictly typed invoke/send)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Preload Script (Sandboxed)                        │
│                                                                        │
│  - contextIsolation: true                                              │
│  - nodeIntegration: false                                              │
│  - Exposes window.api (strictly validated typed bridge methods)        │
│  - Zero raw ipcRenderer exposure                                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ ContextBridge API
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Renderer Process (Chromium)                      │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │    React 18 Shell     │  │ Zustand Stores  │  │ React Query Cts  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │   Tailwind CSS / UI   │  │ WebRTC Media    │  │ Media Streams    │  │
│  │     Components        │  │ PeerConnections │  │ (Local/Remote)   │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Networking Model & Port Allocation

| Component | Protocol | Default Port | Configurable | Purpose |
|---|---|---|---|---|
| Discovery Service | UDP Broadcast | 45820 | Yes | Peer announcements and active queries |
| Discovery Service (alt) | mDNS | 5353 (multicast) | Yes | Zeroconf device and service discovery |
| Core Communication | TLS 1.3 over TCP | 45821 | Yes | Auth, 1-to-1 chat, group chat, file streaming |
| Local Signaling | TCP / WebSocket | 45822 | Yes | WebRTC session negotiation for calls |
| Media Streams | WebRTC (SRTP/UDP)| Dynamic Ephemeral | Yes (range) | Direct peer-to-peer audio, video, screen feeds |

### Multi-Interface Resolution:
On startup and upon network change detection, the Node.js backend enumerates all active, non-internal IPv4 interfaces (`os.networkInterfaces()`). It identifies valid broadcast addresses (e.g., `192.168.1.255`) for each subnet and binds UDP discovery sockets to each interface to support simultaneous Wi-Fi and Ethernet adapters.

---

## 5. Transport Abstraction Layer

All application protocols execute on top of an abstract `TransportAdapter` interface:

```typescript
export interface TransportConnection {
  readonly peerId: string;
  readonly remoteAddress: string;
  readonly isEncrypted: boolean;
  send(message: NetworkMessage): Promise<void>;
  close(): Promise<void>;
}

export interface TransportAdapter {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  connect(peerId: string, address?: string, port?: number): Promise<TransportConnection>;
  getConnection(peerId: string): TransportConnection | undefined;
  onMessage(callback: (peerId: string, message: NetworkMessage) => void): void;
  onPeerConnected(callback: (peerId: string) => void): void;
  onPeerDisconnected(callback: (peerId: string) => void): void;
}
```

The concrete implementation for this release is `LanTransportAdapter` (utilizing Node.js `tls` and `net` sockets). A future `InternetTransportAdapter` will implement the exact same interface using relay/STUN/TURN connections without requiring any refactoring of chat, file, or media business logic.

---

## 6. Distributed Group Messaging & Host Recovery

Group conversations operate via a lightweight dynamic host protocol:
1. **Creation:** The group creator defaults to `Host Node`.
2. **Distribution:** Group members send messages to the `Host Node`, which sequences messages, assigns monotonic sequence numbers, writes to host database, and fans out copies to all active members.
3. **Heartbeat:** Members ping the host every 5 seconds. If the host is silent for 15 seconds, a deterministic election algorithm is invoked:
   - Remaining members evaluate the sorted list of member IDs who acknowledged the highest sequence number.
   - The lowest lexical device ID among candidates with the highest sequence number promotes itself to `Host Node` and broadcasts `GROUP_HOST_MIGRATED`.
   - Other members acknowledge the new host, and message dispatch resumes seamlessly.

---

## 7. Storage Hierarchy & Paths

All runtime artifacts reside within the Windows user roaming directory `%APPDATA%/IPMessenger/`:

```
%APPDATA%/IPMessenger/
├── data/
│   ├── ipm.db             # Primary SQLite database
│   ├── ipm.db-wal         # Write-Ahead Log for concurrent read/write
│   └── ipm.db-shm         # Shared memory index
├── attachments/           # Received & cached media attachments
├── transfers/             # Chunked in-flight downloads & temp files
├── avatars/               # Stored profile and contact avatars
├── logs/                  # Rolling application and network diagnostic logs
├── backups/               # Automated database snapshots
└── security/              # Encrypted device key store (protected via DPAPI)
```

