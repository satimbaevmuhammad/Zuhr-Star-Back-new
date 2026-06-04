const crypto = require('crypto')
const mongoose = require('mongoose')

const Group = require('../model/group.model')
const { ROOM_STATES, WebRtcRoom } = require('../model/webrtc-room.model')

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,80}$/

const getIdentity = req => {
	const isStudent = req.user?.userType === 'student'
	const document = isStudent ? req.student : req.userDocument
	const displayName = String(document?.fullname || req.body?.displayName || 'Participant').trim()

	return {
		userId: req.user.id,
		userType: req.user.userType,
		role: isStudent ? 'student' : String(req.user.role || document?.role || 'teacher'),
		displayName: displayName || 'Participant',
	}
}

const normalizeRoom = room => {
	const data = room?.toObject ? room.toObject() : room
	return {
		...data,
		meetingId: String(data._id),
	}
}

const sendError = (res, statusCode, message, code, field = null) =>
	res.status(statusCode).json({ message, code, field })

const parseParticipantId = (value, fallback) => {
	const normalized = String(value || '').trim()
	return normalized || fallback
}

const ensureRoomId = roomId => ROOM_ID_PATTERN.test(String(roomId || '').trim())

const getIdentityParticipantAliases = (identity, participantId) => {
	const aliases = [
		participantId,
		identity.userId,
		`${identity.userType}-${identity.userId}`,
		`${identity.role}-${identity.userId}`,
	]

	return new Set(aliases.map(value => String(value || '').trim()).filter(Boolean))
}

const findParticipantForIdentity = (room, identity, participantId) => {
	const aliases = getIdentityParticipantAliases(identity, participantId)
	return room.participants.find(participant => {
		const sameUser = String(participant.userId) === String(identity.userId)
		if (!sameUser) {
			return false
		}

		return aliases.has(String(participant.participantId))
	})
}

const ensureRoomAccess = (room, identity) => {
	if (identity.role === 'admin' || identity.role === 'superadmin') {
		return true
	}

	if (String(room.hostUserId) === String(identity.userId)) {
		return true
	}

	return room.participants.some(participant =>
		String(participant.userId) === String(identity.userId),
	)
}

const getActiveStudentGroups = async student => {
	const studentId = student?._id || student?.id
	if (!studentId || !mongoose.isValidObjectId(studentId)) {
		return []
	}

	const activeGroupIds = (student.groups || [])
		.filter(groupItem => groupItem?.status === 'active' && groupItem.group)
		.map(groupItem => groupItem.group)

	const groupFilters = [{ students: studentId }]
	if (activeGroupIds.length > 0) {
		groupFilters.push({ _id: { $in: activeGroupIds } })
	}

	return Group.find({
		status: 'active',
		$or: groupFilters,
	})
		.select('teacher supportTeachers')
		.lean()
}

const getStudentTeacherIds = async student => {
	const groups = await getActiveStudentGroups(student)
	const teacherIds = new Set()

	for (const group of groups) {
		if (group.teacher) {
			teacherIds.add(String(group.teacher))
		}
		for (const supportTeacherId of group.supportTeachers || []) {
			teacherIds.add(String(supportTeacherId))
		}
	}

	return Array.from(teacherIds).filter(mongoose.isValidObjectId)
}

const canAccessStudentTeacherRoom = async (room, identity, student) => {
	if (identity.userType !== 'student') {
		return false
	}

	const teacherIds = await getStudentTeacherIds(student)
	return teacherIds.some(teacherId => String(room.hostUserId) === teacherId)
}

const buildVisibleRoomsQuery = async (identity, student) => {
	if (['admin', 'superadmin'].includes(identity.role)) {
		return {}
	}

	const visibleRoomFilters = [
		{ hostUserId: identity.userId },
		{ 'participants.userId': identity.userId },
	]

	if (identity.userType === 'student') {
		const teacherIds = await getStudentTeacherIds(student)
		if (teacherIds.length > 0) {
			visibleRoomFilters.push({ hostUserId: { $in: teacherIds } })
		}
	}

	return { $or: visibleRoomFilters }
}

const canHostRoom = (room, identity) => {
	if (String(room.hostUserId) === String(identity.userId)) {
		return true
	}

	return ['admin', 'superadmin'].includes(identity.role)
}

const createRoom = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const title = String(req.body.title || '').trim()
		if (!title) {
			return sendError(res, 400, 'title is required', 'VALIDATION_ERROR', 'title')
		}

		let lessonId = null
		if (req.body.lessonId) {
			if (!mongoose.isValidObjectId(req.body.lessonId)) {
				return sendError(res, 400, 'lessonId must be a valid ObjectId', 'INVALID_OBJECT_ID', 'lessonId')
			}
			lessonId = req.body.lessonId
		}

		let startsAt = null
		if (req.body.startsAt) {
			startsAt = new Date(req.body.startsAt)
			if (Number.isNaN(startsAt.getTime())) {
				return sendError(res, 400, 'startsAt must be a valid ISO date', 'VALIDATION_ERROR', 'startsAt')
			}
		}

		const hostParticipantId = parseParticipantId(
			req.body.hostParticipantId,
			`${identity.userType}-${identity.userId}`,
		)
		const roomId = parseParticipantId(req.body.roomId, `room_${crypto.randomUUID()}`)
		if (!ensureRoomId(roomId)) {
			return sendError(res, 400, 'roomId may contain letters, numbers, _ and - only', 'VALIDATION_ERROR', 'roomId')
		}

		const now = new Date()
		const waitingRoomEnabled = req.body.waitingRoomEnabled !== false
		const room = await WebRtcRoom.create({
			roomId,
			lessonId,
			title,
			hostParticipantId,
			hostUserId: identity.userId,
			hostUserType: identity.userType,
			waitingRoomEnabled,
			state: waitingRoomEnabled ? 'WAITING_ROOM' : 'ACTIVE',
			startsAt,
			participants: [
				{
					participantId: hostParticipantId,
					userId: identity.userId,
					userType: identity.userType,
					displayName: identity.displayName,
					role: identity.role,
					admitted: true,
					admissionStatus: 'admitted',
					joinedAt: now,
				},
			],
		})

		return res.status(201).json({
			roomId: room.roomId,
			meetingId: String(room._id),
			state: room.state,
			createdAt: room.createdAt.toISOString(),
			room: normalizeRoom(room),
		})
	} catch (error) {
		if (error?.code === 11000) {
			return sendError(res, 409, 'roomId already exists', 'CONFLICT', 'roomId')
		}

		console.error('Create WebRTC room failed:', error)
		return sendError(res, 500, 'Failed to create WebRTC room', 'INTERNAL_SERVER_ERROR')
	}
}

const listRooms = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
		const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
		const query = await buildVisibleRoomsQuery(identity, req.student)

		if (req.query.state) {
			if (!ROOM_STATES.includes(req.query.state)) {
				return sendError(res, 400, 'Invalid room state', 'VALIDATION_ERROR', 'state')
			}
			query.state = req.query.state
		}

		const [total, rooms] = await Promise.all([
			WebRtcRoom.countDocuments(query),
			WebRtcRoom.find(query)
				.sort({ createdAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit),
		])

		return res.status(200).json({
			page,
			limit,
			total,
			data: rooms.map(normalizeRoom),
		})
	} catch (error) {
		console.error('List WebRTC rooms failed:', error)
		return sendError(res, 500, 'Failed to list WebRTC rooms', 'INTERNAL_SERVER_ERROR')
	}
}

const getRoom = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}

		const canAccessRoom =
			ensureRoomAccess(room, identity) ||
			(await canAccessStudentTeacherRoom(room, identity, req.student))
		if (!canAccessRoom) {
			return sendError(res, 403, 'Forbidden', 'FORBIDDEN')
		}

		return res.status(200).json({ room: normalizeRoom(room) })
	} catch (error) {
		console.error('Get WebRTC room failed:', error)
		return sendError(res, 500, 'Failed to get WebRTC room', 'INTERNAL_SERVER_ERROR')
	}
}

const joinRoom = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}

		if (['ENDING', 'ARCHIVED'].includes(room.state)) {
			return sendError(res, 409, 'Room is already closed', 'CONFLICT')
		}

		const participantId = parseParticipantId(
			req.body.participantId,
			`${identity.userType}-${identity.userId}`,
		)
		const displayName = String(req.body.displayName || identity.displayName).trim() || identity.displayName
		const existing = findParticipantForIdentity(room, identity, participantId)
		const alreadyAdmitted = existing?.admitted !== false && existing?.admissionStatus === 'admitted'
		const admitted = alreadyAdmitted || !room.waitingRoomEnabled || canHostRoom(room, identity)
		const admissionStatus = admitted ? 'admitted' : 'waiting'
		const canonicalParticipantId = existing?.participantId || participantId

		if (existing) {
			existing.leftAt = null
			existing.displayName = displayName
			existing.admitted = admitted
			existing.admissionStatus = admissionStatus
			if (admitted) {
				existing.joinedAt = existing.joinedAt || new Date()
			}
		} else {
			room.participants.push({
				participantId,
				userId: identity.userId,
				userType: identity.userType,
				displayName,
				role: identity.role,
				admitted,
				admissionStatus,
				joinedAt: admitted ? new Date() : null,
			})
		}

		if (admitted && (room.state === 'IDLE' || room.state === 'WAITING_ROOM')) {
			room.state = 'ACTIVE'
		}

		await room.save()

		return res.status(200).json({
			roomId: room.roomId,
			participantId: canonicalParticipantId,
			state: room.state,
			admitted,
			admissionStatus,
			room: normalizeRoom(room),
		})
	} catch (error) {
		console.error('Join WebRTC room failed:', error)
		return sendError(res, 500, 'Failed to join WebRTC room', 'INTERNAL_SERVER_ERROR')
	}
}

const leaveRoom = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}

		const participantId = parseParticipantId(
			req.body.participantId,
			`${identity.userType}-${identity.userId}`,
		)
		const participant = room.participants.find(item => item.participantId === participantId)
		if (participant) {
			participant.leftAt = new Date()
			await room.save()
		}

		return res.status(200).json({ message: 'Left WebRTC room', roomId: room.roomId, participantId })
	} catch (error) {
		console.error('Leave WebRTC room failed:', error)
		return sendError(res, 500, 'Failed to leave WebRTC room', 'INTERNAL_SERVER_ERROR')
	}
}

const updateRoomState = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const nextState = String(req.body.state || '').trim()
		if (!ROOM_STATES.includes(nextState)) {
			return sendError(res, 400, 'Invalid room state', 'VALIDATION_ERROR', 'state')
		}

		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}

		const isHost = String(room.hostUserId) === String(identity.userId)
		if (!isHost && !['admin', 'superadmin'].includes(identity.role)) {
			return sendError(res, 403, 'Only host or admin can change room state', 'FORBIDDEN')
		}

		room.state = nextState
		if (['ENDING', 'ARCHIVED'].includes(nextState)) {
			room.endedAt = room.endedAt || new Date()
		}
		await room.save()

		return res.status(200).json({ room: normalizeRoom(room) })
	} catch (error) {
		console.error('Update WebRTC room state failed:', error)
		return sendError(res, 500, 'Failed to update WebRTC room state', 'INTERNAL_SERVER_ERROR')
	}
}

const createMessage = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const body = String(req.body.body || '').trim()
		if (!body) {
			return sendError(res, 400, 'body is required', 'VALIDATION_ERROR', 'body')
		}

		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}
		if (!ensureRoomAccess(room, identity)) {
			return sendError(res, 403, 'Forbidden', 'FORBIDDEN')
		}

		const message = {
			senderId: parseParticipantId(req.body.senderId, `${identity.userType}-${identity.userId}`),
			senderName: String(req.body.senderName || identity.displayName).trim() || identity.displayName,
			body,
			createdAt: new Date(),
		}
		room.messages.push(message)
		await room.save()

		const saved = room.messages[room.messages.length - 1]
		return res.status(201).json({
			message: {
				id: String(saved.id),
				roomId: room.roomId,
				senderId: saved.senderId,
				senderName: saved.senderName,
				body: saved.body,
				createdAt: saved.createdAt.toISOString(),
			},
		})
	} catch (error) {
		console.error('Create WebRTC message failed:', error)
		return sendError(res, 500, 'Failed to create WebRTC message', 'INTERNAL_SERVER_ERROR')
	}
}

const getAttendanceReport = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}
		if (!ensureRoomAccess(room, identity)) {
			return sendError(res, 403, 'Forbidden', 'FORBIDDEN')
		}

		const now = new Date()
		return res.status(200).json({
			meetingId: String(room._id),
			lessonId: room.lessonId ? String(room.lessonId) : null,
			roomId: room.roomId,
			title: room.title,
			state: room.state,
			generatedAt: now.toISOString(),
			records: room.participants.map(participant => {
				const leftAt = participant.leftAt || now
				const joinedAt = participant.joinedAt || now
				return {
					participantId: participant.participantId,
					userId: String(participant.userId),
					displayName: participant.displayName,
					role: participant.role,
					joinedAt: joinedAt.toISOString(),
					leftAt: participant.leftAt ? participant.leftAt.toISOString() : null,
					durationSeconds: Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 1000)),
				}
			}),
		})
	} catch (error) {
		console.error('Get WebRTC attendance failed:', error)
		return sendError(res, 500, 'Failed to get attendance report', 'INTERNAL_SERVER_ERROR')
	}
}

const addClientLogs = async (req, res) => {
	try {
		const identity = getIdentity(req)
		const events = Array.isArray(req.body.events) ? req.body.events : []
		if (events.length < 1 || events.length > 100) {
			return sendError(res, 400, 'events must contain 1-100 items', 'VALIDATION_ERROR', 'events')
		}

		const room = await WebRtcRoom.findOne({ roomId: req.params.roomId })
		if (!room) {
			return sendError(res, 404, 'WebRTC room not found', 'NOT_FOUND')
		}
		if (!ensureRoomAccess(room, identity)) {
			return sendError(res, 403, 'Forbidden', 'FORBIDDEN')
		}

		for (const event of events) {
			if (!['info', 'warn', 'error'].includes(event.level)) {
				return sendError(res, 400, 'Invalid log level', 'VALIDATION_ERROR', 'events.level')
			}
			const occurredAt = new Date(event.occurredAt)
			if (Number.isNaN(occurredAt.getTime())) {
				return sendError(res, 400, 'Invalid occurredAt date', 'VALIDATION_ERROR', 'events.occurredAt')
			}
			room.clientLogs.push({
				level: event.level,
				message: String(event.message || '').trim(),
				context: event.context && typeof event.context === 'object' ? event.context : {},
				occurredAt,
			})
		}

		await room.save()
		return res.status(202).json({ message: 'Client logs accepted', count: events.length })
	} catch (error) {
		console.error('Add WebRTC client logs failed:', error)
		return sendError(res, 500, 'Failed to add client logs', 'INTERNAL_SERVER_ERROR')
	}
}

const getSocketEventGuide = (req, res) => {
	return res.status(200).json({
		socketUrl: `${req.protocol}://${req.get('host')}/socket.io`,
		auth: {
			type: 'Socket.IO auth token',
			example: {
				auth: {
					token: '<access-token>',
				},
			},
		},
		flow: [
			'Create or join the room with REST.',
			'If join returns admitted:false, show the waiting lobby until the host admits the participant.',
			'Connect Socket.IO with the same access token.',
			'Emit joinRoom with roomId and participantId. Waiting participants are kept outside live signaling.',
			'After admittedFromWaiting, emit joinRoom again to enter the live signaling room.',
			'Exchange offer, answer, and iceCandidate events between participants.',
			'Call REST leave endpoint when the call ends.',
		],
		events: {
			joinRoom: {
				description: 'Join the waiting lobby or live signaling room depending on admission status.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						participantId: 'student-65f12ca7a7720c194de6a002',
					},
				},
			},
			admitFromWaiting: {
				description: 'Host/admin admits a waiting participant. The participant should emit joinRoom again after admittedFromWaiting.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						participantId: 'student-65f12ca7a7720c194de6a002',
					},
				},
			},
			denyFromWaiting: {
				description: 'Host/admin denies a waiting participant.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						participantId: 'student-65f12ca7a7720c194de6a002',
						reason: 'Not admitted by host',
					},
				},
			},
			offer: {
				description: 'Send local WebRTC offer SDP to another participant.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						targetParticipantId: 'teacher-65f12ca7a7720c194de6a001',
						sdp: { type: 'offer', sdp: 'v=0...' },
					},
				},
			},
			answer: {
				description: 'Send local WebRTC answer SDP back to the offer sender.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						targetParticipantId: 'student-65f12ca7a7720c194de6a002',
						sdp: { type: 'answer', sdp: 'v=0...' },
					},
				},
			},
			iceCandidate: {
				description: 'Send ICE candidate discovered by RTCPeerConnection.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						targetParticipantId: 'teacher-65f12ca7a7720c194de6a001',
						candidate: {
							candidate: 'candidate:...',
							sdpMid: '0',
							sdpMLineIndex: 0,
						},
					},
				},
			},
			sendMessage: {
				description: 'Send realtime chat message through Socket.IO.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						body: 'Hello everyone',
					},
				},
			},
			toggleOwnMedia: {
				description: 'Broadcast local audio/video/screen/hand state.',
				payload: {
					roomId: 'room_abc123',
					payload: {
						audioEnabled: true,
						videoEnabled: true,
						screenSharing: false,
						handRaised: false,
					},
				},
			},
		},
	})
}

module.exports = {
	getSocketEventGuide,
	createRoom,
	listRooms,
	getRoom,
	joinRoom,
	leaveRoom,
	updateRoomState,
	createMessage,
	getAttendanceReport,
	addClientLogs,
}
