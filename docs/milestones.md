# IP Messenger - Milestone Checklist

## Phase 1: Desktop Foundation & Core Shell
- [x] Monorepo architecture & directory structure designed
- [x] Technical specifications created (`architecture.md`, `protocol.md`, `database.md`, `security.md`, `implementation.md`)
- [x] pnpm workspace configuration & root scripts
- [x] Shared package (`@ipm/shared`): schemas, types, constants, events
- [x] Database package (`@ipm/database`): better-sqlite3, Drizzle ORM schema, repositories, initial migration
- [x] Security package (`@ipm/security`): Ed25519 identity, key generation, DPAPI safe storage
- [x] Desktop app (`@ipm/desktop`):
  - [x] Electron + electron-vite configuration
  - [x] React 18 + TypeScript + Tailwind CSS
  - [x] Secure Preload bridge & IPC handler framework
  - [x] System Tray integration (minimize to tray, context menu, restore)
  - [x] Theme system: Light, Dark, System
  - [x] Onboarding wizard (OS username/hostname detection, profile creation)
  - [x] Main application shell & navigation (All Chats, Groups, Private, Files, Calls, Devices, Settings)
  - [x] Profile editing & settings view
- [x] Unit & integration tests for Phase 1 components
- [x] Application build & run verification

---

## Phase 2: LAN Networking & Discovery
- [ ] Networking package (`@ipm/networking`):
  - [ ] Network interface detection & multi-adapter handling
  - [ ] UDP Broadcast Discovery Service (port 45820)
  - [ ] mDNS discovery responder & client
  - [ ] TLS 1.3 TCP Server & Connection Manager (port 45821)
  - [ ] IPM/1 Length-prefixed framing codec
  - [ ] Ed25519 mutual authentication handshake
  - [ ] Manual IP/Port connection dialog
- [ ] Device management UI: discovered devices, status indicator, trust verification
- [ ] Network simulation tests (connection loss, reconnect, multiple interfaces)

---

## Phase 3: Messaging
- [ ] Messaging package (`@ipm/messaging`):
  - [ ] 1-to-1 direct messaging pipeline
  - [ ] Group messaging pipeline with Temporary Group Host
  - [ ] Host-loss detection and deterministic failover election
  - [ ] Message deduplication & sequence ordering
  - [ ] Offline message queue with automatic retry
  - [ ] Delivery receipts (ACK, Delivered, Read)
- [ ] Messaging UI: conversation list, message timeline, typing indicator, search
- [ ] Windows native toast notifications

---

## Phase 4: Private Chats System
- [ ] Private invitation token generation & SHA-256 storage
- [ ] Invitation accept & owner approval workflow
- [ ] Argon2id master unlock credential management & failed-attempt rate limiter
- [ ] Application-level payload encryption (AES-256-GCM / ChaCha20-Poly1305)
- [ ] Private chat isolation: completely excluded from standard lists, searches, and notifications
- [ ] Private chat UI with lock/unlock states

---

## Phase 5: File & Folder Sharing
- [ ] File-sharing package (`@ipm/file-sharing`):
  - [ ] 256 KB chunked streaming pipeline with flow control
  - [ ] Concurrent transfer limiter (max 3 concurrent)
  - [ ] SHA-256 chunk & file hash verification
  - [ ] Transfer states: Offer, Accept, Progress, Pause, Resume, Cancel, Complete
  - [ ] LAN Shared Folder server with path traversal & reparse point protection
  - [ ] Folder permission enforcement: Read, Upload, Modify, Full Control
- [ ] File transfer UI: drag-and-drop, progress bar, speed, remaining time, history
- [ ] Virtual LAN folder explorer UI

---

## Phase 6: Voice & Video Calling
- [ ] Calling package (`@ipm/calling`):
  - [ ] Local TCP signaling channel (port 45822)
  - [ ] WebRTC RTCPeerConnection lifecycle (LAN host candidates only)
  - [ ] Audio calling pipeline (device selection, mute, quality monitor)
  - [ ] Video calling pipeline (camera selection, resolution controls)
- [ ] In-call UI: incoming call banner, call screen, video elements, full screen

---

## Phase 7: Screen Sharing
- [ ] Desktop capturer source enumeration (screens, windows)
- [ ] WebRTC video track replacement for screen feed
- [ ] Screen sharing controls and remote viewer interface

---

## Phase 8: Production Readiness
- [ ] Security audit & validation tests
- [ ] Packaging with electron-builder & Windows NSIS installer
- [ ] Start with Windows & auto-recovery configurations
- [ ] Two-PC LAN testing documentation & test reports
