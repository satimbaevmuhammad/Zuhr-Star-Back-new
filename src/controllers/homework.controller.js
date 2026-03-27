const fs = require('fs')
const mongoose = require('mongoose')
const path = require('path')
const Group = require('../model/group.model')
const Lesson = require('../model/lesson.model')
const Student = require('../model/student.model')
const HomeworkSubmission = require('../model/homework-submission.model')
const { toPublicUrl } = require('../utils/public-url')

const HOMEWORK_PASS_SCORE = 70

const safeUnlinkIfExists = filePath => {
	try {
		if (filePath && fs.existsSync(filePath)) {
			fs.unlinkSync(filePath)
		}
	} catch (error) {
		console.error('Failed to remove uploaded homework file:', error)
	}
}

const buildSubmissionDocumentPayload = file => ({
	originalName: String(file?.originalname || '').trim(),
	filename: String(file?.filename || '').trim(),
	url: `/uploads/${file?.filename}`,
	mimeType: String(file?.mimetype || 'application/octet-stream').trim(),
	size: Number(file?.size) || 0,
	uploadedAt: new Date(),
})

const normalizeSubmissionDocument = (document, req) => {
	const normalized = document?.toObject ? document.toObject() : { ...document }
	normalized.url = toPublicUrl(req, normalized.url)
	return normalized
}

const normalizeSubmissionResponse = (submissionDocument, req) => {
	const submission = submissionDocument?.toObject
		? submissionDocument.toObject()
		: { ...submissionDocument }
	submission.documents = Array.isArray(submission.documents)
		? submission.documents.map(doc => normalizeSubmissionDocument(doc, req))
		: []
	return submission
}

const normalizeHomeworkAssignment = (lessonDocument, req) => {
	const lesson = lessonDocument?.toObject ? lessonDocument.toObject() : { ...lessonDocument }
	const documents = Array.isArray(lesson.homeworkDocuments)
		? lesson.homeworkDocuments.map(doc => normalizeSubmissionDocument(doc, req))
		: []
	const links = Array.isArray(lesson.homeworkLinks) ? lesson.homeworkLinks : []
	const description = String(lesson.homework || '').trim()
	return {
		description,
		links,
		documents,
	}
}

const omitHomeworkDocumentUrls = homeworkAssignment => {
	const assignment = { ...homeworkAssignment }
	assignment.documents = Array.isArray(homeworkAssignment?.documents)
		? homeworkAssignment.documents.map(document => {
			const normalizedDocument = { ...document }
			delete normalizedDocument.url
			return normalizedDocument
		})
		: []
	return assignment
}

const parseDescription = value => {
	if (typeof value === 'undefined') {
		return undefined
	}

	const description = String(value || '').trim()
	if (description.length > 2000) {
		return null
	}

	return description
}

const parseLinks = value => {
	if (typeof value === 'undefined') {
		return undefined
	}

	let parsed = value
	if (typeof parsed === 'string') {
		const trimmed = parsed.trim()
		if (!trimmed) {
			return []
		}
		try {
			parsed = JSON.parse(trimmed)
		} catch (error) {
			parsed = trimmed.split(',').map(item => item.trim())
		}
	}

	if (!Array.isArray(parsed)) {
		parsed = [parsed]
	}

	const normalized = parsed.map(link => String(link || '').trim()).filter(Boolean)
	if (normalized.length > 20) {
		return null
	}

	if (normalized.some(link => link.length > 500)) {
		return null
	}

	if (new Set(normalized).size !== normalized.length) {
		return null
	}

	return normalized
}

const hasHomeworkAssignment = lesson => {
	if (!lesson) {
		return false
	}

	const description = String(lesson.homework || '').trim()
	const links = Array.isArray(lesson.homeworkLinks) ? lesson.homeworkLinks : []
	const documents = Array.isArray(lesson.homeworkDocuments) ? lesson.homeworkDocuments : []
	return Boolean(description || links.length > 0 || documents.length > 0)
}

const getActiveGroupIdsForStudent = studentDocument => {
	const student = studentDocument?.toObject ? studentDocument.toObject() : studentDocument
	const groups = Array.isArray(student?.groups) ? student.groups : []
	return groups
		.filter(groupItem => groupItem.status === 'active')
		.map(groupItem => groupItem.group?.toString?.() || String(groupItem.group || ''))
		.filter(Boolean)
}

const resolveStudentGroupForLesson = async ({ studentDocument, lessonId, courseId, groupId }) => {
	const activeGroupIds = getActiveGroupIdsForStudent(studentDocument)
	if (activeGroupIds.length === 0) {
		return { error: 'Student is not active in any group' }
	}

	const matchFilter = {
		_id: { $in: activeGroupIds },
		$or: [{ lessons: lessonId }, { courseRef: courseId }],
	}

	if (groupId) {
		if (!mongoose.isValidObjectId(groupId)) {
			return { error: 'Invalid group id' }
		}
		const normalizedGroupId = String(groupId)
		if (!activeGroupIds.includes(normalizedGroupId)) {
			return { error: 'Student is not active in this group' }
		}
		matchFilter._id = normalizedGroupId
	}

	let groups = await Group.find(matchFilter).select(
		'_id teacher supportTeachers lessons courseRef',
	)
	const normalizedLessonId = String(lessonId)
	groups = groups.filter(group => {
		if (Array.isArray(group.lessons) && group.lessons.length > 0) {
			return group.lessons.some(item => item.toString() === normalizedLessonId)
		}
		return true
	})
	if (groups.length === 0) {
		return { error: 'Student is not enrolled in this lesson' }
	}

	if (!groupId && groups.length > 1) {
		return { error: 'Multiple groups found, provide groupId' }
	}

	return { group: groups[0] }
}

const ensureHomeworkUnlocked = async ({ studentId, lesson, group }) => {
	const lessonFilter = { course: lesson.course }
	if (Array.isArray(group?.lessons) && group.lessons.length > 0) {
		lessonFilter._id = { $in: group.lessons }
	}

	const orderedLessons = await Lesson.find(lessonFilter)
		.sort({ order: 1, createdAt: 1 })
		.select('_id order homework homeworkLinks homeworkDocuments')

	const currentIndex = orderedLessons.findIndex(item => item._id.toString() === lesson._id.toString())
	if (currentIndex <= 0) {
		return { ok: true }
	}

	const previousLessons = orderedLessons.slice(0, currentIndex).filter(hasHomeworkAssignment)
	if (previousLessons.length === 0) {
		return { ok: true }
	}

	const previousLessonIds = previousLessons.map(item => item._id)
	const passed = await HomeworkSubmission.find({
		student: studentId,
		lesson: { $in: previousLessonIds },
		status: 'approved',
		score: { $gte: HOMEWORK_PASS_SCORE },
	}).select('lesson')

	const passedSet = new Set(passed.map(item => item.lesson.toString()))
	const blockedLesson = previousLessons.find(item => !passedSet.has(item._id.toString()))
	if (blockedLesson) {
		return { ok: false, blockedBy: blockedLesson._id.toString() }
	}

	return { ok: true }
}

const canGradeSubmission = async (user, submission) => {
	if (!user || !submission) {
		return false
	}

	if (['admin', 'headteacher', 'superadmin'].includes(user.role)) {
		return true
	}

	const group = await Group.findById(submission.group).select('teacher supportTeachers')
	if (!group) {
		return false
	}

	const userId = user._id?.toString()
	if (!userId) {
		return false
	}

	if (group.teacher?.toString() === userId) {
		return true
	}

	return (group.supportTeachers || []).some(teacherId => teacherId.toString() === userId)
}

exports.getStudentHomework = async (req, res) => {
	try {
		const lessonId = req.params.lessonId
		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await Lesson.findById(lessonId).select(
			'course order homework homeworkLinks homeworkDocuments',
		)
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found' })
		}

		if (!hasHomeworkAssignment(lesson)) {
			return res.status(404).json({ message: 'Homework not set for this lesson' })
		}

		const groupResult = await resolveStudentGroupForLesson({
			studentDocument: req.student,
			lessonId,
			courseId: lesson.course,
			groupId: req.query.groupId,
		})
		if (groupResult.error) {
			return res.status(403).json({ message: groupResult.error })
		}

		const unlockCheck = await ensureHomeworkUnlocked({
			studentId: req.student._id,
			lesson,
			group: groupResult.group,
		})

		const submission = await HomeworkSubmission.findOne({
			lesson: lessonId,
			student: req.student._id,
		}).select('status score attemptsCount checkedAt submittedAt')

		if (!unlockCheck.ok) {
			return res.status(200).json({
				lessonId,
				courseId: lesson.course,
				homework: omitHomeworkDocumentUrls(normalizeHomeworkAssignment(lesson, req)),
				submission: submission || null,
				groupId: groupResult.group._id,
				isBlocked: true,
				blockedReason: 'PRIOR_HOMEWORK_PENDING',
				blockedByLessonId: unlockCheck.blockedBy,
			})
		}

		return res.status(200).json({
			lessonId,
			courseId: lesson.course,
			homework: normalizeHomeworkAssignment(lesson, req),
			submission: submission || null,
			groupId: groupResult.group._id,
			isBlocked: false,
			blockedReason: null,
			blockedByLessonId: null,
		})
	} catch (error) {
		console.error('Get student homework failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.submitStudentHomework = async (req, res) => {
	const uploadedFilePath = req.file?.path

	try {
		const lessonId = req.params.lessonId
		if (!mongoose.isValidObjectId(lessonId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await Lesson.findById(lessonId).select(
			'course order homework homeworkLinks homeworkDocuments',
		)
		if (!lesson) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(404).json({ message: 'Lesson not found' })
		}

		if (!hasHomeworkAssignment(lesson)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Homework not set for this lesson' })
		}

		const description = parseDescription(req.body.description)
		if (description === null) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'description must be 2000 characters or less' })
		}

		const links = parseLinks(req.body.links)
		if (links === null) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({
				message: 'links must be an array of up to 20 links, 500 chars max each',
			})
		}

		if (!description && (!Array.isArray(links) || links.length === 0) && !req.file) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({
				message: 'description, links, or a document is required',
			})
		}

		const groupResult = await resolveStudentGroupForLesson({
			studentDocument: req.student,
			lessonId,
			courseId: lesson.course,
			groupId: req.body.groupId,
		})
		if (groupResult.error) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(403).json({ message: groupResult.error })
		}

		const unlockCheck = await ensureHomeworkUnlocked({
			studentId: req.student._id,
			lesson,
			group: groupResult.group,
		})
		if (!unlockCheck.ok) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(422).json({
				message: 'Submission blocked',
				code: 'PRIOR_HOMEWORK_PENDING',
				blockedByLessonId: unlockCheck.blockedBy,
			})
		}

		let submission = await HomeworkSubmission.findOne({
			lesson: lessonId,
			student: req.student._id,
		})

		const isNewSubmission = !submission
		if (submission && submission.status === 'approved') {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(409).json({ message: 'Homework already approved' })
		}

		if (!submission) {
			submission = new HomeworkSubmission({
				lesson: lessonId,
				student: req.student._id,
				group: groupResult.group._id,
			})
		} else {
			for (const document of submission.documents || []) {
				const filename = String(document.filename || '').trim()
				if (filename) {
					safeUnlinkIfExists(path.join(process.cwd(), 'uploads', filename))
				}
			}
			if (submission.score !== null || submission.checkedAt) {
				submission.attemptsCount += 1
			}
			submission.documents = []
			submission.links = []
			submission.description = ''
		}

		submission.status = 'submitted'
		submission.score = null
		submission.checkedBy = null
		submission.checkedAt = null
		submission.submittedAt = new Date()
		submission.group = groupResult.group._id

		if (typeof description !== 'undefined') {
			submission.description = description
		}

		if (typeof links !== 'undefined') {
			submission.links = links
		}

		if (req.file) {
			submission.documents.push(buildSubmissionDocumentPayload(req.file))
		}

		await submission.save()
		await Student.updateOne(
			{ _id: req.student._id },
			{ $addToSet: { homeworks: submission._id } },
		)

		return res.status(isNewSubmission ? 201 : 200).json({
			message: isNewSubmission ? 'Homework submitted successfully' : 'Homework updated successfully',
			submission: normalizeSubmissionResponse(submission, req),
		})
	} catch (error) {
		safeUnlinkIfExists(uploadedFilePath)
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Submit student homework failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listHomeworkSubmissions = async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit

		const query = {}
		if (req.query.lessonId) {
			if (!mongoose.isValidObjectId(req.query.lessonId)) {
				return res.status(400).json({ message: 'Invalid lesson id' })
			}
			query.lesson = req.query.lessonId
		}

		if (req.query.studentId) {
			if (!mongoose.isValidObjectId(req.query.studentId)) {
				return res.status(400).json({ message: 'Invalid student id' })
			}
			query.student = req.query.studentId
		}

		if (req.query.groupId) {
			if (!mongoose.isValidObjectId(req.query.groupId)) {
				return res.status(400).json({ message: 'Invalid group id' })
			}
			query.group = req.query.groupId
		}

		if (req.query.status) {
			const status = String(req.query.status || '').trim().toLowerCase()
			if (!['submitted', 'approved'].includes(status)) {
				return res.status(400).json({ message: 'Invalid status filter' })
			}
			query.status = status
		}

		if (!['admin', 'headteacher', 'superadmin'].includes(req.user.role)) {
			const groups = await Group.find({
				$or: [{ teacher: req.user._id }, { supportTeachers: req.user._id }],
			}).select('_id')
			const groupIds = groups.map(group => group._id)
			if (groupIds.length === 0) {
				return res.status(200).json({ page, limit, total: 0, data: [] })
			}
			if (query.group) {
				const allowedGroups = new Set(groupIds.map(groupId => groupId.toString()))
				if (!allowedGroups.has(String(query.group))) {
					return res.status(403).json({
						message: 'Forbidden: cannot access submissions for this group',
					})
				}
			} else {
				query.group = { $in: groupIds }
			}
		}

		const [submissions, total] = await Promise.all([
			HomeworkSubmission.find(query)
				.sort({ submittedAt: -1, createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('student', 'fullname studentPhone parentPhone')
				.populate('lesson', 'title order course')
				.populate('group', 'name teacher')
				.populate('checkedBy', 'fullname role'),
			HomeworkSubmission.countDocuments(query),
		])

		return res.status(200).json({
			page,
			limit,
			total,
			data: submissions.map(submission => normalizeSubmissionResponse(submission, req)),
		})
	} catch (error) {
		console.error('List homework submissions failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.gradeHomeworkSubmission = async (req, res) => {
	try {
		const submissionId = req.params.submissionId
		if (!mongoose.isValidObjectId(submissionId)) {
			return res.status(400).json({ message: 'Invalid submission id' })
		}

		const score = Number(req.body.score)
		if (!Number.isFinite(score) || score < 0 || score > 100) {
			return res.status(400).json({ message: 'score must be between 0 and 100' })
		}

		const submission = await HomeworkSubmission.findById(submissionId)
		if (!submission) {
			return res.status(404).json({ message: 'Submission not found' })
		}

		const canGrade = await canGradeSubmission(req.user, submission)
		if (!canGrade) {
			return res.status(403).json({ message: 'Forbidden: cannot grade this submission' })
		}

		submission.score = score
		submission.status = score >= HOMEWORK_PASS_SCORE ? 'approved' : 'submitted'
		submission.checkedBy = req.user._id
		submission.checkedAt = new Date()

		await submission.save()

		const populated = await HomeworkSubmission.findById(submissionId)
			.populate('student', 'fullname studentPhone parentPhone')
			.populate('lesson', 'title order course')
			.populate('group', 'name teacher')
			.populate('checkedBy', 'fullname role')

		return res.status(200).json({
			message: 'Submission graded successfully',
			submission: normalizeSubmissionResponse(populated, req),
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Grade homework submission failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
