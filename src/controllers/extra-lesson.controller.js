const mongoose = require('mongoose')
const ExtraLesson = require('../model/extra-lesson.model')
const User = require('../model/user.model')
const Student = require('../model/student.model')

const MAX_SUPPORT_TEACHERS = 3

// ─── SUPPORT TEACHER MANAGEMENT ──────────────────────────────────────────────

exports.listSupportTeachers = async (req, res) => {
	try {
		const teachers = await User.find({ isExtraLessonSupport: true }).select(
			'fullname phone email role imgURL isExtraLessonSupport',
		)
		return res.status(200).json({ total: teachers.length, max: MAX_SUPPORT_TEACHERS, teachers })
	} catch (error) {
		console.error('List extra lesson support teachers failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.assignSupportTeacher = async (req, res) => {
	try {
		const { userId } = req.params
		if (!mongoose.isValidObjectId(userId)) {
			return res.status(400).json({ message: 'Invalid user id' })
		}

		const currentCount = await User.countDocuments({ isExtraLessonSupport: true })
		if (currentCount >= MAX_SUPPORT_TEACHERS) {
			return res.status(409).json({
				message: `Cannot assign more than ${MAX_SUPPORT_TEACHERS} extra lesson support teachers. Remove one first.`,
			})
		}

		const user = await User.findById(userId)
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		if (user.isExtraLessonSupport) {
			return res.status(409).json({ message: 'User is already an extra lesson support teacher' })
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
				isExtraLessonSupport: user.isExtraLessonSupport,
			},
		})
	} catch (error) {
		console.error('Assign support teacher failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.removeSupportTeacher = async (req, res) => {
	try {
		const { userId } = req.params
		if (!mongoose.isValidObjectId(userId)) {
			return res.status(400).json({ message: 'Invalid user id' })
		}

		const user = await User.findById(userId)
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		if (!user.isExtraLessonSupport) {
			return res.status(400).json({ message: 'User is not an extra lesson support teacher' })
		}

		user.isExtraLessonSupport = false
		await user.save()

		return res.status(200).json({ message: 'User removed from extra lesson support teachers' })
	} catch (error) {
		console.error('Remove support teacher failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── EXTRA LESSON CRUD ────────────────────────────────────────────────────────

exports.listExtraLessons = async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit

		const query = {}
		if (req.query.status) {
			if (!['scheduled', 'completed', 'cancelled'].includes(req.query.status)) {
				return res.status(400).json({ message: 'status must be scheduled, completed, or cancelled' })
			}
			query.status = req.query.status
		}
		if (req.query.teacherId) {
			if (!mongoose.isValidObjectId(req.query.teacherId)) {
				return res.status(400).json({ message: 'Invalid teacherId' })
			}
			query.assignedTeacher = req.query.teacherId
		}

		const [lessons, total] = await Promise.all([
			ExtraLesson.find(query)
				.sort({ scheduledAt: 1 })
				.skip(skip)
				.limit(limit)
				.populate('assignedTeacher', 'fullname phone role')
				.populate('students', 'fullname studentPhone')
				.populate('createdBy', 'fullname role'),
			ExtraLesson.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, lessons })
	} catch (error) {
		console.error('List extra lessons failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getExtraLessonById = async (req, res) => {
	try {
		const { lessonId } = req.params
		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await ExtraLesson.findById(lessonId)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students', 'fullname studentPhone parentPhone gender')
			.populate('createdBy', 'fullname role')

		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		return res.status(200).json({ lesson })
	} catch (error) {
		console.error('Get extra lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.createExtraLesson = async (req, res) => {
	try {
		const title = String(req.body.title || '').trim()
		const description = req.body.description ? String(req.body.description).trim() : undefined
		const subject = req.body.subject ? String(req.body.subject).trim() : undefined
		const scheduledAt = req.body.scheduledAt
		const durationMinutes = req.body.durationMinutes ? Number(req.body.durationMinutes) : undefined
		const assignedTeacherId = String(req.body.assignedTeacher || '').trim()
		const room = req.body.room ? String(req.body.room).trim() : undefined
		const note = req.body.note ? String(req.body.note).trim() : undefined

		if (!title) {
			return res.status(400).json({ message: 'title is required' })
		}
		if (!scheduledAt) {
			return res.status(400).json({ message: 'scheduledAt is required' })
		}
		if (!assignedTeacherId) {
			return res.status(400).json({ message: 'assignedTeacher is required' })
		}

		const parsedDate = new Date(scheduledAt)
		if (Number.isNaN(parsedDate.getTime())) {
			return res.status(400).json({ message: 'Invalid scheduledAt date' })
		}

		if (!mongoose.isValidObjectId(assignedTeacherId)) {
			return res.status(400).json({ message: 'Invalid assignedTeacher id' })
		}

		if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes < 15)) {
			return res.status(400).json({ message: 'durationMinutes must be at least 15' })
		}

		// Validate that assigned teacher is a registered support teacher
		const teacher = await User.findById(assignedTeacherId).select('isExtraLessonSupport fullname')
		if (!teacher) {
			return res.status(404).json({ message: 'Assigned teacher not found' })
		}
		if (!teacher.isExtraLessonSupport) {
			return res.status(403).json({
				message: 'Assigned teacher is not registered as an extra lesson support teacher',
			})
		}

		const lesson = await ExtraLesson.create({
			title,
			description,
			subject,
			scheduledAt: parsedDate,
			durationMinutes,
			assignedTeacher: assignedTeacherId,
			room,
			note,
			createdBy: req.user._id,
		})

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('createdBy', 'fullname role')

		return res.status(201).json({ message: 'Extra lesson created', lesson: populated })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('Create extra lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateExtraLesson = async (req, res) => {
	try {
		const { lessonId } = req.params
		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		// Only the assigned teacher or admin/superadmin can update
		const isAssigned = lesson.assignedTeacher.toString() === req.user._id.toString()
		const isAdmin = ['admin', 'superadmin'].includes(req.user.role)
		if (!isAssigned && !isAdmin) {
			return res.status(403).json({ message: 'Only the assigned teacher or admin can update this lesson' })
		}

		if (typeof req.body.title !== 'undefined') {
			const title = String(req.body.title || '').trim()
			if (!title) return res.status(400).json({ message: 'title cannot be empty' })
			lesson.title = title
		}
		if (typeof req.body.description !== 'undefined') lesson.description = String(req.body.description || '').trim()
		if (typeof req.body.subject !== 'undefined') lesson.subject = String(req.body.subject || '').trim()
		if (typeof req.body.room !== 'undefined') lesson.room = String(req.body.room || '').trim()
		if (typeof req.body.note !== 'undefined') lesson.note = String(req.body.note || '').trim()

		if (typeof req.body.scheduledAt !== 'undefined') {
			const parsed = new Date(req.body.scheduledAt)
			if (Number.isNaN(parsed.getTime())) {
				return res.status(400).json({ message: 'Invalid scheduledAt date' })
			}
			lesson.scheduledAt = parsed
		}

		if (typeof req.body.durationMinutes !== 'undefined') {
			const dur = Number(req.body.durationMinutes)
			if (!Number.isFinite(dur) || dur < 15) {
				return res.status(400).json({ message: 'durationMinutes must be at least 15' })
			}
			lesson.durationMinutes = dur
		}

		if (typeof req.body.status !== 'undefined') {
			if (!['scheduled', 'completed', 'cancelled'].includes(req.body.status)) {
				return res.status(400).json({ message: 'status must be scheduled, completed, or cancelled' })
			}
			lesson.status = req.body.status
		}

		if (typeof req.body.assignedTeacher !== 'undefined') {
			const tid = String(req.body.assignedTeacher || '').trim()
			if (!mongoose.isValidObjectId(tid)) {
				return res.status(400).json({ message: 'Invalid assignedTeacher id' })
			}
			const teacher = await User.findById(tid).select('isExtraLessonSupport')
			if (!teacher) return res.status(404).json({ message: 'Assigned teacher not found' })
			if (!teacher.isExtraLessonSupport) {
				return res.status(403).json({ message: 'Assigned teacher is not a registered support teacher' })
			}
			lesson.assignedTeacher = tid
		}

		await lesson.save()

		const populated = await ExtraLesson.findById(lesson._id)
			.populate('assignedTeacher', 'fullname phone role')
			.populate('students', 'fullname studentPhone')
			.populate('createdBy', 'fullname role')

		return res.status(200).json({ message: 'Extra lesson updated', lesson: populated })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('Update extra lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteExtraLesson = async (req, res) => {
	try {
		const { lessonId } = req.params
		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await ExtraLesson.findByIdAndDelete(lessonId)
		if (!lesson) {
			return res.status(404).json({ message: 'Extra lesson not found' })
		}

		return res.status(200).json({ message: 'Extra lesson deleted' })
	} catch (error) {
		console.error('Delete extra lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// ─── STUDENT ENROLLMENT ───────────────────────────────────────────────────────

exports.addStudent = async (req, res) => {
	try {
		const { lessonId } = req.params
		const studentId = String(req.body.studentId || '').trim()

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}
		if (!studentId || !mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Valid studentId is required' })
		}

		const [lesson, student] = await Promise.all([
			ExtraLesson.findById(lessonId),
			Student.findById(studentId).select('_id fullname'),
		])

		if (!lesson) return res.status(404).json({ message: 'Extra lesson not found' })
		if (!student) return res.status(404).json({ message: 'Student not found' })

		if (lesson.students.some(id => id.toString() === studentId)) {
			return res.status(409).json({ message: 'Student already enrolled in this extra lesson' })
		}

		lesson.students.push(studentId)
		await lesson.save()

		return res.status(200).json({ message: 'Student added to extra lesson', studentId })
	} catch (error) {
		console.error('Add student to extra lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.removeStudent = async (req, res) => {
	try {
		const { lessonId, studentId } = req.params

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const lesson = await ExtraLesson.findById(lessonId)
		if (!lesson) return res.status(404).json({ message: 'Extra lesson not found' })

		const before = lesson.students.length
		lesson.students = lesson.students.filter(id => id.toString() !== studentId)
		if (lesson.students.length === before) {
			return res.status(404).json({ message: 'Student not enrolled in this extra lesson' })
		}

		await lesson.save()

		return res.status(200).json({ message: 'Student removed from extra lesson' })
	} catch (error) {
		console.error('Remove student from extra lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
