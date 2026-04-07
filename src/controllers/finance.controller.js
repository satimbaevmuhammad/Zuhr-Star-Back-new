const mongoose = require('mongoose')

const User = require('../model/user.model')
const Student = require('../model/student.model')
const { FinancialEvent, FINANCIAL_EVENT_TYPES, getCurrentMonth } = require('../models/FinancialEvent.model')
const {
	getFinanceSummary,
	getFinanceSummariesByUserIds,
	getFinanceSummariesByUserIdsForMonth,
	getEmployeeMonthlyHistory,
} = require('../services/finance.service')

const EMPLOYEE_ROLES = new Set([
	'teacher',
	'supporteacher',
	'headteacher',
	'admin',
	'superadmin',
])

const isPositiveNumber = value => Number.isFinite(value) && value > 0

const isValidMonth = value => /^\d{4}-\d{2}$/.test(String(value || ''))

const normalizeRoleInput = value => {
	const normalized = String(value || '').trim()
	const lowered = normalized.toLowerCase()
	if (lowered === 'supportteacher') {
		return 'supporteacher'
	}
	return lowered
}

const parsePagination = query => {
	const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
	const page = Math.max(Number(query.page) || 1, 1)
	const skip = (page - 1) * limit
	return { page, limit, skip }
}

const resolveEmployee = async employeeId => {
	if (!mongoose.isValidObjectId(employeeId)) {
		return { error: 'Invalid employee id', statusCode: 400 }
	}

	const employee = await User.findById(employeeId).select('fullname phone email role forbidens imgURL')
	if (!employee) {
		return { error: 'Employee not found', statusCode: 404 }
	}

	return { employee }
}

// Build a MongoDB $or clause that matches a target month on both new docs (month field)
// and legacy docs (no month field, derive from createdAt).
const buildMonthQuery = month => {
	const [year, monthNum] = month.split('-').map(Number)
	const startDate = new Date(year, monthNum - 1, 1)
	const endDate = new Date(year, monthNum, 1)
	return {
		$or: [
			{ month },
			{ month: null, createdAt: { $gte: startDate, $lt: endDate } },
		],
	}
}

exports.listEmployees = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query)
		const search = String(req.query.search || '').trim()
		const role = normalizeRoleInput(req.query.role || '')

		let monthFilter = null
		if (req.query.month) {
			const month = String(req.query.month).trim()
			if (!isValidMonth(month)) {
				return res.status(400).json({ message: 'month must be in YYYY-MM format' })
			}
			monthFilter = month
		}

		const query = {}
		if (search) {
			query.$or = [
				{ fullname: { $regex: search, $options: 'i' } },
				{ phone: { $regex: search, $options: 'i' } },
				{ email: { $regex: search, $options: 'i' } },
			]
		}
		if (role && EMPLOYEE_ROLES.has(role)) {
			query.role = role
		}

		const [employees, total] = await Promise.all([
			User.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.select('fullname phone email role forbidens imgURL'),
			User.countDocuments(query),
		])

		const userIds = employees.map(employee => employee._id.toString())
		const summariesMap = monthFilter
			? await getFinanceSummariesByUserIdsForMonth(userIds, monthFilter)
			: await getFinanceSummariesByUserIds(userIds)

		const normalized = employees.map(employee => ({
			_id: employee._id,
			fullname: employee.fullname,
			phone: employee.phone,
			email: employee.email,
			role: employee.role,
			imgURL: employee.imgURL,
			forbidensCount: Array.isArray(employee.forbidens) ? employee.forbidens.length : 0,
			finance: summariesMap.get(employee._id.toString()) || {
				salary: 0,
				totalBonuses: 0,
				totalFines: 0,
				net: 0,
				takeHomeEstimate: 0,
			},
		}))

		return res.status(200).json({
			page,
			limit,
			total,
			data: normalized,
		})
	} catch (error) {
		console.error('List employees failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listTransactions = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query)

		const query = {}

		if (req.query.employeeId) {
			if (!mongoose.isValidObjectId(req.query.employeeId)) {
				return res.status(400).json({ message: 'Invalid employeeId' })
			}
			query.userId = req.query.employeeId
		}

		if (req.query.studentId) {
			if (!mongoose.isValidObjectId(req.query.studentId)) {
				return res.status(400).json({ message: 'Invalid studentId' })
			}
			query.studentId = req.query.studentId
		}

		if (req.query.type) {
			const type = String(req.query.type || '').trim().toLowerCase()
			if (!FINANCIAL_EVENT_TYPES.includes(type)) {
				return res.status(400).json({
					message: `type must be one of ${FINANCIAL_EVENT_TYPES.join(', ')}`,
				})
			}
			query.type = type
		}

		if (req.query.month) {
			const month = String(req.query.month).trim()
			if (!isValidMonth(month)) {
				return res.status(400).json({ message: 'month must be in YYYY-MM format' })
			}
			Object.assign(query, buildMonthQuery(month))
		}

		const [transactions, total] = await Promise.all([
			FinancialEvent.find(query)
				.sort({ createdAt: -1, _id: -1 })
				.skip(skip)
				.limit(limit)
				.populate('userId', 'fullname phone role')
				.populate('studentId', 'fullname studentPhone')
				.populate('createdBy', 'fullname role')
				.populate('relatedViolationId', 'note fineAmount createdAt'),
			FinancialEvent.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: transactions })
	} catch (error) {
		console.error('List finance transactions failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getEmployeeFinanceSummary = async (req, res) => {
	try {
		const { employeeId } = req.params
		const employeeResult = await resolveEmployee(employeeId)
		if (employeeResult.error) {
			return res.status(employeeResult.statusCode).json({ message: employeeResult.error })
		}

		const history = await getEmployeeMonthlyHistory(employeeId)
		return res.status(200).json({
			employeeId: employeeResult.employee._id,
			history,
		})
	} catch (error) {
		console.error('Get employee finance summary failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateEmployeeSalary = async (req, res) => {
	try {
		const { employeeId } = req.params
		const employeeResult = await resolveEmployee(employeeId)
		if (employeeResult.error) {
			return res.status(employeeResult.statusCode).json({ message: employeeResult.error })
		}

		const salary = Number(req.body.salary)
		if (!Number.isFinite(salary) || salary < 0) {
			return res.status(400).json({ message: 'salary must be a non-negative number' })
		}

		const month = req.body.month ? String(req.body.month).trim() : getCurrentMonth()
		if (!isValidMonth(month)) {
			return res.status(400).json({ message: 'month must be in YYYY-MM format' })
		}

		const note = String(req.body.note || '').trim() || 'Salary updated'
		const event = await FinancialEvent.create({
			userId: employeeId,
			type: 'salary_update',
			amount: salary,
			month,
			note,
			createdBy: req.user.id,
		})

		const summary = await getFinanceSummary(employeeId)
		return res.status(200).json({
			message: 'Salary updated successfully',
			event,
			summary,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}

		console.error('Update employee salary failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.addBonus = async (req, res) => {
	try {
		const { employeeId } = req.params
		const employeeResult = await resolveEmployee(employeeId)
		if (employeeResult.error) {
			return res.status(employeeResult.statusCode).json({ message: employeeResult.error })
		}

		const amount = Number(req.body.amount)
		if (!isPositiveNumber(amount)) {
			return res.status(400).json({ message: 'amount must be a positive number' })
		}

		const note = String(req.body.reason || req.body.note || '').trim()
		if (!note) {
			return res.status(400).json({ message: 'reason is required' })
		}

		const month = req.body.month ? String(req.body.month).trim() : getCurrentMonth()
		if (!isValidMonth(month)) {
			return res.status(400).json({ message: 'month must be in YYYY-MM format' })
		}

		const event = await FinancialEvent.create({
			userId: employeeId,
			type: 'bonus',
			amount,
			month,
			note,
			createdBy: req.user.id,
		})

		const summary = await getFinanceSummary(employeeId)
		return res.status(201).json({
			message: 'Bonus added',
			event,
			summary,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}

		console.error('Add bonus failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.addFine = async (req, res) => {
	try {
		const { employeeId } = req.params
		const employeeResult = await resolveEmployee(employeeId)
		if (employeeResult.error) {
			return res.status(employeeResult.statusCode).json({ message: employeeResult.error })
		}

		const amount = Number(req.body.amount)
		if (!isPositiveNumber(amount)) {
			return res.status(400).json({ message: 'amount must be a positive number' })
		}

		const note = String(req.body.reason || req.body.note || '').trim()
		if (!note) {
			return res.status(400).json({ message: 'reason is required' })
		}

		const month = req.body.month ? String(req.body.month).trim() : getCurrentMonth()
		if (!isValidMonth(month)) {
			return res.status(400).json({ message: 'month must be in YYYY-MM format' })
		}

		const event = await FinancialEvent.create({
			userId: employeeId,
			type: 'fine',
			amount,
			month,
			note,
			createdBy: req.user.id,
		})

		const summary = await getFinanceSummary(employeeId)
		return res.status(201).json({
			message: 'Fine added',
			event,
			summary,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}

		console.error('Add fine failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteTransaction = async (req, res) => {
	try {
		const { transactionId } = req.params
		if (!mongoose.isValidObjectId(transactionId)) {
			return res.status(400).json({ message: 'Invalid transaction id' })
		}

		const event = await FinancialEvent.findById(transactionId).select('_id relatedViolationId')
		if (!event) {
			return res.status(404).json({ message: 'Transaction not found' })
		}

		if (event.relatedViolationId) {
			return res.status(409).json({
				message: 'Transaction is linked to a violation',
				code: 'VIOLATION_LINKED',
				violationId: event.relatedViolationId.toString(),
			})
		}

		return res.status(405).json({
			message: 'Transactions are immutable and cannot be deleted',
		})
	} catch (error) {
		console.error('Delete transaction failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getEmployeeBonuses = async (req, res) => {
	try {
		const { employeeId } = req.params
		const employeeResult = await resolveEmployee(employeeId)
		if (employeeResult.error) {
			return res.status(employeeResult.statusCode).json({ message: employeeResult.error })
		}

		const events = await FinancialEvent.aggregate([
			{ $match: { userId: new mongoose.Types.ObjectId(employeeId), type: 'bonus' } },
			{
				$addFields: {
					effectiveMonth: {
						$ifNull: ['$month', { $dateToString: { format: '%Y-%m', date: '$createdAt' } }],
					},
				},
			},
			{ $sort: { effectiveMonth: -1, createdAt: -1 } },
			{
				$project: {
					_id: 1,
					amount: 1,
					reason: '$note',
					month: '$effectiveMonth',
					createdAt: 1,
				},
			},
		])

		return res.status(200).json({ data: events })
	} catch (error) {
		console.error('Get employee bonuses failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getEmployeeFines = async (req, res) => {
	try {
		const { employeeId } = req.params
		const employeeResult = await resolveEmployee(employeeId)
		if (employeeResult.error) {
			return res.status(employeeResult.statusCode).json({ message: employeeResult.error })
		}

		const events = await FinancialEvent.aggregate([
			{ $match: { userId: new mongoose.Types.ObjectId(employeeId), type: 'fine' } },
			{
				$addFields: {
					effectiveMonth: {
						$ifNull: ['$month', { $dateToString: { format: '%Y-%m', date: '$createdAt' } }],
					},
				},
			},
			{ $sort: { effectiveMonth: -1, createdAt: -1 } },
			{
				$project: {
					_id: 1,
					amount: 1,
					reason: '$note',
					month: '$effectiveMonth',
					createdAt: 1,
				},
			},
		])

		return res.status(200).json({ data: events })
	} catch (error) {
		console.error('Get employee fines failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.addStudentPayment = async (req, res) => {
	try {
		const { studentId } = req.params
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid studentId' })
		}

		const student = await Student.findById(studentId).select('_id fullname')
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		const amount = Number(req.body.amount)
		if (!isPositiveNumber(amount)) {
			return res.status(400).json({ message: 'amount must be a positive number' })
		}

		const month = req.body.month ? String(req.body.month).trim() : getCurrentMonth()
		if (!isValidMonth(month)) {
			return res.status(400).json({ message: 'month must be in YYYY-MM format' })
		}

		let groupId = null
		if (req.body.groupId) {
			if (!mongoose.isValidObjectId(req.body.groupId)) {
				return res.status(400).json({ message: 'Invalid groupId' })
			}
			groupId = req.body.groupId
		}

		const note = String(req.body.note || '').trim()

		const event = await FinancialEvent.create({
			type: 'student_payment',
			amount,
			month,
			note,
			studentId,
			groupId,
			createdBy: req.user.id,
		})

		await Student.findByIdAndUpdate(studentId, { $inc: { balance: amount } })

		return res.status(201).json({ message: 'Payment recorded', event })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}

		console.error('Add student payment failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getStudentPayments = async (req, res) => {
	try {
		const { studentId } = req.params
		if (!mongoose.isValidObjectId(studentId)) {
			return res.status(400).json({ message: 'Invalid studentId' })
		}

		const student = await Student.findById(studentId).select('_id fullname')
		if (!student) {
			return res.status(404).json({ message: 'Student not found' })
		}

		const events = await FinancialEvent.aggregate([
			{ $match: { studentId: new mongoose.Types.ObjectId(studentId), type: 'student_payment' } },
			{
				$addFields: {
					effectiveMonth: {
						$ifNull: ['$month', { $dateToString: { format: '%Y-%m', date: '$createdAt' } }],
					},
				},
			},
			{ $sort: { effectiveMonth: -1, createdAt: -1 } },
			{
				$project: {
					_id: 1,
					amount: 1,
					note: 1,
					month: '$effectiveMonth',
					groupId: 1,
					createdAt: 1,
				},
			},
		])

		return res.status(200).json({ studentId, data: events })
	} catch (error) {
		console.error('Get student payments failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listStudentPayments = async (req, res) => {
	try {
		const matchStage = { type: 'student_payment' }

		if (req.query.groupId) {
			if (!mongoose.isValidObjectId(req.query.groupId)) {
				return res.status(400).json({ message: 'Invalid groupId' })
			}
			matchStage.groupId = new mongoose.Types.ObjectId(req.query.groupId)
		}

		const pipeline = [
			{ $match: matchStage },
			{
				$addFields: {
					effectiveMonth: {
						$ifNull: ['$month', { $dateToString: { format: '%Y-%m', date: '$createdAt' } }],
					},
				},
			},
		]

		if (req.query.month) {
			const month = String(req.query.month).trim()
			if (!isValidMonth(month)) {
				return res.status(400).json({ message: 'month must be in YYYY-MM format' })
			}
			pipeline.push({ $match: { effectiveMonth: month } })
		}

		pipeline.push(
			{ $sort: { effectiveMonth: -1, createdAt: -1 } },
			{
				$project: {
					_id: 1,
					amount: 1,
					note: 1,
					month: '$effectiveMonth',
					studentId: 1,
					groupId: 1,
					createdAt: 1,
				},
			},
		)

		const events = await FinancialEvent.aggregate(pipeline)
		return res.status(200).json({ data: events })
	} catch (error) {
		console.error('List student payments failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
