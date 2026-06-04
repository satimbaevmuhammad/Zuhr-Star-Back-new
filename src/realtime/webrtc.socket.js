const { Server } = require('socket.io')

const User = require('../model/user.model')
const Student = require('../model/student.model')
const { WebRtcRoom } = require('../model/webrtc-room.model')
const { verifyAccessToken } = require('../utils/token')

const rooms = new Map()

const normalizeOrigin = value => String(value || '').trim().replace(/\/+$/, '')

const buildCorsOptions = () => {
	const configured = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
		.split(',')
		.map(normalizeOrigin)
		.filter(Boolean)
	const allowAll = configured.length === 0 || configured.includes('*')

	return {
		origin(origin, callback) {
			if (!origin || allowAll) {
				return callback(null, true)
			}

			return callback(null, configured.includes(normalizeOrigin(origin)))
		},
		credentials: true,
	}
}

const getToken = socket => {
	const authToken = socket.handshake.auth?.token
	const header = socket.handshake.headers?.authorization
	if (authToken) {
		return String(authToken).replace(/^Bearer\s+/i, '').trim()
	}
	if (header) {
		return String(header).replace(/^Bearer\s+/i, '').trim()
	}
	return ''
}

const getRoom = roomId => {
	const key = String(roomId || '').trim()
	if (!rooms.has(key)) {
		rooms.set(key, new Map())
	}
	return rooms.get(key)
}

const normalizeEvent = (eventName, raw, socket) => {
	const data = raw && typeof raw === 'object' ? raw : {}
	const payload = data.payload && typeof data.payload === 'object' ? data.payload : data
	const roomId = String(data.roomId || payload.roomId || '').trim()
	const senderId = String(data.senderId || payload.senderId || socket.data.participantId || socket.data.userId).trim()

	return {
		type: String(data.type || eventName),
		roomId,
		senderId,
		timestamp: String(data.timestamp || new Date().toISOString()),
		payload,
	}
}

const emitError = (socket, event, message, code = 'WEBRTC_ERROR') => {
	socket.emit('error', {
		type: 'error',
		roomId: event?.roomId || '',
		senderId: 'server',
		timestamp: new Date().toISOString(),
		payload: { code, message },
	})
}

const participantSummary = socket => ({
	participantId: socket.data.participantId,
	userId: socket.data.userId,
	displayName: socket.data.displayName,
	role: socket.data.role,
	joinedAt: socket.data.joinedAt,
	media: socket.data.media,
	networkQuality: socket.data.networkQuality,
	socketId: socket.id,
})

const participantSummaryFromDocument = participant => ({
	participantId: participant.participantId,
	userId: String(participant.userId),
	displayName: participant.displayName,
	role: participant.role,
	joinedAt: participant.joinedAt ? participant.joinedAt.toISOString() : null,
	media: {
		audioEnabled: false,
		videoEnabled: false,
		screenSharing: false,
		handRaised: false,
	},
	networkQuality: 0,
})

const isRoomHost = (room, socket) => {
	if (String(room.hostUserId) === String(socket.data.userId)) {
		return true
	}

	return ['admin', 'superadmin'].includes(socket.data.role)
}

const getParticipantAliases = (socket, requestedParticipantId) => {
	const aliases = [
		socket.data.userId,
		`${socket.data.userType}-${socket.data.userId}`,
		`${socket.data.role}-${socket.data.userId}`,
	]

	const ownAliases = new Set(aliases.map(value => String(value || '').trim()).filter(Boolean))
	const requested = String(requestedParticipantId || '').trim()
	if (requested) {
		ownAliases.add(requested)
	}

	return ownAliases
}

const resolveSocketParticipant = (room, socket, requestedParticipantId) => {
	const requested = String(requestedParticipantId || '').trim()
	if (requested) {
		const exactParticipant = room.participants.find(
			participant =>
				String(participant.userId) === String(socket.data.userId) &&
				String(participant.participantId) === requested,
		)
		if (exactParticipant) {
			return exactParticipant
		}

		const ownAliases = new Set([
			socket.data.userId,
			`${socket.data.userType}-${socket.data.userId}`,
			`${socket.data.role}-${socket.data.userId}`,
		].map(value => String(value || '').trim()).filter(Boolean))
		if (!ownAliases.has(requested)) {
			return undefined
		}
	}

	const aliases = getParticipantAliases(socket, requestedParticipantId)
	return room.participants.find(participant => {
		if (String(participant.userId) !== String(socket.data.userId)) {
			return false
		}

		return aliases.has(String(participant.participantId))
	})
}

const getWaitingParticipants = room =>
	room.participants
		.filter(participant => participant.admissionStatus === 'waiting' || participant.admitted === false)
		.map(participantSummaryFromDocument)

const emitWaitingRoomUpdated = (io, room) => {
	io.to(`webrtc:${room.roomId}`).emit('waitingRoomUpdated', {
		type: 'waitingRoomUpdated',
		roomId: room.roomId,
		senderId: 'server',
		timestamp: new Date().toISOString(),
		payload: { participants: getWaitingParticipants(room) },
	})
}

const leaveCurrentRoom = socket => {
	const roomId = socket.data.roomId
	const participantId = socket.data.participantId
	if (!roomId || !participantId) {
		return
	}

	const room = rooms.get(roomId)
	if (room) {
		room.delete(participantId)
		if (room.size === 0) {
			rooms.delete(roomId)
		}
	}

	socket.to(`webrtc:${roomId}`).emit('participantLeft', {
		type: 'participantLeft',
		roomId,
		senderId: 'server',
		timestamp: new Date().toISOString(),
		payload: {
			participantId,
			leftAt: new Date().toISOString(),
		},
	})

	socket.leave(`webrtc:${roomId}`)
	socket.leave(`webrtc-waiting:${roomId}:${participantId}`)
	socket.data.roomId = null
	socket.data.participantId = null
	socket.data.waitingRoomId = null
}

const attachWebRtcSocketServer = server => {
	const io = new Server(server, {
		cors: buildCorsOptions(),
		path: '/socket.io',
	})

	io.use(async (socket, next) => {
		try {
			const token = getToken(socket)
			if (!token) {
				return next(new Error('Authorization token missing'))
			}

			const payload = verifyAccessToken(token)
			const userId = String(payload.sub || payload.id || '').trim()
			let document = null
			if (payload.userType === 'student') {
				document = await Student.findById(userId)
			} else if (payload.userType === 'employee') {
				document = await User.findById(userId)
			}

			if (!document) {
				return next(new Error('Invalid token user'))
			}

			socket.data.userId = userId
			socket.data.userType = payload.userType
			socket.data.role = payload.userType === 'student' ? 'student' : document.role
			socket.data.displayName = String(document.fullname || 'Participant').trim()
			socket.data.media = {
				audioEnabled: false,
				videoEnabled: false,
				screenSharing: false,
				handRaised: false,
			}
			socket.data.networkQuality = 4
			return next()
		} catch (error) {
			return next(new Error('Invalid or expired access token'))
		}
	})

	io.on('connection', socket => {
		socket.on('joinRoom', async (raw, ack) => {
			const event = normalizeEvent('joinRoom', raw, socket)
			try {
				if (!event.roomId) {
					emitError(socket, event, 'roomId is required', 'VALIDATION_ERROR')
					return
				}

				const requestedParticipantId = String(event.payload.participantId || event.senderId || socket.data.userId).trim()
				const roomDocument = await WebRtcRoom.findOne({ roomId: event.roomId })
				if (!roomDocument) {
					emitError(socket, event, 'WebRTC room not found', 'NOT_FOUND')
					return
				}

				const participant = resolveSocketParticipant(roomDocument, socket, requestedParticipantId)
				if (!participant) {
					emitError(socket, event, 'Join the room with REST before opening WebRTC signaling', 'NOT_JOINED')
					return
				}

				const participantId = participant.participantId
				const admitted = participant.admitted !== false && participant.admissionStatus !== 'waiting'
				if (!admitted && !isRoomHost(roomDocument, socket)) {
					socket.join(`webrtc-waiting:${event.roomId}:${participantId}`)
					socket.data.waitingRoomId = event.roomId
					socket.data.participantId = participantId
					emitWaitingRoomUpdated(io, roomDocument)
					socket.emit('waitingRoomUpdated', {
						type: 'waitingRoomUpdated',
						roomId: event.roomId,
						senderId: 'server',
						timestamp: new Date().toISOString(),
						payload: { participants: [participantSummaryFromDocument(participant)] },
					})
					if (typeof ack === 'function') {
						ack({ ok: true, waiting: true, participantId })
					}
					return
				}

				leaveCurrentRoom(socket)
				socket.data.roomId = event.roomId
				socket.data.participantId = participantId
				socket.data.joinedAt = new Date().toISOString()
				socket.data.waitingRoomId = null
				socket.join(`webrtc:${event.roomId}`)
				socket.leave(`webrtc-waiting:${event.roomId}:${participantId}`)

				const room = getRoom(event.roomId)
				room.set(participantId, socket.id)

				const participants = Array.from(room.keys()).map(id => {
					const participantSocketId = room.get(id)
					const participantSocket = io.sockets.sockets.get(participantSocketId)
					return participantSocket ? participantSummary(participantSocket) : null
				}).filter(Boolean)

				const joinedEvent = {
					type: 'participantJoined',
					roomId: event.roomId,
					senderId: 'server',
					timestamp: new Date().toISOString(),
					payload: participantSummary(socket),
				}

				socket.to(`webrtc:${event.roomId}`).emit('participantJoined', joinedEvent)
				io.to(`webrtc:${event.roomId}`).emit('roomParticipants', {
					type: 'roomParticipants',
					roomId: event.roomId,
					senderId: 'server',
					timestamp: new Date().toISOString(),
					payload: { participants },
				})

				if (typeof ack === 'function') {
					ack({ ok: true, waiting: false, participantId, participants })
				}
			} catch (error) {
				console.error('WebRTC joinRoom socket failed:', error)
				emitError(socket, event, 'Failed to join live signaling room', 'INTERNAL_SERVER_ERROR')
			}
		})

		socket.on('leaveRoom', (raw, ack) => {
			leaveCurrentRoom(socket)
			if (typeof ack === 'function') {
				ack({ ok: true })
			}
		})

		const relayToPeer = (eventName, raw, ack) => {
			const event = normalizeEvent(eventName, raw, socket)
			if (!event.roomId) {
				emitError(socket, event, 'roomId is required', 'VALIDATION_ERROR')
				return
			}

			const targetParticipantId = String(
				event.payload.targetParticipantId || event.payload.to || '',
			).trim()
			const outgoing = {
				...event,
				senderId: event.senderId || socket.data.participantId,
				payload: {
					...event.payload,
					fromParticipantId: socket.data.participantId,
					fromSocketId: socket.id,
				},
			}

			if (targetParticipantId) {
				const targetSocketId = rooms.get(event.roomId)?.get(targetParticipantId)
				if (!targetSocketId) {
					emitError(socket, event, 'Target participant is not connected', 'TARGET_NOT_FOUND')
					return
				}
				io.to(targetSocketId).emit(eventName, outgoing)
			} else {
				socket.to(`webrtc:${event.roomId}`).emit(eventName, outgoing)
			}

			if (typeof ack === 'function') {
				ack({ ok: true })
			}
		}

		socket.on('signal', (raw, ack) => relayToPeer('signal', raw, ack))
		socket.on('offer', (raw, ack) => relayToPeer('offer', raw, ack))
		socket.on('answer', (raw, ack) => relayToPeer('answer', raw, ack))
		socket.on('iceCandidate', (raw, ack) => relayToPeer('iceCandidate', raw, ack))

		socket.on('sendMessage', (raw, ack) => {
			const event = normalizeEvent('sendMessage', raw, socket)
			if (!event.roomId || !event.payload.body) {
				emitError(socket, event, 'roomId and body are required', 'VALIDATION_ERROR')
				return
			}
			const outgoing = {
				type: 'messageCreated',
				roomId: event.roomId,
				senderId: socket.data.participantId || event.senderId,
				timestamp: new Date().toISOString(),
				payload: {
					id: `${Date.now()}-${socket.id}`,
					roomId: event.roomId,
					senderId: socket.data.participantId || event.senderId,
					senderName: socket.data.displayName,
					body: String(event.payload.body).trim(),
					createdAt: new Date().toISOString(),
				},
			}
			io.to(`webrtc:${event.roomId}`).emit('messageCreated', outgoing)
			if (typeof ack === 'function') {
				ack({ ok: true, message: outgoing.payload })
			}
		})

		socket.on('toggleOwnMedia', (raw, ack) => {
			const event = normalizeEvent('toggleOwnMedia', raw, socket)
			socket.data.media = {
				...socket.data.media,
				...event.payload,
			}
			io.to(`webrtc:${event.roomId}`).emit('participantUpdated', {
				type: 'participantUpdated',
				roomId: event.roomId,
				senderId: 'server',
				timestamp: new Date().toISOString(),
				payload: participantSummary(socket),
			})
			if (typeof ack === 'function') {
				ack({ ok: true })
			}
		})

		socket.on('raiseHand', (raw, ack) => {
			const event = normalizeEvent('raiseHand', raw, socket)
			socket.data.media = {
				...socket.data.media,
				handRaised: Boolean(event.payload.raised),
			}
			io.to(`webrtc:${event.roomId}`).emit('participantUpdated', {
				type: 'participantUpdated',
				roomId: event.roomId,
				senderId: 'server',
				timestamp: new Date().toISOString(),
				payload: participantSummary(socket),
			})
			if (typeof ack === 'function') {
				ack({ ok: true })
			}
		})

		socket.on('networkQuality', (raw, ack) => {
			const event = normalizeEvent('networkQuality', raw, socket)
			socket.data.networkQuality = Number(event.payload.score) || 0
			socket.to(`webrtc:${event.roomId}`).emit('networkQuality', event)
			if (typeof ack === 'function') {
				ack({ ok: true })
			}
		})

		socket.on('admitFromWaiting', async (raw, ack) => {
			const event = normalizeEvent('admitFromWaiting', raw, socket)
			try {
				const participantId = String(event.payload.participantId || '').trim()
				const roomDocument = await WebRtcRoom.findOne({ roomId: event.roomId })
				if (!roomDocument || !participantId) {
					emitError(socket, event, 'roomId and participantId are required', 'VALIDATION_ERROR')
					return
				}
				if (!isRoomHost(roomDocument, socket)) {
					emitError(socket, event, 'Only host or admin can admit participants', 'FORBIDDEN')
					return
				}

				const participant = roomDocument.participants.find(item => item.participantId === participantId)
				if (!participant) {
					emitError(socket, event, 'Participant is not waiting for this room', 'NOT_FOUND')
					return
				}

				participant.admitted = true
				participant.admissionStatus = 'admitted'
				participant.joinedAt = participant.joinedAt || new Date()
				if (roomDocument.state === 'IDLE' || roomDocument.state === 'WAITING_ROOM') {
					roomDocument.state = 'ACTIVE'
				}
				await roomDocument.save()

				io.to(`webrtc-waiting:${event.roomId}:${participantId}`).emit('admittedFromWaiting', {
					type: 'admittedFromWaiting',
					roomId: event.roomId,
					senderId: socket.data.participantId || socket.data.userId,
					timestamp: new Date().toISOString(),
					payload: { participantId },
				})
				emitWaitingRoomUpdated(io, roomDocument)
				if (typeof ack === 'function') {
					ack({ ok: true, participantId })
				}
			} catch (error) {
				console.error('WebRTC admitFromWaiting socket failed:', error)
				emitError(socket, event, 'Failed to admit participant', 'INTERNAL_SERVER_ERROR')
			}
		})

		socket.on('denyFromWaiting', async (raw, ack) => {
			const event = normalizeEvent('denyFromWaiting', raw, socket)
			try {
				const participantId = String(event.payload.participantId || '').trim()
				const roomDocument = await WebRtcRoom.findOne({ roomId: event.roomId })
				if (!roomDocument || !participantId) {
					emitError(socket, event, 'roomId and participantId are required', 'VALIDATION_ERROR')
					return
				}
				if (!isRoomHost(roomDocument, socket)) {
					emitError(socket, event, 'Only host or admin can deny participants', 'FORBIDDEN')
					return
				}

				const participant = roomDocument.participants.find(item => item.participantId === participantId)
				if (!participant) {
					emitError(socket, event, 'Participant is not waiting for this room', 'NOT_FOUND')
					return
				}

				participant.admitted = false
				participant.admissionStatus = 'denied'
				participant.leftAt = new Date()
				await roomDocument.save()

				io.to(`webrtc-waiting:${event.roomId}:${participantId}`).emit('deniedFromWaiting', {
					type: 'deniedFromWaiting',
					roomId: event.roomId,
					senderId: socket.data.participantId || socket.data.userId,
					timestamp: new Date().toISOString(),
					payload: {
						participantId,
						reason: String(event.payload.reason || 'Denied by host').trim(),
					},
				})
				emitWaitingRoomUpdated(io, roomDocument)
				if (typeof ack === 'function') {
					ack({ ok: true, participantId })
				}
			} catch (error) {
				console.error('WebRTC denyFromWaiting socket failed:', error)
				emitError(socket, event, 'Failed to deny participant', 'INTERNAL_SERVER_ERROR')
			}
		})

		for (const eventName of [
			'kickParticipant',
			'muteParticipant',
			'muteAll',
			'startRecording',
			'stopRecording',
			'setConsumerPreferredLayers',
		]) {
			socket.on(eventName, (raw, ack) => {
				const event = normalizeEvent(eventName, raw, socket)
				socket.to(`webrtc:${event.roomId}`).emit(eventName, event)
				if (typeof ack === 'function') {
					ack({ ok: true })
				}
			})
		}

		for (const eventName of ['createTransport', 'connectTransport', 'produce', 'consume', 'consumerResume']) {
			socket.on(eventName, raw => {
				const event = normalizeEvent(eventName, raw, socket)
				emitError(
					socket,
					event,
					`${eventName} requires an SFU such as mediasoup. This server currently supports peer-to-peer signaling with offer, answer, and iceCandidate.`,
					'SFU_NOT_CONFIGURED',
				)
			})
		}

		socket.on('disconnect', () => {
			leaveCurrentRoom(socket)
		})
	})

	return io
}

module.exports = {
	attachWebRtcSocketServer,
	__private: {
		getParticipantAliases,
		resolveSocketParticipant,
	},
}
