# BackZuhr Backend API

BackZuhr is a Node.js + Express + MongoDB backend for an education center. It is designed to handle the main school administration workflows in one place: student management, group scheduling, attendance, homework, finance, extra lessons, and CRM.

This README provides a full explanation of the architecture, key entities, authentication flows, API structure, configuration, and how to start working with the project.
# Zuhr Backend (Zuhr-Star-Back-new)

This repository provides the backend for Zuhr's realtime meeting platform.
It exposes REST endpoints to manage meeting "rooms" and a Socket.IO-based
signaling layer to coordinate peer-to-peer WebRTC connections (offer/answer
signaling, ICE exchange). The design follows a Google Meet-style lobby +
peer-to-peer signaling architecture with a clear separation between room
management (REST / MongoDB) and live presence/signaling (Socket.IO).

This README focuses on the WebRTC architecture implemented in this project,
how to run the server locally, and client integration examples.

Table of contents
- Overview
- How it works (concepts)
- REST API: room lifecycle
- Socket.IO signaling: events & flows
- Data model highlights (room, participants)
- Running locally
- Security & deployment notes
- Troubleshooting & debugging

Overview
--------

- REST manages persistent room data (host, participants, chat messages,
  waiting-room state, attendance, and client logs).
- Socket.IO manages live presence, waiting-room admission, chat relay and
  peer-to-peer WebRTC signaling (offer/answer/ICE). The server does not
  proxy media in the default configuration — media is exchanged directly
  between browsers (peer-to-peer). A future SFU (e.g., mediasoup) is
  referenced in the codebase but not configured by default.

Key project files
- API controllers: src/controllers/webrtc.controller.js
- Socket signaling and presence: src/realtime/webrtc.socket.js
- Room model: src/model/webrtc-room.model.js
- Architecture notes: docs/webrtc/phase-1-architecture.md

How it works (concepts)
-----------------------

- Room: an application-level object stored in MongoDB. A room contains
  participants, messages, client logs and lifecycle `state` (IDLE,
  WAITING_ROOM, ACTIVE, RECORDING, ENDING, ARCHIVED).
- Participant: an entry inside a room with fields such as `participantId`,
  `userId`, `displayName`, `role`, `admitted` (boolean) and
  `admissionStatus` (one of `waiting`, `admitted`, `denied`).
- Waiting room / lobby: when `waitingRoomEnabled` is true, participants
  who are not the host are not immediately admitted to the live signaling
  room. They join a waiting lobby and must be admitted by the host/admin.
- Signaling: once admitted, participants join the live signaling Socket.IO
  room (namespace/room) and exchange `offer`, `answer`, and `iceCandidate`
  messages. The server simply relays those signaling messages to the
  appropriate peer(s).

REST API: room lifecycle
------------------------

Base path: `/api/webrtc`

Implemented endpoints (see docs for examples):

- `POST /api/webrtc/rooms` — create a room. Returns `roomId` and initial
  host participant entry.
- `GET /api/webrtc/rooms` — list visible rooms for the caller.
- `GET /api/webrtc/rooms/:roomId` — get a single room document.
- `POST /api/webrtc/rooms/:roomId/join` — join a room (returns whether
  the participant is admitted or waiting in the lobby).
- `POST /api/webrtc/rooms/:roomId/leave` — leave the room (records `leftAt`).
- `PATCH /api/webrtc/rooms/:roomId/state` — change lifecycle state (host/admin).
- `POST /api/webrtc/rooms/:roomId/messages` — add a chat message persistently.
- `GET /api/webrtc/rooms/:roomId/attendance` — attendance report for the room.
- `POST /api/webrtc/rooms/:roomId/client-logs` — upload client-side logs.

Important behavior
- Creating a room can enable a waiting lobby (`waitingRoomEnabled: true`).
- Joining a room is a two-step flow: call the REST join endpoint first; the
  response includes `admitted` and `admissionStatus`. If `admitted: false`
  the client should show a waiting UI and only open Socket.IO signaling
  after admission.

Socket.IO signaling: events & flows
----------------------------------

Socket.IO path: `/socket.io` (the server validates a JWT on connection).

Auth
- Connect using the same access token (JWT) used for REST. Example:

```js
const socket = io('https://your-server.com', { auth: { token: accessToken } })
```

Join flow
1. Call REST `POST /api/webrtc/rooms/:roomId/join`. If the response has
   `admitted: false`/`admissionStatus: 'waiting'`, the client should show
   the waiting lobby and then connect to Socket.IO and emit `joinRoom`.
2. Emit Socket.IO `joinRoom` with `{ roomId, payload: { participantId } }`.
   The server will either place the socket in a waiting sub-room
   (`webrtc-waiting:<roomId>:<participantId>`) or the live signaling room
   (`webrtc:<roomId>`), depending on admission.
3. Hosts/Admins listen for `waitingRoomUpdated` in their live room and can
   call `admitFromWaiting` or `denyFromWaiting`.
4. When a waiting participant is admitted the server emits `admittedFromWaiting`
   to the waiting socket, which should re-emit `joinRoom` to enter the live
   signaling room.

Primary signaling events
- `offer`, `answer`, `iceCandidate` — relay peer-to-peer SDP and ICE data.
- `signal` — generic relay event for custom peer-to-peer signaling.
- `sendMessage` — realtime chat messages (server broadcasts `messageCreated`).
- `toggleOwnMedia`, `raiseHand`, `networkQuality` — participant presence updates.
- `admitFromWaiting`, `denyFromWaiting` — host/admin admits or denies.
- `participantJoined`, `participantLeft`, `participantUpdated` — server-sent
  presence/room state events.

Relay semantics
- When a signaling event includes a `targetParticipantId`, the server
  routes it to that participant only. Otherwise the event is broadcast to
  all other sockets in the live signaling room.

SFU hooks
- The repository includes shared contracts for SFU operations (e.g., create
  transport, produce/consume) but the current server returns `SFU_NOT_CONFIGURED`
  for those events. The current architecture focuses on peer-to-peer media
  (no server-side media routing) unless you integrate an SFU like mediasoup.

Data model highlights
---------------------

- Room document (src/model/webrtc-room.model.js) contains:
  - `roomId` (string, indexed)
  - `hostParticipantId`, `hostUserId`, `hostUserType`
  - `waitingRoomEnabled` (boolean)
  - `state` (one of IDLE, WAITING_ROOM, ACTIVE, RECORDING, ENDING, ARCHIVED)
  - `participants` (array of participant objects)
  - `messages` (chat history)
  - `clientLogs` (array of telemetry/logs uploaded by clients)

- Participant object includes:
  - `participantId` — an identifier that may include role prefix (e.g., `student-<id>`)
  - `userId` — MongoDB user id
  - `userType` — `student` or `employee`
  - `displayName`, `role`
  - `admitted` (boolean)
  - `admissionStatus` (enum: `waiting`, `admitted`, `denied`)
  - `joinedAt`, `leftAt`

Why `admissionStatus` and `admitted` exist
- `admissionStatus` tracks the logical lobby state (`waiting`, `admitted`,
  or `denied`) which is persisted in MongoDB and used for attendance and
  audit logs.
- `admitted` is a boolean convenience flag (true when participant can join
  live signaling). When joining, the controller calculates both values and
  returns them to clients.

Running locally
---------------

Prerequisites
- Node.js (recommended: 18+), npm
- MongoDB instance (local or remote)

Environment (example)

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/zuhr
JWT_SECRET=your_jwt_secret
CORS_ORIGINS=
```

Install & run

```bash
npm install
npm start
```

During development the server prints a message when Socket.IO is attached.
Example from index.js: "WebRTC signaling is available on Socket.IO path /socket.io".

Client quick-start (join + signaling)

1. Create the room (or join an existing one) via REST:

```http
POST /api/webrtc/rooms
Authorization: Bearer <access-token>
Content-Type: application/json

{ "title": "Math lesson", "waitingRoomEnabled": true }
```

2. Call join REST endpoint to register your participant:

```http
POST /api/webrtc/rooms/:roomId/join
Authorization: Bearer <access-token>
Content-Type: application/json

{ "participantId": "student-<id>", "displayName": "Student Name" }
```

3. Connect Socket.IO with the same token and emit `joinRoom`:

```js
const socket = io(serverUrl, { auth: { token: accessToken } })
socket.emit('joinRoom', { roomId, payload: { participantId } })

socket.on('admittedFromWaiting', () => {
  socket.emit('joinRoom', { roomId, payload: { participantId } })
})

socket.on('offer', event => handleOffer(event.payload))
socket.on('answer', event => handleAnswer(event.payload))
socket.on('iceCandidate', event => handleIceCandidate(event.payload))
```

4. Typical WebRTC client steps once in live signaling room:
- create RTCPeerConnection
- call getUserMedia
- createOffer -> setLocalDescription -> emit `offer` to target
- on remote `offer` createAnswer -> setLocalDescription -> emit `answer`
- exchange ICE candidates via `iceCandidate` events

Security & deployment notes
---------------------------

- Use HTTPS and secure WebSocket (wss) in production. Ensure JWT tokens
  are short-lived and issued by a trusted auth service.
- Configure `CORS_ORIGINS` or `CORS_ORIGIN` environment variable to restrict
  allowed origins for Socket.IO connections.
- If your use-case requires many participants or server-side recording,
  integrate an SFU (mediasoup) and enable the SFU-specific socket events.

Troubleshooting & debugging
---------------------------

- If a participant cannot join live signaling, confirm the REST join call
  returned `admitted: true` or that `admittedFromWaiting` was emitted.
- Socket.IO errors are emitted as `error` events with `{ code, message }`.
- The server logs admission, join, and signaling failures to the console.
- Use `GET /api/webrtc/:roomId/attendance` to get participant joined/left
  timestamps for debugging attendance and durations.

Further reading
---------------

- Architecture notes: docs/webrtc/phase-1-architecture.md
- Socket contract (shared types): packages/shared/src/socket-events.ts
- Main Socket handler: src/realtime/webrtc.socket.js

If you want, I can also:
- generate a short client-side example repository showing full join +
  peer-to-peer video exchange,
- or extend the server to optionally integrate a mediasoup SFU and
  demonstrate server-side recording.


## 2. High-level architecture

### 2.1 Server startup

- `index.js` boots the application.
- `app.js` configures Express middleware, routes, static file serving, Swagger docs, and error handling.
- Database connection is established in `src/config/db.js`.
- Role seeding runs on startup if required.

### 2.2 Request lifecycle

1. A request enters Express.
2. Middleware parses JSON, handles CORS, checks authentication, and validates IDs.
3. Routes are routed to controller handlers.
4. Controllers execute business logic using models and services.
5. Errors are normalized and returned with a consistent JSON shape.

### 2.3 Data storage

- MongoDB is the primary datastore.
- Mongoose schemas are defined in `src/model/` and `src/models/`.
- The backend uses a mix of direct model operations and transactional logic when available.

## 3. Key concepts and entities

### 3.1 Users vs Students

This system intentionally separates two account types:

- `User` — an employee or staff member.
- `Student` — a learner enrolled in groups, extra lessons, or CRM lead flows.

They have different authentication routes and different access patterns.

### 3.2 Roles and permissions

Staff roles are enforced at the API layer. Main roles include:

- `teacher`
- `supporteacher`
- `headteacher`
- `admin`
- `superadmin`

Role checks are performed by middleware and controller logic. Some actions are reserved for managers (`admin`, `superadmin`, `headteacher`) while others can be done by assigned teachers.

Permissions are loaded from the database and can be adjusted without code changes.

### 3.3 Courses, groups, and lessons

The domain model has a clear hierarchy:

- `Course` — a reusable course template.
- `Group` — a cohort of students attached to a course, with schedule rules and attendance.
- `Lesson` — a specific class session for a group.

This separation allows the app to manage both curriculum and delivery.

### 3.4 Homework

Homework records are attached to lessons and students. The backend supports:

- Assigning homework to a lesson or student
- Uploading homework documents
- Submitting homework
- Grading and status updates

### 3.5 Finance and audit

The finance module is designed to be audit-friendly:

- Financial records are append-only
- Salary payments, bonuses, fines, discounts, and extra lesson charges are recorded as events
- Records are not deleted to preserve history

This makes it easier to review past operations and resolve discrepancies.

### 3.6 Forbidden rules and employee violations

Employees can be assigned forbidden rules and tracked for violations.

- Rules are defined in `forbidden-rule.model.js`
- Violations are stored separately with references to employees and applied fines

This module supports behavior enforcement and HR workflows.

### 3.7 Extra lessons

Extra lessons are handled with a dedicated workflow for support teachers:

- Support teachers have a configurable work schedule
- Students can request a slot via booking
- Teachers review and approve or deny requests
- Confirmed lessons can be completed and paid for
- Payment is processed only after completion, respecting free quota rules

This flow is implemented in `src/controllers/extra-lesson.controller.js` and its supporting services.

### 3.8 Leads and CRM

Leads are potential clients who are not yet students.

- Leads can be created, updated, assigned, and tracked
- CRM workflows live in `lead.controller.js`
- Leads usually represent inquiries, potential enrollments, or sales pipelines

## 4. Authentication and authorization

### 4.1 Employee authentication

Employees log in through the staff auth routes. These routes issue access tokens and refresh tokens.

Typical flow:

- `POST /api/auth/login` — log in with employee credentials
- `POST /api/auth/refresh-token` — obtain a new access token using a refresh token
- `POST /api/auth/logout` — revoke refresh tokens

### 4.2 Student authentication

Students authenticate separately:

- `POST /api/students/login`

Student tokens are separate from employee tokens and do not share the same permissions.

### 4.3 JWT and token structure

Access tokens are JWTs. Example payload fields:

- `sub` — user ID
- `role` — staff role or `student`
- `userType` — `employee` or `student`
- `iat` — issued at
- `exp` — expiration

Headers should include:

```http
Authorization: Bearer <accessToken>
```

### 4.4 Authorization rules

- Only designated extra-lesson support teachers can manage their own support schedule.
- Only assigned teachers or managers can update lessons and student assignments.
- Only admin/headteacher roles can perform high-risk actions like deleting lessons or cancelling confirmed sessions.

## 5. API documentation

Swagger is available at:

- `GET /api-docs` — interactive Swagger UI
- `GET /api-docs-json` — OpenAPI JSON schema

These endpoints document the available routes and expected request/response shapes.

## 6. Error handling and validation

The API returns a consistent JSON error shape for all failures:

```json
{
  "message": "Invalid request data",
  "code": "BAD_REQUEST",
  "field": "date"
}
```

Common error codes:

- `BAD_REQUEST` — validation failure or missing input
- `NOT_FOUND` — resource not found
- `FORBIDDEN` — permission denied
- `UNAUTHORIZED` — missing or invalid authentication
- `CONFLICT` — entity conflict, duplicate entry, or invalid transition
- `INTERNAL_SERVER_ERROR` — unexpected server failure

## 7. File uploads and static assets

- Uploaded files are stored in `/uploads`
- Static assets are served from `/public`
- Avatars and other upload routes are handled with `multer`
- A Face ID demo page is available at `GET /face-id-demo`

## 8. Running locally

### Install dependencies

```bash
npm install
```

### Set environment variables

Create a `.env` file with at least the required values:

```env
MONGO_URI=mongodb://localhost:27017/backzuhr
PORT=3000
JWT_SECRET=replace_with_a_long_secret
```

### Start the server

```bash
node index.js
```

### Run tests

```bash
npm test
```

## 9. Environment variables

| Name | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | yes | n/a | MongoDB connection string |
| `PORT` | no | `3000` | HTTP port |
| `JWT_SECRET` | yes | n/a | JWT signing secret |
| `JWT_ACCESS_SECRET` | no | n/a | optional access token secret |
| `JWT_REFRESH_SECRET` | no | n/a | optional refresh token secret |
| `CORS_ORIGINS` | no | allow all | allowed CORS origins |
| `CORS_ORIGIN` | no | allow all | single-origin fallback |
| `PUBLIC_BASE_URL` | no | derived | public URL used for uploaded files |
| `BASE_URL` | no | derived | fallback base URL |
| `FACE_MATCH_THRESHOLD` | no | `0.45` | face login similarity threshold |
| `FACE_LOGIN_MAX_CANDIDATES` | no | `2000` | maximum face match candidates |

## 10. Project structure

```text
BackZuhr/
├── index.js
├── app.js
├── package.json
├── README.md
├── README.frontend.md
├── public/
│   └── face-id-demo.html
├── uploads/
├── scripts/
│   ├── smoke.test.js
│   └── senior.test.js
└── src/
    ├── config/
    │   ├── db.js
    │   └── swagger.js
    ├── controllers/
    ├── middleware/
    ├── model/
    ├── models/
    ├── routes/
    ├── seeders/
    ├── services/
    └── utils/
```

### 10.1 Core folders

- `src/controllers/` — request handlers and business logic
- `src/routes/` — API endpoints and route wiring
- `src/model/` — Mongoose schema definitions for domain entities
- `src/models/` — shared models such as `Role`, `FaceCredential`, and `FinancialEvent`
- `src/services/` — reusable business operations, such as finance processing
- `src/middleware/` — authentication, validation, file upload, and error handling
- `src/config/` — database and Swagger configuration
- `src/seeders/` — initial data seeding

## 11. Important implementation notes

### 11.1 Extra lesson scheduling

Extra lessons use a local schedule and fixed-time slots. The system converts local slots into UTC dates for storage and comparison.

### 11.2 Teacher daily limits

The app enforces a teacher daily capacity limit based on schedule slots. This prevents overbooking.

### 11.3 Transaction support

Where possible, the app uses MongoDB sessions and transactions. If the database does not support transactions, it falls back to non-transactional processing.

### 11.4 Data validation

The controllers include strict validation for:

- dates in `YYYY-MM-DD` format
- time slots in `HH:mm` format
- MongoDB ObjectId strings
- required fields for each operation

## 12. Frontend integration

For frontend-specific guidance, request examples, and authentication details, refer to `README.frontend.md`.

## 13. How to extend this backend

- Add new routes in `src/routes/`
- Add handlers in `src/controllers/`
- Add schema changes in `src/model/`
- Add business utilities in `src/services/`
- Use `src/utils/` for shared helpers and error creation

## 14. Contact points in code

- `app.js` — Express app setup and middleware chain
- `index.js` — server bootstrap
- `src/config/db.js` — MongoDB connection and seeding
- `src/controllers/auth.controller.js` — employee auth logic
- `src/controllers/extra-lesson.controller.js` — extra lesson booking workflow
- `src/controllers/finance.controller.js` — finance event creation
- `src/middleware/auth.middleware.js` — token validation and role enforcement

---

BackZuhr is built to be maintainable and extensible. Use this README as the starting point for onboarding frontend and backend developers, and refer to `README.frontend.md` for API usage patterns.
