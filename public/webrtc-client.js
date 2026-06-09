/**
 * WebRTC Client — Production-ready signaling with all 7 bugs fixed
 * 
 * Implements:
 * - BUG 1: Creates offer on participantJoined
 * - BUG 2: Map<participantId, RTCPeerConnection> instead of single variable
 * - BUG 3: ICE candidate queue per peer
 * - BUG 4: targetParticipantId on every signaling emit
 * - BUG 5: addTrack to each new connection BEFORE createOffer
 * - BUG 6: Close & remove stale connections on participantLeft
 * - BUG 7: signalingState guards on setLocalDescription/setRemoteDescription
 */

class WebRTCClient {
	constructor(socket, config = {}) {
		this.socket = socket
		this.config = {
			iceServers: config.iceServers || [
				{ urls: ['stun:stun.l.google.com:19302'] },
				{ urls: ['stun:stun1.l.google.com:19302'] },
			],
			...config,
		}

		// BUG 2 FIX: Use Map instead of single peerConnection variable
		this.peerConnections = new Map() // participantId -> RTCPeerConnection

		// BUG 3 FIX: ICE candidate queue per peer
		this.iceCandidateQueues = new Map() // participantId -> ICECandidate[]

		// State tracking
		this.localStream = null
		this.roomId = null
		this.participantId = null
		this.remoteStreams = new Map() // participantId -> MediaStream

		// Event handlers for UI updates
		this.handlers = {
			onRemoteStream: null,
			onRemoteStreamRemoved: null,
			onLocalStream: null,
			onParticipantJoined: null,
			onParticipantLeft: null,
			onError: null,
		}

		this.setupSocketListeners()
	}

	/**
	 * Setup all Socket.IO event listeners
	 */
	setupSocketListeners() {
		// Room lifecycle
		this.socket.on('joinRoom', (event) => {
			console.log('[WebRTC] joinRoom response:', event)
		})

		this.socket.on('leaveRoom', (event) => {
			console.log('[WebRTC] leaveRoom response:', event)
		})

		// Handle roomParticipants list update (sent when we join or room changes)
		this.socket.on('roomParticipants', async (event) => {
			const { payload } = event
			console.log('[WebRTC] Room participants updated:', payload.participants)

			try {
				if (!payload.participants || !Array.isArray(payload.participants)) {
					return
				}

				// Create peer connections to all participants we're not already connected to
				for (const participant of payload.participants) {
					const participantId = participant.participantId
					
					// Skip ourselves
					if (participantId === this.participantId) {
						continue
					}

					// Skip if already connected
					if (this.peerConnections.has(participantId)) {
						continue
					}

					// Only create offer if we have local stream
					if (this.localStream) {
						try {
							await this.createPeerConnection(participantId, true) // initiator
						} catch (error) {
							console.warn(`[WebRTC] Failed to create connection to ${participantId}:`, error)
						}
					}
				}
			} catch (error) {
				console.error('[WebRTC] Error handling roomParticipants:', error)
				if (this.handlers.onError) {
					this.handlers.onError({
						code: 'ROOM_PARTICIPANTS_ERROR',
						message: error.message,
					})
				}
			}
		})

		// BUG 1 FIX: Handle participantJoined by creating offer to newcomer
		this.socket.on('participantJoined', async (event) => {
			const { payload } = event
			console.log('[WebRTC] Participant joined:', payload.participantId)

			try {
				// Skip if it's ourselves (shouldn't happen, but safety check)
				if (payload.participantId === this.participantId) {
					return
				}

				// Only create offer if we already have a local stream and not already connected
				if (this.localStream && !this.peerConnections.has(payload.participantId)) {
					await this.createPeerConnection(
						payload.participantId,
						true, // initiator
					)
				}

				if (this.handlers.onParticipantJoined) {
					this.handlers.onParticipantJoined(payload)
				}
			} catch (error) {
				console.error('[WebRTC] Error handling participantJoined:', error)
				if (this.handlers.onError) {
					this.handlers.onError({
						code: 'PARTICIPANT_JOINED_ERROR',
						message: error.message,
					})
				}
			}
		})

		// BUG 6 FIX: Close stale connection on participantLeft
		this.socket.on('participantLeft', (event) => {
			const { payload } = event
			const participantId = payload.participantId

			console.log('[WebRTC] Participant left:', participantId)

			// Close and clean up connection
			this.closePeerConnection(participantId)

			// Remove remote stream
			this.remoteStreams.delete(participantId)

			if (this.handlers.onRemoteStreamRemoved) {
				this.handlers.onRemoteStreamRemoved(participantId)
			}

			if (this.handlers.onParticipantLeft) {
				this.handlers.onParticipantLeft(payload)
			}
		})

		// Signaling events
		this.socket.on('offer', async (event) => {
			const { payload } = event
			const fromParticipantId = payload.fromParticipantId

			console.log('[WebRTC] Received offer from:', fromParticipantId)

			try {
				// BUG 2 FIX: Get connection from map
				let peerConnection = this.peerConnections.get(fromParticipantId)
				if (!peerConnection) {
					// Create connection if it doesn't exist (remote initiated)
					peerConnection = await this.createPeerConnection(
						fromParticipantId,
						false, // not initiator
					)
				}

				// BUG 7 FIX: Check signalingState before setRemoteDescription
				if (peerConnection.signalingState === 'stable' || peerConnection.signalingState === 'have-local-offer') {
					await peerConnection.setRemoteDescription(
						new RTCSessionDescription(payload.sdp),
					)

					// BUG 3 FIX: Flush queued ICE candidates after setRemoteDescription
					await this.flushIceCandidateQueue(fromParticipantId, peerConnection)

					// Create and send answer
					const answer = await peerConnection.createAnswer()
					await peerConnection.setLocalDescription(answer)

					// BUG 4 FIX: Include targetParticipantId
					this.socket.emit('answer', {
						roomId: this.roomId,
						payload: {
							targetParticipantId: fromParticipantId,
							sdp: peerConnection.localDescription,
						},
					})
				} else {
					console.warn(
						`[WebRTC] Cannot set remote description in state: ${peerConnection.signalingState}`,
					)
				}
			} catch (error) {
				console.error('[WebRTC] Error handling offer:', error)
				if (this.handlers.onError) {
					this.handlers.onError({
						code: 'OFFER_ERROR',
						message: error.message,
					})
				}
			}
		})

		this.socket.on('answer', async (event) => {
			const { payload } = event
			const fromParticipantId = payload.fromParticipantId

			console.log('[WebRTC] Received answer from:', fromParticipantId)

			try {
				// BUG 2 FIX: Get connection from map
				const peerConnection = this.peerConnections.get(fromParticipantId)
				if (!peerConnection) {
					console.warn('[WebRTC] Received answer from unknown peer:', fromParticipantId)
					return
				}

				// BUG 7 FIX: Check signalingState before setRemoteDescription
				if (peerConnection.signalingState === 'have-local-offer') {
					await peerConnection.setRemoteDescription(
						new RTCSessionDescription(payload.sdp),
					)

					// BUG 3 FIX: Flush queued ICE candidates after setRemoteDescription
					await this.flushIceCandidateQueue(fromParticipantId, peerConnection)
				} else {
					console.warn(
						`[WebRTC] Cannot set remote description in state: ${peerConnection.signalingState}`,
					)
				}
			} catch (error) {
				console.error('[WebRTC] Error handling answer:', error)
				if (this.handlers.onError) {
					this.handlers.onError({
						code: 'ANSWER_ERROR',
						message: error.message,
					})
				}
			}
		})

		this.socket.on('iceCandidate', async (event) => {
			const { payload } = event
			const fromParticipantId = payload.fromParticipantId

			console.log('[WebRTC] Received ICE candidate from:', fromParticipantId)

			try {
				// BUG 2 FIX: Get connection from map
				const peerConnection = this.peerConnections.get(fromParticipantId)
				if (!peerConnection) {
					console.warn('[WebRTC] Received ICE candidate from unknown peer:', fromParticipantId)
					return
				}

				// BUG 3 FIX: Queue candidates until setRemoteDescription is complete
				if (peerConnection.remoteDescription) {
					// Remote description already set, apply immediately
					await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate))
				} else {
					// Queue for later
					if (!this.iceCandidateQueues.has(fromParticipantId)) {
						this.iceCandidateQueues.set(fromParticipantId, [])
					}
					this.iceCandidateQueues.get(fromParticipantId).push(payload.candidate)
					console.log(`[WebRTC] Queued ICE candidate for ${fromParticipantId}`)
				}
			} catch (error) {
				console.error('[WebRTC] Error handling ICE candidate:', error)
				if (this.handlers.onError) {
					this.handlers.onError({
						code: 'ICE_CANDIDATE_ERROR',
						message: error.message,
					})
				}
			}
		})

		this.socket.on('error', (event) => {
			console.error('[WebRTC] Socket error:', event)
			if (this.handlers.onError) {
				this.handlers.onError({
					code: event.payload?.code || 'SOCKET_ERROR',
					message: event.payload?.message || 'Unknown error',
				})
			}
		})
	}

	/**
	 * Get local media stream (audio/video)
	 */
	async getLocalStream(constraints = { audio: true, video: { width: 640, height: 480 } }) {
		try {
			this.localStream = await navigator.mediaDevices.getUserMedia(constraints)

			if (this.handlers.onLocalStream) {
				this.handlers.onLocalStream(this.localStream)
			}

			return this.localStream
		} catch (error) {
			console.error('[WebRTC] Failed to get local stream:', error)
			if (this.handlers.onError) {
				this.handlers.onError({
					code: 'GET_MEDIA_ERROR',
					message: error.message,
				})
			}
			throw error
		}
	}

	/**
	 * Stop local stream
	 */
	stopLocalStream() {
		if (this.localStream) {
			this.localStream.getTracks().forEach((track) => track.stop())
			this.localStream = null
		}
	}

	/**
	 * Join a room and emit joinRoom event
	 * Also creates peer connections to existing participants
	 */
	async joinRoom(roomId, participantId) {
		this.roomId = roomId
		this.participantId = participantId

		return new Promise((resolve, reject) => {
			this.socket.emit(
				'joinRoom',
				{
					roomId,
					payload: { participantId },
				},
				async (response) => {
					try {
						if (response?.ok) {
							// Create peer connections to any existing participants returned in ack
							if (response.participants && Array.isArray(response.participants) && this.localStream) {
								console.log('[WebRTC] Creating connections to existing participants:', 
									response.participants.map(p => p.participantId))
								
								for (const participant of response.participants) {
									const pId = participant.participantId
									// Skip ourselves
									if (pId === this.participantId) {
										continue
									}
									// Skip if already connected
									if (this.peerConnections.has(pId)) {
										continue
									}
									try {
										await this.createPeerConnection(pId, true) // initiator
									} catch (error) {
										console.warn(`[WebRTC] Failed to create connection to ${pId}:`, error)
									}
								}
							}
							resolve(response)
						} else {
							reject(new Error('Failed to join room'))
						}
					} catch (error) {
						reject(error)
					}
				},
			)
		})
	}

	/**
	 * Leave room and cleanup
	 */
	async leaveRoom() {
		// Close all peer connections
		for (const [participantId] of this.peerConnections) {
			this.closePeerConnection(participantId)
		}

		// Clear state
		this.peerConnections.clear()
		this.iceCandidateQueues.clear()
		this.remoteStreams.clear()

		return new Promise((resolve) => {
			this.socket.emit('leaveRoom', {}, () => resolve())
		})
	}

	/**
	 * BUG 2 FIX: Create peer connection and store in map
	 * BUG 5 FIX: Add local tracks BEFORE creating offer
	 */
	async createPeerConnection(participantId, initiator = false) {
		// Don't recreate if already exists
		if (this.peerConnections.has(participantId)) {
			return this.peerConnections.get(participantId)
		}

		const peerConnection = new RTCPeerConnection({
			iceServers: this.config.iceServers,
		})

		// BUG 5 FIX: Add local tracks to EVERY new connection
		if (this.localStream) {
			this.localStream.getTracks().forEach((track) => {
				peerConnection.addTrack(track, this.localStream)
			})
		}

		// Handle remote stream
		peerConnection.ontrack = (event) => {
			console.log('[WebRTC] Received remote track from:', participantId)
			const [remoteStream] = event.streams
			this.remoteStreams.set(participantId, remoteStream)

			if (this.handlers.onRemoteStream) {
				this.handlers.onRemoteStream(participantId, remoteStream)
			}
		}

		// Handle ICE candidates
		peerConnection.onicecandidate = (event) => {
			if (event.candidate) {
				console.log('[WebRTC] Generated ICE candidate for:', participantId)

				// BUG 4 FIX: Include targetParticipantId
				this.socket.emit('iceCandidate', {
					roomId: this.roomId,
					payload: {
						targetParticipantId: participantId,
						candidate: event.candidate,
					},
				})
			}
		}

		// Handle connection state changes
		peerConnection.onconnectionstatechange = () => {
			console.log(`[WebRTC] Connection state with ${participantId}:`, peerConnection.connectionState)

			if (
				peerConnection.connectionState === 'failed' ||
				peerConnection.connectionState === 'disconnected'
			) {
				this.closePeerConnection(participantId)
			}
		}

		// BUG 2 FIX: Store in map
		this.peerConnections.set(participantId, peerConnection)

		// If initiator, create and send offer
		if (initiator) {
			try {
				const offer = await peerConnection.createOffer()
				await peerConnection.setLocalDescription(offer)

				// BUG 4 FIX: Include targetParticipantId
				this.socket.emit('offer', {
					roomId: this.roomId,
					payload: {
						targetParticipantId: participantId,
						sdp: peerConnection.localDescription,
					},
				})
			} catch (error) {
				console.error('[WebRTC] Error creating offer:', error)
				this.closePeerConnection(participantId)
				throw error
			}
		}

		return peerConnection
	}

	/**
	 * BUG 3 FIX: Flush queued ICE candidates after setRemoteDescription
	 */
	async flushIceCandidateQueue(participantId, peerConnection) {
		const queue = this.iceCandidateQueues.get(participantId)
		if (!queue || queue.length === 0) {
			return
		}

		console.log(`[WebRTC] Flushing ${queue.length} queued ICE candidates for ${participantId}`)

		for (const candidate of queue) {
			try {
				await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
			} catch (error) {
				console.warn('[WebRTC] Failed to add queued ICE candidate:', error)
			}
		}

		this.iceCandidateQueues.delete(participantId)
	}

	/**
	 * BUG 6 FIX: Close and remove stale connection
	 */
	closePeerConnection(participantId) {
		const peerConnection = this.peerConnections.get(participantId)
		if (!peerConnection) {
			return
		}

		// Close connection
		peerConnection.close()

		// Remove from map
		this.peerConnections.delete(participantId)

		// Clean up queued candidates
		this.iceCandidateQueues.delete(participantId)

		console.log('[WebRTC] Closed connection with:', participantId)
	}

	/**
	 * Register event handler
	 */
	on(eventName, handler) {
		if (this.handlers.hasOwnProperty(`on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`)) {
			this.handlers[`on${eventName.charAt(0).toUpperCase()}${eventName.slice(1)}`] = handler
		}
	}

	/**
	 * Get remote stream for participant
	 */
	getRemoteStream(participantId) {
		return this.remoteStreams.get(participantId)
	}

	/**
	 * Get all connected participants
	 */
	getConnectedParticipants() {
		return Array.from(this.peerConnections.keys())
	}
}

// Export for Node/Webpack
if (typeof module !== 'undefined' && module.exports) {
	module.exports = WebRTCClient
}
