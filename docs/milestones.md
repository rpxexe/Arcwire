# Development Milestones & Checklist

## Phase 1: Foundation & Architecture Setup
- [x] Monorepo initialization with pnpm workspaces
- [x] TypeScript strict configuration across all packages
- [x] Shared types, interfaces, schemas (Zod), and event definitions (`@ipm/shared`)
- [x] SQLite database schema definitions and migrations via Drizzle (`@ipm/database`)
- [x] Electron application scaffolding with electron-vite (`@ipm/desktop`)
- [x] React frontend scaffolding with Tailwind CSS
- [x] Basic window frame and system tray setup
- [x] DPAPI safeStorage wrapper with hardware key binding (`@ipm/security`)
- [x] Smoke test verification

---

## Phase 2: Networking & Peer Discovery
- [x] Networking package (`@ipm/networking`):
  - [x] Network interface enumerator & subnet calculation
  - [x] UDP Multicast & Broadcast discovery service (port 45820)
  - [x] TCP framed messaging transport (port 45821)
  - [x] TLS 1.3 self-signed cert generation with pinned Ed25519 public keys
  - [x] Connection pool with automatic reconnection and heartbeat ping/pong
  - [x] Manual direct connect by IP/port
- [x] Device discovery state management (Zustand)
- [x] Device list UI with status indicators (online, away, busy, offline)
- [x] Device trust & authorization management

---

## Phase 3: Messaging
- [x] Messaging package (`@ipm/messaging`):
  - [x] 1-to-1 direct messaging pipeline
  - [x] Group messaging pipeline with Temporary Group Host
  - [x] Host-loss detection and deterministic failover election
  - [x] Message deduplication & sequence ordering
  - [x] Offline message queue with automatic retry
  - [x] Delivery receipts (ACK, Delivered, Read)
- [x] Messaging UI: conversation list, message timeline, typing indicator, search
- [x] Windows native toast notifications

---

## Phase 4: Private Chats System
- [x] Private invitation token generation & SHA-256 storage
- [x] Invitation accept & owner approval workflow
- [x] Argon2id master unlock credential management & failed-attempt rate limiter
- [x] Application-level payload encryption (AES-256-GCM / ChaCha20-Poly1305)
- [x] Private chat isolation: completely excluded from standard lists, searches, and notifications
- [x] Private chat UI with lock/unlock states

---

## Phase 5: File & Folder Sharing
- [x] File-sharing package (`@ipm/file-sharing`):
  - [x] 256 KB chunked streaming pipeline with flow control
  - [x] Concurrent transfer limiter (max 3 concurrent)
  - [x] SHA-256 chunk & file hash verification
  - [x] Transfer states: Offer, Accept, Progress, Pause, Resume, Cancel, Complete
  - [x] LAN Shared Folder server with path traversal & reparse point protection
  - [x] Folder permission enforcement: Read, Upload, Modify, Full Control
- [x] File transfer UI: drag-and-drop, progress bar, speed, remaining time, history
- [x] Virtual LAN folder explorer UI

---

## Phase 6: Voice & Video Calling
- [x] Calling package (`@ipm/calling`):
  - [x] Local TCP signaling channel (port 45822)
  - [x] WebRTC RTCPeerConnection lifecycle (LAN host candidates only)
  - [x] Audio calling pipeline (device selection, mute, quality monitor)
  - [x] Video calling pipeline (camera selection, resolution controls)
- [x] In-call UI: incoming call banner, call screen, video elements, full screen

---

## Phase 7: Screen Sharing
- [x] Desktop capturer source enumeration (screens, windows)
- [x] WebRTC video track replacement for screen feed
- [x] Screen sharing controls and remote viewer interface

---

## Phase 8: Production Readiness
- [x] Security audit & validation tests (DPAPI key store, Path Traversal Guard, ADS, reserved device names)
- [x] Packaging with electron-builder & Windows NSIS installer
- [x] Start with Windows (`app.setLoginItemSettings`) & auto-recovery configurations (`crash.log`, SQLite integrity check)
- [x] Two-PC LAN testing documentation & test reports (`docs/two-pc-lan-testing.md`)
