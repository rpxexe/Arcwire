# IP Messenger - Implementation Plan & Engineering Guidelines

## 1. Phase Breakdown

### Phase 1: Desktop Foundation & Core Shell (Current)
- Monorepo initialization with pnpm workspaces.
- Configuration of Electron, electron-vite, React, TypeScript.
- Tailwind CSS design system with Dark / Light / System theme support.
- Secure Preload bridge and IPC typed dispatchers.
- Initial SQLite database setup with Drizzle ORM and migrations.
- Onboarding wizard: Windows username/hostname detection, profile customization, unique device ID derivation.
- Desktop shell: system tray, minimize-to-tray, navigation sidebar, window frame controls.

### Phase 2: LAN Networking & Discovery
- UDP Discovery Service (Broadcast on 45820).
- mDNS Service responder & query.
- Network interface manager (Wi-Fi + Ethernet monitoring, multi-homed IP resolution).
- TLS 1.3 TCP server & client pool on port 45821.
- Ed25519 identity handshake and mutual authentication.
- Manual IP direct connect dialog.

### Phase 3: Reliable Messaging
- 1-to-1 conversation management and thread rendering.
- Group chat coordination with distributed group host and failover migration.
- Monotonic sequence numbers and message deduplication.
- Offline outgoing message queue with retry backoff.
- Delivery receipts (ACK, Delivered, Read) and status indicators.
- Native Windows toast notifications.

### Phase 4: Private Chats System
- Secure invitation generator (`PRV-XXXX-XXXX`) with SHA-256 token verification.
- Local unlock credentials hashed with Argon2id and failed-attempt throttling.
- Separate private chat repository with strict query isolation.
- Application-level payload encryption using AES-256-GCM session ratchets.

### Phase 5: File & Folder Sharing
- Chunked file streaming engine (256 KB chunks, max 3 concurrent transfers).
- SHA-256 chunk and cumulative file verification.
- In-flight transfer controls: Pause, Resume, Cancel, Retry.
- LAN shared folder browser with strict path traversal validation.
- Folder permissions: Read-only, Upload, Modify, Full Control.

### Phase 6: Voice & Video Calling
- Local signaling channel on TCP port 45822.
- WebRTC RTCPeerConnection establishment (LAN host candidates only, no external STUN/TURN).
- Audio call controls (mic mute, audio output device selection).
- Video call interface (camera selector, local preview, remote video, fullscreen).

### Phase 7: Screen Sharing
- Electron `desktopCapturer` screen and window stream acquisition.
- WebRTC screen track injection.
- Screen sharing controls: source switcher, stop/pause, remote viewer.

### Phase 8: Production Hardening & Windows Packaging
- Cross-platform network simulation test suite.
- Security audit & path traversal penetration tests.
- Windows NSIS installer creation with `electron-builder`.
- Auto-start with Windows and desktop shortcut configurations.

---

## 2. Engineering Conventions

1. **Strict TypeScript:** No `any` types; all IPC calls, database entities, and network packets use strict typing with Zod runtime validation.
2. **Repository Pattern:** Database interactions are encapsulated within repositories (`ProfileRepository`, `DeviceRepository`, `MessageRepository`, etc.) rather than ad-hoc SQL queries.
3. **Event-Driven Service Layer:** Main process services communicate internally via an `AppEventBus` typed EventEmitter.
4. **Idempotent Network Processing:** Every incoming frame is checked against processed UUID caches before triggering side effects.
