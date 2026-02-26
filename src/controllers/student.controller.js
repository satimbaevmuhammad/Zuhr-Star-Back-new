const bcrypt = require('bcrypt')
const mongoose = require('mongoose')

const Group = require('../model/group.model')
const Student = require('../model/student.model')
const { resetStudentBalancesIfNeeded } = require('../services/student-balance-reset.service')
const { stack } = require('../routes/group.routes')

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
const STUDENT_GROUP_STATUSES = ['active', 'paused', 'completed', 'left']

const parseGroupIds = input => {
	if (typeof input === 'undefined') {
		return undefined
	}

	let groups = input
	if (typeof input === 'string') {
		try {
			groups = JSON.parse(input)
		} catch (error) {
			groups = [input.trim()]
		}
	}

	if (!Array.isArray(groups)) {
		return null
	}

	const normalizedIds = []
	for (const item of groups) {
		const groupId = String(item || '').trim()
		if (!groupId || !mongoose.isValidObjectId(groupId)) {
			return null
		}
		normalizedIds.push(groupId)
	}

	const uniqueIds = [...new Set(normalizedIds)]
	if (uniqueIds.length !== normalizedIds.length) {
		return null
	}

	return uniqueIds
}

const toStudentGroupMemberships = groupIds =>
	groupIds.map(groupId => ({
		group: groupId,
		status: 'active',
	}))

const normalizeObjectIdArray = values => {
	if (!Array.isArray(values)) {
		return []
	}

	const seen = new Set()
	const normalized = []
	for (const value of values) {
		const id = String(value || '').trim()
		if (!id || !mongoose.isValidObjectId(id) || seen.has(id)) {
			continue
		}
		seen.add(id)
		normalized.push(new mongoose.Types.ObjectId(id))
	}

	return normalized
}

const syncGroupStudentLinks = async ({ studentId, previousGroupIds = [], nextGroupIds = [] }) => {
	const previousSet = new Set(previousGroupIds.map(groupId => String(groupId)))
	const nextSet = new Set(nextGroupIds.map(groupId => String(groupId)))

	const groupsToAdd = [...nextSet].filter(groupId => !previousSet.has(groupId))
	const groupsToRemove = [...previousSet].filter(groupId => !nextSet.has(groupId))

	const normalizedStudentId = String(studentId)

	if (groupsToAdd.length > 0) {
		const groups = await Group.find({ _id: { $in: groupsToAdd } }).select('_id students')
		const updates = groups.map(group => {
			const currentStudents = normalizeObjectIdArray(group.students)
			if (!currentStudents.some(id => id.toString() === normalizedStudentId)) {
				currentStudents.push(new mongoose.Types.ObjectId(normalizedStudentId))
			}

			return {
				updateOne: {
					filter: { _id: group._id },
					update: { $set: { students: currentStudents } },
				},
			}
		})

		if (updates.length > 0) {
			await Group.bulkWrite(updates)
		}
	}

	if (groupsToRemove.length > 0) {
		const groups = await Group.find({ _id: { $in: groupsToRemove } }).select('_id students')
		const updates = groups.map(group => {
			const currentStudents = normalizeObjectIdArray(group.students)
			const nextStudents = currentStudents.filter(id => id.toString() !== normalizedStudentId)

			return {
				updateOne: {
					filter: { _id: group._id },
					update: { $set: { students: nextStudents } },
				},
			}
		})

		if (updates.length > 0) {
			await Group.bulkWrite(updates)
		}
	}
}

const parseBirthDate = value => {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

const runBalanceResetSafely = async () => {
	try {
		await resetStudentBalancesIfNeeded()
	} catch (error) {
		console.error('Student balance reset check failed:', error)
	}
}

const countActiveMembershipsByGroupIds = async (groupIds, { excludeStudentId } = {}) => {
	if (!Array.isArray(groupIds) || groupIds.length === 0) {
		return new Map()
	}

	const objectIds = groupIds.map(groupId => new mongoose.Types.ObjectId(groupId))
	const matchStage = {
		groups: {
			$elemMatch: {
				group: { $in: objectIds },
				status: 'active',
			},
		},
	}

	if (excludeStudentId && mongoose.isValidObjectId(excludeStudentId)) {
		matchStage._id = { $ne: new mongoose.Types.ObjectId(excludeStudentId) }
	}

	const stats = await Student.aggregate([
		{
			$match: matchStage,
		},
		{
			$unwind: '$groups',
		},
		{
			$match: {
				'groups.group': { $in: objectIds },
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

const validateGroupAssignments = async (groupIds, { excludeStudentId } = {}) => {
	if (!Array.isArray(groupIds) || groupIds.length === 0) {
		return null
	}

	const groupDocs = await Group.find({ _id: { $in: groupIds } }).select('_id status maxStudents')

	if (groupDocs.length !== groupIds.length) {
		const found = new Set(groupDocs.map(group => group._id.toString()))
		const missing = groupIds.filter(groupId => !found.has(groupId))
		return {
			statusCode: 400,
			message: `One or more groups were not found: ${missing.join(', ')}`,
		}
	}

	const groupsById = new Map(groupDocs.map(group => [group._id.toString(), group]))
	const activeGroupIds = [...new Set(groupIds.map(groupId => String(groupId)))]

	for (const activeGroupId of activeGroupIds) {
		const linkedGroup = groupsById.get(activeGroupId)
		if (linkedGroup && ['completed', 'archived'].includes(linkedGroup.status)) {
			return {
				statusCode: 400,
				message: 'Cannot attach an active student membership to completed or archived groups',
			}
		}
	}

	const activeCounts = await countActiveMembershipsByGroupIds(activeGroupIds, {
		excludeStudentId,
	})

	for (const activeGroupId of activeGroupIds) {
		const linkedGroup = groupsById.get(activeGroupId)
		const currentActiveCount = activeCounts.get(activeGroupId) || 0
		if (linkedGroup && currentActiveCount >= linkedGroup.maxStudents) {
			return {
				statusCode: 409,
				message: `Group ${activeGroupId} has reached maxStudents limit`,
			}
		}
	}

	return null
}

exports.createStudent = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const fullname = String(req.body.fullname || '').trim()
		const studentPhone = String(req.body.studentPhone || '').trim()
		const parentPhone = String(req.body.parentPhone || '').trim()
		const gender = String(req.body.gender || '')
			.trim()
			.toLowerCase()
		const password = req.body.password
		const note = req.body.note ? String(req.body.note).trim() : undefined
		const groups = parseGroupIds(req.body.groups)
		const birthDate = parseBirthDate(req.body.birthDate)

		if (!fullname || !studentPhone || !parentPhone || !gender || !birthDate || !password) {
			return res.status(400).json({
				message:
					'fullname, studentPhone, parentPhone, gender, birthDate and password are required',
			})
		}

		if (!['male', 'female'].includes(gender)) {
			return res.status(400).json({ message: 'Gender must be male or female' })
		}

		if (!PHONE_PATTERN.test(studentPhone) || !PHONE_PATTERN.test(parentPhone)) {
			return res.status(400).json({ message: 'Phone must contain 7-15 digits' })
		}

		if (password.length < 8) {
			return res.status(400).json({ message: 'Password must be at least 8 characters' })
		}

		if (typeof req.body.groups !== 'undefined' && !groups) {
			return res.status(400).json({
				message: 'groups must be an array of group ObjectId strings',
			})
		}

		if (groups) {
			const groupValidation = await validateGroupAssignments(groups)
			if (groupValidation) {
				return res.status(groupValidation.statusCode).json({ message: groupValidation.message })
			}
		}

		const existingStudent = await Student.findOne({ studentPhone })
		if (existingStudent) {
			return res.status(409).json({
				message: 'Student with this phone number already exists',
			})
		}

		const hashedPassword = await bcrypt.hash(password, 12)
		const studentPayload = {
			fullname,
			studentPhone,
			parentPhone,
			gender,
			birthDate,
			note,
			password: hashedPassword,
		}

		if (groups) {
			studentPayload.groups = toStudentGroupMemberships(groups)
		}

		const student = await Student.create(studentPayload)
		if (groups && groups.length > 0) {
			await syncGroupStudentLinks({
				studentId: student._id,
				previousGroupIds: [],
				nextGroupIds: groups,
			}).catch(syncError => {
				console.error('Create student group sync failed:', syncError)
			})
		}

		return res.status(201).json({
			message: 'Student created successfully',
			student,
		})
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({
				message: 'Student with this phone number already exists',
			})
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Create student failed:', error)
		return res.status(500).json({ message: 'Internal server error', error: error.message, stack: error.stack })
	}
}

exports.getStudents = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit
		const search = String(req.query.search || '').trim()

		const query = {}
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

		return res.status(200).json({
			page,
			limit,
			total,
			students,
		})
	} catch (error) {
		console.error('Get students failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getStudentById = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const studentId = req.params.studentId
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const student = await Student.findById(studentId).populate(
			'groups.group',
			'name course level status',
		)
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		return res.status(200).json({ student })
	} catch (error) {
		console.error('Get student by id failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getStudentGroups = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const studentId = req.params.studentId
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const membershipStatus = String(req.query.membershipStatus || '')
			.trim()
			.toLowerCase()

		if (membershipStatus && !STUDENT_GROUP_STATUSES.includes(membershipStatus)) {
			return res.status(400).json({
				message: 'membershipStatus must be one of active, paused, completed, left',
			})
		}

		const student = await Student.findById(studentId).populate(
			'groups.group',
			'name course level status teacher supportTeachers maxStudents startDate endDate schedule room monthlyFee',
		)
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		let groups = student.groups
		if (membershipStatus) {
			groups = groups.filter(groupItem => groupItem.status === membershipStatus)
		}

		const normalizedGroups = groups.map(groupItem => ({
			group: groupItem.group,
			status: groupItem.status,
			joinedAt: groupItem.joinedAt,
			note: groupItem.note,
		}))

		return res.status(200).json({
			studentId: student._id,
			groupAttached: student.groupAttached,
			totalGroups: normalizedGroups.length,
			groups: normalizedGroups,
		})
	} catch (error) {
		console.error('Get student groups failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.rewardStudentCoins = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const studentId = req.params.studentId
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const amount = Number(req.body.amount)
		if (!Number.isInteger(amount) || amount <= 0) {
			return res.status(400).json({ message: 'amount must be a positive integer' })
		}

		const note =
			typeof req.body.note === 'undefined' ? undefined : String(req.body.note || '').trim()
		if (typeof note !== 'undefined' && note.length > 300) {
			return res.status(400).json({ message: 'note must be 300 characters or less' })
		}

		const student = await Student.findById(studentId)
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		student.coinBalance += amount
		await student.save()

		return res.status(200).json({
			message: 'Student rewarded with coins successfully',
			rewardedCoins: amount,
			note: note || null,
			student,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Reward student coins failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateStudent = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const studentId = req.params.studentId
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const updatePayload = {}

		if (typeof req.body.fullname !== 'undefined') {
			const fullname = String(req.body.fullname || '').trim()
			if (!fullname) {
				return res.status(400).json({ message: 'fullname cannot be empty' })
			}
			updatePayload.fullname = fullname
		}

		if (typeof req.body.studentPhone !== 'undefined') {
			const studentPhone = String(req.body.studentPhone || '').trim()
			if (!PHONE_PATTERN.test(studentPhone)) {
				return res.status(400).json({ message: 'Invalid studentPhone format' })
			}
			updatePayload.studentPhone = studentPhone
		}

		if (typeof req.body.parentPhone !== 'undefined') {
			const parentPhone = String(req.body.parentPhone || '').trim()
			if (!PHONE_PATTERN.test(parentPhone)) {
				return res.status(400).json({ message: 'Invalid parentPhone format' })
			}
			updatePayload.parentPhone = parentPhone
		}

		if (typeof req.body.gender !== 'undefined') {
			const gender = String(req.body.gender || '')
				.trim()
				.toLowerCase()
			if (!['male', 'female'].includes(gender)) {
				return res.status(400).json({ message: 'Gender must be male or female' })
			}
			updatePayload.gender = gender
		}

		if (typeof req.body.birthDate !== 'undefined') {
			const birthDate = parseBirthDate(req.body.birthDate)
			if (!birthDate) {
				return res.status(400).json({ message: 'Invalid birthDate value' })
			}
			updatePayload.birthDate = birthDate
		}

		if (typeof req.body.note !== 'undefined') {
			updatePayload.note = req.body.note ? String(req.body.note).trim() : ''
		}

		if (typeof req.body.balance !== 'undefined') {
			const balance = Number(req.body.balance)
			if (!Number.isFinite(balance) || balance < 0) {
				return res.status(400).json({ message: 'balance must be a non-negative number' })
			}
			updatePayload.balance = balance
		}

		if (typeof req.body.coinBalance !== 'undefined') {
			const coinBalance = Number(req.body.coinBalance)
			if (!Number.isFinite(coinBalance) || coinBalance < 0) {
				return res
					.status(400)
					.json({ message: 'coinBalance must be a non-negative number' })
			}
			updatePayload.coinBalance = coinBalance
		}

		if (typeof req.body.password !== 'undefined') {
			const password = String(req.body.password || '')
			if (password.length < 8) {
				return res
					.status(400)
					.json({ message: 'Password must be at least 8 characters' })
			}
			updatePayload.password = await bcrypt.hash(password, 12)
		}

		if (typeof req.body.groups !== 'undefined') {
			const groups = parseGroupIds(req.body.groups)
			if (!groups) {
				return res.status(400).json({
					message: 'groups must be an array of group ObjectId strings',
				})
			}

			const groupValidation = await validateGroupAssignments(groups, {
				excludeStudentId: studentId,
			})
			if (groupValidation) {
				return res.status(groupValidation.statusCode).json({ message: groupValidation.message })
			}

			updatePayload.groups = toStudentGroupMemberships(groups)
		}

		const student = await Student.findById(studentId)
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		const previousGroupIds = student.groups.map(groupItem => groupItem.group.toString())

		Object.assign(student, updatePayload)
		await student.save()

		if (typeof req.body.groups !== 'undefined') {
			const nextGroupIds = student.groups.map(groupItem => groupItem.group.toString())
			await syncGroupStudentLinks({
				studentId,
				previousGroupIds,
				nextGroupIds,
			}).catch(syncError => {
				console.error('Update student group sync failed:', syncError)
			})
		}

		const updatedStudent = await Student.findById(studentId).populate(
			'groups.group',
			'name course level status',
		)

		return res.status(200).json({
			message: 'Student updated successfully',
			student: updatedStudent,
		})
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({
				message: 'Student with this phone number already exists',
			})
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update student failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteStudent = async (req, res) => {
	try {
		await runBalanceResetSafely()

		const studentId = req.params.studentId
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const deletedStudent = await Student.findByIdAndDelete(studentId)
		if (!deletedStudent) {
			return res.status(404).json({ message: 'Student not found' })
		}

		const previousGroupIds = (deletedStudent.groups || []).map(groupItem =>
			groupItem.group.toString(),
		)
		if (previousGroupIds.length > 0) {
			await syncGroupStudentLinks({
				studentId,
				previousGroupIds,
				nextGroupIds: [],
			}).catch(syncError => {
				console.error('Delete student group sync failed:', syncError)
			})
		}

		return res.status(200).json({ message: 'Student deleted successfully' })
	} catch (error) {
		console.error('Delete student failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
