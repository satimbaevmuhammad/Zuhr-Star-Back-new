const mongoose = require('mongoose')

const {
	ExtraLesson,
	MAX_LESSONS_PER_DAY,
	TIMEZONE_OFFSET_MINUTES,
	VALID_SLOT_TIMES_LOCAL,
	MAX_STUDENTS_PER_LESSON,
} = require('../model/extra-lesson.model')
const User = require('../model/user.model')
const Student = require('../model/student.model')
const Group = require('../model/group.model')

const TIMEZONE_OFFSET_MS = TIMEZONE_OFFSET_MINUTES * 60 * 1000
const SLOT_SET = new Set(VALID_SLOT_TIMES_LOCAL)
const MANAGER_ROLES = new Set(['admin', 'superadmin', 'headteacher'])
const TERMINAL_STATUSES = new Set(['cancelled', 'completed'])

const sendError = (res, status, message, code, field = null) => {
	return res.status(status).json({ message, code, field })
}

const createHttpError = (status, message, code, field = null) => {
	const error = new Error(message)
	error.statusCode = status
	error.code = code
	error.field = field
	return error
}

const isHttpError = error => Boolean(error && Number.isInteger(error.statusCode) && error.code)

const handleControllerError = (res, error, logLabel) => {
	if (isHttpError(error)) {
		return sendError(res, error.statusCode, error.message, error.code, error.field)
	}

	if (error && error.name === 'ValidationError') {
		const first = Object.values(error.errors || {})[0]
		const message = String(first?.message || 'Validation failed')
		const field = String(first?.path || '').trim() || null
		return sendError(res, 400, message, 'BAD_REQUEST', field)
	}

	console.error(`${logLabel} failed:`, error)
	return sendError(res, 500, 'Internal server error', 'INTERNAL_SERVER_ERROR')
}

const isRoleManager = role => MANAGER_ROLES.has(String(role || '').trim())

const parseObjectIdString = value => String(value || '').trim()

const parseLocalDateInput = rawValue => {
	const value = String(rawValue || '').trim()
	if (!value) {
		return null
	}

	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/)
	if (!match) {
		return null
	}

	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))

	if (
		Number.isNaN(probe.getTime()) ||
		probe.getUTCFullYear() !== year ||
		probe.getUTCMonth() + 1 !== month ||
		probe.getUTCDate() !== day
	) {
		return null
	}

	return `${match[1]}-${match[2]}-${match[3]}`
}

const normalizeSlotInput = rawValue => {
	const value = String(rawValue || '').trim()
	if (!value) {
		return null
	}

	const match = value.match(/^(\d{2}):(\d{2})$/)
	if (!match) {
		return null
	}

	const hour = Number(match[1])
	const minute = Number(match[2])
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		return null
	}

	return `${match[1]}:${match[2]}`
}

const pad2 = value => String(value).padStart(2, '0')

const getTodayLocalDateString = () => {
	const localDate = new Date(Date.now() + TIMEZONE_OFFSET_MS)
	return `${localDate.getUTCFullYear()}-${pad2(localDate.getUTCMonth() + 1)}-${pad2(localDate.getUTCDate())}`
}

const localDateToUtcRange = localDate => {
	const [year, month, day] = localDate.split('-').map(Number)
	const startLocalMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
	const startUtc = new Date(startLocalMs - TIMEZONE_OFFSET_MS)
	const endUtc = new Date(startLocalMs + 24 * 60 * 60 * 1000 - TIMEZONE_OFFSET_MS)
	return { startUtc, endUtc }
}

const localDateAndSlotToUtcDate = (localDate, slot) => {
	const [year, month, day] = localDate.split('-').map(Number)
	const [hour, minute] = slot.split(':').map(Number)
	const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - TIMEZONE_OFFSET_MS
	return new Date(utcMs)
}

const utcDateToLocalDate = utcDate => {
	const localDate = new Date(utcDate.getTime() + TIMEZONE_OFFSET_MS)
	return `${localDate.getUTCFullYear()}-${pad2(localDate.getUTCMonth() + 1)}-${pad2(localDate.getUTCDate())}`
}

const utcDateToLocalSlot = utcDate => {
	const localDate = new Date(utcDate.getTime() + TIMEZONE_OFFSET_MS)
	return `${pad2(localDate.getUTCHours())}:${pad2(localDate.getUTCMinutes())}`
}

const isSlotDateInPast = scheduledAt => {
	const nowLocalMs = Date.now() + TIMEZONE_OFFSET_MS
	const scheduledLocalMs = scheduledAt.getTime() + TIMEZONE_OFFSET_MS
	return scheduledLocalMs <= nowLocalMs
}

const parseScheduledAtInput = rawValue => {
	if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
		return new Date(rawValue.getTime())
	}

	const value = String(rawValue || '').trim()
	if (!value) {
		return null
	}

	if (/(?:Z|[+\-]\d{2}:\d{2})$/i.test(value)) {
		const parsed = new Date(value)
		return Number.isNaN(parsed.getTime()) ? null : parsed
	}

	const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/)
	if (!match) {
		return null
	}

	const year = Number(match[1])
	const month = Number(match[2])
	const day = Number(match[3])
	const hour = Number(match[4])
	const minute = Number(match[5])
	const second = Number(match[6] || 0)

	const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0))
	if (
		Number.isNaN(probe.getTime()) ||
		probe.getUTCFullYear() !== year ||
		probe.getUTCMonth() + 1 !== month ||
		probe.getUTCDate() !== day
	) {
		return null
	}

	if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
		return null
	}

	const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, 0) - TIMEZONE_OFFSET_MS
	return new Date(utcMs)
}

const isAllowedUtcSlotDate = scheduledAt => {
	if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
		return false
	}

	const localDate = new Date(scheduledAt.getTime() + TIMEZONE_OFFSET_MS)
	if (localDate.getUTCSeconds() !== 0 || localDate.getUTCMilliseconds() !== 0) {
		return false
	}

	const slot = `${pad2(localDate.getUTCHours())}:${pad2(localDate.getUTCMinutes())}`
	return SLOT_SET.has(slot)
}

const resolveScheduleFromDateAndSlot = (dateValue, slotValue) => {
	const localDate = parseLocalDateInput(dateValue)
	if (!localDate) {
		throw createHttpError(400, 'date must be a valid ISO date string', 'BAD_REQUEST', 'date')
	}

	const slot = normalizeSlotInput(slotValue)
	if (!slot || !SLOT_SET.has(slot)) {
		throw createHttpError(400, 'Invalid time slot', 'INVALID_SLOT', 'slot')
	}

	return {
		localDate,
		slot,
		scheduledAt: localDateAndSlotToUtcDate(localDate, slot),
	}
}

const resolveScheduleFromBody = ({ date, slot, scheduledAt }) => {
	const hasDateOrSlot = typeof date !== 'undefined' || typeof slot !== 'undefined'

	if (hasDateOrSlot) {
		if (typeof date === 'undefined') {
			throw createHttpError(400, 'date is required', 'BAD_REQUEST', 'date')
		}
		if (typeof slot === 'undefined') {
			throw createHttpError(400, 'slot is required', 'BAD_REQUEST', 'slot')
		}
		return resolveScheduleFromDateAndSlot(date, slot)
	}

	const parsed = parseScheduledAtInput(scheduledAt)
	if (!parsed || !isAllowedUtcSlotDate(parsed)) {
		throw createHttpError(400, 'Invalid time slot', 'INVALID_SLOT', 'scheduledAt')
	}

	return {
		localDate: utcDateToLocalDate(parsed),
		slot: utcDateToLocalSlot(parsed),
		scheduledAt: parsed,
	}
}

const applySession = (query, session) => {
	if (session) {
		return query.session(session)
	}
	return query
}

const runWithOptionalTransaction = async work => {
	let session = null
	try {
		session = await mongoose.startSession()
	} catch (error) {
		return work(null)
	}

	if (!session || typeof session.withTransaction !== 'function') {
		if (session) {
			await session.endSession().catch(() => {})
		}
		return work(null)
	}

	try {
		let result
		await session.withTransaction(async () => {
			result = await work(session)
		})
		return result
	} catch (error) {
		const message = String(error?.message || '')
		if (
			message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
			message.includes('replica set')
		) {
			return work(null)
		}
		throw error
	} finally {
		await session.endSession().catch(() => {})
	}
}

const populateLessonQuery = query => {
	return query
		.populate('assignedTeacher', 'fullname phone role imgURL isExtraLessonSupport')
		.populate('students.student', 'fullname studentPhone parentPhone gender')
		.populate('students.addedBy', 'fullname role')
		.populate('requestedBy')
		.populate('approvedBy', 'fullname role')
		.populate('deniedBy', 'fullname role')
		.populate('completedBy', 'fullname role')
}

const getPopulatedLessonById = lessonId => {
	return populateLessonQuery(ExtraLesson.findById(lessonId))
}

const assertTeacherDailyLimit = async ({ teacherId, localDate, session, excludeLessonId = null }) => {
	const { startUtc, endUtc } = localDateToUtcRange(localDate)
	const filter = {
		assignedTeacher: teacherId,
		scheduledAt: { $gte: startUtc, $lt: endUtc },
		status: { $ne: 'cancelled' },
	}
	if (excludeLessonId) {
		filter._id = { $ne: excludeLessonId }
	}

	const countQuery = ExtraLesson.countDocuments(filter)
	applySession(countQuery, session)
	const count = await countQuery
	if (count >= MAX_LESSONS_PER_DAY) {
		throw createHttpError(409, 'Teacher daily limit reached', 'TEACHER_LIMIT')
	}
}

const assertSupportTeacher = async ({ teacherId, session }) => {
	const teacherQuery = User.findById(teacherId).select('fullname role isExtraLessonSupport')
	applySession(teacherQuery, session)
	const teacher = await teacherQuery

	if (!teacher) {
		throw createHttpError(404, 'Teacher not found', 'NOT_FOUND', 'teacherId')
	}
	if (teacher.role !== 'supporteacher') {
		throw createHttpError(400, 'Specified user must have supporteacher role', 'BAD_REQUEST', 'teacherId')
	}
	if (!teacher.isExtraLessonSupport) {
		throw createHttpError(400, 'Specified user is not a support teacher', 'BAD_REQUEST', 'teacherId')
	}

	return teacher
}

const canManageLesson = (lesson, user) => {
	const actorId = String(user?._id || user?.id || '')
	return String(lesson.assignedTeacher) === actorId || isRoleManager(user?.role)
}

const ensureLessonExists = async lessonId => {
	const lesson = await ExtraLesson.findById(lessonId)
	if (!lesson) {
		throw createHttpError(404, 'Extra lesson not found', 'NOT_FOUND')
	}
	return lesson
}

const getGroupSupporteacherIds = group => {
	const supporteacherIds = []
	if (!Array.isArray(group?.supportTeachers)) {
		return supporteacherIds
	}

	for (const teacherId of group.supportTeachers) {
		const normalizedTeacherId = parseObjectIdString(teacherId)
		if (normalizedTeacherId) {
			supporteacherIds.push(normalizedTeacherId)
		}
	}

	return supporteacherIds
}

const getStudentSupporteacherIds = async studentId => {
	const groups = await Group.find({ students: studentId }).select('supportTeachers').lean()
	const teacherIdSet = new Set()

	for (const group of groups) {
		const groupTeacherIds = getGroupSupporteacherIds(group)
		for (const teacherId of groupTeacherIds) {
			if (mongoose.isValidObjectId(teacherId)) {
				teacherIdSet.add(teacherId)
			}
		}
	}

	const candidateTeacherIds = [...teacherIdSet]
	if (candidateTeacherIds.length === 0) {
		return []
	}

	const allowedSupporteacherUsers = await User.find({
		_id: { $in: candidateTeacherIds },
		role: 'supporteacher',
	})
		.select('_id')
		.lean()

	return allowedSupporteacherUsers.map(user => String(user._id))
}

exports.listSupportTeachers = async (req, res) => {
	try {
		const teachers = await User.find({ isExtraLessonSupport: true }).select(
			'fullname phone email role imgURL isExtraLessonSupport',
		)
		return res.status(200).json({
			total: teachers.length,
			data: teachers,
		})
	} catch (error) {
		return handleControllerError(res, error, 'listSupportTeachers')
	}
}

exports.assignSupportTeacher = async (req, res) => {
	try {
		const userId = parseObjectIdString(req.params.userId)

		const assignedUser = await runWithOptionalTransaction(async session => {
			const updateQuery = User.findOneAndUpdate(
				{ _id: userId, isExtraLessonSupport: false },
				{ $set: { isExtraLessonSupport: true } },
				{ new: true },
			)
			applySession(updateQuery, session)
			const updated = await updateQuery
			if (updated) {
				return updated
			}

			const existingQuery = User.findById(userId)
			applySession(existingQuery, session)
			const existing = await existingQuery
			if (!existing) {
				throw createHttpError(404, 'User not found', 'NOT_FOUND', 'userId')
			}
			if (existing.isExtraLessonSupport) {
				throw createHttpError(409, 'User is already a support teacher', 'CONFLICT')
			}

			throw createHttpError(409, 'Could not assign support teacher', 'CONFLICT')
		})

		return res.status(200).json({
			message: 'User assigned as extra lesson support teacher',
			user: {
				_id: assignedUser._id,
				fullname: assignedUser.fullname,
				phone: assignedUser.phone,
				role: assignedUser.role,
				isExtraLessonSupport: assignedUser.isExtraLessonSupport,
			},
		})
	} catch (error) {
		return handleControllerError(res, error, 'assignSupportTeacher')
	}
}

exports.removeSupportTeacher = async (req, res) => {
	try {
		const userId = parseObjectIdString(req.params.userId)
		const user = await User.findById(userId)
		if (!user) {
			return sendError(res, 404, 'User not found', 'NOT_FOUND', 'userId')
		}
		if (!user.isExtraLessonSupport) {
			return sendError(res, 400, 'User is not a support teacher', 'BAD_REQUEST')
		}

		user.isExtraLessonSupport = false
		await user.save()

		return res.status(200).json({ message: 'User removed from extra lesson support teachers' })
	} catch (error) {
		return handleControllerError(res, error, 'removeSupportTeacher')
	}
}

exports.getAvailability = async (req, res) => {
	try {
		const studentId = parseObjectIdString(req.student?._id)
		if (!studentId || !mongoose.isValidObjectId(studentId)) {
			return sendError(res, 401, 'Invalid student token', 'UNAUTHORIZED')
		}

		const localDate = req.query.date
			? parseLocalDateInput(req.query.date)
			: getTodayLocalDateString()
		if (!localDate) {
			return sendError(res, 400, 'date must be in YYYY-MM-DD format', 'BAD_REQUEST', 'date')
		}

		const supporteacherIds = await getStudentSupporteacherIds(studentId)
		if (supporteacherIds.length === 0) {
			return res.status(403).json({
				message: "You can only book extra lessons with your own group's support teacher",
				code: 'FORBIDDEN_SUPPORT_TEACHER',
			})
		}
		const requestedTeacherId = parseObjectIdString(req.query.teacherId)
		let teacherId = requestedTeacherId

		if (requestedTeacherId) {
			if (!mongoose.isValidObjectId(requestedTeacherId)) {
				return sendError(res, 400, 'Valid teacherId query param is required', 'BAD_REQUEST', 'teacherId')
			}
			if (!supporteacherIds.includes(requestedTeacherId)) {
				return res.status(403).json({
					message: "You can only book extra lessons with your own group's support teacher",
					code: 'FORBIDDEN_SUPPORT_TEACHER',
				})
			}
		} else if (supporteacherIds.length === 1) {
			teacherId = supporteacherIds[0]
		} else {
			return sendError(res, 400, 'Valid teacherId query param is required', 'BAD_REQUEST', 'teacherId')
		}

		const teacher = await User.findById(teacherId).select('fullname')
		if (!teacher) {
			return sendError(res, 404, 'Teacher not found', 'NOT_FOUND', 'teacherId')
		}

		const { startUtc, endUtc } = localDateToUtcRange(localDate)
		const lessons = await ExtraLesson.find({
			assignedTeacher: teacherId,
			scheduledAt: { $gte: startUtc, $lt: endUtc },
			status: { $ne: 'cancelled' },
		}).select('scheduledAt')

		const slotBookingCounts = new Map()
		for (const lesson of lessons) {
			const slot = utcDateToLocalSlot(lesson.scheduledAt)
			slotBookingCounts.set(slot, (slotBookingCounts.get(slot) || 0) + 1)
		}

		const slots = VALID_SLOT_TIMES_LOCAL.map(slot => {
			const scheduledAt = localDateAndSlotToUtcDate(localDate, slot)
			const bookedCount = slotBookingCounts.get(slot) || 0
			return {
				slot,
				bookedCount,
				available: bookedCount === 0 && !isSlotDateInPast(scheduledAt),
			}
		})

		return res.status(200).json({
			teacherId,
			date: localDate,
			slots,
		})
	} catch (error) {
		return handleControllerError(res, error, 'getAvailability')
	}
}

exports.bookLesson = async (req, res) => {
	try {
		const teacherId = parseObjectIdString(req.body.teacherId)
		if (!teacherId || !mongoose.isValidObjectId(teacherId)) {
			return sendError(res, 400, 'Valid teacherId is required', 'BAD_REQUEST', 'teacherId')
		}

		const studentId = String(req.student?._id || '')
		if (!studentId) {
			return sendError(res, 401, 'Invalid student token', 'UNAUTHORIZED')
		}

		const supporteacherIds = await getStudentSupporteacherIds(studentId)
		if (!supporteacherIds.includes(teacherId)) {
			return res.status(403).json({
				message: "You can only book extra lessons with your own group's support teacher",
				code: 'FORBIDDEN_SUPPORT_TEACHER',
			})
		}

		if (
			typeof req.body.date === 'undefined' &&
			typeof req.body.slot === 'undefined' &&
			typeof req.body.scheduledAt === 'undefined'
		) {
			return sendError(res, 400, 'date and slot are required', 'BAD_REQUEST', 'date')
		}

		let schedule
		try {
			schedule = resolveScheduleFromBody(req.body)
		} catch (error) {
			if (isHttpError(error)) {
				return sendError(res, error.statusCode, error.message, error.code, error.field)
			}
			throw error
		}

		if (isSlotDateInPast(schedule.scheduledAt)) {
			return sendError(res, 400, 'Cannot book a lesson in the past', 'PAST_SLOT', 'date')
		}

		await assertSupportTeacher({ teacherId })

		const studentNote = req.body.studentNote ? String(req.body.studentNote).trim().slice(0, 500) : undefined

		const result = await runWithOptionalTransaction(async session => {
			const existingQuery = ExtraLesson.findOne({
				assignedTeacher: teacherId,
				scheduledAt: schedule.scheduledAt,
				status: { $ne: 'cancelled' },
			}).select('students')
			applySession(existingQuery, session)
			const existingLesson = await existingQuery

			if (existingLesson) {
				const alreadyBooked = existingLesson.students.some(entry => String(entry.student) === studentId)
				if (alreadyBooked) {
					throw createHttpError(409, 'Already booked', 'DUPLICATE_BOOKING')
				}

				if (existingLesson.students.length >= MAX_STUDENTS_PER_LESSON) {
					throw createHttpError(409, 'Lesson is full', 'LESSON_FULL')
				}

				const updateQuery = ExtraLesson.findOneAndUpdate(
					{
						_id: existingLesson._id,
						'students.student': { $ne: studentId },
						[`students.${MAX_STUDENTS_PER_LESSON - 1}`]: { $exists: false },
					},
					{
						$push: {
							students: {
								student: studentId,
								addedBy: null,
								addedAt: new Date(),
							},
						},
						$set: { updatedAt: new Date() },
					},
					{ new: true },
				)
				applySession(updateQuery, session)
				const updated = await updateQuery
				if (!updated) {
					const latestQuery = ExtraLesson.findById(existingLesson._id).select('students')
					applySession(latestQuery, session)
					const latest = await latestQuery
					if (latest && latest.students.some(entry => String(entry.student) === studentId)) {
						throw createHttpError(409, 'Already booked', 'DUPLICATE_BOOKING')
					}
					throw createHttpError(409, 'Lesson is full', 'LESSON_FULL')
				}

				return {
					created: false,
					lessonId: updated._id,
				}
			}

			await assertTeacherDailyLimit({
				teacherId,
				localDate: schedule.localDate,
				session,
			})

			const payload = {
				assignedTeacher: teacherId,
				scheduledAt: schedule.scheduledAt,
				requestType: 'student_request',
				requestedBy: studentId,
				requestedByModel: 'Student',
				status: 'pending_approval',
				studentNote,
				students: [
					{
						student: studentId,
						addedBy: null,
						addedAt: new Date(),
					},
				],
			}

			let createdLesson
			if (session) {
				const createdDocs = await ExtraLesson.create([payload], { session })
				createdLesson = createdDocs[0]
			} else {
				createdLesson = await ExtraLesson.create(payload)
			}

			return {
				created: true,
				lessonId: createdLesson._id,
			}
		})

		const lesson = await getPopulatedLessonById(result.lessonId)
		return res.status(result.created ? 201 : 200).json({ lesson })
	} catch (error) {
		return handleControllerError(res, error, 'bookLesson')
	}
}

exports.getMyLessons = async (req, res) => {
	try {
		const page = Math.max(Number(req.query.page) || 1, 1)
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const skip = (page - 1) * limit

		const query = { 'students.student': req.student._id }
		if (req.query.status) {
			const status = String(req.query.status).trim()
			if (!['pending_approval', 'confirmed', 'cancelled', 'completed'].includes(status)) {
				return sendError(
					res,
					400,
					'status must be one of: pending_approval, confirmed, cancelled, completed',
					'BAD_REQUEST',
					'status',
				)
			}
			query.status = status
		}

		const [lessons, total] = await Promise.all([
			populateLessonQuery(ExtraLesson.find(query).sort({ scheduledAt: -1 }).skip(skip).limit(limit)),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: lessons })
	} catch (error) {
		return handleControllerError(res, error, 'getMyLessons')
	}
}

exports.listPendingRequests = async (req, res) => {
	try {
		const page = Math.max(Number(req.query.page) || 1, 1)
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const skip = (page - 1) * limit

		const query = { status: 'pending_approval' }
		const userId = String(req.user?._id || req.user?.id || '')

		if (!isRoleManager(req.user.role)) {
			query.assignedTeacher = userId
		} else if (req.query.teacherId) {
			const teacherId = parseObjectIdString(req.query.teacherId)
			if (!mongoose.isValidObjectId(teacherId)) {
				return sendError(res, 400, 'Invalid teacherId', 'BAD_REQUEST', 'teacherId')
			}
			query.assignedTeacher = teacherId
		}

		const [requests, total] = await Promise.all([
			populateLessonQuery(ExtraLesson.find(query).sort({ scheduledAt: 1 }).skip(skip).limit(limit)),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: requests })
	} catch (error) {
		return handleControllerError(res, error, 'listPendingRequests')
	}
}

exports.approveRequest = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const lesson = await ensureLessonExists(lessonId)

		if (!canManageLesson(lesson, req.user)) {
			return sendError(res, 403, 'Only the assigned teacher or admin can approve requests', 'FORBIDDEN')
		}

		const teacherNote =
			typeof req.body.teacherNote === 'undefined'
				? undefined
				: String(req.body.teacherNote || '').trim().slice(0, 500)

		const update = {
			$set: {
				status: 'confirmed',
				approvedBy: req.user._id,
				updatedAt: new Date(),
			},
			$unset: {
				deniedBy: '',
				completedBy: '',
			},
		}
		if (typeof teacherNote !== 'undefined') {
			update.$set.teacherNote = teacherNote
		}

		const updated = await ExtraLesson.findOneAndUpdate(
			{ _id: lessonId, status: 'pending_approval' },
			update,
			{ new: true },
		)

		if (!updated) {
			return sendError(res, 400, 'Invalid status transition', 'INVALID_TRANSITION', 'status')
		}

		const populated = await getPopulatedLessonById(updated._id)
		return res.status(200).json({ message: 'Booking request approved', lesson: populated })
	} catch (error) {
		return handleControllerError(res, error, 'approveRequest')
	}
}

exports.denyRequest = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const denialReason = String(req.body.denialReason || '').trim()
		if (!denialReason) {
			return sendError(res, 400, 'denialReason is required when denying a request', 'BAD_REQUEST', 'denialReason')
		}

		const lesson = await ensureLessonExists(lessonId)
		if (!canManageLesson(lesson, req.user)) {
			return sendError(res, 403, 'Only the assigned teacher or admin can deny requests', 'FORBIDDEN')
		}

		const teacherNote =
			typeof req.body.teacherNote === 'undefined'
				? undefined
				: String(req.body.teacherNote || '').trim().slice(0, 500)

		const update = {
			$set: {
				status: 'cancelled',
				denialReason: denialReason.slice(0, 500),
				deniedBy: req.user._id,
				updatedAt: new Date(),
			},
			$unset: {
				approvedBy: '',
				completedBy: '',
			},
		}
		if (typeof teacherNote !== 'undefined') {
			update.$set.teacherNote = teacherNote
		}

		const updated = await ExtraLesson.findOneAndUpdate(
			{ _id: lessonId, status: 'pending_approval' },
			update,
			{ new: true },
		)

		if (!updated) {
			return sendError(res, 400, 'Invalid status transition', 'INVALID_TRANSITION', 'status')
		}

		const populated = await getPopulatedLessonById(updated._id)
		return res.status(200).json({ message: 'Booking request denied', lesson: populated })
	} catch (error) {
		return handleControllerError(res, error, 'denyRequest')
	}
}

exports.markCompleted = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const lesson = await ensureLessonExists(lessonId)

		if (!canManageLesson(lesson, req.user)) {
			return sendError(res, 403, 'Only the assigned teacher or admin can complete lessons', 'FORBIDDEN')
		}

		const teacherNote =
			typeof req.body.teacherNote === 'undefined'
				? undefined
				: String(req.body.teacherNote || '').trim().slice(0, 500)

		const update = {
			$set: {
				status: 'completed',
				completedBy: req.user._id,
				updatedAt: new Date(),
			},
		}
		if (typeof teacherNote !== 'undefined') {
			update.$set.teacherNote = teacherNote
		}

		const updated = await ExtraLesson.findOneAndUpdate(
			{ _id: lessonId, status: 'confirmed' },
			update,
			{ new: true },
		)

		if (!updated) {
			return sendError(res, 400, 'Invalid status transition', 'INVALID_TRANSITION', 'status')
		}

		const populated = await getPopulatedLessonById(updated._id)
		return res.status(200).json({ message: 'Lesson marked as completed', lesson: populated })
	} catch (error) {
		return handleControllerError(res, error, 'markCompleted')
	}
}

exports.cancelConfirmedLesson = async (req, res) => {
	try {
		if (!isRoleManager(req.user.role)) {
			return sendError(res, 403, 'Only admin or headteacher can cancel confirmed lessons', 'FORBIDDEN')
		}

		const lessonId = parseObjectIdString(req.params.lessonId)
		const reason = req.body.denialReason ? String(req.body.denialReason).trim().slice(0, 500) : undefined
		const teacherNote =
			typeof req.body.teacherNote === 'undefined'
				? undefined
				: String(req.body.teacherNote || '').trim().slice(0, 500)

		const update = {
			$set: {
				status: 'cancelled',
				deniedBy: req.user._id,
				updatedAt: new Date(),
			},
		}
		if (reason) {
			update.$set.denialReason = reason
		}
		if (typeof teacherNote !== 'undefined') {
			update.$set.teacherNote = teacherNote
		}

		const updated = await ExtraLesson.findOneAndUpdate(
			{ _id: lessonId, status: 'confirmed' },
			update,
			{ new: true },
		)

		if (!updated) {
			const exists = await ExtraLesson.exists({ _id: lessonId })
			if (!exists) {
				return sendError(res, 404, 'Extra lesson not found', 'NOT_FOUND')
			}
			return sendError(res, 400, 'Invalid status transition', 'INVALID_TRANSITION', 'status')
		}

		const populated = await getPopulatedLessonById(updated._id)
		return res.status(200).json({ message: 'Lesson cancelled', lesson: populated })
	} catch (error) {
		return handleControllerError(res, error, 'cancelConfirmedLesson')
	}
}

exports.createExtraLesson = async (req, res) => {
	try {
		let schedule
		try {
			schedule = resolveScheduleFromBody(req.body)
		} catch (error) {
			if (isHttpError(error)) {
				return sendError(res, error.statusCode, error.message, error.code, error.field)
			}
			throw error
		}

		if (isSlotDateInPast(schedule.scheduledAt)) {
			return sendError(res, 400, 'Cannot schedule a lesson in the past', 'PAST_SLOT', 'date')
		}

		const isManager = isRoleManager(req.user.role)
		const callerId = String(req.user?._id || req.user?.id || '')
		const explicitTeacherId = parseObjectIdString(req.body.assignedTeacherId)

		if (explicitTeacherId && !mongoose.isValidObjectId(explicitTeacherId)) {
			return sendError(res, 400, 'Invalid assignedTeacherId', 'BAD_REQUEST', 'assignedTeacherId')
		}

		if (explicitTeacherId && !isManager) {
			return sendError(res, 403, 'Only admin or headteacher can assign another teacher', 'FORBIDDEN')
		}

		if (!isManager && !req.userDocument?.isExtraLessonSupport) {
			return sendError(
				res,
				403,
				'Only support teachers or admin can create extra lessons directly',
				'FORBIDDEN',
			)
		}

		if (isManager && !explicitTeacherId && !req.userDocument?.isExtraLessonSupport) {
			return sendError(res, 400, 'assignedTeacherId is required', 'BAD_REQUEST', 'assignedTeacherId')
		}

		const assignedTeacherId = explicitTeacherId || callerId

		await assertSupportTeacher({ teacherId: assignedTeacherId })

		const rawStudentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : []
		const uniqueStudentIds = [...new Set(rawStudentIds.map(id => String(id || '').trim()).filter(Boolean))]

		if (uniqueStudentIds.length > MAX_STUDENTS_PER_LESSON) {
			return sendError(res, 400, `Cannot add more than ${MAX_STUDENTS_PER_LESSON} students per lesson`, 'BAD_REQUEST', 'studentIds')
		}

		for (const studentId of uniqueStudentIds) {
			if (!mongoose.isValidObjectId(studentId)) {
				return sendError(res, 400, `Invalid student id: ${studentId}`, 'BAD_REQUEST', 'studentIds')
			}
		}

		if (uniqueStudentIds.length > 0) {
			const students = await Student.find({ _id: { $in: uniqueStudentIds } }).select('_id')
			if (students.length !== uniqueStudentIds.length) {
				return sendError(res, 404, 'One or more student ids were not found', 'NOT_FOUND', 'studentIds')
			}
		}

		const lesson = await runWithOptionalTransaction(async session => {
			const conflictQuery = ExtraLesson.findOne({
				assignedTeacher: assignedTeacherId,
				scheduledAt: schedule.scheduledAt,
				status: { $ne: 'cancelled' },
			})
			applySession(conflictQuery, session)
			const conflict = await conflictQuery
			if (conflict) {
				throw createHttpError(409, 'This slot is already taken for the selected teacher.', 'CONFLICT')
			}

			await assertTeacherDailyLimit({
				teacherId: assignedTeacherId,
				localDate: schedule.localDate,
				session,
			})

			const payload = {
				assignedTeacher: assignedTeacherId,
				scheduledAt: schedule.scheduledAt,
				requestType: 'teacher_created',
				requestedBy: callerId,
				requestedByModel: 'User',
				status: 'confirmed',
				subject: req.body.subject ? String(req.body.subject).trim().slice(0, 120) : undefined,
				teacherNote: req.body.teacherNote ? String(req.body.teacherNote).trim().slice(0, 500) : undefined,
				room: req.body.room ? String(req.body.room).trim().slice(0, 100) : undefined,
				students: uniqueStudentIds.map(studentId => ({
					student: studentId,
					addedBy: callerId,
					addedAt: new Date(),
				})),
			}

			if (session) {
				const docs = await ExtraLesson.create([payload], { session })
				return docs[0]
			}
			return ExtraLesson.create(payload)
		})

		const populated = await getPopulatedLessonById(lesson._id)
		return res.status(201).json({ message: 'Extra lesson created', lesson: populated })
	} catch (error) {
		return handleControllerError(res, error, 'createExtraLesson')
	}
}

exports.listExtraLessons = async (req, res) => {
	try {
		const page = Math.max(Number(req.query.page) || 1, 1)
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const skip = (page - 1) * limit

		const query = {}
		if (req.query.status) {
			const status = String(req.query.status).trim()
			if (!['pending_approval', 'confirmed', 'cancelled', 'completed'].includes(status)) {
				return sendError(
					res,
					400,
					'status must be one of: pending_approval, confirmed, cancelled, completed',
					'BAD_REQUEST',
					'status',
				)
			}
			query.status = status
		}

		if (req.query.teacherId) {
			const teacherId = parseObjectIdString(req.query.teacherId)
			if (!mongoose.isValidObjectId(teacherId)) {
				return sendError(res, 400, 'Invalid teacherId', 'BAD_REQUEST', 'teacherId')
			}
			query.assignedTeacher = teacherId
		}

		if (req.query.date) {
			const localDate = parseLocalDateInput(req.query.date)
			if (!localDate) {
				return sendError(res, 400, 'date must be in YYYY-MM-DD format', 'BAD_REQUEST', 'date')
			}
			const { startUtc, endUtc } = localDateToUtcRange(localDate)
			query.scheduledAt = { $gte: startUtc, $lt: endUtc }
		}

		const [lessons, total] = await Promise.all([
			populateLessonQuery(ExtraLesson.find(query).sort({ scheduledAt: 1 }).skip(skip).limit(limit)),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: lessons })
	} catch (error) {
		return handleControllerError(res, error, 'listExtraLessons')
	}
}

exports.getExtraLessonById = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const lesson = await getPopulatedLessonById(lessonId)
		if (!lesson) {
			return sendError(res, 404, 'Extra lesson not found', 'NOT_FOUND')
		}
		return res.status(200).json({ lesson })
	} catch (error) {
		return handleControllerError(res, error, 'getExtraLessonById')
	}
}

exports.updateExtraLesson = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const lesson = await ensureLessonExists(lessonId)

		if (!canManageLesson(lesson, req.user)) {
			return sendError(res, 403, 'Only the assigned teacher or admin can update this lesson', 'FORBIDDEN')
		}

		if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
			return sendError(res, 400, 'Invalid status transition', 'INVALID_TRANSITION', 'status')
		}

		if (TERMINAL_STATUSES.has(lesson.status)) {
			return sendError(res, 409, `Cannot edit a lesson that is already '${lesson.status}'`, 'CONFLICT')
		}

		if (typeof req.body.subject !== 'undefined') {
			lesson.subject = String(req.body.subject || '').trim().slice(0, 120)
		}
		if (typeof req.body.teacherNote !== 'undefined') {
			lesson.teacherNote = String(req.body.teacherNote || '').trim().slice(0, 500)
		}
		if (typeof req.body.room !== 'undefined') {
			lesson.room = String(req.body.room || '').trim().slice(0, 100)
		}

		const hasSchedulingChange =
			typeof req.body.scheduledAt !== 'undefined' ||
			typeof req.body.date !== 'undefined' ||
			typeof req.body.slot !== 'undefined'

		if (hasSchedulingChange) {
			if (!isRoleManager(req.user.role)) {
				return sendError(res, 403, 'Only admin or headteacher can reschedule a lesson', 'FORBIDDEN')
			}

			let schedule
			try {
				schedule = resolveScheduleFromBody(req.body)
			} catch (error) {
				if (isHttpError(error)) {
					return sendError(res, error.statusCode, error.message, error.code, error.field)
				}
				throw error
			}

			if (isSlotDateInPast(schedule.scheduledAt)) {
				return sendError(res, 400, 'Cannot schedule a lesson in the past', 'PAST_SLOT', 'date')
			}

			await assertTeacherDailyLimit({
				teacherId: lesson.assignedTeacher,
				localDate: schedule.localDate,
				excludeLessonId: lesson._id,
			})

			const conflict = await ExtraLesson.findOne({
				_id: { $ne: lesson._id },
				assignedTeacher: lesson.assignedTeacher,
				scheduledAt: schedule.scheduledAt,
				status: { $ne: 'cancelled' },
			})
			if (conflict) {
				return sendError(res, 409, 'New slot is already taken', 'CONFLICT')
			}

			lesson.scheduledAt = schedule.scheduledAt
		}

		lesson.updatedAt = new Date()
		await lesson.save()

		const populated = await getPopulatedLessonById(lesson._id)
		return res.status(200).json({ message: 'Extra lesson updated', lesson: populated })
	} catch (error) {
		return handleControllerError(res, error, 'updateExtraLesson')
	}
}

exports.deleteExtraLesson = async (req, res) => {
	try {
		if (!isRoleManager(req.user.role)) {
			return sendError(res, 403, 'Only admin or headteacher can delete extra lessons', 'FORBIDDEN')
		}

		const lessonId = parseObjectIdString(req.params.lessonId)
		const lesson = await ExtraLesson.findByIdAndDelete(lessonId)
		if (!lesson) {
			return sendError(res, 404, 'Extra lesson not found', 'NOT_FOUND')
		}

		return res.status(200).json({ message: 'Extra lesson deleted' })
	} catch (error) {
		return handleControllerError(res, error, 'deleteExtraLesson')
	}
}

exports.addStudents = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const rawIds = Array.isArray(req.body.studentIds) ? req.body.studentIds : []

		if (rawIds.length === 0) {
			return sendError(res, 400, 'studentIds array is required and must not be empty', 'BAD_REQUEST', 'studentIds')
		}

		const lesson = await ensureLessonExists(lessonId)
		if (!canManageLesson(lesson, req.user)) {
			return sendError(res, 403, 'Only the assigned teacher or admin can add students', 'FORBIDDEN')
		}

		if (TERMINAL_STATUSES.has(lesson.status)) {
			return sendError(res, 409, `Cannot add students to a lesson that is '${lesson.status}'`, 'CONFLICT')
		}

		const uniqueIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))]
		for (const studentId of uniqueIds) {
			if (!mongoose.isValidObjectId(studentId)) {
				return sendError(res, 400, `Invalid student id: ${studentId}`, 'BAD_REQUEST', 'studentIds')
			}
		}

		const currentStudentIds = new Set(lesson.students.map(entry => String(entry.student)))
		const toAdd = uniqueIds.filter(studentId => !currentStudentIds.has(studentId))

		if (toAdd.length === 0) {
			return sendError(res, 409, 'All provided students are already enrolled in this lesson', 'CONFLICT')
		}

		if (lesson.students.length + toAdd.length > MAX_STUDENTS_PER_LESSON) {
			return sendError(res, 409, 'Lesson is full', 'LESSON_FULL')
		}

		const students = await Student.find({ _id: { $in: toAdd } }).select('_id')
		if (students.length !== toAdd.length) {
			return sendError(res, 404, 'One or more student ids were not found', 'NOT_FOUND', 'studentIds')
		}

		const entriesToAdd = toAdd.map(studentId => ({
			student: studentId,
			addedBy: req.user._id,
			addedAt: new Date(),
		}))

		const maxIndexAllowedBeforeAdd = MAX_STUDENTS_PER_LESSON - toAdd.length
		const update = await ExtraLesson.findOneAndUpdate(
			{
				_id: lessonId,
				status: { $nin: ['cancelled', 'completed'] },
				'students.student': { $nin: toAdd },
				[`students.${maxIndexAllowedBeforeAdd}`]: { $exists: false },
			},
			{
				$push: { students: { $each: entriesToAdd } },
				$set: { updatedAt: new Date() },
			},
			{ new: true },
		)

		if (!update) {
			const latest = await ExtraLesson.findById(lessonId).select('students status')
			if (!latest) {
				return sendError(res, 404, 'Extra lesson not found', 'NOT_FOUND')
			}
			if (TERMINAL_STATUSES.has(latest.status)) {
				return sendError(res, 409, `Cannot add students to a lesson that is '${latest.status}'`, 'CONFLICT')
			}
			if (latest.students.length >= MAX_STUDENTS_PER_LESSON) {
				return sendError(res, 409, 'Lesson is full', 'LESSON_FULL')
			}
			return sendError(res, 409, 'Could not add students to lesson', 'CONFLICT')
		}

		const populated = await getPopulatedLessonById(update._id)
		return res.status(200).json({
			message: `${toAdd.length} student(s) added to the lesson`,
			lesson: populated,
		})
	} catch (error) {
		return handleControllerError(res, error, 'addStudents')
	}
}

exports.removeStudent = async (req, res) => {
	try {
		const lessonId = parseObjectIdString(req.params.lessonId)
		const studentId = parseObjectIdString(req.params.studentId)

		const lesson = await ensureLessonExists(lessonId)
		if (!canManageLesson(lesson, req.user)) {
			return sendError(res, 403, 'Only the assigned teacher or admin can remove students', 'FORBIDDEN')
		}

		const updated = await ExtraLesson.findOneAndUpdate(
			{ _id: lessonId, 'students.student': studentId },
			{
				$pull: { students: { student: studentId } },
				$set: { updatedAt: new Date() },
			},
			{ new: true },
		)

		if (!updated) {
			return sendError(res, 404, 'Student is not enrolled in this lesson', 'NOT_FOUND')
		}

		return res.status(200).json({ message: 'Student removed from extra lesson' })
	} catch (error) {
		return handleControllerError(res, error, 'removeStudent')
	}
}
