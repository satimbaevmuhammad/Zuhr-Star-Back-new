const mongoose = require('mongoose')

const User = require('../model/user.model')
const { FinancialEvent, FINANCIAL_EVENT_TYPES } = require('../models/FinancialEvent.model')
const {
	getFinanceSummary,
	getFinanceSummariesByUserIds,
} = require('../services/finance.service')

const EMPLOYEE_ROLES = new Set([
	'teacher',
	'supportTeacher',
	'headteacher',
	'admin',
	'superadmin',
])

const isPositiveNumber = value => Number.isFinite(value) && value > 0

const normalizeRoleInput = value => {
	const normalized = String(value || '').trim()
	const lowered = normalized.toLowerCase()
	if (lowered === 'supporteacher' || lowered === 'supportteacher') {
		return 'supportTeacher'
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

exports.listEmployees = async (req, res) => {
	try {
		const { page, limit, skip } = parsePagination(req.query)
		const search = String(req.query.search || '').trim()
		const role = normalizeRoleInput(req.query.role || '')

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

		const summariesMap = await getFinanceSummariesByUserIds(
			employees.map(employee => employee._id.toString()),
		)

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

		if (req.query.type) {
			const type = String(req.query.type || '').trim().toLowerCase()
			if (!FINANCIAL_EVENT_TYPES.includes(type)) {
				return res.status(400).json({
					message: `type must be one of ${FINANCIAL_EVENT_TYPES.join(', ')}`,
				})
			}
			query.type = type
		}

		const [transactions, total] = await Promise.all([
			FinancialEvent.find(query)
				.sort({ createdAt: -1, _id: -1 })
				.skip(skip)
				.limit(limit)
				.populate('userId', 'fullname phone role')
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

		const summary = await getFinanceSummary(employeeId)
		return res.status(200).json({
			employee: {
				_id: employeeResult.employee._id,
				fullname: employeeResult.employee.fullname,
				phone: employeeResult.employee.phone,
				email: employeeResult.employee.email,
				role: employeeResult.employee.role,
				imgURL: employeeResult.employee.imgURL,
				forbidens: employeeResult.employee.forbidens || [],
			},
			summary,
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

		const note = String(req.body.note || '').trim() || 'Salary updated'
		const event = await FinancialEvent.create({
			userId: employeeId,
			type: 'salary_update',
			amount: salary,
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

		const event = await FinancialEvent.create({
			userId: employeeId,
			type: 'bonus',
			amount,
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

		const event = await FinancialEvent.create({
			userId: employeeId,
			type: 'fine',
			amount,
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
