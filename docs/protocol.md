# IP Messenger - Network Protocol Specification: IPM/1

## 1. Protocol Overview

**Protocol Identifier:** `IPM/1`  
**Wire Encoding:** UTF-8 JSON wrapped in 4-byte big-endian length prefix framing. For binary streams (file chunks), a binary header prefix is used to minimize overhead.  
**Transport:** TLS 1.3 over TCP (Port 45821 default), UDP Broadcast (Port 45820 default), and TCP Signaling (Port 45822 default).

---

## 2. Framing Specification

### Length-Prefixed TCP Framing
Each message transmitted over TCP connections begins with a 4-byte unsigned integer in big-endian byte order representing the length of the payload in bytes:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Payload Length (N)                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
+                    Payload Data (N Bytes)                     +
|                       (UTF-8 JSON / Binary)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Constraints:
- Maximum Control/Message Frame Length: `1,048,576 bytes (1 MB)`
- Maximum Binary Chunk Frame Length: `262,144 bytes (256 KB) + 256 bytes header`
- Framing Decoder: Accumulates stream bytes until the 4-byte length $N$ is available, verifies $N \le \text{MaxFrameLength}$, allocates a slice of size $N$, unpacks data, validates JSON, and passes to the Zod message parser.
- Frames exceeding max limits or failing JSON parsing trigger immediate stream termination and peer disconnect.

---

## 3. Base Envelope Structure

Every network frame conforms to the base envelope structure:

```json
{
  "protocol": "IPM/1",
  "id": "e9b5f3a0-1234-4a21-98ab-c0123456789a",
  "type": "CHAT_MESSAGE",
  "senderId": "dev_01HWYZABC1234567890",
  "receiverId": "dev_01HWYZDEF9876543210",
  "conversationId": "conv_01HWYZ9999999999999",
  "timestamp": 1714567890123,
  "sequence": 42,
  "payload": {}
}
```

### Field Definitions:
- `protocol`: String literal `"IPM/1"`.
- `id`: Unique RFC4122 v4 UUID generated per frame for deduplication.
- `type`: Enum indicating the packet operation.
- `senderId`: Cryptographic Device ID (derived from public key hash) of sender.
- `receiverId`: Target Device ID or Group ID or `"*"`.
- `conversationId`: UUID of target 1-to-1, group, or private conversation.
- `timestamp`: UTC millisecond timestamp when the frame was constructed.
- `sequence`: Monotonically increasing 64-bit integer per sender/conversation for replay protection.
- `payload`: Strictly typed object corresponding to `type`.

---

## 4. Complete Event Type Registry

```typescript
export enum IpmEventType {
  // Discovery
  DEVICE_ANNOUNCE = "DEVICE_ANNOUNCE",
  DEVICE_QUERY = "DEVICE_QUERY",

  // Authentication & Handshake
  AUTH_REQUEST = "AUTH_REQUEST",
  AUTH_CHALLENGE = "AUTH_CHALLENGE",
  AUTH_RESPONSE = "AUTH_RESPONSE",
  AUTH_ACCEPTED = "AUTH_ACCEPTED",

  // 1-to-1 Messaging
  CHAT_MESSAGE = "CHAT_MESSAGE",
  MESSAGE_ACK = "MESSAGE_ACK",
  MESSAGE_DELIVERED = "MESSAGE_DELIVERED",
  MESSAGE_READ = "MESSAGE_READ",

  // Group Messaging
  GROUP_CREATE = "GROUP_CREATE",
  GROUP_JOIN = "GROUP_JOIN",
  GROUP_LEAVE = "GROUP_LEAVE",
  GROUP_MESSAGE = "GROUP_MESSAGE",
  GROUP_HOST_MIGRATED = "GROUP_HOST_MIGRATED",

  // Private Conversations
  PRIVATE_INVITE = "PRIVATE_INVITE",
  PRIVATE_JOIN_REQUEST = "PRIVATE_JOIN_REQUEST",
  PRIVATE_JOIN_ACCEPTED = "PRIVATE_JOIN_ACCEPTED",
  PRIVATE_UNLOCK = "PRIVATE_UNLOCK",
  PRIVATE_MESSAGE = "PRIVATE_MESSAGE",

  // File Transfer
  FILE_OFFER = "FILE_OFFER",
  FILE_ACCEPT = "FILE_ACCEPT",
  FILE_REJECT = "FILE_REJECT",
  FILE_CHUNK = "FILE_CHUNK",
  FILE_CHUNK_ACK = "FILE_CHUNK_ACK",
  FILE_COMPLETE = "FILE_COMPLETE",
  FILE_CANCEL = "FILE_CANCEL",

  // Folder Sharing
  FOLDER_LIST = "FOLDER_LIST",
  FOLDER_LIST_RESPONSE = "FOLDER_LIST_RESPONSE",
  FOLDER_DOWNLOAD = "FOLDER_DOWNLOAD",
  FOLDER_UPLOAD = "FOLDER_UPLOAD",
  FOLDER_MODIFY = "FOLDER_MODIFY",

  // Calling & WebRTC Signaling
  CALL_REQUEST = "CALL_REQUEST",
  CALL_ACCEPT = "CALL_ACCEPT",
  CALL_REJECT = "CALL_REJECT",
  CALL_END = "CALL_END",
  CALL_SIGNAL = "CALL_SIGNAL",
  SCREEN_SHARE_START = "SCREEN_SHARE_START",
  SCREEN_SHARE_STOP = "SCREEN_SHARE_STOP"
}
```

---

## 5. Payloads & State Flow Specifications

### 5.1 Device Discovery Flow
1. **Announce (UDP 45820 Broadcast):**  
   New node broadcasts `DEVICE_ANNOUNCE` every 30 seconds or upon adapter change.
   ```json
   {
     "type": "DEVICE_ANNOUNCE",
     "payload": {
       "deviceId": "dev_01HWYZ...",
       "displayName": "Alice Smith",
       "hostname": "ALICE-DESKTOP",
       "osUser": "alice",
       "tcpPort": 45821,
       "signalingPort": 45822,
       "publicKey": "base64_ed25519_pubkey",
       "avatarHash": "sha256_avatar_hex",
       "status": "online"
     }
   }
   ```
2. **Query (UDP Broadcast):** Node prompts active LAN nodes to announce themselves immediately.

### 5.2 Mutual TLS & Ed25519 Challenge-Response Authentication
When connecting over TCP:
1. TCP connection established with TLS 1.3.
2. Initiator sends `AUTH_REQUEST` with its public key and timestamp.
3. Listener generates a cryptographically random 32-byte nonce, returning `AUTH_CHALLENGE`.
4. Initiator signs `nonce + listenerDeviceId + timestamp` using its private Ed25519 key, sending `AUTH_RESPONSE`.
5. Listener verifies signature against public key, verifies device fingerprint, marks connection authenticated, and replies with `AUTH_ACCEPTED`.

### 5.3 Reliable Message Delivery State Machine
```
[Sender]                               [Receiver]
   |                                       |
   |--- CHAT_MESSAGE (seq 42, id: msg_1) ->| (Receives & persists to SQLite)
   |<-- MESSAGE_ACK (id: msg_1) -----------| (Sender marks 'sent')
   |<-- MESSAGE_DELIVERED (id: msg_1) -----| (Receiver notifies sender of commit)
   |                                       |
   |                                 (User opens chat)
   |<-- MESSAGE_READ (id: msg_1) ----------| (Sender marks 'read')
```

### 5.4 Chunked File Streaming Protocol
- **Chunk Size:** Fixed 262,144 bytes ($256\text{ KB}$).
- **Flow Control:** Sliding window of up to 4 unacknowledged chunks per file transfer.
- **Payload (`FILE_CHUNK`):**
  ```json
  {
    "type": "FILE_CHUNK",
    "payload": {
      "transferId": "xfer_1234",
      "chunkIndex": 14,
      "totalChunks": 200,
      "offset": 3670016,
      "chunkSize": 262144,
      "chunkHash": "sha256_of_chunk",
      "data": "base64_or_raw_binary"
    }
  }
  ```
- **Integrity:** Once `chunkIndex == totalChunks - 1`, the receiver recalculates the full file SHA-256 hash. Only when matched against the offer's `fileHash` is `FILE_COMPLETE` sent.
