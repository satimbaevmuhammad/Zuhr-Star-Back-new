const mongoose = require('mongoose')
const {
	ExtraLesson,
	LESSON_DURATION_MINUTES,
	MAX_LESSONS_PER_DAY,
	TIMEZONE_OFFSET_HOURS,
	TIMEZONE_OFFSET_MINUTES,
	VALID_SLOT_MINUTES_LOCAL,
	MAX_STUDENTS_PER_LESSON,
	MAX_SUPPORT_TEACHERS,
} = require('../model/extra-lesson.model')
const User = require('../model/user.model')
const Student = require('../model/student.model')

// ─── TIMEZONE / SLOT HELPERS ─────────────────────────────────────────────────

/**
 * Convert a UTC Date to the number of minutes elapsed since local midnight (UTC+5).
 * Used to check whether a scheduledAt value lands on a valid slot.
 *
 * Example: 09:00 UTC → 09:00 + 5h = 14:00 local → 14 * 60 = 840 minutes.
 */
const toLocalMinutesOfDay = utcDate => {
	const utcMinutes = utcDate.getUTCHours() * 60 + utcDate.getUTCMinutes()
	// Add the UTC+5 offset and wrap around midnight (should never happen for work hours).
	return (utcMinutes + TIMEZONE_OFFSET_MINUTES) % (24 * 60)
}

/**
 * Return true when a UTC Date falls exactly on one of the five valid local slot times
 * AND has no stray seconds / milliseconds (slots must be clean whole-minute boundaries).
 */
const isValidSlot = utcDate => {
	if (utcDate.getUTCSeconds() !== 0 || utcDate.getUTCMilliseconds() !== 0) {
		return false
	}
	const localMinutes = toLocalMinutesOfDay(utcDate)
	return VALID_SLOT_MINUTES_LOCAL.includes(localMinutes)
}

/**
 * Build the five valid UTC slot Date objects for a given local calendar date string (YYYY-MM-DD).
 *
 * Because local time = UTC + 5, each UTC slot = local slot - 5 hours.
 * Example for 2026-03-28:
 *   Local 14:00 → UTC 2026-03-28T09:00:00Z
 *   Local 15:10 → UTC 2026-03-28T10:10:00Z
 *   ...
 */
const buildSlotUtcDates = localDateStr => {
	const [year, month, day] = localDateStr.split('-').map(Number)
	return VALID_SLOT_MINUTES_LOCAL.map(localMins => {
		const localHour = Math.floor(localMins / 60)
		const localMin = localMins % 60
		// Subtract the UTC+5 offset to get UTC time.
		// Date.UTC handles negative hours by rolling back to the previous calendar day (safe).
		return new Date(Date.UTC(year, month - 1, day, localHour - TIMEZONE_OFFSET_HOURS, localMin, 0, 0))
	})
}

/**
 * Return today's date as a YYYY-MM-DD string in local time (UTC+5).
 * Used as the default when no date query param is provided.
 */
const getTodayLocalDateString = () => {
	const now = new Date()
	// Shift the UTC timestamp by the offset to get the local clock reading.
	const localMs = now.getTime() + TIMEZONE_OFFSET_MINUTES * 60 * 1000
	const localDate = new Date(localMs)
	const y = localDate.getUTCFullYear()
	const m = String(localDate.getUTCMonth() + 1).padStart(2, '0')
	const d = String(localDate.getUTCDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

/**
 * Return the UTC range [startUTC, endUTC) that covers an entire local calendar day.
 *
 * Local 00:00 UTC+5 = UTC-5h previous day; Local 24:00 = UTC+19h same day.
 * Example: 2026-03-28 local → 2026-03-27T19:00:00Z … 2026-03-28T19:00:00Z
 */
const getLocalDayUtcRange = localDateStr => {
	const [year, month, day] = localDateStr.split('-').map(Number)
	const startUTC = new Date(Date.UTC(year, month - 1, day, 0 - TIMEZONE_OFFSET_HOURS, 0, 0, 0))
	const endUTC = new Date(Date.UTC(year, month - 1, day, 24 - TIMEZONE_OFFSET_HOURS, 0, 0, 0))
	return { startUTC, endUTC }
}

/**
 * Validate a YYYY-MM-DD date string and return it, or return an error message string.
 * Returns null on success (puts the validated string in the `out` object).
 */
const parseDateParam = (raw, out) => {
	const str = String(raw || '').trim()
	if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
		return 'date must be in YYYY-MM-DD format'
	}
	// Sanity-check that it is a real calendar date.
	const parsed = new Date(str + 'T12:00:00Z')
	if (Number.isNaN(parsed.getTime())) {
		return 'date is not a valid calendar date'
	}
	out.date = str
	return null
}

// ─── SUPPORT TEACHER MANAGEMENT ──────────────────────────────────────────────

/**
 * GET /api/extra-lessons/support-teachers
 * List all users designated as extra-lesson support teachers.
 * Auth: employee token (any role with users:read permission).
 */
exports.listSupportTeachers = async (req, res) => {
	try {
		const teachers = await User.find({ isExtraLessonSupport: true }).select(
			'fullname phone email role imgURL isExtraLessonSupport',
		)
		return res.status(200).json({
			total: teachers.length,
			max: MAX_SUPPORT_TEACHERS,
			data: teachers,
		})
	} catch (error) {
		console.error('listSupportTeachers failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * POST /api/extra-lessons/support-teachers/:userId
 * Designate an employee as an extra-lesson support teacher.
 * Auth: admin or superadmin.
 * Max MAX_SUPPORT_TEACHERS teachers allowed simultaneously.
 */
exports.assignSupportTeacher = async (req, res) => {
	try {
		const { userId } = req.params

		// Check the global cap before touching any document.
		const currentCount = await User.countDocuments({ isExtraLessonSupport: true })
		if (currentCount >= MAX_SUPPORT_TEACHERS) {
			return res.status(409).json({
				message: `Cannot assign more than ${MAX_SUPPORT_TEACHERS} support teachers. Remove one first.`,
			})
		}

		const user = await User.findById(userId)
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}
		if (user.isExtraLessonSupport) {
			return res.status(409).json({ message: 'User is already a support teacher' })
		}

		user.isExtraLessonSupport = true
		await user.save()

		return res.status(200).json({
			message: 'User assigned as extra lesson support teacher',
			user: {
				_id: user._id,
				fullname: user.fullname,
				phone: user.phone,
				role: user.role,
				isExtraLessonSupport: true,
			},
		})
	} catch (error) {
		console.error('assignSupportTeacher failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * DELETE /api/extra-lessons/support-teachers/:userId
 * Remove the extra-lesson support designation from a user.
 * Auth: admin or superadmin.
 */
exports.removeSupportTeacher = async (req, res) => {
	try {
		const { userId } = req.params

		const user = await User.findById(userId)
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}
		if (!user.isExtraLessonSupport) {
			return res.status(400).json({ message: 'User is not a support teacher' })
		}

		user.isExtraLessonSupport = false
		await user.save()

		return res.status(200).json({ message: 'User removed from extra lesson support teachers' })
	} catch (error) {
		console.error('removeSupportTeacher failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── AVAILABILITY ─────────────────────────────────────────────────────────────

/**
 * GET /api/extra-lessons/availability?teacherId=...&date=YYYY-MM-DD
 * Return the five daily slots for a support teacher on a given local date.
 * Each slot includes an `isFree` flag based on whether a confirmed/pending lesson
 * already occupies that time.
 *
 * Auth: NONE — students need to see schedules before logging in.
 */
exports.getAvailability = async (req, res) => {
	try {
		const teacherId = String(req.query.teacherId || '').trim()
		if (!teacherId || !mongoose.isValidObjectId(teacherId)) {
			return res.status(400).json({ message: 'Valid teacherId query param is required', field: 'teacherId' })
		}

		// Default to today in local time when no date is given.
		const out = {}
		const dateError = req.query.date ? parseDateParam(req.query.date, out) : null
		if (dateError) {
			return res.status(400).json({ message: dateError, field: 'date' })
		}
		const localDateStr = out.date || getTodayLocalDateString()

		// Confirm the teacher exists and is a support teacher.
		const teacher = await User.findById(teacherId).select('fullname isExtraLessonSupport')
		if (!teacher) {
			return res.status(404).json({ message: 'Teacher not found' })
		}
		if (!teacher.isExtraLessonSupport) {
			return res.status(400).json({ message: 'Specified user is not a support teacher' })
		}

		// Build the exact UTC Date objects for each of the five valid slots.
		const slotDates = buildSlotUtcDates(localDateStr)

		// Find any already-booked lessons for this teacher on this local day.
		const { startUTC, endUTC } = getLocalDayUtcRange(localDateStr)
		const bookedLessons = await ExtraLesson.find({
			assignedTeacher: teacherId,
			scheduledAt: { $gte: startUTC, $lt: endUTC },
			// Both pending and confirmed slots count as occupied — a pending request
			// holds the slot until approved/denied.
			status: { $in: ['pending_approval', 'confirmed'] },
		}).select('scheduledAt status')

		// Build a Set of occupied slot timestamps for O(1) lookup.
		const occupiedTimes = new Set(bookedLessons.map(l => l.scheduledAt.getTime()))

		// Map each slot to a response object with human-readable local time and isFree.
		const slots = slotDates.map(slotUtc => {
			const localMins = toLocalMinutesOfDay(slotUtc)
			const localHour = Math.floor(localMins / 60)
			const localMin = localMins % 60
			return {
				// ISO 8601 UTC timestamp — frontend passes this back when booking.
				scheduledAt: slotUtc.toISOString(),
				// Human-readable local time for display (UTC+5).
				localTime: `${String(localHour).padStart(2, '0')}:${String(localMin).padStart(2, '0')}`,
				isFree: !occupiedTimes.has(slotUtc.getTime()),
			}
		})

		// Count how many lessons the teacher already has today (to show remaining capacity).
		const bookedCount = bookedLessons.length

		return res.status(200).json({
			teacherId,
			date: localDateStr,
			teacher: { _id: teacher._id, fullname: teacher.fullname },
			lessonsToday: bookedCount,
			remainingSlots: MAX_LESSONS_PER_DAY - bookedCount,
			slots,
		})
	} catch (error) {
		console.error('getAvailability failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── STUDENT BOOKING ──────────────────────────────────────────────────────────

/**
 * POST /api/extra-lessons/book
 * Student submits a booking request for a specific slot with a support teacher.
 *
 * The lesson is created with status 'pending_approval'. The support teacher must
 * then approve or deny it via PATCH /:lessonId/approve or /deny.
 *
 * Body: { teacherId, scheduledAt, studentNote? }
 * Auth: student token (requireStudentAuth).
 */
exports.bookLesson = async (req, res) => {
	try {
		const teacherId = String(req.body.teacherId || '').trim()
		const scheduledAtRaw = req.body.scheduledAt
		const studentNote = req.body.studentNote ? String(req.body.studentNote).trim().slice(0, 500) : undefined

		// Validate required fields.
		if (!teacherId || !mongoose.isValidObjectId(teacherId)) {
			return res.status(400).json({ message: 'Valid teacherId is required', field: 'teacherId' })
		}
		if (!scheduledAtRaw) {
			return res.status(400).json({ message: 'scheduledAt is required', field: 'scheduledAt' })
		}

		const scheduledAt = new Date(scheduledAtRaw)
		if (Number.isNaN(scheduledAt.getTime())) {
			return res.status(400).json({ message: 'scheduledAt is not a valid date', field: 'scheduledAt' })
		}

		// Ensure the requested time is one of the five valid slots (14:00 / 15:10 / 16:20 / 17:30 / 18:40 local).
		if (!isValidSlot(scheduledAt)) {
			return res.status(400).json({
				message:
					'scheduledAt must be a valid slot time (14:00, 15:10, 16:20, 17:30, or 18:40 local UTC+5). Use GET /api/extra-lessons/availability to see free slots.',
				field: 'scheduledAt',
			})
		}

		// Reject booking requests for past slots.
		if (scheduledAt <= new Date()) {
			return res.status(400).json({ message: 'Cannot book a lesson in the past', field: 'scheduledAt' })
		}

		// Confirm the teacher exists and is a support teacher.
		const teacher = await User.findById(teacherId).select('isExtraLessonSupport fullname')
		if (!teacher) {
			return res.status(404).json({ message: 'Teacher not found' })
		}
		if (!teacher.isExtraLessonSupport) {
			return res.status(400).json({ message: 'Specified user is not a support teacher' })
		}

		// Check for a slot conflict — another pending or confirmed lesson at the same time.
		const slotConflict = await ExtraLesson.findOne({
			assignedTeacher: teacherId,
			scheduledAt,
			status: { $in: ['pending_approval', 'confirmed'] },
		})
		if (slotConflict) {
			return res.status(409).json({
				message: 'This slot is already taken. Please choose another time or teacher.',
			})
		}

		// Enforce the daily cap — a teacher can handle at most MAX_LESSONS_PER_DAY per day.
		const localDateStr = (() => {
			const ms = scheduledAt.getTime() + TIMEZONE_OFFSET_MINUTES * 60 * 1000
			const d = new Date(ms)
			return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
		})()
		const { startUTC, endUTC } = getLocalDayUtcRange(localDateStr)
		const lessonsToday = await ExtraLesson.countDocuments({
			assignedTeacher: teacherId,
			scheduledAt: { $gte: startUTC, $lt: endUTC },
			status: { $in: ['pending_approval', 'confirmed'] },
		})
		if (lessonsToday >= MAX_LESSONS_PER_DAY) {
			return res.status(409).json({
				message: `This teacher is fully booked for ${localDateStr} (max ${MAX_LESSONS_PER_DAY} lessons per day).`,
			})
		}

		// Check the student isn't already enrolled in a lesson at the same time
		// (a student shouldn't book two lessons simultaneously).
		const studentConflict = await ExtraLesson.findOne({
			scheduledAt,
			'students.student': req.student._id,
			status: { $in: ['pending_approval', 'confirmed'] },
		})
		if (studentConflict) {
			return res.status(409).json({
				message: 'You already have a lesson booked at this time.',
			})
		}

		// Create the lesson in pending_approval state.
		// The booking student is automatically the first (and initially only) student.
		const lesson = await ExtraLesson.create({
			assignedTeacher: teacherId,
			scheduledAt,
			requestType: 'student_request',
			requestedBy: req.student._id,
			requestedByModel: 'Student',
			status: 'pending_approval',
			studentNote,
			students: [
				{
					student: req.student._id,
					addedBy: null, // student enrolled themselves
					addedAt: new Date(),
				},
			],
		})

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students.student', 'fullname studentPhone')
			.populate('requestedBy')

		return res.status(201).json({
			message: 'Booking request submitted. Waiting for teacher approval.',
			lesson: populated,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('bookLesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── STUDENT: MY LESSONS ──────────────────────────────────────────────────────

/**
 * GET /api/extra-lessons/my-lessons
 * Return the authenticated student's extra lessons (all statuses), newest first.
 * Supports pagination via ?page=&limit= query params.
 * Auth: student token.
 */
exports.getMyLessons = async (req, res) => {
	try {
		const page = Math.max(Number(req.query.page) || 1, 1)
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const skip = (page - 1) * limit

		// Optional status filter — useful for a student checking only pending requests.
		const query = { 'students.student': req.student._id }
		if (req.query.status) {
			const validStatuses = ['pending_approval', 'confirmed', 'cancelled', 'completed']
			if (!validStatuses.includes(req.query.status)) {
				return res.status(400).json({
					message: `status must be one of: ${validStatuses.join(', ')}`,
					field: 'status',
				})
			}
			query.status = req.query.status
		}

		const [lessons, total] = await Promise.all([
			ExtraLesson.find(query)
				.sort({ scheduledAt: -1 }) // most recent first
				.skip(skip)
				.limit(limit)
				.populate('assignedTeacher', 'fullname phone role imgURL'),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: lessons })
	} catch (error) {
		console.error('getMyLessons failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── TEACHER: PENDING REQUEST QUEUE ──────────────────────────────────────────

/**
 * GET /api/extra-lessons/requests
 * List pending booking requests.
 *   - Support teachers see only their own queue.
 *   - Admin / superadmin can see all (or filter by teacherId query param).
 * Auth: employee token.
 */
exports.listPendingRequests = async (req, res) => {
	try {
		const page = Math.max(Number(req.query.page) || 1, 1)
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const skip = (page - 1) * limit

		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)

		// Build the base query — always filter to pending_approval only.
		const query = { status: 'pending_approval' }

		if (!isAdmin) {
			// Non-admins only see their own requests.
			query.assignedTeacher = req.user._id
		} else if (req.query.teacherId) {
			// Admins can filter by teacher.
			if (!mongoose.isValidObjectId(req.query.teacherId)) {
				return res.status(400).json({ message: 'Invalid teacherId', field: 'teacherId' })
			}
			query.assignedTeacher = req.query.teacherId
		}

		const [requests, total] = await Promise.all([
			ExtraLesson.find(query)
				.sort({ scheduledAt: 1 }) // soonest first so teacher reviews urgent ones first
				.skip(skip)
				.limit(limit)
				.populate('assignedTeacher', 'fullname phone role')
				.populate('students.student', 'fullname studentPhone')
				.populate('requestedBy'),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: requests })
	} catch (error) {
		console.error('listPendingRequests failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── TEACHER: APPROVE / DENY / COMPLETE ──────────────────────────────────────

/**
 * PATCH /api/extra-lessons/:lessonId/approve
 * Approve a student's booking request → status becomes 'confirmed'.
 * The assigned teacher or admin can approve.
 *
 * Body: { teacherNote? }
 * Auth: employee token.
 */
exports.approveRequest = async (req, res) => {
	try {
		const { lessonId } = req.params

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		// Only the lesson's own teacher or an admin may approve.
		const isAssignedTeacher = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssignedTeacher && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can approve requests' })
		}

		if (lesson.status !== 'pending_approval') {
			return res.status(409).json({
				message: `Cannot approve a lesson that is already '${lesson.status}'`,
			})
		}

		// Re-check slot availability — another lesson might have been confirmed in the meantime.
		const slotConflict = await ExtraLesson.findOne({
			_id: { $ne: lesson._id }, // exclude this lesson itself
			assignedTeacher: lesson.assignedTeacher,
			scheduledAt: lesson.scheduledAt,
			status: 'confirmed',
		})
		if (slotConflict) {
			return res.status(409).json({
				message: 'Slot is no longer available — another lesson was confirmed for this time. Please deny this request.',
			})
		}

		lesson.status = 'confirmed'
		if (req.body.teacherNote) {
			lesson.teacherNote = String(req.body.teacherNote).trim().slice(0, 500)
		}
		await lesson.save()

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students.student', 'fullname studentPhone')
			.populate('requestedBy')

		return res.status(200).json({ message: 'Booking request approved', lesson: populated })
	} catch (error) {
		console.error('approveRequest failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * PATCH /api/extra-lessons/:lessonId/deny
 * Deny a student's booking request → status becomes 'cancelled'.
 * The assigned teacher or admin can deny.
 * `denialReason` is required so the student knows why their request was rejected.
 *
 * Body: { denialReason }
 * Auth: employee token.
 */
exports.denyRequest = async (req, res) => {
	try {
		const { lessonId } = req.params
		const denialReason = String(req.body.denialReason || '').trim()

		if (!denialReason) {
			return res.status(400).json({ message: 'denialReason is required when denying a request', field: 'denialReason' })
		}

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		// Only the lesson's own teacher or an admin may deny.
		const isAssignedTeacher = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssignedTeacher && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can deny requests' })
		}

		if (lesson.status !== 'pending_approval') {
			return res.status(409).json({
				message: `Cannot deny a lesson that is already '${lesson.status}'`,
			})
		}

		lesson.status = 'cancelled'
		lesson.denialReason = denialReason.slice(0, 500)
		if (req.body.teacherNote) {
			lesson.teacherNote = String(req.body.teacherNote).trim().slice(0, 500)
		}
		await lesson.save()

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students.student', 'fullname studentPhone')
			.populate('requestedBy')

		return res.status(200).json({ message: 'Booking request denied', lesson: populated })
	} catch (error) {
		console.error('denyRequest failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * PATCH /api/extra-lessons/:lessonId/complete
 * Mark a confirmed lesson as completed after it has taken place.
 * Only the assigned teacher or admin can do this.
 *
 * Auth: employee token.
 */
exports.markCompleted = async (req, res) => {
	try {
		const { lessonId } = req.params

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		// Only the lesson's own teacher or an admin may mark it complete.
		const isAssignedTeacher = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssignedTeacher && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can complete lessons' })
		}

		if (lesson.status !== 'confirmed') {
			return res.status(409).json({
				message: `Only confirmed lessons can be marked as completed (current status: '${lesson.status}')`,
			})
		}

		lesson.status = 'completed'
		if (req.body.teacherNote) {
			lesson.teacherNote = String(req.body.teacherNote).trim().slice(0, 500)
		}
		await lesson.save()

		return res.status(200).json({ message: 'Lesson marked as completed', lesson })
	} catch (error) {
		console.error('markCompleted failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── TEACHER: CREATE LESSON DIRECTLY ─────────────────────────────────────────

/**
 * POST /api/extra-lessons
 * Support teacher creates an extra lesson directly without a student request.
 * The lesson is immediately 'confirmed' — no approval step needed.
 *
 * Body: { scheduledAt, studentIds?, subject?, teacherNote?, room? }
 *   studentIds — optional array of 1–3 student ObjectIds to enroll immediately.
 *
 * Auth: employee token; the calling user must be an isExtraLessonSupport teacher
 *       (or admin/superadmin who can create on behalf of any teacher by passing assignedTeacherId).
 */
exports.createExtraLesson = async (req, res) => {
	try {
		const scheduledAtRaw = req.body.scheduledAt
		const subject = req.body.subject ? String(req.body.subject).trim() : undefined
		const teacherNote = req.body.teacherNote ? String(req.body.teacherNote).trim().slice(0, 500) : undefined
		const room = req.body.room ? String(req.body.room).trim() : undefined
		// Optional array of student IDs to pre-enroll.
		const rawStudentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : []

		// Validate scheduledAt presence and format.
		if (!scheduledAtRaw) {
			return res.status(400).json({ message: 'scheduledAt is required', field: 'scheduledAt' })
		}
		const scheduledAt = new Date(scheduledAtRaw)
		if (Number.isNaN(scheduledAt.getTime())) {
			return res.status(400).json({ message: 'scheduledAt is not a valid date', field: 'scheduledAt' })
		}

		// Validate the slot is one of the five permitted daily times.
		if (!isValidSlot(scheduledAt)) {
			return res.status(400).json({
				message:
					'scheduledAt must be a valid slot time (14:00, 15:10, 16:20, 17:30, or 18:40 local UTC+5).',
				field: 'scheduledAt',
			})
		}

		// Determine which teacher this lesson is assigned to.
		// Admins can pass an optional assignedTeacherId; support teachers use themselves.
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		let assignedTeacherId

		if (isAdmin && req.body.assignedTeacherId) {
			// Admin creates on behalf of a specific teacher.
			const tid = String(req.body.assignedTeacherId).trim()
			if (!mongoose.isValidObjectId(tid)) {
				return res.status(400).json({ message: 'Invalid assignedTeacherId', field: 'assignedTeacherId' })
			}
			assignedTeacherId = tid
		} else {
			// The caller must be a support teacher.
			if (!req.userDocument.isExtraLessonSupport) {
				return res.status(403).json({
					message: 'Only support teachers or admin can create extra lessons directly',
				})
			}
			assignedTeacherId = req.user._id.toString()
		}

		// Confirm the assigned teacher is a support teacher.
		const teacher = await User.findById(assignedTeacherId).select('isExtraLessonSupport fullname')
		if (!teacher) {
			return res.status(404).json({ message: 'Assigned teacher not found' })
		}
		if (!teacher.isExtraLessonSupport) {
			return res.status(403).json({ message: 'Assigned teacher is not a support teacher' })
		}

		// Check slot conflict.
		const slotConflict = await ExtraLesson.findOne({
			assignedTeacher: assignedTeacherId,
			scheduledAt,
			status: { $in: ['pending_approval', 'confirmed'] },
		})
		if (slotConflict) {
			return res.status(409).json({ message: 'This slot is already taken for the selected teacher.' })
		}

		// Enforce daily cap.
		const localDateStr = (() => {
			const ms = scheduledAt.getTime() + TIMEZONE_OFFSET_MINUTES * 60 * 1000
			const d = new Date(ms)
			return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
		})()
		const { startUTC, endUTC } = getLocalDayUtcRange(localDateStr)
		const lessonsToday = await ExtraLesson.countDocuments({
			assignedTeacher: assignedTeacherId,
			scheduledAt: { $gte: startUTC, $lt: endUTC },
			status: { $in: ['pending_approval', 'confirmed'] },
		})
		if (lessonsToday >= MAX_LESSONS_PER_DAY) {
			return res.status(409).json({
				message: `Teacher is fully booked for ${localDateStr} (max ${MAX_LESSONS_PER_DAY} lessons per day).`,
			})
		}

		// Validate the provided student IDs if any.
		if (rawStudentIds.length > MAX_STUDENTS_PER_LESSON) {
			return res.status(400).json({
				message: `Cannot add more than ${MAX_STUDENTS_PER_LESSON} students per lesson`,
				field: 'studentIds',
			})
		}

		const uniqueStudentIds = [...new Set(rawStudentIds.map(id => String(id).trim()))]
		for (const sid of uniqueStudentIds) {
			if (!mongoose.isValidObjectId(sid)) {
				return res.status(400).json({ message: `Invalid student id: ${sid}`, field: 'studentIds' })
			}
		}

		// Verify all student documents exist before creating the lesson.
		const studentDocs = await Student.find({ _id: { $in: uniqueStudentIds } }).select('_id')
		if (studentDocs.length !== uniqueStudentIds.length) {
			return res.status(404).json({ message: 'One or more student ids were not found', field: 'studentIds' })
		}

		// Build the students subdoc array — teacher is the addedBy.
		const studentsArr = uniqueStudentIds.map(sid => ({
			student: sid,
			addedBy: req.user._id,
			addedAt: new Date(),
		}))

		// Create lesson as confirmed — no approval needed when teacher creates directly.
		const lesson = await ExtraLesson.create({
			assignedTeacher: assignedTeacherId,
			scheduledAt,
			requestType: 'teacher_created',
			requestedBy: req.user._id,
			requestedByModel: 'User',
			status: 'confirmed',
			subject,
			teacherNote,
			room,
			students: studentsArr,
		})

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students.student', 'fullname studentPhone')
			.populate('requestedBy', 'fullname role')

		return res.status(201).json({ message: 'Extra lesson created', lesson: populated })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('createExtraLesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── ADMIN / EMPLOYEE: LIST & GET ────────────────────────────────────────────

/**
 * GET /api/extra-lessons
 * List all extra lessons with optional filters. Paginated.
 *
 * Query params: status, teacherId, date (YYYY-MM-DD local), page, limit.
 * Auth: employee token with groups:read permission.
 */
exports.listExtraLessons = async (req, res) => {
	try {
		const page = Math.max(Number(req.query.page) || 1, 1)
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const skip = (page - 1) * limit

		const query = {}

		// Filter by lifecycle status.
		if (req.query.status) {
			const validStatuses = ['pending_approval', 'confirmed', 'cancelled', 'completed']
			if (!validStatuses.includes(req.query.status)) {
				return res.status(400).json({ message: `status must be one of: ${validStatuses.join(', ')}`, field: 'status' })
			}
			query.status = req.query.status
		}

		// Filter by assigned support teacher.
		if (req.query.teacherId) {
			if (!mongoose.isValidObjectId(req.query.teacherId)) {
				return res.status(400).json({ message: 'Invalid teacherId', field: 'teacherId' })
			}
			query.assignedTeacher = req.query.teacherId
		}

		// Filter by local calendar date (YYYY-MM-DD).
		if (req.query.date) {
			const out = {}
			const err = parseDateParam(req.query.date, out)
			if (err) return res.status(400).json({ message: err, field: 'date' })
			const { startUTC, endUTC } = getLocalDayUtcRange(out.date)
			query.scheduledAt = { $gte: startUTC, $lt: endUTC }
		}

		const [lessons, total] = await Promise.all([
			ExtraLesson.find(query)
				.sort({ scheduledAt: 1 })
				.skip(skip)
				.limit(limit)
				.populate('assignedTeacher', 'fullname phone role')
				.populate('students.student', 'fullname studentPhone')
				.populate('requestedBy'),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: lessons })
	} catch (error) {
		console.error('listExtraLessons failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * GET /api/extra-lessons/:lessonId
 * Get full details for a single extra lesson.
 * Auth: employee token.
 */
exports.getExtraLessonById = async (req, res) => {
	try {
		const { lessonId } = req.params

		const lesson = await ExtraLesson.findById(lessonId)
			.populate('assignedTeacher', 'fullname phone role imgURL')
			.populate('students.student', 'fullname studentPhone parentPhone gender')
			.populate('students.addedBy', 'fullname role')
			.populate('requestedBy')

		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		return res.status(200).json({ lesson })
	} catch (error) {
		console.error('getExtraLessonById failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── UPDATE & DELETE ──────────────────────────────────────────────────────────

/**
 * PATCH /api/extra-lessons/:lessonId
 * Update mutable fields of an extra lesson.
 * Only the assigned teacher or admin/superadmin may update.
 * Cannot reschedule a completed or cancelled lesson.
 *
 * Body (all optional): subject, teacherNote, room, scheduledAt (admin only).
 * Auth: employee token.
 */
exports.updateExtraLesson = async (req, res) => {
	try {
		const { lessonId } = req.params

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		const isAssignedTeacher = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssignedTeacher && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can update this lesson' })
		}

		// Cannot modify finished lessons.
		if (['completed', 'cancelled'].includes(lesson.status)) {
			return res.status(409).json({ message: `Cannot edit a lesson that is already '${lesson.status}'` })
		}

		// Mutable fields available to teachers.
		if (typeof req.body.subject !== 'undefined') {
			lesson.subject = String(req.body.subject || '').trim().slice(0, 120)
		}
		if (typeof req.body.teacherNote !== 'undefined') {
			lesson.teacherNote = String(req.body.teacherNote || '').trim().slice(0, 500)
		}
		if (typeof req.body.room !== 'undefined') {
			lesson.room = String(req.body.room || '').trim().slice(0, 100)
		}

		// Rescheduling is an admin-only operation to prevent abuse.
		if (typeof req.body.scheduledAt !== 'undefined') {
			if (!isAdmin) {
				return res.status(403).json({ message: 'Only admin can reschedule a lesson' })
			}
			const parsed = new Date(req.body.scheduledAt)
			if (Number.isNaN(parsed.getTime())) {
				return res.status(400).json({ message: 'Invalid scheduledAt date', field: 'scheduledAt' })
			}
			if (!isValidSlot(parsed)) {
				return res.status(400).json({
					message: 'scheduledAt must be a valid slot time (14:00, 15:10, 16:20, 17:30, or 18:40 local UTC+5).',
					field: 'scheduledAt',
				})
			}
			// Check the new slot isn't already taken.
			const conflict = await ExtraLesson.findOne({
				_id: { $ne: lesson._id },
				assignedTeacher: lesson.assignedTeacher,
				scheduledAt: parsed,
				status: { $in: ['pending_approval', 'confirmed'] },
			})
			if (conflict) {
				return res.status(409).json({ message: 'New slot is already taken' })
			}
			lesson.scheduledAt = parsed
		}

		await lesson.save()

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students.student', 'fullname studentPhone')
			.populate('requestedBy')

		return res.status(200).json({ message: 'Extra lesson updated', lesson: populated })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('updateExtraLesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * DELETE /api/extra-lessons/:lessonId
 * Hard-delete an extra lesson. Only admin/superadmin may do this.
 * Auth: employee token (admin or superadmin role).
 */
exports.deleteExtraLesson = async (req, res) => {
	try {
		const { lessonId } = req.params

		const lesson = await ExtraLesson.findByIdAndDelete(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		return res.status(200).json({ message: 'Extra lesson deleted' })
	} catch (error) {
		console.error('deleteExtraLesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── STUDENT ENROLLMENT MANAGEMENT ───────────────────────────────────────────

/**
 * POST /api/extra-lessons/:lessonId/students
 * Add one or more students to an existing lesson.
 * The teacher can add up to MAX_STUDENTS_PER_LESSON total (including the booking student).
 *
 * Body: { studentIds: string[] }  — array of 1–3 student ObjectIds.
 * Auth: employee token (assigned teacher or admin).
 */
exports.addStudents = async (req, res) => {
	try {
		const { lessonId } = req.params
		const rawIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : []

		if (rawIds.length === 0) {
			return res.status(400).json({ message: 'studentIds array is required and must not be empty', field: 'studentIds' })
		}

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		// Only the assigned teacher or admin can add students to a lesson.
		const isAssignedTeacher = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssignedTeacher && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can add students' })
		}

		// Cannot add students to cancelled/completed lessons.
		if (['cancelled', 'completed'].includes(lesson.status)) {
			return res.status(409).json({ message: `Cannot add students to a lesson that is '${lesson.status}'` })
		}

		// Deduplicate and validate each provided id.
		const uniqueIds = [...new Set(rawIds.map(id => String(id).trim()))]
		for (const sid of uniqueIds) {
			if (!mongoose.isValidObjectId(sid)) {
				return res.status(400).json({ message: `Invalid student id: ${sid}`, field: 'studentIds' })
			}
		}

		// Filter out students already enrolled so we don't duplicate.
		const alreadyEnrolled = new Set(lesson.students.map(e => e.student.toString()))
		const toAdd = uniqueIds.filter(id => !alreadyEnrolled.has(id))

		if (toAdd.length === 0) {
			return res.status(409).json({ message: 'All provided students are already enrolled in this lesson' })
		}

		// Enforce the per-lesson student cap.
		const newTotal = lesson.students.length + toAdd.length
		if (newTotal > MAX_STUDENTS_PER_LESSON) {
			return res.status(409).json({
				message: `Cannot exceed ${MAX_STUDENTS_PER_LESSON} students per lesson. Currently enrolled: ${lesson.students.length}, trying to add: ${toAdd.length}.`,
			})
		}

		// Verify all student documents exist.
		const studentDocs = await Student.find({ _id: { $in: toAdd } }).select('_id')
		if (studentDocs.length !== toAdd.length) {
			return res.status(404).json({ message: 'One or more student ids were not found', field: 'studentIds' })
		}

		// Append new students to the lesson; record who added them.
		const now = new Date()
		for (const sid of toAdd) {
			lesson.students.push({ student: sid, addedBy: req.user._id, addedAt: now })
		}
		await lesson.save()

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students.student', 'fullname studentPhone')
			.populate('students.addedBy', 'fullname role')

		return res.status(200).json({
			message: `${toAdd.length} student(s) added to the lesson`,
			lesson: populated,
		})
	} catch (error) {
		console.error('addStudents failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

/**
 * DELETE /api/extra-lessons/:lessonId/students/:studentId
 * Remove a single student from a lesson.
 * The assigned teacher or admin can remove; a student can remove themselves
 * (handled by checking req.student if the student token is used — but this
 * route uses employee auth, so only teachers/admin via this endpoint).
 * Auth: employee token (assigned teacher or admin).
 */
exports.removeStudent = async (req, res) => {
	try {
		const { lessonId, studentId } = req.params

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		// Only the assigned teacher or admin can remove students.
		const isAssignedTeacher = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssignedTeacher && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can remove students' })
		}

		const before = lesson.students.length
		lesson.students = lesson.students.filter(e => e.student.toString() !== studentId)

		if (lesson.students.length === before) {
			return res.status(404).json({ message: 'Student is not enrolled in this lesson' })
		}

		await lesson.save()

		return res.status(200).json({ message: 'Student removed from extra lesson' })
	} catch (error) {
		console.error('removeStudent failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
