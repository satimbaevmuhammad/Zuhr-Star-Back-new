const mongoose = require('mongoose')

const DAYS_OF_WEEK = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday',
]
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused']

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

const groupScheduleSchema = new mongoose.Schema(
	{
		dayOfWeek: {
			type: String,
			required: true,
			enum: DAYS_OF_WEEK,
		},
		startTime: {
			type: String,
			required: true,
			match: [TIME_PATTERN, 'startTime must be in HH:mm format'],
		},
		durationMinutes: {
			type: Number,
			required: true,
			min: 30,
			max: 300,
		},
	},
	{ _id: false },
)

const groupAttendanceSchema = new mongoose.Schema(
	{
		student: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Student',
			required: true,
		},
		date: {
			type: Date,
			required: true,
		},
		status: {
			type: String,
			enum: ATTENDANCE_STATUSES,
			default: 'present',
		},
		note: {
			type: String,
			trim: true,
			maxlength: 300,
		},
		markedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		},
	},
	{ _id: false },
)

const groupSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 100,
		},
		course: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
		},
		level: {
			type: String,
			trim: true,
			maxlength: 50,
		},
		teacher: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		supportTeachers: {
			type: [
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'User',
				},
			],
			default: [],
			validate: {
				validator: value => {
					const ids = value.map(item => item.toString())
					return new Set(ids).size === ids.length
				},
				message: 'Support teachers list cannot contain duplicates',
			},
		},
		students: {
			type: [
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'Student',
				},
			],
			default: [],
			validate: {
				validator: value => {
					const ids = value.map(item => item.toString())
					return new Set(ids).size === ids.length
				},
				message: 'Students list cannot contain duplicates',
			},
		},
		maxStudents: {
			type: Number,
			default: 15,
			min: 1,
			max: 100,
		},
		status: {
			type: String,
			enum: ['planned', 'active', 'paused', 'completed', 'archived'],
			default: 'planned',
		},
		startDate: {
			type: Date,
			required: true,
		},
		endDate: {
			type: Date,
			default: null,
			validate: {
				validator: function (value) {
					if (!value) {
						return true
					}
					return value >= this.startDate
				},
				message: 'endDate must be greater than or equal to startDate',
			},
		},
		schedule: {
			type: [groupScheduleSchema],
			required: true,
			validate: {
				validator: value => Array.isArray(value) && value.length > 0,
				message: 'At least one schedule item is required',
			},
		},
		room: {
			type: String,
			trim: true,
			maxlength: 50,
		},
		monthlyFee: {
			type: Number,
			default: 0,
			min: 0,
		},
		coinBalance: {
			type: Number,
			default: 0,
			min: 0,
		},
		attendance: {
			type: [groupAttendanceSchema],
			default: [],
			validate: {
				validator: value => {
					const attendanceKeys = value.map(item => {
						const attendanceDate = new Date(item.date)
						const dateKey = Number.isNaN(attendanceDate.getTime())
							? ''
							: attendanceDate.toISOString().slice(0, 10)
						return `${item.student.toString()}::${dateKey}`
					})

					return new Set(attendanceKeys).size === attendanceKeys.length
				},
				message:
					'Attendance cannot contain duplicate records for the same student and day',
			},
		},
		note: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
	},
	{ timestamps: true },
)

groupSchema.index({ name: 1, startDate: 1 }, { unique: true })
groupSchema.index({ teacher: 1, status: 1 })
groupSchema.index({ students: 1 })
groupSchema.index({ 'attendance.student': 1, 'attendance.date': 1 })

module.exports = mongoose.model('Group', groupSchema)
