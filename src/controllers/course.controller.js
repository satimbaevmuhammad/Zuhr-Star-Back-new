const fs = require('fs')
const mongoose = require('mongoose')
const path = require('path')

const Course = require('../model/course.model')
const Group = require('../model/group.model')
const Lesson = require('../model/lesson.model')
const { getGroupsCountByCourseIds } = require('../services/course-sync.service')
const { toPublicUrl } = require('../utils/public-url')

const LESSON_SELECT =
	'title order durationMinutes description homework homeworkLinks homeworkDocuments course documents createdAt updatedAt'

const safeUnlinkIfExists = filePath => {
	try {
		if (filePath && fs.existsSync(filePath)) {
			fs.unlinkSync(filePath)
		}
	} catch (error) {
		console.error('Failed to remove uploaded lesson document file:', error)
	}
}

const buildLessonDocumentPayload = (file, uploadedBy) => ({
	originalName: String(file?.originalname || '').trim(),
	filename: String(file?.filename || '').trim(),
	url: `/uploads/${file?.filename}`,
	mimeType: String(file?.mimetype || 'application/octet-stream').trim(),
	size: Number(file?.size) || 0,
	uploadedBy,
	uploadedAt: new Date(),
})

const normalizeLessonDocument = (document, req) => {
	const normalizedDocument = document?.toObject ? document.toObject() : { ...document }
	normalizedDocument.url = toPublicUrl(req, normalizedDocument.url)
	return normalizedDocument
}

const normalizeLessonResponse = (lessonDocument, req) => {
	const lesson = lessonDocument?.toObject ? lessonDocument.toObject() : { ...lessonDocument }
	lesson.documents = Array.isArray(lesson.documents)
		? lesson.documents.map(document => normalizeLessonDocument(document, req))
		: []
	lesson.homeworkDocuments = Array.isArray(lesson.homeworkDocuments)
		? lesson.homeworkDocuments.map(document => normalizeLessonDocument(document, req))
		: []

	if (!Array.isArray(lesson.homeworkLinks)) {
		lesson.homeworkLinks = []
	}

	return lesson
}

const normalizeCourseResponse = (courseDocument, countMap = new Map(), req) => {
	const course = courseDocument.toObject ? courseDocument.toObject() : { ...courseDocument }
	const courseId = course._id?.toString?.()
	if (courseId && countMap.has(courseId)) {
		course.groupsCount = countMap.get(courseId)
	}

	if (typeof course.groupsCount !== 'number') {
		course.groupsCount = 0
	}

	const durationMonths = Number(course.durationMonths) || 0
	course.maxLessons = durationMonths * 12

	if (Array.isArray(course.methodology)) {
		course.methodology = course.methodology.map(lesson => {
			if (!lesson || typeof lesson !== 'object') {
				return lesson
			}
			return normalizeLessonResponse(lesson, req)
		})
	}

	return course
}

const parseCourseDurationMonths = value => {
	const durationMonths = Number(value)
	if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) {
		return null
	}

	return durationMonths
}

const parseCoursePrice = value => {
	const price = Number(value)
	if (!Number.isFinite(price) || price < 0) {
		return null
	}

	return price
}

const parseLessonDurationMinutes = value => {
	if (typeof value === 'undefined' || value === null || value === '') {
		return undefined
	}

	const durationMinutes = Number(value)
	if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
		return null
	}

	return durationMinutes
}

const parseHomework = value => {
	if (typeof value === 'undefined') {
		return undefined
	}

	const homework = String(value || '').trim()
	if (homework.length > 1000) {
		return null
	}

	return homework
}

const parseHomeworkLinks = value => {
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

const parseHomeworkPayload = (payload = {}, { descriptionAliasKey } = {}) => {
	const hasHomeworkKey = Object.prototype.hasOwnProperty.call(payload, 'homework')
	const hasLinksKey =
		Object.prototype.hasOwnProperty.call(payload, 'homeworkLinks') ||
		Object.prototype.hasOwnProperty.call(payload, 'links')
	const hasDescriptionAlias =
		descriptionAliasKey &&
		Object.prototype.hasOwnProperty.call(payload, descriptionAliasKey) &&
		!hasHomeworkKey

	let descriptionInput
	let linksInput

	if (hasHomeworkKey) {
		const value = payload.homework
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			if (Object.prototype.hasOwnProperty.call(value, 'description')) {
				descriptionInput = value.description
			}
			if (Object.prototype.hasOwnProperty.call(value, 'links')) {
				linksInput = value.links
			}
		} else if (typeof value === 'string') {
			const trimmed = value.trim()
			if (!trimmed) {
				descriptionInput = ''
			} else {
				try {
					const parsed = JSON.parse(trimmed)
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
						if (Object.prototype.hasOwnProperty.call(parsed, 'description')) {
							descriptionInput = parsed.description
						}
						if (Object.prototype.hasOwnProperty.call(parsed, 'links')) {
							linksInput = parsed.links
						}
					} else {
						descriptionInput = value
					}
				} catch (error) {
					descriptionInput = value
				}
			}
		} else {
			descriptionInput = value
		}
	} else if (hasDescriptionAlias) {
		descriptionInput = payload[descriptionAliasKey]
	}

	if (typeof linksInput === 'undefined' && hasLinksKey) {
		linksInput = Object.prototype.hasOwnProperty.call(payload, 'homeworkLinks')
			? payload.homeworkLinks
			: payload.links
	}

	let description
	if (typeof descriptionInput !== 'undefined') {
		description = parseHomework(descriptionInput)
		if (description === null) {
			return { error: 'homework must be 1000 characters or less' }
		}
	}

	let links
	if (typeof linksInput !== 'undefined') {
		links = parseHomeworkLinks(linksInput)
		if (links === null) {
			return {
				error: 'homeworkLinks must be an array of up to 20 links, 500 chars max each',
			}
		}
	}

	return {
		hasDescription: typeof descriptionInput !== 'undefined',
		hasLinks: typeof linksInput !== 'undefined',
		description,
		links,
	}
}

const getNextLessonOrder = async courseId => {
	const latestLesson = await Lesson.findOne({ course: courseId }).sort({ order: -1 }).select('order')
	if (!latestLesson) {
		return 1
	}

	return latestLesson.order + 1
}

const getCourseWithMethodology = async courseId => {
	return Course.findById(courseId).populate({
		path: 'methodology',
		select: LESSON_SELECT,
		options: { sort: { order: 1, createdAt: 1 } },
		populate: {
			path: 'documents.uploadedBy',
			select: 'fullname role phone',
		},
	})
}

exports.createCourse = async (req, res) => {
	try {
		const name = String(req.body.name || '').trim()
		const durationMonths = parseCourseDurationMonths(req.body.durationMonths)
		const price = parseCoursePrice(req.body.price)
		const note = typeof req.body.note === 'undefined' ? undefined : String(req.body.note || '').trim()

		if (!name || durationMonths === null || price === null) {
			return res.status(400).json({
				message: 'name, durationMonths and price are required',
			})
		}

		const coursePayload = {
			name,
			durationMonths,
			price,
		}

		if (typeof note !== 'undefined') {
			coursePayload.note = note
		}

		const course = await Course.create(coursePayload)
		const populatedCourse = await getCourseWithMethodology(course._id)
		const countMap = new Map([[course._id.toString(), 0]])

		return res.status(201).json({
			message: 'Course created successfully',
			course: normalizeCourseResponse(populatedCourse, countMap, req),
		})
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: 'Course with this name already exists' })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Create course failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getCourses = async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit
		const search = String(req.query.search || '').trim()

		const query = {}
		if (search) {
			query.$or = [
				{ name: { $regex: search, $options: 'i' } },
				{ note: { $regex: search, $options: 'i' } },
			]
		}

		const [courses, total] = await Promise.all([
			Course.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate({
					path: 'methodology',
					select: LESSON_SELECT,
					options: { sort: { order: 1, createdAt: 1 } },
				}),
			Course.countDocuments(query),
		])

		const countMap = await getGroupsCountByCourseIds(courses.map(course => course._id.toString()))
		const normalizedCourses = courses.map(course =>
			normalizeCourseResponse(course, countMap, req),
		)

		return res.status(200).json({
			page,
			limit,
			total,
			courses: normalizedCourses,
		})
	} catch (error) {
		console.error('Get courses failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getCourseById = async (req, res) => {
	try {
		const courseId = req.params.courseId
		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		const course = await getCourseWithMethodology(courseId)
		if (!course) {
			return res.status(404).json({ message: 'Course not found' })
		}

		const countMap = await getGroupsCountByCourseIds([courseId])

		return res.status(200).json({
			course: normalizeCourseResponse(course, countMap, req),
		})
	} catch (error) {
		console.error('Get course by id failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateCourse = async (req, res) => {
	try {
		const courseId = req.params.courseId
		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		const course = await Course.findById(courseId)
		if (!course) {
			return res.status(404).json({ message: 'Course not found' })
		}
		const previousName = course.name

		if (typeof req.body.name !== 'undefined') {
			const name = String(req.body.name || '').trim()
			if (!name) {
				return res.status(400).json({ message: 'name cannot be empty' })
			}
			course.name = name
		}

		if (typeof req.body.durationMonths !== 'undefined') {
			const durationMonths = parseCourseDurationMonths(req.body.durationMonths)
			if (durationMonths === null) {
				return res.status(400).json({ message: 'durationMonths must be an integer from 1 to 120' })
			}

			const lessonsCount = await Lesson.countDocuments({ course: courseId })
			const maxLessons = durationMonths * 12
			if (lessonsCount > maxLessons) {
				return res.status(400).json({
					message: `durationMonths=${durationMonths} allows maximum ${maxLessons} lessons, but course already has ${lessonsCount} lessons`,
				})
			}

			course.durationMonths = durationMonths
		}

		if (typeof req.body.price !== 'undefined') {
			const price = parseCoursePrice(req.body.price)
			if (price === null) {
				return res.status(400).json({ message: 'price must be a non-negative number' })
			}
			course.price = price
		}

		if (typeof req.body.note !== 'undefined') {
			course.note = String(req.body.note || '').trim()
		}

		await course.save()

		if (previousName !== course.name) {
			await Group.updateMany(
				{ courseRef: courseId },
				{ $set: { course: course.name } },
			)
		}

		const populatedCourse = await getCourseWithMethodology(courseId)
		const countMap = await getGroupsCountByCourseIds([courseId])

		return res.status(200).json({
			message: 'Course updated successfully',
			course: normalizeCourseResponse(populatedCourse, countMap, req),
		})
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: 'Course with this name already exists' })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update course failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteCourse = async (req, res) => {
	try {
		const courseId = req.params.courseId
		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		const course = await Course.findById(courseId)
		if (!course) {
			return res.status(404).json({ message: 'Course not found' })
		}

		const linkedGroupsCount = await Group.countDocuments({ courseRef: courseId })
		if (linkedGroupsCount > 0) {
			return res.status(409).json({
				message: 'Cannot delete course while groups are attached to it',
			})
		}

		const lessons = await Lesson.find({ course: courseId }).select(
			'documents homeworkDocuments',
		)
		for (const lesson of lessons) {
			const lessonDocuments = [
				...(lesson.documents || []),
				...(lesson.homeworkDocuments || []),
			]
			for (const document of lessonDocuments) {
				const filename = String(document.filename || '').trim()
				if (filename) {
					safeUnlinkIfExists(path.join(process.cwd(), 'uploads', filename))
				}
			}
		}

		await Promise.all([
			Lesson.deleteMany({ course: courseId }),
			Course.updateOne({ _id: courseId }, { $set: { methodology: [] } }),
		])

		await Course.deleteOne({ _id: courseId })

		return res.status(200).json({ message: 'Course deleted successfully' })
	} catch (error) {
		console.error('Delete course failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.createCourseLesson = async (req, res) => {
	const uploadedFilePath = req.file?.path

	try {
		const courseId = req.params.courseId
		if (!mongoose.isValidObjectId(courseId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid course id' })
		}

		const course = await Course.findById(courseId).select('_id durationMonths')
		if (!course) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(404).json({ message: 'Course not found' })
		}

		const maxLessons = Number(course.durationMonths || 0) * 12
		const currentLessonsCount = await Lesson.countDocuments({ course: courseId })
		if (currentLessonsCount >= maxLessons) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(409).json({
				message: `Course has reached maximum lesson limit (${maxLessons})`,
			})
		}

		const title = String(req.body.title || '').trim()
		if (!title) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'title is required' })
		}

		const durationMinutes = parseLessonDurationMinutes(req.body.durationMinutes)
		if (durationMinutes === null) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({
				message: 'durationMinutes must be an integer from 1 to 600',
			})
		}

		const homeworkPayload = parseHomeworkPayload(req.body)
		if (homeworkPayload.error) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: homeworkPayload.error })
		}

		const nextOrder = await getNextLessonOrder(courseId)
		if (nextOrder > maxLessons) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(409).json({
				message: `Course has reached maximum lesson limit (${maxLessons})`,
			})
		}

		const payload = {
			course: courseId,
			title,
			order: nextOrder,
		}

		if (typeof durationMinutes !== 'undefined') {
			payload.durationMinutes = durationMinutes
		}

		if (typeof req.body.description !== 'undefined') {
			payload.description = String(req.body.description || '').trim()
		}

		if (homeworkPayload.hasDescription) {
			payload.homework = homeworkPayload.description
		}

		if (homeworkPayload.hasLinks) {
			payload.homeworkLinks = homeworkPayload.links
		}

		if (req.file) {
			payload.documents = [buildLessonDocumentPayload(req.file, req.user?._id)]
		}

		const lesson = await Lesson.create(payload)

		await Promise.all([
			Course.updateOne({ _id: courseId }, { $addToSet: { methodology: lesson._id } }),
			Group.updateMany({ courseRef: courseId }, { $addToSet: { lessons: lesson._id } }),
		])

		return res.status(201).json({
			message: 'Lesson created and attached to course methodology',
			lesson: normalizeLessonResponse(lesson, req),
		})
	} catch (error) {
		safeUnlinkIfExists(uploadedFilePath)

		if (error.code === 11000) {
			return res.status(409).json({
				message: 'Lesson order already exists for this course',
			})
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Create lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getCourseLessons = async (req, res) => {
	try {
		const courseId = req.params.courseId
		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		const courseExists = await Course.exists({ _id: courseId })
		if (!courseExists) {
			return res.status(404).json({ message: 'Course not found' })
		}

		const lessons = await Lesson.find({ course: courseId })
			.sort({ order: 1, createdAt: 1 })
			.populate('documents.uploadedBy', 'fullname role phone')
		return res.status(200).json({
			total: lessons.length,
			lessons: lessons.map(lesson => normalizeLessonResponse(lesson, req)),
		})
	} catch (error) {
		console.error('Get lessons failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateCourseLesson = async (req, res) => {
	const uploadedFilePath = req.file?.path

	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId })
		if (!lesson) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		if (typeof req.body.title !== 'undefined') {
			const title = String(req.body.title || '').trim()
			if (!title) {
				safeUnlinkIfExists(uploadedFilePath)
				return res.status(400).json({ message: 'title cannot be empty' })
			}
			lesson.title = title
		}

		if (typeof req.body.durationMinutes !== 'undefined') {
			const durationMinutes = parseLessonDurationMinutes(req.body.durationMinutes)
			if (durationMinutes === null) {
				safeUnlinkIfExists(uploadedFilePath)
				return res.status(400).json({
					message: 'durationMinutes must be an integer from 1 to 600',
				})
			}
			lesson.durationMinutes = durationMinutes
		}

		if (typeof req.body.description !== 'undefined') {
			lesson.description = String(req.body.description || '').trim()
		}

		const homeworkPayload = parseHomeworkPayload(req.body)
		if (homeworkPayload.error) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: homeworkPayload.error })
		}

		if (homeworkPayload.hasDescription) {
			lesson.homework = homeworkPayload.description
		}

		if (homeworkPayload.hasLinks) {
			lesson.homeworkLinks = homeworkPayload.links
		}

		if (req.file) {
			lesson.documents.push(buildLessonDocumentPayload(req.file, req.user?._id))
		}

		await lesson.save()

		return res.status(200).json({
			message: 'Lesson updated successfully',
			lesson: normalizeLessonResponse(lesson, req),
		})
	} catch (error) {
		safeUnlinkIfExists(uploadedFilePath)

		if (error.code === 11000) {
			return res.status(409).json({
				message: 'Lesson order already exists for this course',
			})
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteCourseLesson = async (req, res) => {
	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await Lesson.findOneAndDelete({ _id: lessonId, course: courseId })
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		await Promise.all([
			Course.updateOne({ _id: courseId }, { $pull: { methodology: lesson._id } }),
			Group.updateMany({ courseRef: courseId }, { $pull: { lessons: lesson._id } }),
		])

		const lessonDocuments = [
			...(lesson.documents || []),
			...(lesson.homeworkDocuments || []),
		]
		for (const document of lessonDocuments) {
			const filename = String(document.filename || '').trim()
			if (filename) {
				safeUnlinkIfExists(path.join(process.cwd(), 'uploads', filename))
			}
		}

		return res.status(200).json({ message: 'Lesson deleted successfully' })
	} catch (error) {
		console.error('Delete lesson failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getLessonDocuments = async (req, res) => {
	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId }).populate(
			'documents.uploadedBy',
			'fullname role phone',
		)
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		return res.status(200).json({
			courseId,
			lessonId,
			total: (lesson.documents || []).length,
			documents: (lesson.documents || []).map(document => normalizeLessonDocument(document, req)),
		})
	} catch (error) {
		console.error('Get lesson documents failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.uploadLessonDocument = async (req, res) => {
	const uploadedFilePath = req.file?.path

	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		if (!req.file) {
			return res.status(400).json({
				message: 'document file is required',
			})
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId })
		if (!lesson) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		const documentPayload = buildLessonDocumentPayload(req.file, req.user?._id)

		lesson.documents.push(documentPayload)
		await lesson.save()

		const uploadedDocument = lesson.documents[lesson.documents.length - 1]

		return res.status(201).json({
			message: 'Lesson document uploaded successfully',
			courseId,
			lessonId,
			document: normalizeLessonDocument(uploadedDocument, req),
		})
	} catch (error) {
		safeUnlinkIfExists(uploadedFilePath)

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Upload lesson document failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteLessonDocument = async (req, res) => {
	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId
		const documentId = req.params.documentId

		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		if (!mongoose.isValidObjectId(documentId)) {
			return res.status(400).json({ message: 'Invalid document id' })
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId })
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		const documentIndex = (lesson.documents || []).findIndex(
			document => document._id.toString() === documentId,
		)
		if (documentIndex === -1) {
			return res.status(404).json({ message: 'Lesson document not found' })
		}

		const document = lesson.documents[documentIndex]
		const filename = String(document.filename || '').trim()

		lesson.documents.splice(documentIndex, 1)
		await lesson.save()

		if (filename) {
			safeUnlinkIfExists(path.join(process.cwd(), 'uploads', filename))
		}

		return res.status(200).json({
			message: 'Lesson document deleted successfully',
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Delete lesson document failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getLessonHomework = async (req, res) => {
	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId }).select(
			'homework homeworkLinks homeworkDocuments',
		)
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		return res.status(200).json({
			courseId,
			lessonId,
			homework: {
				description: lesson.homework || '',
				links: Array.isArray(lesson.homeworkLinks) ? lesson.homeworkLinks : [],
				documents: Array.isArray(lesson.homeworkDocuments)
					? lesson.homeworkDocuments.map(document => normalizeLessonDocument(document, req))
					: [],
			},
		})
	} catch (error) {
		console.error('Get lesson homework failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateLessonHomework = async (req, res) => {
	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		const homeworkPayload = parseHomeworkPayload(req.body, { descriptionAliasKey: 'description' })
		if (homeworkPayload.error) {
			return res.status(400).json({ message: homeworkPayload.error })
		}

		if (!homeworkPayload.hasDescription && !homeworkPayload.hasLinks) {
			return res.status(400).json({
				message: 'homework description or links are required',
			})
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId })
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		if (homeworkPayload.hasDescription) {
			lesson.homework = homeworkPayload.description
		}
		if (homeworkPayload.hasLinks) {
			lesson.homeworkLinks = homeworkPayload.links
		}
		await lesson.save()

		return res.status(200).json({
			message: 'Homework updated successfully',
			courseId,
			lessonId,
			homework: {
				description: lesson.homework || '',
				links: Array.isArray(lesson.homeworkLinks) ? lesson.homeworkLinks : [],
				documents: Array.isArray(lesson.homeworkDocuments)
					? lesson.homeworkDocuments.map(document => normalizeLessonDocument(document, req))
					: [],
			},
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update lesson homework failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.uploadLessonHomeworkDocument = async (req, res) => {
	const uploadedFilePath = req.file?.path

	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId

		if (!mongoose.isValidObjectId(courseId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		if (!req.file) {
			return res.status(400).json({
				message: 'homework document file is required',
			})
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId })
		if (!lesson) {
			safeUnlinkIfExists(uploadedFilePath)
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		const documentPayload = buildLessonDocumentPayload(req.file, req.user?._id)

		lesson.homeworkDocuments.push(documentPayload)
		await lesson.save()

		const uploadedDocument =
			lesson.homeworkDocuments[lesson.homeworkDocuments.length - 1]

		return res.status(201).json({
			message: 'Homework document uploaded successfully',
			courseId,
			lessonId,
			document: normalizeLessonDocument(uploadedDocument, req),
		})
	} catch (error) {
		safeUnlinkIfExists(uploadedFilePath)

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Upload homework document failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteLessonHomeworkDocument = async (req, res) => {
	try {
		const courseId = req.params.courseId
		const lessonId = req.params.lessonId
		const documentId = req.params.documentId

		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		if (!mongoose.isValidObjectId(lessonId)) {
			return res.status(400).json({ message: 'Invalid lesson id' })
		}

		if (!mongoose.isValidObjectId(documentId)) {
			return res.status(400).json({ message: 'Invalid document id' })
		}

		const lesson = await Lesson.findOne({ _id: lessonId, course: courseId })
		if (!lesson) {
			return res.status(404).json({ message: 'Lesson not found in this course' })
		}

		const documentIndex = (lesson.homeworkDocuments || []).findIndex(
			document => document._id.toString() === documentId,
		)
		if (documentIndex === -1) {
			return res.status(404).json({ message: 'Homework document not found' })
		}

		const document = lesson.homeworkDocuments[documentIndex]
		const filename = String(document.filename || '').trim()

		lesson.homeworkDocuments.splice(documentIndex, 1)
		await lesson.save()

		if (filename) {
			safeUnlinkIfExists(path.join(process.cwd(), 'uploads', filename))
		}

		return res.status(200).json({
			message: 'Homework document deleted successfully',
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Delete homework document failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.rebuildCourseMethodology = async (req, res) => {
	try {
		const courseId = req.params.courseId
		if (!mongoose.isValidObjectId(courseId)) {
			return res.status(400).json({ message: 'Invalid course id' })
		}

		const course = await Course.findById(courseId)
		if (!course) {
			return res.status(404).json({ message: 'Course not found' })
		}

		const lessons = await Lesson.find({ course: courseId }).sort({ order: 1, createdAt: 1 }).select('_id')
		const lessonIds = lessons.map(lesson => lesson._id)

		course.methodology = lessonIds
		await course.save()

		await Group.updateMany({ courseRef: courseId }, { $set: { lessons: lessonIds } })

		const populatedCourse = await getCourseWithMethodology(courseId)
		const countMap = await getGroupsCountByCourseIds([courseId])

		return res.status(200).json({
			message: 'Course methodology rebuilt successfully',
			course: normalizeCourseResponse(populatedCourse, countMap, req),
		})
	} catch (error) {
		console.error('Rebuild methodology failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
