const express = require('express')

const webrtcController = require('../controllers/webrtc.controller')
const { requireAnyAuth } = require('../middleware/auth.middleware')

const router = express.Router()

/**
 * @swagger
 * /api/webrtc/socket-events:
 *   get:
 *     tags: [WebRTC]
 *     summary: Socket.IO event guide for frontend developers
 *     description: |
 *       Swagger/OpenAPI can test REST endpoints, but it cannot execute Socket.IO events.
 *       This endpoint exists so the WebRTC signaling flow is visible in Swagger.
 *
 *       Simple flow:
 *       1. Create or join a room with REST.
 *       2. Connect Socket.IO with the same access token.
 *       3. Emit `joinRoom`.
 *       4. Exchange `offer`, `answer`, and `iceCandidate`.
 *       5. Call REST `leave` when the call ends.
 *
 *       Socket connection:
 *       ```js
 *       const socket = io("http://localhost:3000", {
 *         auth: { token: accessToken }
 *       });
 *       ```
 *     responses:
 *       200:
 *         description: Socket.IO event names and payload examples
 */
router.get('/socket-events', webrtcController.getSocketEventGuide)

/**
 * @swagger
 * /api/webrtc/rooms:
 *   post:
 *     tags: [WebRTC]
 *     summary: Create a WebRTC room
 *     description: |
 *       Creates a room document and automatically adds the creator as the host participant.
 *       Use the returned `roomId` for join, attendance, messages, and Socket.IO signaling.
 *
 *       Who can use it: any authenticated student or employee.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *                 example: Extra lesson video room
 *               roomId:
 *                 type: string
 *                 description: Optional custom room id. If omitted, backend generates one.
 *                 example: room_abc123
 *               lessonId:
 *                 type: string
 *                 nullable: true
 *                 example: 65f12ca7a7720c194de6a010
 *               hostParticipantId:
 *                 type: string
 *                 example: teacher-65f12ca7a7720c194de6a001
 *               waitingRoomEnabled:
 *                 type: boolean
 *                 example: true
 *               startsAt:
 *                 type: string
 *                 format: date-time
 *                 example: 2026-05-29T10:00:00.000Z
 *           example:
 *             title: Extra lesson video room
 *             lessonId: 65f12ca7a7720c194de6a010
 *             hostParticipantId: teacher-65f12ca7a7720c194de6a001
 *             waitingRoomEnabled: true
 *             startsAt: 2026-05-29T10:00:00.000Z
 *     responses:
 *       201:
 *         description: Room created
 *         content:
 *           application/json:
 *             example:
 *               roomId: room_abc123
 *               meetingId: 65f12ca7a7720c194de6a099
 *               state: WAITING_ROOM
 *               createdAt: 2026-05-29T10:00:00.000Z
 *       400:
 *         description: Validation error
 *       401:
 *         description: Token missing or invalid
 *       409:
 *         description: Custom roomId already exists
 *   get:
 *     tags: [WebRTC]
 *     summary: List WebRTC rooms visible to current user
 *     description: |
 *       Admin/superadmin can see all rooms. Other users see rooms where they are
 *       the host or already a participant.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *           enum: [IDLE, WAITING_ROOM, ACTIVE, RECORDING, ENDING, ARCHIVED]
 *         example: ACTIVE
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated room list
 *         content:
 *           application/json:
 *             example:
 *               page: 1
 *               limit: 20
 *               total: 1
 *               data:
 *                 - roomId: room_abc123
 *                   title: Extra lesson video room
 *                   state: ACTIVE
 */
router.post('/rooms', requireAnyAuth, webrtcController.createRoom)
router.get('/rooms', requireAnyAuth, webrtcController.listRooms)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}:
 *   get:
 *     tags: [WebRTC]
 *     summary: Get one WebRTC room
 *     description: Returns room details, participants, messages, and current state.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     responses:
 *       200:
 *         description: Room details
 *       403:
 *         description: User cannot access this room
 *       404:
 *         description: Room not found
 */
router.get('/rooms/:roomId', requireAnyAuth, webrtcController.getRoom)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}/join:
 *   post:
 *     tags: [WebRTC]
 *     summary: Join a WebRTC room
 *     description: |
 *       Adds the current authenticated user as a participant. With waiting room
 *       enabled, non-host participants receive `admitted: false` and must wait
 *       for the host to emit `admitFromWaiting` before joining live signaling.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantId:
 *                 type: string
 *                 example: student-65f12ca7a7720c194de6a002
 *               displayName:
 *                 type: string
 *                 example: Kamol Yusupov
 *           example:
 *             participantId: student-65f12ca7a7720c194de6a002
 *             displayName: Kamol Yusupov
 *     responses:
 *       200:
 *         description: Joined room
 *         content:
 *           application/json:
 *             example:
 *               roomId: room_abc123
 *               participantId: student-65f12ca7a7720c194de6a002
 *               state: ACTIVE
 *               admitted: true
 *               admissionStatus: admitted
 *       404:
 *         description: Room not found
 *       409:
 *         description: Room is already closed
 */
router.post('/rooms/:roomId/join', requireAnyAuth, webrtcController.joinRoom)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}/leave:
 *   post:
 *     tags: [WebRTC]
 *     summary: Leave a WebRTC room
 *     description: Marks the participant as left for attendance reporting.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               participantId:
 *                 type: string
 *                 example: student-65f12ca7a7720c194de6a002
 *           example:
 *             participantId: student-65f12ca7a7720c194de6a002
 *     responses:
 *       200:
 *         description: Participant left room
 */
router.post('/rooms/:roomId/leave', requireAnyAuth, webrtcController.leaveRoom)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}/state:
 *   patch:
 *     tags: [WebRTC]
 *     summary: Change room state
 *     description: Only the room host, admin, or superadmin can change state.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [state]
 *             properties:
 *               state:
 *                 type: string
 *                 enum: [IDLE, WAITING_ROOM, ACTIVE, RECORDING, ENDING, ARCHIVED]
 *                 example: ACTIVE
 *           examples:
 *             start:
 *               value:
 *                 state: ACTIVE
 *             end:
 *               value:
 *                 state: ENDING
 *     responses:
 *       200:
 *         description: Room state updated
 *       403:
 *         description: Only host/admin can update state
 */
router.patch('/rooms/:roomId/state', requireAnyAuth, webrtcController.updateRoomState)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}/messages:
 *   post:
 *     tags: [WebRTC]
 *     summary: Store a room chat message
 *     description: REST version of room chat persistence. Realtime chat can also use Socket.IO `sendMessage`.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [body]
 *             properties:
 *               senderId:
 *                 type: string
 *                 example: student-65f12ca7a7720c194de6a002
 *               senderName:
 *                 type: string
 *                 example: Kamol Yusupov
 *               body:
 *                 type: string
 *                 example: Hello teacher
 *           example:
 *             senderId: student-65f12ca7a7720c194de6a002
 *             senderName: Kamol Yusupov
 *             body: Hello teacher
 *     responses:
 *       201:
 *         description: Message stored
 */
router.post('/rooms/:roomId/messages', requireAnyAuth, webrtcController.createMessage)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}/attendance:
 *   get:
 *     tags: [WebRTC]
 *     summary: Get room attendance report
 *     description: Shows who joined, who left, and approximate duration in seconds.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     responses:
 *       200:
 *         description: Attendance report
 *         content:
 *           application/json:
 *             example:
 *               meetingId: 65f12ca7a7720c194de6a099
 *               lessonId: 65f12ca7a7720c194de6a010
 *               roomId: room_abc123
 *               title: Extra lesson video room
 *               state: ACTIVE
 *               generatedAt: 2026-05-29T10:30:00.000Z
 *               records:
 *                 - participantId: student-65f12ca7a7720c194de6a002
 *                   userId: 65f12ca7a7720c194de6a002
 *                   displayName: Kamol Yusupov
 *                   role: student
 *                   joinedAt: 2026-05-29T10:00:00.000Z
 *                   leftAt: null
 *                   durationSeconds: 1800
 */
router.get('/rooms/:roomId/attendance', requireAnyAuth, webrtcController.getAttendanceReport)

/**
 * @swagger
 * /api/webrtc/rooms/{roomId}/client-logs:
 *   post:
 *     tags: [WebRTC]
 *     summary: Send frontend call logs
 *     description: Use for camera, microphone, network, and WebRTC debugging logs.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         example: room_abc123
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [events]
 *             properties:
 *               events:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 100
 *                 items:
 *                   type: object
 *                   required: [level, message, occurredAt]
 *                   properties:
 *                     level:
 *                       type: string
 *                       enum: [info, warn, error]
 *                     message:
 *                       type: string
 *                     context:
 *                       type: object
 *                     occurredAt:
 *                       type: string
 *                       format: date-time
 *           example:
 *             events:
 *               - level: error
 *                 message: Camera permission denied
 *                 context:
 *                   browser: Chrome
 *                   page: lesson-room
 *                 occurredAt: 2026-05-29T10:05:00.000Z
 *     responses:
 *       202:
 *         description: Logs accepted
 */
router.post('/rooms/:roomId/client-logs', requireAnyAuth, webrtcController.addClientLogs)

module.exports = router
