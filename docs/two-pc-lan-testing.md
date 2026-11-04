# Arcwire: Two-PC Physical LAN Deployment & Verification Runbook

This runbook outlines the deployment procedure and step-by-step verification matrix for running **Arcwire (IP Messenger)** across two physical Windows 10/11 computers over an isolated Local Area Network (LAN).

---

## 1. Network & Hardware Prerequisites

Arcwire operates in **Pure LAN Mode**—it requires **no internet connection, no external servers, and zero cloud dependencies**. All peer discovery, messaging, transfers, and real-time audio/video streams route point-to-point within your local subnet.

### Hardware & Topology
- **Two Windows Computers:** Both running Windows 10 (version 1903+) or Windows 11 64-bit.
- **Physical Connection:** Connected to the same network via:
  - An Ethernet switch or crossover cable, or
  - A Wi-Fi router (2.4GHz or 5GHz band).

### Subnet Verification
Both computers must reside on the same IP subnet. Open PowerShell on each machine and run:
```powershell
ipconfig
```
Verify that the `IPv4 Address` values share the same prefix (e.g., `192.168.1.15` and `192.168.1.28` with Subnet Mask `255.255.255.0`).

> [!IMPORTANT]
> **Wi-Fi AP Isolation:** Some enterprise and guest Wi-Fi networks enable **Client Isolation** (or "AP Isolation"), which blocks broadcast and direct peer-to-peer traffic between devices. Ensure client isolation is **disabled** on the Wi-Fi router, or use a standard private/home Wi-Fi network or Ethernet switch.

---

## 2. Windows Defender Firewall Configuration

Windows Firewall must permit incoming traffic on Arcwire's three default ports:

| Port | Protocol | Service | Description |
|---|---|---|---|
| **45820** | **UDP** | LAN Discovery | UDP Multicast (`239.255.45.82`) & Subnet Broadcast for peer presence |
| **45821** | **TCP** | Core Transport | Framed messaging, packet envelopes, and 256KB chunked file transfers |
| **45822** | **TCP** | WebRTC Signaling | Local JSON signaling exchange for voice, video, and screen sharing |

### Automated Firewall Setup (Run as Administrator)
Open an elevated PowerShell prompt on **both** PC 1 and PC 2 and execute:

```powershell
New-NetFirewallRule -DisplayName "Arcwire UDP Discovery" -Direction Inbound -LocalPort 45820 -Protocol UDP -Action Allow
New-NetFirewallRule -DisplayName "Arcwire TCP Messaging & Transfer" -Direction Inbound -LocalPort 45821 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "Arcwire TCP WebRTC Signaling" -Direction Inbound -LocalPort 45822 -Protocol TCP -Action Allow
```

To verify the rules have been added:
```powershell
Get-NetFirewallRule -DisplayName "Arcwire*" | Select-Object DisplayName, Enabled, Direction, Action
```

---

## 3. Building & Installing the Windows NSIS Package

### Step A: Package on Build Machine (PC 1)
In the Arcwire repository root, execute:
```powershell
pnpm --filter @ipm/desktop package:win
```
This builds the TypeScript bundles via `electron-vite` and packages the NSIS executable via `electron-builder`. The output will be located at:
```
apps/desktop/dist/Arcwire Setup 1.0.0.exe
```

### Step B: Install on Both Machines
1. Copy `Arcwire Setup 1.0.0.exe` to a USB flash drive or transfer it via a local shared folder to PC 2.
2. Run the installer on **PC 1** and **PC 2**.
3. Choose the installation directory and opt in to Desktop and Start Menu shortcuts.
4. Complete the installation and launch Arcwire on both systems.

---

## 4. Verification Test Matrix Across All 7 Core Features

### Test Case 1: First-Run Onboarding & Automatic LAN Peer Discovery
- **Actions:**
  1. Launch Arcwire on PC 1. Enter Display Name `Alice-PC1` and status `Available`.
  2. Launch Arcwire on PC 2. Enter Display Name `Bob-PC2` and status `Working on LAN`.
- **Expected Outcome:**
  - Both machines automatically detect each other within 1–3 seconds via UDP broadcast.
  - PC 1's device list displays `Bob-PC2` with an active green online badge, computer hostname, and IP address.
  - PC 2's device list displays `Alice-PC1` identically.
- **Manual IP Fallback Test:**
  - On PC 1, click **Direct Connect** (`+` button). Enter PC 2's IPv4 address and port `45821`.
  - Click **Connect**; the peer appears in the list immediately via direct TCP handshake.

---

### Test Case 2: Real-time Direct & Group Messaging
- **Actions:**
  1. On PC 1, click `Bob-PC2` to open the conversation view.
  2. Send `Hello Bob, testing Arcwire LAN messenger!`.
  3. Observe delivery ticks on PC 1.
  4. On PC 2, type a reply in the input box.
- **Expected Outcome:**
  - Message appears instantaneously (<5ms) on PC 2 without internet access.
  - Delivery receipt indicator transitions from Sent (`✓`) to Delivered (`✓✓`) on PC 1.
  - When PC 2 opens the message, receipt turns blue (Read).
  - While Bob is typing, Alice sees `"Bob-PC2 is typing..."` above the input bar.
- **Group Chat Test:**
  - Click **New Group**, name it `LAN Ops Team`, and select `Bob-PC2`.
  - Send messages in the group; both machines display messages in real-time.

---

### Test Case 3: Zero-Knowledge Private Chat (X3DH / Double Ratchet)
- **Actions:**
  1. On PC 1, select `Bob-PC2` and click **Start Private Chat**.
  2. If prompted, set an unlock PIN/Password (Argon2id).
  3. Enter the credential to unlock the private chat session.
  4. An invitation prompt will appear on PC 2. On PC 2, accept the invitation and enter/set unlock credential.
  5. Exchange messages inside the Private Chat session.
  6. Enable the **Self-Destruct Timer** (e.g., 10 seconds).
- **Expected Outcome:**
  - Messages display a lock icon indicating end-to-end forward secrecy encryption.
  - After 10 seconds, the message cleanly vanishes from both screens.
  - Screen protection (`setContentProtection(true)`) prevents Windows screenshot tools (Snipping Tool, OBS) from capturing the private chat window contents.
  - Inspect `%APPDATA%/IPMessenger/data/ipm.db`; verify zero private chat message text is stored in unencrypted SQLite tables.

---

### Test Case 4: High-Speed File & Folder Sharing
- **Actions:**
  1. On PC 1, drag-and-drop a large file (e.g., a 200MB–1GB `.zip` or `.iso`) into the chat with `Bob-PC2`.
  2. On PC 2, click **Accept File**.
  3. While transferring, click **Pause**, verify transfer suspends, then click **Resume**.
- **Expected Outcome:**
  - File streams across LAN at wire speed (typically 50–110 MB/s over Gigabit Ethernet, 15–40 MB/s over Wi-Fi 5/6).
  - Progress bar, transfer speed (MB/s), and ETA update smoothly every 256KB chunk.
  - Once completed, PC 2 computes the SHA-256 hash and verifies 100% cryptographic file integrity.
- **Folder Sharing Test:**
  - On PC 1, go to **Shared Folders** and share a local directory with `Bob-PC2`.
  - On PC 2, open the Shared Folders tab, browse the folder directory hierarchy, and download individual files safely.
  - Path traversal attempts (e.g. `../` or reserved Windows device names) are actively blocked by `PathTraversalGuard`.

---

### Test Case 5: Direct LAN Voice & Video Calling
- **Actions:**
  1. On PC 1, click the **Audio Call** or **Video Call** button in the header of `Bob-PC2`'s chat.
  2. On PC 2, observe the incoming call notification and audible ringtone; click **Accept**.
  3. Test speaking through PC 1's microphone; listen on PC 2's speakers/headset.
  4. Toggle the **Mute Microphone** and **Disable Camera** buttons on either side.
- **Expected Outcome:**
  - WebRTC establishes a direct peer-to-peer media pipeline over LAN via host ICE candidates (no STUN/TURN servers required).
  - Audio and video play with crystal-clear clarity and sub-30ms latency.
  - Muting audio or video instantly updates the remote peer's stream status.
  - Clicking **End Call** terminates the signaling session and releases media devices.

---

### Test Case 6: High-Definition Desktop Screen Sharing
- **Actions:**
  1. While in a call (or from the chat toolbar), click **Share Screen**.
  2. The Screen Picker modal appears listing available monitors and application windows with live thumbnails.
  3. Select **Entire Screen** and click **Share**.
- **Expected Outcome:**
  - PC 2 receives a high-frame-rate (up to 60fps) desktop stream.
  - Mouse movements and window scrolling on PC 1 appear with low latency on PC 2.
  - Clicking **Stop Sharing** gracefully tears down the screen track and returns to normal call/chat mode.

---

### Test Case 7: Windows System Tray, Single Instance & Auto-Start
- **Actions:**
  1. Click the `X` (close) button on Arcwire's top title bar.
  2. Check the Windows System Tray (near the clock).
  3. Double-click the Arcwire tray icon (or right-click -> **Show Window**).
  4. With Arcwire running, attempt to launch Arcwire again from the Desktop shortcut.
  5. Open Settings and toggle **Start with Windows** on.
- **Expected Outcome:**
  - Closing the window minimizes Arcwire to the system tray without terminating the process or disconnecting LAN listeners.
  - Double-clicking the tray icon restores the window to its active state.
  - Launching a second instance triggers the single-instance lock: the second process immediately quits, while the first instance is brought forward and focused.
  - Checking `%APPDATA%/IPMessenger/logs/crash.log` shows clean operations without unhandled exceptions.

---

## 5. Diagnostic & Troubleshooting Checklist

| Issue | Root Cause | Solution |
|---|---|---|
| Peers do not appear in device list | UDP broadcast blocked by Wi-Fi AP isolation or Windows Firewall | 1. Run the firewall PowerShell commands above.<br>2. Ensure both PCs are connected to "Private network" profile in Windows Settings.<br>3. Use **Direct Connect** modal to manually connect via TCP. |
| File transfer stuck at 0% | Inbound TCP 45821 is blocked on the receiver machine | Ensure inbound TCP port 45821 is allowed in Windows Defender Firewall on the receiver. |
| Call connects but no audio/video | Windows Camera/Microphone privacy settings blocking desktop apps | Open Windows Settings -> Privacy & Security -> Microphone/Camera -> Turn on "Let desktop apps access your microphone/camera". |
| "Database locked" or corrupted | Abrupt system power loss | Check `%APPDATA%/IPMessenger/logs/crash.log`. Arcwire runs `PRAGMA integrity_check` on every boot and uses SQLite WAL mode for crash tolerance. |
