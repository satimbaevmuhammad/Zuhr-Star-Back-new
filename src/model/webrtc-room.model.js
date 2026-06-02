const mongoose = require('mongoose')

const ROOM_STATES = ['IDLE', 'WAITING_ROOM', 'ACTIVE', 'RECORDING', 'ENDING', 'ARCHIVED']
const PARTICIPANT_ROLES = ['student', 'teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin']

const participantSchema = new mongoose.Schema(
	{
		participantId: { type: String, required: true, trim: true },
		userId: { type: mongoose.Schema.Types.ObjectId, required: true },
		userType: { type: String, enum: ['employee', 'student'], required: true },
		displayName: { type: String, required: true, trim: true, maxlength: 120 },
		role: { type: String, enum: PARTICIPANT_ROLES, required: true },
		admitted: { type: Boolean, default: true },
		admissionStatus: { type: String, enum: ['waiting', 'admitted', 'denied'], default: 'admitted' },
		joinedAt: { type: Date, default: Date.now },
		leftAt: { type: Date, default: null },
	},
	{ _id: false },
)

const messageSchema = new mongoose.Schema(
	{
		id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
		senderId: { type: String, required: true, trim: true },
		senderName: { type: String, required: true, trim: true, maxlength: 120 },
		body: { type: String, required: true, trim: true, maxlength: 2000 },
		createdAt: { type: Date, default: Date.now },
	},
	{ _id: false },
)

const clientLogSchema = new mongoose.Schema(
	{
		level: { type: String, enum: ['info', 'warn', 'error'], required: true },
		message: { type: String, required: true, trim: true, maxlength: 4000 },
		context: { type: mongoose.Schema.Types.Mixed, default: {} },
		occurredAt: { type: Date, required: true },
		receivedAt: { type: Date, default: Date.now },
	},
	{ _id: false },
)

const webrtcRoomSchema = new mongoose.Schema(
	{
		roomId: { type: String, required: true, unique: true, trim: true, index: true },
		lessonId: { type: mongoose.Schema.Types.ObjectId, default: null },
		title: { type: String, required: true, trim: true, maxlength: 160 },
		hostParticipantId: { type: String, required: true, trim: true },
		hostUserId: { type: mongoose.Schema.Types.ObjectId, required: true },
		hostUserType: { type: String, enum: ['employee', 'student'], required: true },
		waitingRoomEnabled: { type: Boolean, default: true },
		state: { type: String, enum: ROOM_STATES, default: 'WAITING_ROOM' },
		startsAt: { type: Date, default: null },
		endedAt: { type: Date, default: null },
		participants: { type: [participantSchema], default: [] },
		messages: { type: [messageSchema], default: [] },
		clientLogs: { type: [clientLogSchema], default: [] },
	},
	{ timestamps: true },
)

webrtcRoomSchema.index({ createdAt: -1 })
webrtcRoomSchema.index({ lessonId: 1 })

module.exports = {
	ROOM_STATES,
	WebRtcRoom: mongoose.model('WebRtcRoom', webrtcRoomSchema),
}
