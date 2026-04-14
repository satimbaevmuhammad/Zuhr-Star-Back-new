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
const GROUP_TYPE_DAYS = Object.freeze({
	odd: ['monday', 'wednesday', 'friday'],
	even: ['tuesday', 'thursday', 'saturday'],
})

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const ATTENDANCE_TIMEZONE_OFFSET_HOURS = 5
const ATTENDANCE_TIMEZONE_OFFSET_MINUTES = ATTENDANCE_TIMEZONE_OFFSET_HOURS * 60

const toAttendanceDateKey = value => {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return ''
	}

	const localMs = date.getTime() + ATTENDANCE_TIMEZONE_OFFSET_MINUTES * 60 * 1000
	const localDate = new Date(localMs)
	const year = localDate.getUTCFullYear()
	const month = String(localDate.getUTCMonth() + 1).padStart(2, '0')
	const day = String(localDate.getUTCDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

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
		markedAt: {
			type: Date,
			default: Date.now,
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
		courseRef: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Course',
			default: null,
		},
		groupType: {
			type: String,
			enum: ['even', 'odd'],
			default: 'odd',
		},
		lessons: {
			type: [
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'Lesson',
				},
			],
			default: [],
			validate: {
				validator: value => {
					const ids = value.map(item => item.toString())
					return new Set(ids).size === ids.length
				},
				message: 'Lessons list cannot contain duplicates',
			},
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
				validator: function (value) {
					if (!Array.isArray(value) || value.length === 0) {
						return false
					}

					const daySet = new Set(
						value.map(item =>
							String(item?.dayOfWeek || '')
								.trim()
								.toLowerCase(),
						),
					)
					if (daySet.size !== value.length) {
						return false
					}

					const groupType = String(this.groupType || '')
						.trim()
						.toLowerCase()
					const expectedDays = GROUP_TYPE_DAYS[groupType]
					if (!expectedDays) {
						return true
					}

					if (value.length !== expectedDays.length) {
						return false
					}

					return expectedDays.every(day => daySet.has(day))
				},
				message:
					'Schedule must have unique days and match groupType pattern (odd: monday/wednesday/friday, even: tuesday/thursday/saturday)',
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
						const dateKey = toAttendanceDateKey(item.date)
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
groupSchema.index({ courseRef: 1, status: 1 })
groupSchema.index({ students: 1 })
groupSchema.index({ 'attendance.student': 1, 'attendance.date': 1 })

module.exports = mongoose.model('Group', groupSchema)
