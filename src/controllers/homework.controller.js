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

const parseBooleanQuery = (value, fallback = false) => {
	if (typeof value === 'undefined') {
		return fallback
	}

	if (typeof value === 'boolean') {
		return value
	}

	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (['1', 'true', 'yes', 'y'].includes(normalized)) {
		return true
	}

	if (['0', 'false', 'no', 'n'].includes(normalized)) {
		return false
	}

	return fallback
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

const getSafeGroupSubmissions = async ({ lessonId, groupId }) => {
	if (!groupId) {
		return []
	}

	const activeStudents = await Student.find({
		groups: { $elemMatch: { group: groupId, status: 'active' } },
	})
		.select('_id')
		.lean()

	const activeStudentIds = activeStudents.map(student => student._id).filter(Boolean)
	if (activeStudentIds.length === 0) {
		return []
	}

	const groupSubmissions = await HomeworkSubmission.find({
		lesson: lessonId,
		student: { $in: activeStudentIds },
	})
		.populate('student', 'name fullname _id')
		.select('student status score submittedAt')
		.lean()

	return groupSubmissions
		.map(submission => ({
			studentId: submission?.student?._id ? String(submission.student._id) : '',
			studentName: String(
				submission?.student?.name || submission?.student?.fullname || '',
			).trim(),
			status: submission?.status || 'submitted',
			score: typeof submission?.score === 'number' ? submission.score : null,
			submittedAt: submission?.submittedAt || null,
		}))
		.filter(submission => Boolean(submission.studentId))
} // FIX [7]: Add safe group grade list for student homework view without exposing private payload fields

const resolveStudentOwnedGroup = async ({ studentDocument, groupId }) => {
	const activeGroupIds = getActiveGroupIdsForStudent(studentDocument)
	if (activeGroupIds.length === 0) {
		return { statusCode: 403, error: 'Student is not active in any group' }
	}

	const requestedGroupId = String(groupId || '').trim()
	let selectedGroupId = ''

	if (requestedGroupId) {
		if (!mongoose.isValidObjectId(requestedGroupId)) {
			return { statusCode: 400, error: 'Invalid group id' }
		}

		if (!activeGroupIds.includes(requestedGroupId)) {
			return { statusCode: 403, error: 'Student is not active in this group' }
		}

		selectedGroupId = requestedGroupId
	} else {
		if (activeGroupIds.length > 1) {
			return { statusCode: 400, error: 'Multiple active groups found, provide groupId' }
		}
		selectedGroupId = activeGroupIds[0]
	}

	const group = await Group.findById(selectedGroupId).select(
		'_id name course courseRef lessons',
	)
	if (!group) {
		return { statusCode: 404, error: 'Group not found' }
	}

	return { group }
}

exports.getStudentGroupmatesGrades = async (req, res) => {
	try {
		const includeSelf = parseBooleanQuery(req.query.includeSelf, false)
		const onlyChecked = parseBooleanQuery(req.query.onlyChecked, true)

		const groupResult = await resolveStudentOwnedGroup({
			studentDocument: req.student,
			groupId: req.query.groupId,
		})
		if (groupResult.error) {
			return res.status(groupResult.statusCode || 400).json({ message: groupResult.error })
		}

		const group = groupResult.group
		const groupmatesQuery = {
			groups: {
				$elemMatch: {
					group: group._id,
					status: 'active',
				},
			},
		}

		if (!includeSelf) {
			groupmatesQuery._id = { $ne: req.student._id }
		}

		const groupmates = await Student.find(groupmatesQuery)
			.select('_id fullname')
			.sort({ fullname: 1, _id: 1 })
			.lean()

		const groupmateIds = groupmates.map(student => student._id).filter(Boolean)
		if (groupmateIds.length === 0) {
			return res.status(200).json({
				groupId: String(group._id),
				groupName: String(group.name || '').trim(),
				groupCourse: String(group.course || '').trim(),
				includeSelf,
				onlyChecked,
				totalGroupmates: 0,
				gradedStudentsCount: 0,
				totalGrades: 0,
				data: [],
			})
		}

		const lessonFilter = {}
		if (Array.isArray(group.lessons) && group.lessons.length > 0) {
			lessonFilter._id = { $in: group.lessons }
		} else if (group.courseRef) {
			lessonFilter.course = group.courseRef
		}

		const lessons =
			Object.keys(lessonFilter).length > 0
				? await Lesson.find(lessonFilter)
					.select('_id title order')
					.sort({ order: 1, createdAt: 1 })
					.lean()
				: []
		const lessonsById = new Map(
			lessons.map(lesson => [
				String(lesson._id),
				{
					lessonTitle: String(lesson.title || '').trim(),
					lessonOrder: Number.isFinite(lesson.order) ? lesson.order : null,
				},
			]),
		)

		const submissionsFilter = {
			group: group._id,
			student: { $in: groupmateIds },
			score: { $ne: null },
		}
		if (onlyChecked) {
			submissionsFilter.checkedAt = { $ne: null }
		}

		const submissions = await HomeworkSubmission.find(submissionsFilter)
			.select('student lesson status score submittedAt checkedAt')
			.sort({ checkedAt: -1, submittedAt: -1, createdAt: -1 })
			.lean()

		const gradesByStudentId = new Map()
		for (const submission of submissions) {
			const studentId = String(submission.student || '').trim()
			if (!studentId) {
				continue
			}

			const lessonId = String(submission.lesson || '').trim()
			const lessonMeta = lessonsById.get(lessonId)
			const grades = gradesByStudentId.get(studentId) || []

			grades.push({
				lessonId,
				lessonTitle: lessonMeta?.lessonTitle || '',
				lessonOrder: lessonMeta?.lessonOrder ?? null,
				score: typeof submission.score === 'number' ? submission.score : null,
				status: submission.status || 'submitted',
				submittedAt: submission.submittedAt || null,
				checkedAt: submission.checkedAt || null,
			})
			gradesByStudentId.set(studentId, grades)
		}

		const data = groupmates.map(groupmate => {
			const studentId = String(groupmate._id)
			const grades = gradesByStudentId.get(studentId) || []
			const scoredGrades = grades.filter(item => typeof item.score === 'number')
			const averageScore =
				scoredGrades.length > 0
					? Number(
						(
							scoredGrades.reduce((sum, item) => sum + Number(item.score || 0), 0) /
							scoredGrades.length
						).toFixed(2),
					)
					: null

			return {
				studentId,
				studentName: String(groupmate.fullname || '').trim(),
				gradesCount: grades.length,
				averageScore,
				grades,
			}
		})

		return res.status(200).json({
			groupId: String(group._id),
			groupName: String(group.name || '').trim(),
			groupCourse: String(group.course || '').trim(),
			includeSelf,
			onlyChecked,
			totalGroupmates: data.length,
			gradedStudentsCount: data.filter(item => item.gradesCount > 0).length,
			totalGrades: submissions.length,
			data,
		})
	} catch (error) {
		console.error('Get student groupmates grades failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
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

		const groupSubmissions = groupResult?.group?._id
			? await getSafeGroupSubmissions({ lessonId, groupId: groupResult.group._id })
			: []

		const unlockCheck = await ensureHomeworkUnlocked({
			studentId: req.student._id,
			lesson,
			group: groupResult.group,
		})

		const submission = await HomeworkSubmission.findOne({
			lesson: lessonId,
			student: req.student._id,
		}).select('status score attemptsCount checkedAt submittedAt history') // FIX [6]: Return student submission history in homework lesson response

		if (!unlockCheck.ok) {
			return res.status(200).json({
				lessonId,
				courseId: lesson.course,
				homework: omitHomeworkDocumentUrls(normalizeHomeworkAssignment(lesson, req)),
				submission: submission || null,
				groupSubmissions,
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
			groupSubmissions,
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
			if (!Array.isArray(submission.history)) {
				submission.history = []
			}
			submission.history.push({
				description: String(submission.description || '').trim(),
				links: Array.isArray(submission.links) ? [...submission.links] : [],
				documents: Array.isArray(submission.documents)
					? submission.documents.map(document => ({
						name: String(document.originalName || document.filename || '').trim(),
						url: String(document.url || '').trim(),
					}))
					: [],
				submittedAt: submission.submittedAt || new Date(),
			}) // FIX [5]: Preserve previous top-level submission payload in history before resubmit overwrite

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

		submission.lesson = lessonId // FIX [5]: Always bind submission record to current lesson on create/resubmit
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
