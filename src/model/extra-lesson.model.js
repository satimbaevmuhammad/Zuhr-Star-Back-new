const mongoose = require('mongoose')

// ─── SCHEDULING CONSTANTS ─────────────────────────────────────────────────────

// Each extra lesson is exactly 60 minutes with a mandatory 10-minute rest after.
// This gives a 70-minute slot interval so teachers never overlap.
const LESSON_DURATION_MINUTES = 60
const REST_MINUTES_AFTER_LESSON = 10
const SLOT_INTERVAL_MINUTES = LESSON_DURATION_MINUTES + REST_MINUTES_AFTER_LESSON // 70

// Support teachers work from 14:00 to 20:00 local time (UTC+5, Tashkent).
// With 70-minute intervals starting at 14:00, 5 slots fit before 20:00:
//   14:00 → 15:00 lesson + 10 min rest
//   15:10 → 16:10 lesson + 10 min rest
//   16:20 → 17:20 lesson + 10 min rest
//   17:30 → 18:30 lesson + 10 min rest
//   18:40 → 19:40 lesson (ends within 20:00 cutoff)
const WORK_START_HOUR_LOCAL = 14
const WORK_END_HOUR_LOCAL = 20
const MAX_LESSONS_PER_DAY = 5

// Timezone offset for Tashkent (UTC+5). All slot calculations use this.
const TIMEZONE_OFFSET_HOURS = 5
const TIMEZONE_OFFSET_MINUTES = TIMEZONE_OFFSET_HOURS * 60 // 300

// Canonical extra-lesson slot times in local UTC+5.
const VALID_SLOT_TIMES_LOCAL = ['14:00', '15:10', '16:20', '17:30', '18:40']

// Valid slot start times expressed as minutes from local midnight.
const VALID_SLOT_MINUTES_LOCAL = VALID_SLOT_TIMES_LOCAL.map(slot => {
	const [hour, minute] = slot.split(':').map(Number)
	return hour * 60 + minute
})

const EXTRA_LESSON_STATUSES = ['pending_approval', 'confirmed', 'cancelled', 'completed']

// Maximum number of students per extra lesson (teacher can add 2–3 students).
const MAX_STUDENTS_PER_LESSON = 3

// Maximum number of globally designated support teachers allowed.
const MAX_SUPPORT_TEACHERS = 3

// ─── SCHEMA ───────────────────────────────────────────────────────────────────

// Sub-document for enrolled students. Tracks who added them and when.
// _id: false to keep the array lightweight (no extra index per entry).
const studentEntrySchema = new mongoose.Schema(
	{
		// The enrolled student.
		student: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Student',
			required: true,
		},
		// The employee who added this student (null when the student enrolled themselves via booking).
		addedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},
		// Timestamp for auditing when the student was added.
		addedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ _id: false },
)

const extraLessonSchema = new mongoose.Schema(
	{
		// The support teacher who will conduct this extra lesson.
		// Must be a User with isExtraLessonSupport === true.
		assignedTeacher: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},

		// The exact UTC date-time when the lesson starts.
		// Must correspond to one of the five valid daily slots (see VALID_SLOT_MINUTES_LOCAL).
		scheduledAt: {
			type: Date,
			required: true,
		},

		// Optional subject or topic for this lesson.
		subject: {
			type: String,
			trim: true,
			maxlength: 120,
		},

		// Who initiated this lesson: 'student_request' means a student submitted a booking
		// request; 'teacher_created' means the support teacher created it directly (auto-confirmed).
		requestType: {
			type: String,
			enum: ['student_request', 'teacher_created'],
			required: true,
		},

		// Polymorphic reference to the person who originated the request.
		// For 'student_request' this is a Student document; for 'teacher_created' it is a User.
		requestedBy: {
			type: mongoose.Schema.Types.ObjectId,
			refPath: 'requestedByModel',
			required: true,
		},
		// Discriminator field required by Mongoose refPath.
		requestedByModel: {
			type: String,
			enum: ['Student', 'User'],
			required: true,
		},

		// Lesson lifecycle status.
		//   pending_approval – student submitted a request, waiting for teacher action.
		//   confirmed        – lesson is approved and will happen (or teacher created it directly).
		//   cancelled        – teacher denied the request or an admin cancelled the lesson.
		//   completed        – lesson has taken place.
		status: {
			type: String,
			enum: EXTRA_LESSON_STATUSES,
			default: 'pending_approval',
		},

		// Up to MAX_STUDENTS_PER_LESSON (3) students per lesson.
		// Tracks the student, who added them, and when.
		students: {
			type: [studentEntrySchema],
			validate: {
				validator(arr) {
					// Enforce hard cap to prevent over-enrollment.
					return arr.length <= MAX_STUDENTS_PER_LESSON
				},
				message: `A single extra lesson cannot have more than ${MAX_STUDENTS_PER_LESSON} students`,
			},
		},

		// Optional note left by the student when booking (e.g. topic they need help with).
		studentNote: {
			type: String,
			trim: true,
			maxlength: 500,
		},

		// Optional internal note from the support teacher (visible to admin).
		teacherNote: {
			type: String,
			trim: true,
			maxlength: 500,
		},

		// Required when status is set to 'cancelled' via a deny action.
		// Tells the student why their request was denied.
		denialReason: {
			type: String,
			trim: true,
			maxlength: 500,
		},

		approvedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},

		deniedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},

		completedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			default: null,
		},

		// Optional room or location identifier.
		room: {
			type: String,
			trim: true,
			maxlength: 100,
		},
	},
	{ timestamps: true },
)

// Index for quickly finding a teacher's lessons on a given date range (availability checks).
extraLessonSchema.index({ assignedTeacher: 1, scheduledAt: 1 })

// Index for admin dashboards filtering by status and time.
extraLessonSchema.index({ status: 1, scheduledAt: 1 })

// Index for student "my lessons" queries.
extraLessonSchema.index({ 'students.student': 1, scheduledAt: 1 })

const ExtraLesson = mongoose.model('ExtraLesson', extraLessonSchema)

module.exports = {
	ExtraLesson,
	// Export constants so the controller can use them without re-defining.
	LESSON_DURATION_MINUTES,
	REST_MINUTES_AFTER_LESSON,
	SLOT_INTERVAL_MINUTES,
	WORK_START_HOUR_LOCAL,
	WORK_END_HOUR_LOCAL,
	MAX_LESSONS_PER_DAY,
	TIMEZONE_OFFSET_HOURS,
	TIMEZONE_OFFSET_MINUTES,
	VALID_SLOT_TIMES_LOCAL,
	VALID_SLOT_MINUTES_LOCAL,
	MAX_STUDENTS_PER_LESSON,
	MAX_SUPPORT_TEACHERS,
	EXTRA_LESSON_STATUSES,
}
