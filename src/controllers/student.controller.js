const bcrypt = require('bcrypt')
const mongoose = require('mongoose')

const Student = require('../model/student.model')

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/

const parseGroups = input => {
	if (typeof input === 'undefined') {
		return undefined
	}

	let groups = input
	if (typeof input === 'string') {
		try {
			groups = JSON.parse(input)
		} catch (error) {
			return null
		}
	}

	if (!Array.isArray(groups)) {
		return null
	}

	const normalized = []
	for (const item of groups) {
		if (typeof item === 'string') {
			if (!mongoose.isValidObjectId(item)) {
				return null
			}
			normalized.push({ group: item, status: 'active' })
			continue
		}

		if (!item || typeof item !== 'object' || !item.group) {
			return null
		}

		if (!mongoose.isValidObjectId(item.group)) {
			return null
		}

		normalized.push({
			group: item.group,
			status: item.status || 'active',
			joinedAt: item.joinedAt,
			note: item.note,
		})
	}

	return normalized
}

const parseBirthDate = value => {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

exports.createStudent = async (req, res) => {
	try {
		const fullname = String(req.body.fullname || '').trim()
		const studentPhone = String(req.body.studentPhone || '').trim()
		const parentPhone = String(req.body.parentPhone || '').trim()
		const gender = String(req.body.gender || '')
			.trim()
			.toLowerCase()
		const password = req.body.password
		const note = req.body.note ? String(req.body.note).trim() : undefined
		const groups = parseGroups(req.body.groups)
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
				message:
					'groups must be an array of group objects or group ObjectId strings',
			})
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
			studentPayload.groups = groups
		}

		const student = await Student.create(studentPayload)
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
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getStudents = async (req, res) => {
	try {
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

exports.updateStudent = async (req, res) => {
	try {
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
			const groups = parseGroups(req.body.groups)
			if (!groups) {
				return res.status(400).json({
					message:
						'groups must be an array of group objects or group ObjectId strings',
				})
			}
			updatePayload.groups = groups
		}

		const student = await Student.findById(studentId)
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		Object.assign(student, updatePayload)
		await student.save()

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
		const studentId = req.params.studentId
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid student id' })
		}

		const deletedStudent = await Student.findByIdAndDelete(studentId)
		if (!deletedStudent) {
			return res.status(404).json({ message: 'Student not found' })
		}

		return res.status(200).json({ message: 'Student deleted successfully' })
	} catch (error) {
		console.error('Delete student failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
