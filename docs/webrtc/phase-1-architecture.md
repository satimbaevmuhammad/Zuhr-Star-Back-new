# Phase 1 Architecture

## Implemented Backend Surface

The current backend exposes WebRTC room management over REST and live peer-to-peer
signaling over Socket.IO.

REST base path:

```text
/api/webrtc
```

Socket.IO endpoint:

```text
http://localhost:3000/socket.io
```

Authenticate Socket.IO with the same JWT access token used by REST:

```js
const socket = io("http://localhost:3000", {
  auth: { token: accessToken }
});
```

### REST Endpoints

```text
POST   /api/webrtc/rooms
GET    /api/webrtc/rooms
GET    /api/webrtc/rooms/:roomId
POST   /api/webrtc/rooms/:roomId/join
POST   /api/webrtc/rooms/:roomId/leave
PATCH  /api/webrtc/rooms/:roomId/state
POST   /api/webrtc/rooms/:roomId/messages
GET    /api/webrtc/rooms/:roomId/attendance
POST   /api/webrtc/rooms/:roomId/client-logs
```

Create room:

```http
POST /api/webrtc/rooms
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "title": "Extra lesson video room",
  "lessonId": "65f12ca7a7720c194de6a010",
  "hostParticipantId": "teacher-65f12ca7a7720c194de6a001",
  "waitingRoomEnabled": true,
  "startsAt": "2026-05-29T10:00:00.000Z"
}
```

Join room:

```http
POST /api/webrtc/rooms/room_123/join
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "participantId": "student-65f12ca7a7720c194de6a002",
  "displayName": "Kamol Yusupov"
}
```

### Socket Events For Browser WebRTC

Join the live signaling room first:

```js
socket.emit("joinRoom", {
  roomId: "room_123",
  payload: {
    participantId: "teacher-65f12ca7a7720c194de6a001"
  }
});
```

Send an offer:

```js
socket.emit("offer", {
  roomId: "room_123",
  payload: {
    targetParticipantId: "student-65f12ca7a7720c194de6a002",
    sdp: peerConnection.localDescription
  }
});
```

Send an answer:

```js
socket.emit("answer", {
  roomId: "room_123",
  payload: {
    targetParticipantId: "teacher-65f12ca7a7720c194de6a001",
    sdp: peerConnection.localDescription
  }
});
```

Send ICE candidates:

```js
socket.emit("iceCandidate", {
  roomId: "room_123",
  payload: {
    targetParticipantId: "student-65f12ca7a7720c194de6a002",
    candidate
  }
});
```

Listen for remote signaling:

```js
socket.on("offer", event => handleOffer(event.payload));
socket.on("answer", event => handleAnswer(event.payload));
socket.on("iceCandidate", event => handleIceCandidate(event.payload));
socket.on("participantJoined", event => console.log(event.payload));
socket.on("participantLeft", event => console.log(event.payload));
```

The current implementation is peer-to-peer signaling. The mediasoup/SFU events
below remain in the shared contract for a future SFU upgrade; when called today,
the server returns `SFU_NOT_CONFIGURED`.

## Folder Structure

```text
packages/
  shared/                         # Cross-runtime contracts consumed by server and client.
    src/
      roles.ts                    # Role hierarchy and host-control permission helpers.
      room-state.ts               # Meeting lifecycle state machine constants.
      socket-events.ts            # Discriminated Socket.IO event contract.
      schemas.ts                  # Zod API request/response validation schemas.
      index.ts                    # Public package exports.
  server/                         # Node.js, Express, Socket.IO, mediasoup, Redis, MongoDB service.
    src/
      config/                     # Environment validation, Redis, MongoDB, mediasoup worker and codec config.
      domain/                     # Pure Room, Participant, Meeting, Message, AttendanceRecord models.
      application/                # Constructor-injected use-case classes.
      infrastructure/             # Mongo, Redis, mediasoup, Socket.IO concrete adapters.
      api/                        # Express routers, validators, serializers, thin controllers.
      socket/                     # Room, media, chat, and control namespace handlers.
  client/                         # React 19, Vite, TailwindCSS, Zustand, Socket.IO, mediasoup-client app.
    src/
      services/                   # Framework-agnostic Socket, WebRTC, Device, MediaStream services.
      stores/                     # Zustand slices without direct cross-slice imports.
      hooks/                      # React hooks wrapping services and stores.
      components/                 # Layout, meeting, controls, participants, chat, and ui components.
      pages/                      # LobbyPage, MeetingPage, WaitingRoomPage composition-only pages.
```

## Socket Event Contract

Every socket event is represented by the shared `SocketEvent` discriminated union in `packages/shared/src/socket-events.ts`.
Every event has:

```ts
{
  type: string;
  payload: unknown;
  roomId: string;
  senderId: string;
  timestamp: string;
}
```

Client-to-server event groups:

- Room membership: `joinRoom`, `leaveRoom`
- mediasoup signaling: `createTransport`, `connectTransport`, `produce`, `consume`, `consumerResume`, `setConsumerPreferredLayers`
- Communication: `sendMessage`, `raiseHand`
- Participant controls: `toggleOwnMedia`, `kickParticipant`, `muteParticipant`, `muteAll`
- Waiting room: `admitFromWaiting`, `denyFromWaiting`
- Recording: `startRecording`, `stopRecording`
- Reliability telemetry: `networkQuality`

Server-to-client event groups:

- mediasoup signaling: `routerRtpCapabilities`, `transportCreated`, `transportConnected`, `produced`, `newProducer`, `consumerCreated`
- Meeting state: `participantJoined`, `participantLeft`, `participantUpdated`, `roomStateChanged`, `recordingStateChanged`, `waitingRoomUpdated`
- Communication: `messageCreated`
- Intelligence and feedback: `activeSpeaker`, `permissionDenied`, `error`

## Room Lifecycle State Machine

```text
IDLE
  | host creates room
  v
WAITING_ROOM
  | host starts meeting
  v
ACTIVE
  | host starts recording
  v
RECORDING
  | host stops recording
  v
ACTIVE
  | host ends meeting or last participant leaves
  v
ENDING
  | cleanup job deletes Redis keys, finalizes MongoDB, writes attendance records
  v
ARCHIVED
```

Transition side effects:

- Update Redis room metadata with a 24-hour TTL.
- Emit `roomStateChanged` to all room participants.
- Write a MongoDB audit log entry.
- When leaving `ACTIVE` or `RECORDING` for `ENDING`, close consumers, producers, recv transport, send transport, then schedule router cleanup.

## WebRTC Signaling Sequence

```text
Client                                  Socket.IO server                         Mediasoup
  | connect auth.token JWT                     |                                      |
  |------------------------------------------->| validate JWT, attach user             |
  | emit joinRoom(roomId, participantId)       |                                      |
  |------------------------------------------->| load/create Redis room metadata       |
  |                                            | create router on assigned worker      |
  |                                            |-------------------------------------> |
  | emit routerRtpCapabilities                 |                                      |
  |<-------------------------------------------|                                      |
  | Device.load(routerRtpCapabilities)         |                                      |
  | emit createTransport(send)                 |                                      |
  |------------------------------------------->| create WebRtcTransport(send)          |
  | emit transportCreated(send params)         |                                      |
  |<-------------------------------------------|                                      |
  | emit connectTransport(send, dtls)          |                                      |
  |------------------------------------------->| transport.connect(dtls)               |
  |                                            |-------------------------------------> |
  | emit createTransport(recv)                 |                                      |
  |------------------------------------------->| create WebRtcTransport(recv)          |
  | emit transportCreated(recv params)         |                                      |
  |<-------------------------------------------|                                      |
  | emit connectTransport(recv, dtls)          |                                      |
  |------------------------------------------->| transport.connect(dtls)               |
  | getUserMedia(camera, microphone)           |                                      |
  | produce audio/video with simulcast video   |                                      |
  |------------------------------------------->| transport.produce()                   |
  |                                            |-------------------------------------> |
  | emit produced(producerId)                  |                                      |
  |<-------------------------------------------|                                      |
  | server emits newProducer for each producer |                                      |
  |<-------------------------------------------|                                      |
  | emit consume(producerId, recv transport)   |                                      |
  |------------------------------------------->| transport.consume(paused: true)        |
  | emit consumerCreated                       |                                      |
  |<-------------------------------------------|                                      |
  | local recvTransport.consume(params)        |                                      |
  | emit consumerResume                        |                                      |
  |------------------------------------------->| consumer.resume()                     |
  |                                            |-------------------------------------> |
```

Screen sharing follows the same `produce` path with `appData.type = "screen"` and a display-media video track on the existing send transport.

Disconnect teardown order:

```text
consumers -> producers -> recv transport -> send transport -> Redis participant hash -> Mongo attendance leftAt
```
