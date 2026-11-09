# IP Messenger – Windows LAN Desktop Communication Platform

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-blue?logo=windows)](https://microsoft.com)
[![Runtime](https://img.shields.io/badge/Electron-34.5-47848F?logo=electron)](https://www.electronjs.org/)
[![UI](https://img.shields.io/badge/React-18.3-61DAFB?logo=react)](https://react.dev/)
[![Language](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Database](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?logo=sqlite)](https://sqlite.org/)
[![ORM](https://img.shields.io/badge/Drizzle-ORM-C5F74F?logo=drizzle)](https://orm.drizzle.team/)
[![Styling](https://img.shields.io/badge/TailwindCSS-3.4-38B2AC?logo=tailwindcss)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](#)

A high-performance, zero-cloud Windows desktop messenger designed for local area networks (Wi-Fi and Ethernet). **IP Messenger operates completely offline without internet connectivity, third-party authentication servers, or external databases**, delivering direct node-to-node communications with military-grade local cryptography.

---

## Table of Contents

- [Architectural Highlights](#architectural-highlights)
- [Technology Stack](#technology-stack)
- [Monorepo Structure](#monorepo-structure)
- [Network Protocol & Ports](#network-protocol--ports)
- [Data Storage Hierarchy](#data-storage-hierarchy)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Development & Build Commands](#development--build-commands)
- [Testing Strategy](#testing-strategy)
- [Implementation Roadmap](#implementation-roadmap)
- [Documentation Index](#documentation-index)

---

## Architectural Highlights

- **Zero-Cloud & Zero-Internet Operation:** Operates autonomously across subnets via direct UDP broadcast discovery and TLS 1.3 TCP streams.
- **Cryptographic Device Identities:** Every computer generates a permanent Ed25519 identity keypair upon onboarding. The Device ID (`dev_<hash>`) is permanent and strictly decoupled from the Windows username.
- **Hardware-Protected Secret Storage:** Private signing and encryption keys are encrypted using the Windows Data Protection API (DPAPI / Electron `safeStorage`) and stored in `%APPDATA%/IPMessenger/security/identity.dat`.
- **Hardened Electron Runtime:** Fully isolated renderer (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), strictly typed preload bridge (`window.api`), and strict Content Security Policy (`CSP`).
- **SQLite 3 Write-Ahead Logging:** High-concurrency local database powered by Drizzle ORM across 20 normalized schemas with foreign key integrity.
- **Dynamic System Tray:** Custom notification tray icon with live presence status toggles (Online, Busy, Away), close-to-tray window interception, and double-click restore.
- **Multi-Adapter Support:** Automatically enumerates and binds to all active network adapters (Wi-Fi, Ethernet, virtual LAN switches).
- **Transport Agnostic Core:** Implements a pluggable `TransportAdapter` interface (`LanTransportAdapter` current; `InternetTransportAdapter` reserved for future releases).

---

## Technology Stack

| Layer | Technologies |
|---|---|
| **Desktop Runtime** | Electron 34, `electron-vite`, Node.js (Main Process) |
| **Frontend Framework** | React 18, TypeScript (Strict), React DOM |
| **Design & UI** | Tailwind CSS, Lucide React Icons, custom shadcn-compatible design tokens |
| **State Management** | Zustand stores (`themeStore`, `profileStore`, `navigationStore`) |
| **Local Database** | SQLite 3 (Write-Ahead Logging), `better-sqlite3`, Drizzle ORM, Drizzle Kit |
| **Security & Secrets** | Windows DPAPI (`safeStorage`), Ed25519, X25519, HKDF-SHA-256, AES-256-GCM, Argon2id |
| **LAN Networking** | UDP Broadcast (45820), TLS 1.3 over TCP (45821), WebRTC local signaling (45822) |
| **Validation** | Zod wire envelope & payload validation schemas |
| **Testing** | Vitest (Unit & Integration tests) |
| **Monorepo Tooling** | pnpm workspaces |

---

## Monorepo Structure

```
ip-messenger/
├── apps/
│   └── desktop/                     # Electron + React Application Shell
│       ├── electron/
│       │   ├── main/                # Main process lifecycle, single-instance lock
│       │   ├── preload/             # Sandboxed context bridge (window.api)
│       │   ├── services/            # AppPaths, SystemInfoService, TrayManager, WindowManager
│       │   └── ipc/                 # Strongly typed IPC channel dispatchers
│       ├── src/                     # React 18 UI Application
│       │   ├── app/                 # Main App layout & view orchestrator
│       │   ├── components/          # TitleBar (Windows controls), Sidebar (Navigation)
│       │   ├── features/            # Authentication, Chats, Devices, Files, Settings
│       │   ├── stores/              # Zustand state stores (Theme, Profile, Navigation)
│       │   └── styles/              # Tailwind CSS styles & CSS token variables
│       ├── electron.vite.config.ts  # Multi-target Vite bundler config
│       └── package.json
│
├── packages/
│   ├── shared/                      # Wire protocol schemas (Zod), types, constants, events
│   ├── database/                    # Drizzle ORM schema (20 tables), connection & repositories
│   ├── security/                    # Ed25519 identity, DPAPI secret store, path traversal guard
│   ├── networking/                  # UDP discovery, TLS TCP transport, TransportAdapter
│   ├── messaging/                   # 1-to-1 direct messaging, distributed group host engine
│   ├── file-sharing/                # 256 KB chunked streaming pipeline & LAN virtual drive
│   └── calling/                     # WebRTC voice, video, and screen sharing signaling
│
├── tests/
│   ├── unit/                        # Security, path traversal, and Zod schema tests
│   └── integration/                 # SQLite WAL, profile persistence, and settings tests
│
├── scripts/
│   ├── setup-sqlite.ps1             # Native better-sqlite3 binary manager
│   └── test-run.js                  # Automated Electron smoke test runner
└── docs/                            # In-depth architectural & protocol documentation
```

---

## Network Protocol & Ports

The application communicates via the versioned **`IPM/1`** protocol using length-prefixed binary framing (4-byte big-endian unsigned length + payload).

| Purpose | Protocol | Port | Description |
|---|---|---|---|
| **Device Discovery** | UDP Broadcast | `45820` | Automated periodic beacons and peer query pings |
| **Core Messaging & Data** | TLS 1.3 over TCP | `45821` | Authenticated peer messaging and chunked file transfer |
| **WebRTC Local Signaling**| TCP / WebSocket | `45822` | Peer session negotiation for voice, video, and screen calls |
| **Media Streams** | WebRTC SRTP/UDP | Dynamic | Direct peer-to-peer audio, video, and desktop capture |

---

## Data Storage Hierarchy

All application state is preserved locally inside the user's roaming directory `%APPDATA%/IPMessenger/`:

```
%APPDATA%/IPMessenger/
├── data/
│   ├── ipm.db             # Primary SQLite database (WAL mode)
│   ├── ipm.db-wal         # Write-Ahead Log journal
│   └── ipm.db-shm         # Shared-memory index
├── attachments/           # Cached media attachments
├── transfers/             # Chunked in-flight downloads & staging files
├── avatars/               # Cached contact avatars
├── logs/                  # Rolling diagnostic and network logs
├── backups/               # Automated database snapshots
└── security/
    └── identity.dat       # DPAPI-encrypted Ed25519 private identity key
```

---

## Prerequisites

- **Operating System:** Windows 10 (version 22H2 or newer) or Windows 11 (x64).
- **Node.js:** `v20.x` or `v24.x`.
- **Package Manager:** `pnpm` (v10+ / v12+).
  ```powershell
  npm install -g pnpm
  ```

---

## Installation & Setup

1. **Clone or enter the project repository:**
   ```powershell
   cd c:\Rishabh\ip-messenger
   ```

2. **Install all workspace dependencies:**
   ```powershell
   pnpm install
   ```

3. **Verify the SQLite native binary configuration:**
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File "scripts/setup-sqlite.ps1"
   ```

---

## Development & Build Commands

```powershell
# Launch the application in development mode with Hot Module Replacement (HMR):
pnpm dev

# Build the complete desktop application for production (Main + Preload + Renderer):
pnpm build

# Run strict TypeScript validation across all 7 workspace packages:
pnpm typecheck

# Run all unit and integration test suites:
pnpm test

# Run tests in interactive watch mode:
pnpm test:watch

# Run the live Electron runtime smoke test:
& "apps/desktop/node_modules/electron/dist/electron.exe" apps/desktop --smoke-test
```

---

## Testing Strategy

IP Messenger enforces multi-tiered testing:

1. **Unit Testing (`tests/unit/`):**
   - Cryptographic key generation, signing, and signature verification (`security.test.ts`).
   - Secret key storage encryption and decryption fallback (`security.test.ts`).
   - Path traversal and reparse point boundary defenses (`permissions.test.ts`).
   - Zod wire envelope and payload validation schemas (`schemas.test.ts`).

2. **Integration Testing (`tests/integration/`):**
   - SQLite Write-Ahead Logging initialization and verification of all 20 database tables (`desktop-init.test.ts`).
   - First-launch onboarding, profile generation, and update persistence (`desktop-init.test.ts`).
   - Settings repository and preference persistence (`desktop-init.test.ts`).

3. **Live Electron Smoke Test (`--smoke-test`):**
   - Verifies that the native Electron 34 runtime initializes the window manager, system tray, SQLite database, DPAPI safeStorage, and typed IPC handlers without warnings or exceptions.

---

## Implementation Roadmap

- [x] **Phase 1: Desktop Foundation & Core Shell**
  - [x] pnpm workspace monorepo layout & configurations.
  - [x] Electron 34 + electron-vite + React 18 + TypeScript + Tailwind CSS.
  - [x] Secure Preload bridge (`window.api`) with strict CSP and typed IPC dispatchers.
  - [x] System Tray integration with status menu and close-to-tray handling.
  - [x] Light, Dark, and System theme synchronization.
  - [x] Onboarding wizard: Windows username/hostname detection and profile customization.
  - [x] SQLite 3 database with WAL mode and 20 Drizzle ORM schema tables.
  - [x] Windows DPAPI protected key storage for Ed25519 device identities.
- [x] **Phase 2: LAN Networking & Discovery**
  - [x] Multi-interface detection (Wi-Fi + Ethernet).
  - [x] UDP Broadcast Discovery Service (Port 45820).
  - [x] mDNS service announcer & query responder.
  - [x] TLS 1.3 TCP Server & Connection Pool (Port 45821).
  - [x] Ed25519 mutual authentication handshake.
  - [x] Manual IP/Port direct connect dialog.
- [x] **Phase 3: Messaging Pipeline**
  - [x] 1-to-1 reliable direct messaging with deduplication.
  - [x] Distributed group messaging with temporary host and failover election.
  - [x] Delivery receipts (ACK, Delivered, Read).
  - [x] Offline message queue with automatic retry.
- [x] **Phase 4: Private Chats System**
  - [x] PRV-XXXX-XXXX invitation token generation & SHA-256 verification.
  - [x] Argon2id master unlock credentials with failed-attempt throttling.
  - [x] Application-level payload encryption (AES-256-GCM session ratchets).
  - [x] Strict query and UI isolation from standard chat views.
- [x] **Phase 5: File & Folder Sharing**
  - [x] 256 KB chunked streaming pipeline with sliding-window flow control.
  - [x] SHA-256 chunk and cumulative file verification.
  - [x] Drag-and-drop transfers with progress, speed, pause, and resume.
  - [x] Virtual LAN shared drive with path traversal defense and granular permissions.
- [x] **Phase 6: Voice & Video Calling**
  - [x] Local TCP signaling channel (Port 45822).
  - [x] WebRTC 1-to-1 voice and video calling.
  - [x] Audio/video device selectors, mute, and fullscreen.
- [x] **Phase 7: Screen Sharing**
  - [x] Electron `desktopCapturer` screen and window stream acquisition.
  - [x] Remote viewer display and source switcher.
- [x] **Phase 8: Production Hardening & Windows Installer**
  - [x] Automated NSIS Windows installer via `electron-builder`.
  - [x] Multi-PC LAN verification and performance benchmarking.

---

## Documentation Index

For in-depth technical specifications, consult the detailed documentation:

- [System Architecture Specification](docs/architecture.md)
- [IPM/1 Network Protocol Specification](docs/protocol.md)
- [Database Schema & Storage Architecture](docs/database.md)
- [Security Architecture & Threat Model](docs/security.md)
- [Implementation Plan & Engineering Conventions](docs/implementation.md)
- [Milestone Checklist & Acceptance Criteria](docs/milestones.md)

