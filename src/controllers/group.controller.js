const mongoose = require('mongoose')

const Group = require('../model/group.model')
const Student = require('../model/student.model')
const User = require('../model/user.model')
const { resetStudentBalancesIfNeeded } = require('../services/student-balance-reset.service')

const DAYS_OF_WEEK = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday',
]
const GROUP_STATUSES = ['planned', 'active', 'paused', 'completed', 'archived']
const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused']
const STUDENT_GROUP_STATUSES = ['active', 'paused', 'completed', 'left']
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const COINS_PER_ACTIVE_STUDENT = 200

const parseDateValue = value => {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

const parseJsonIfNeeded = input => {
	if (typeof input !== 'string') {
		return input
	}

	try {
		return JSON.parse(input)
	} catch (error) {
		return undefined
	}
}

const parseSchedule = input => {
	if (typeof input === 'undefined') {
		return undefined
	}

	const parsed = parseJsonIfNeeded(input)
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return null
	}

	const normalized = []
	for (const item of parsed) {
		if (!item || typeof item !== 'object') {
			return null
		}

		const dayOfWeek = String(item.dayOfWeek || '')
			.trim()
			.toLowerCase()
		const startTime = String(item.startTime || '').trim()
		const durationMinutes = Number(item.durationMinutes)

		if (!DAYS_OF_WEEK.includes(dayOfWeek)) {
			return null
		}

		if (!TIME_PATTERN.test(startTime)) {
			return null
		}

		if (!Number.isFinite(durationMinutes) || durationMinutes < 30 || durationMinutes > 300) {
			return null
		}

		normalized.push({
			dayOfWeek,
			startTime,
			durationMinutes,
		})
	}

	return normalized
}

const parseObjectIdArray = input => {
	if (typeof input === 'undefined') {
		return undefined
	}

	let parsed = parseJsonIfNeeded(input)
	if (typeof parsed === 'undefined') {
		parsed = [String(input).trim()]
	}

	if (!Array.isArray(parsed)) {
		return null
	}

	const normalized = []
	for (const item of parsed) {
		const value = String(item || '').trim()
		if (!value) {
			continue
		}

		if (!mongoose.isValidObjectId(value)) {
			return null
		}

		normalized.push(value)
	}

	return normalized
}

const parseAttendanceRecords = input => {
	if (typeof input === 'undefined') {
		return undefined
	}

	const parsed = parseJsonIfNeeded(input)
	if (!Array.isArray(parsed) || parsed.length === 0) {
		return null
	}

	const normalized = []
	for (const item of parsed) {
		if (!item || typeof item !== 'object') {
			return null
		}

		const student = String(item.student || '').trim()
		const status = String(item.status || 'present')
			.trim()
			.toLowerCase()
		const note = typeof item.note === 'undefined' ? undefined : String(item.note || '').trim()

		if (!mongoose.isValidObjectId(student)) {
			return null
		}

		if (!ATTENDANCE_STATUSES.includes(status)) {
			return null
		}

		normalized.push({ student, status, note })
	}

	return normalized
}

const parseGroupMemberStatus = input => {
	const status = String(input || 'active')
		.trim()
		.toLowerCase()

	if (!STUDENT_GROUP_STATUSES.includes(status)) {
		return null
	}

	return status
}

const parseGroupMembershipPayload = body => {
	const status = parseGroupMemberStatus(body.status)
	if (!status) {
		return { error: 'status must be one of active, paused, completed, left' }
	}

	let joinedAt
	if (typeof body.joinedAt !== 'undefined' && body.joinedAt !== null && body.joinedAt !== '') {
		joinedAt = parseDateValue(body.joinedAt)
		if (!joinedAt) {
			return { error: 'Invalid joinedAt value' }
		}
	}

	const note = typeof body.note === 'undefined' ? undefined : String(body.note || '').trim()
	return { status, joinedAt, note }
}

const toDateKey = value => {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

const runBalanceResetSafely = async () => {
	try {
		await resetStudentBalancesIfNeeded()
	} catch (error) {
		console.error('Student balance reset check failed:', error)
	}
}

const getActiveStudentCountsByGroupIds = async groupIds => {
	if (!Array.isArray(groupIds) || groupIds.length === 0) {
		return new Map()
	}

	const ids = groupIds
		.filter(Boolean)
		.map(groupId => new mongoose.Types.ObjectId(groupId))

	const stats = await Student.aggregate([
		{
			$unwind: '$groups',
		},
		{
			$match: {
				'groups.group': { $in: ids },
				'groups.status': 'active',
			},
		},
		{
			$group: {
				_id: '$groups.group',
				studentsCount: { $sum: 1 },
			},
		},
	])

	const countsMap = new Map()
	for (const item of stats) {
		countsMap.set(item._id.toString(), item.studentsCount)
	}

	return countsMap
}

const countActiveStudentsForGroup = async (groupId, { excludeStudentId } = {}) => {
	const query = {
		groups: {
			$elemMatch: {
				group: groupId,
				status: 'active',
			},
		},
	}

	if (excludeStudentId && mongoose.isValidObjectId(excludeStudentId)) {
		query._id = { $ne: excludeStudentId }
	}

	return Student.countDocuments(query)
}

const findMissingUserIds = async userIds => {
	if (!Array.isArray(userIds) || userIds.length === 0) {
		return []
	}

	const normalizedIds = [...new Set(userIds.map(userId => String(userId).trim()))].filter(Boolean)
	if (normalizedIds.length === 0) {
		return []
	}

	const users = await User.find({ _id: { $in: normalizedIds } }).select('_id')
	const existingIds = new Set(users.map(user => user._id.toString()))
	return normalizedIds.filter(userId => !existingIds.has(userId))
}

const ensureStudentInGroupList = async ({ groupId, studentId }) => {
	const normalizedStudentId = new mongoose.Types.ObjectId(String(studentId))
	await Group.updateOne(
		{ _id: groupId },
		[
			{
				$set: {
					students: {
						$cond: [{ $isArray: '$students' }, '$students', []],
					},
				},
			},
			{
				$set: {
					students: {
						$setUnion: ['$students', [normalizedStudentId]],
					},
				},
			},
		],
	)
}

const removeStudentFromGroupList = async ({ groupId, studentId }) => {
	const normalizedStudentId = new mongoose.Types.ObjectId(String(studentId))
	await Group.updateOne(
		{ _id: groupId },
		[
			{
				$set: {
					students: {
						$cond: [{ $isArray: '$students' }, '$students', []],
					},
				},
			},
			{
				$set: {
					students: {
						$filter: {
							input: '$students',
							as: 'studentRef',
							cond: { $ne: ['$$studentRef', normalizedStudentId] },
						},
					},
				},
			},
		],
	)
}

const attachGroupComputedFields = (groupDocument, activeStudentsCount = 0) => {
	const group = groupDocument.toObject ? groupDocument.toObject() : { ...groupDocument }
	group.studentsCount = activeStudentsCount
	group.coinBalance = activeStudentsCount * COINS_PER_ACTIVE_STUDENT
	return group
}

exports.createGroup = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const name = String(req.body.name || '').trim()
		const course = String(req.body.course || '').trim()
		const teacher = String(req.body.teacher || '').trim()
		const schedule = parseSchedule(req.body.schedule)
		const startDate = parseDateValue(req.body.startDate)

		if (!name || !course || !teacher || !startDate || !schedule) {
			return res.status(400).json({
				message: 'name, course, teacher, startDate and schedule are required',
			})
		}

		if (!mongoose.isValidObjectId(teacher)) {
			return res.status(400).json({ message: 'Invalid teacher id' })
		}

		const groupPayload = {
			name,
			course,
			teacher,
			startDate,
			schedule,
		}

		if (typeof req.body.level !== 'undefined') {
			groupPayload.level = String(req.body.level || '').trim()
		}

		if (typeof req.body.status !== 'undefined') {
			const status = String(req.body.status || '')
				.trim()
				.toLowerCase()
			if (!GROUP_STATUSES.includes(status)) {
				return res.status(400).json({ message: 'Invalid status value' })
			}
			groupPayload.status = status
		}

		if (typeof req.body.supportTeachers !== 'undefined') {
			const supportTeachers = parseObjectIdArray(req.body.supportTeachers)
			if (!supportTeachers) {
				return res.status(400).json({
					message: 'supportTeachers must be an array of valid user ObjectIds',
				})
			}
			groupPayload.supportTeachers = supportTeachers
		}

		if (typeof req.body.maxStudents !== 'undefined') {
			const maxStudents = Number(req.body.maxStudents)
			if (!Number.isFinite(maxStudents) || maxStudents < 1 || maxStudents > 100) {
				return res.status(400).json({ message: 'maxStudents must be between 1 and 100' })
			}
			groupPayload.maxStudents = maxStudents
		}

		if (typeof req.body.endDate !== 'undefined' && req.body.endDate !== null && req.body.endDate !== '') {
			const endDate = parseDateValue(req.body.endDate)
			if (!endDate) {
				return res.status(400).json({ message: 'Invalid endDate value' })
			}
			groupPayload.endDate = endDate
		}

		if (typeof req.body.room !== 'undefined') {
			groupPayload.room = String(req.body.room || '').trim()
		}

		if (typeof req.body.monthlyFee !== 'undefined') {
			const monthlyFee = Number(req.body.monthlyFee)
			if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
				return res.status(400).json({ message: 'monthlyFee must be a non-negative number' })
			}
			groupPayload.monthlyFee = monthlyFee
		}

		if (typeof req.body.note !== 'undefined') {
			groupPayload.note = String(req.body.note || '').trim()
		}

		if (
			Array.isArray(groupPayload.supportTeachers) &&
			groupPayload.supportTeachers.some(supportTeacherId => supportTeacherId === teacher)
		) {
			return res.status(400).json({
				message: 'teacher cannot be listed in supportTeachers',
			})
		}

		const missingUserIds = await findMissingUserIds([
			groupPayload.teacher,
			...(groupPayload.supportTeachers || []),
		])
		if (missingUserIds.length > 0) {
			return res.status(400).json({
				message: `One or more users were not found: ${missingUserIds.join(', ')}`,
			})
		}

		const group = await Group.create(groupPayload)
		const populatedGroup = await Group.findById(group._id)
			.populate('teacher', 'fullname role phone')
			.populate('supportTeachers', 'fullname role phone')
			.populate('students', 'fullname studentPhone parentPhone groupAttached')

		return res.status(201).json({
			message: 'Group created successfully',
			group: attachGroupComputedFields(populatedGroup, 0),
		})
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: 'Group with same name and startDate already exists' })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Create group failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getGroups = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit
		const search = String(req.query.search || '').trim()
		const status = String(req.query.status || '')
			.trim()
			.toLowerCase()

		const query = {}
		if (search) {
			query.$or = [
				{ name: { $regex: search, $options: 'i' } },
				{ course: { $regex: search, $options: 'i' } },
				{ level: { $regex: search, $options: 'i' } },
			]
		}

		if (status) {
			if (!GROUP_STATUSES.includes(status)) {
				return res.status(400).json({ message: 'Invalid status filter' })
			}
			query.status = status
		}

		const [groups, total] = await Promise.all([
			Group.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('teacher', 'fullname role phone')
				.populate('supportTeachers', 'fullname role phone'),
			Group.countDocuments(query),
		])

		const groupIds = groups.map(group => group._id.toString())
		const countsMap = await getActiveStudentCountsByGroupIds(groupIds)

		const normalizedGroups = groups.map(group => {
			const studentsCount = countsMap.get(group._id.toString()) || 0
			return attachGroupComputedFields(group, studentsCount)
		})

		return res.status(200).json({
			page,
			limit,
			total,
			groups: normalizedGroups,
		})
	} catch (error) {
		console.error('Get groups failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getGroupById = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		const group = await Group.findById(groupId)
			.populate('teacher', 'fullname role phone')
			.populate('supportTeachers', 'fullname role phone')
			.populate('students', 'fullname studentPhone parentPhone groupAttached')
			.populate('attendance.student', 'fullname studentPhone')
			.populate('attendance.markedBy', 'fullname role')
		if (!group) {
			return res.status(404).json({ message: 'Group not found' })
		}

		const countsMap = await getActiveStudentCountsByGroupIds([groupId])
		const studentsCount = countsMap.get(groupId) || 0

		return res.status(200).json({
			group: attachGroupComputedFields(group, studentsCount),
		})
	} catch (error) {
		console.error('Get group by id failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateGroup = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		const group = await Group.findById(groupId)
		if (!group) {
			return res.status(404).json({ message: 'Group not found' })
		}

		if (typeof req.body.name !== 'undefined') {
			const name = String(req.body.name || '').trim()
			if (!name) {
				return res.status(400).json({ message: 'name cannot be empty' })
			}
			group.name = name
		}

		if (typeof req.body.course !== 'undefined') {
			const course = String(req.body.course || '').trim()
			if (!course) {
				return res.status(400).json({ message: 'course cannot be empty' })
			}
			group.course = course
		}

		if (typeof req.body.level !== 'undefined') {
			group.level = String(req.body.level || '').trim()
		}

		if (typeof req.body.teacher !== 'undefined') {
			const teacher = String(req.body.teacher || '').trim()
			if (!mongoose.isValidObjectId(teacher)) {
				return res.status(400).json({ message: 'Invalid teacher id' })
			}
			group.teacher = teacher
		}

		if (typeof req.body.supportTeachers !== 'undefined') {
			const supportTeachers = parseObjectIdArray(req.body.supportTeachers)
			if (!supportTeachers) {
				return res.status(400).json({
					message: 'supportTeachers must be an array of valid user ObjectIds',
				})
			}
			group.supportTeachers = supportTeachers
		}

		if (typeof req.body.maxStudents !== 'undefined') {
			const maxStudents = Number(req.body.maxStudents)
			if (!Number.isFinite(maxStudents) || maxStudents < 1 || maxStudents > 100) {
				return res.status(400).json({ message: 'maxStudents must be between 1 and 100' })
			}
			group.maxStudents = maxStudents
		}

		if (typeof req.body.status !== 'undefined') {
			const status = String(req.body.status || '')
				.trim()
				.toLowerCase()
			if (!GROUP_STATUSES.includes(status)) {
				return res.status(400).json({ message: 'Invalid status value' })
			}
			group.status = status
		}

		if (typeof req.body.startDate !== 'undefined') {
			const startDate = parseDateValue(req.body.startDate)
			if (!startDate) {
				return res.status(400).json({ message: 'Invalid startDate value' })
			}
			group.startDate = startDate
		}

		if (typeof req.body.endDate !== 'undefined') {
			if (req.body.endDate === null || req.body.endDate === '') {
				group.endDate = null
			} else {
				const endDate = parseDateValue(req.body.endDate)
				if (!endDate) {
					return res.status(400).json({ message: 'Invalid endDate value' })
				}
				group.endDate = endDate
			}
		}

		if (typeof req.body.schedule !== 'undefined') {
			const schedule = parseSchedule(req.body.schedule)
			if (!schedule) {
				return res.status(400).json({ message: 'Invalid schedule format' })
			}
			group.schedule = schedule
		}

		if (typeof req.body.room !== 'undefined') {
			group.room = String(req.body.room || '').trim()
		}

		if (typeof req.body.monthlyFee !== 'undefined') {
			const monthlyFee = Number(req.body.monthlyFee)
			if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
				return res.status(400).json({ message: 'monthlyFee must be a non-negative number' })
			}
			group.monthlyFee = monthlyFee
		}

		if (typeof req.body.note !== 'undefined') {
			group.note = String(req.body.note || '').trim()
		}

		if (group.supportTeachers.some(supportTeacherId => supportTeacherId.toString() === group.teacher.toString())) {
			return res.status(400).json({
				message: 'teacher cannot be listed in supportTeachers',
			})
		}

		const missingUserIds = await findMissingUserIds([group.teacher, ...group.supportTeachers])
		if (missingUserIds.length > 0) {
			return res.status(400).json({
				message: `One or more users were not found: ${missingUserIds.join(', ')}`,
			})
		}

		await group.save()

		const updatedGroup = await Group.findById(groupId)
			.populate('teacher', 'fullname role phone')
			.populate('supportTeachers', 'fullname role phone')
			.populate('students', 'fullname studentPhone parentPhone groupAttached')
			.populate('attendance.student', 'fullname studentPhone')
			.populate('attendance.markedBy', 'fullname role')

		const countsMap = await getActiveStudentCountsByGroupIds([groupId])
		const studentsCount = countsMap.get(groupId) || 0

		return res.status(200).json({
			message: 'Group updated successfully',
			group: attachGroupComputedFields(updatedGroup, studentsCount),
		})
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: 'Group with same name and startDate already exists' })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update group failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getGroupStudents = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		const groupExists = await Group.exists({ _id: groupId })
		if (!groupExists) {
			return res.status(404).json({ message: 'Group not found' })
		}

		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit
		const search = String(req.query.search || '').trim()
		const membershipStatus = String(req.query.membershipStatus || '')
			.trim()
			.toLowerCase()

		const groupMembershipFilter = { group: new mongoose.Types.ObjectId(groupId) }
		if (membershipStatus) {
			if (!STUDENT_GROUP_STATUSES.includes(membershipStatus)) {
				return res.status(400).json({
					message: 'membershipStatus must be one of active, paused, completed, left',
				})
			}
			groupMembershipFilter.status = membershipStatus
		}

		const query = {
			groups: {
				$elemMatch: groupMembershipFilter,
			},
		}

		if (search) {
			query.$or = [
				{ fullname: { $regex: search, $options: 'i' } },
				{ studentPhone: { $regex: search, $options: 'i' } },
				{ parentPhone: { $regex: search, $options: 'i' } },
			]
		}

		const [students, total] = await Promise.all([
			Student.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('groups.group', 'name course level status'),
			Student.countDocuments(query),
		])

		const normalizedStudents = students.map(student => {
			const studentObject = student.toObject()
			const membership = studentObject.groups.find(groupItem => {
				const linkedGroup =
					groupItem.group && typeof groupItem.group === 'object'
						? groupItem.group._id
						: groupItem.group
				return linkedGroup && linkedGroup.toString() === groupId
			})

			return {
				...studentObject,
				groupMembership: membership || null,
			}
		})

		return res.status(200).json({
			page,
			limit,
			total,
			students: normalizedStudents,
		})
	} catch (error) {
		console.error('Get group students failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.attachStudentToGroup = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		const studentId = req.params.studentId

		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const [group, student] = await Promise.all([
			Group.findById(groupId).select('_id status maxStudents'),
			Student.findById(studentId),
		])

		if (!group) {
			return res.status(404).json({ message: 'Group not found' })
		}

		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		const membershipIndex = student.groups.findIndex(
			groupItem => groupItem.group.toString() === groupId,
		)
		const existingMembership = membershipIndex === -1 ? null : student.groups[membershipIndex]

		const membershipPayload = parseGroupMembershipPayload({
			...(req.body || {}),
			status:
				typeof req.body?.status === 'undefined'
					? existingMembership?.status || 'active'
					: req.body.status,
		})
		if (membershipPayload.error) {
			return res.status(400).json({ message: membershipPayload.error })
		}

		if (membershipPayload.status === 'active') {
			if (['completed', 'archived'].includes(group.status)) {
				return res.status(400).json({
					message: 'Cannot add active students to completed or archived groups',
				})
			}

			const isActivatingNewSeat =
				!existingMembership || existingMembership.status !== 'active'

			if (isActivatingNewSeat) {
				const activeStudentsCount = await countActiveStudentsForGroup(groupId, {
					excludeStudentId: studentId,
				})
				if (activeStudentsCount >= group.maxStudents) {
					return res.status(409).json({
						message: 'Group has reached maxStudents limit',
					})
				}
			}
		}

		const nextMembership = {
			group: groupId,
			status: membershipPayload.status,
			joinedAt: membershipPayload.joinedAt || existingMembership?.joinedAt || new Date(),
		}

		if (typeof membershipPayload.note !== 'undefined') {
			nextMembership.note = membershipPayload.note
		} else if (existingMembership && typeof existingMembership.note !== 'undefined') {
			nextMembership.note = existingMembership.note
		}

		if (membershipIndex === -1) {
			student.groups.push(nextMembership)
		} else {
			student.groups[membershipIndex] = nextMembership
		}

		await student.save()
		await ensureStudentInGroupList({ groupId, studentId })

		const [updatedStudent, countsMap] = await Promise.all([
			Student.findById(studentId).populate('groups.group', 'name course level status'),
			getActiveStudentCountsByGroupIds([groupId]),
		])

		const studentsCount = countsMap.get(groupId) || 0

		return res.status(membershipIndex === -1 ? 201 : 200).json({
			message:
				membershipIndex === -1
					? 'Student attached to group successfully'
					: 'Student group membership updated successfully',
			group: {
				_id: group._id,
				studentsCount,
				coinBalance: studentsCount * COINS_PER_ACTIVE_STUDENT,
			},
			student: updatedStudent,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Attach student to group failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.detachStudentFromGroup = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		const studentId = req.params.studentId

		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const [group, student] = await Promise.all([
			Group.findById(groupId).select('_id'),
			Student.findById(studentId),
		])

		if (!group) {
			return res.status(404).json({ message: 'Group not found' })
		}

		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		const previousGroupsCount = student.groups.length
		student.groups = student.groups.filter(groupItem => groupItem.group.toString() !== groupId)

		if (student.groups.length === previousGroupsCount) {
			return res.status(404).json({ message: 'Student is not attached to this group' })
		}

		await student.save()
		await removeStudentFromGroupList({ groupId, studentId })

		const [updatedStudent, countsMap] = await Promise.all([
			Student.findById(studentId).populate('groups.group', 'name course level status'),
			getActiveStudentCountsByGroupIds([groupId]),
		])

		const studentsCount = countsMap.get(groupId) || 0

		return res.status(200).json({
			message: 'Student detached from group successfully',
			group: {
				_id: group._id,
				studentsCount,
				coinBalance: studentsCount * COINS_PER_ACTIVE_STUDENT,
			},
			student: updatedStudent,
		})
	} catch (error) {
		console.error('Detach student from group failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteGroup = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		const deletedGroup = await Group.findByIdAndDelete(groupId)
		if (!deletedGroup) {
			return res.status(404).json({ message: 'Group not found' })
		}

		const affectedStudents = await Student.find({ 'groups.group': groupId }).select('_id')
		if (affectedStudents.length > 0) {
			const affectedStudentIds = affectedStudents.map(student => student._id)

			await Student.updateMany(
				{ _id: { $in: affectedStudentIds } },
				{
					$pull: {
						groups: {
							group: groupId,
						},
					},
				},
			)

			await Student.updateMany(
				{ _id: { $in: affectedStudentIds } },
				[
					{
						$set: {
							groupAttached: {
								$gt: [
									{
										$size: {
											$filter: {
												input: '$groups',
												as: 'groupItem',
												cond: { $eq: ['$$groupItem.status', 'active'] },
											},
										},
									},
									0,
								],
							},
						},
					},
				],
			)
		}

		return res.status(200).json({ message: 'Group deleted successfully' })
	} catch (error) {
		console.error('Delete group failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.upsertGroupAttendance = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const groupId = req.params.groupId
		if (!mongoose.isValidObjectId(groupId)) {
			return res.status(400).json({ message: 'Invalid group id' })
		}

		const date = parseDateValue(req.body.date)
		const records = parseAttendanceRecords(req.body.records)

		if (!date || !records) {
			return res.status(400).json({
				message: 'date and records are required, records must be a non-empty array',
			})
		}

		const studentIds = records.map(item => item.student)
		if (new Set(studentIds).size !== studentIds.length) {
			return res.status(400).json({
				message: 'records cannot contain duplicate students for the same request',
			})
		}

		const group = await Group.findById(groupId)
		if (!group) {
			return res.status(404).json({ message: 'Group not found' })
		}

		const activeMembers = await Student.find({
			_id: { $in: studentIds },
			groups: {
				$elemMatch: {
					group: groupId,
					status: 'active',
				},
			},
		}).select('_id')

		if (activeMembers.length !== studentIds.length) {
			return res.status(400).json({
				message: 'All attendance students must be active members of the group',
			})
		}

		const dateKey = toDateKey(date)
		const markedBy = req.user?._id

		for (const record of records) {
			const recordIndex = group.attendance.findIndex(item => {
				return item.student.toString() === record.student && toDateKey(item.date) === dateKey
			})

			const payload = {
				student: record.student,
				date,
				status: record.status,
				note: record.note,
				markedBy,
			}

			if (recordIndex === -1) {
				group.attendance.push(payload)
			} else {
				group.attendance[recordIndex] = payload
			}
		}

		await group.save()

		const updatedGroup = await Group.findById(groupId)
			.populate('teacher', 'fullname role phone')
			.populate('supportTeachers', 'fullname role phone')
			.populate('students', 'fullname studentPhone parentPhone groupAttached')
			.populate('attendance.student', 'fullname studentPhone')
			.populate('attendance.markedBy', 'fullname role')

		const countsMap = await getActiveStudentCountsByGroupIds([groupId])
		const studentsCount = countsMap.get(groupId) || 0

		return res.status(200).json({
			message: 'Attendance updated successfully',
			group: attachGroupComputedFields(updatedGroup, studentsCount),
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Upsert group attendance failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
