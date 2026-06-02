const mongoose = require('mongoose')
const ForbiddenRule = require('../model/forbidden-rule.model')
const EmployeeViolation = require('../model/employee-violation.model')
const User = require('../model/user.model')
const { FinancialEvent } = require('../models/FinancialEvent.model')

// -------------------------------------------------------------------------------
// FORBIDDEN RULES
// -------------------------------------------------------------------------------

exports.listRules = async (req, res) => {
	try {
		const rules = await ForbiddenRule.find()
			.sort({ createdAt: -1 })
			.populate('createdBy', 'fullname role')

		return res.status(200).json({
			page: 1,
			limit: rules.length,
			total: rules.length,
			data: rules,
		})
	} catch (error) {
		console.error('List forbidden rules failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.createRule = async (req, res) => {
	try {
		const name = String(req.body.name || '').trim()
		const description = req.body.description ? String(req.body.description).trim() : undefined
		const defaultFineAmount = Number(req.body.defaultFineAmount ?? 0)

		if (!name) {
			return res.status(400).json({ message: 'name is required' })
		}

		if (!Number.isFinite(defaultFineAmount) || defaultFineAmount < 0) {
			return res.status(400).json({ message: 'defaultFineAmount must be a non-negative number' })
		}

		const rule = await ForbiddenRule.create({
			name,
			description,
			defaultFineAmount,
			createdBy: req.user.id,
		})

		return res.status(201).json({ message: 'Forbidden rule created', rule })
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: 'A rule with this name already exists' })
		}
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('Create forbidden rule failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateRule = async (req, res) => {
	try {
		const { ruleId } = req.params
		if (!mongoose.isValidObjectId(ruleId)) {
			return res.status(400).json({ message: 'Invalid rule id' })
		}

		const rule = await ForbiddenRule.findById(ruleId)
		if (!rule) {
			return res.status(404).json({ message: 'Rule not found' })
		}

		if (typeof req.body.name !== 'undefined') {
			const name = String(req.body.name || '').trim()
			if (!name) return res.status(400).json({ message: 'name cannot be empty' })
			rule.name = name
		}

		if (typeof req.body.description !== 'undefined') {
			rule.description = String(req.body.description || '').trim() || undefined
		}

		if (typeof req.body.defaultFineAmount !== 'undefined') {
			const amount = Number(req.body.defaultFineAmount)
			if (!Number.isFinite(amount) || amount < 0) {
				return res.status(400).json({ message: 'defaultFineAmount must be a non-negative number' })
			}
			rule.defaultFineAmount = amount
		}

		await rule.save()
		return res.status(200).json({ message: 'Rule updated', rule })
	} catch (error) {
		if (error.code === 11000) {
			return res.status(409).json({ message: 'A rule with this name already exists' })
		}
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('Update forbidden rule failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteRule = async (req, res) => {
	try {
		const { ruleId } = req.params
		if (!mongoose.isValidObjectId(ruleId)) {
			return res.status(400).json({ message: 'Invalid rule id' })
		}

		const rule = await ForbiddenRule.findByIdAndDelete(ruleId)
		if (!rule) {
			return res.status(404).json({ message: 'Rule not found' })
		}

		return res.status(200).json({ message: 'Rule deleted' })
	} catch (error) {
		console.error('Delete forbidden rule failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// -------------------------------------------------------------------------------
// EMPLOYEE VIOLATIONS
// -------------------------------------------------------------------------------

exports.listViolations = async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit

		const query = {}
		if (req.query.employeeId) {
			if (!mongoose.isValidObjectId(req.query.employeeId)) {
				return res.status(400).json({ message: 'Invalid employeeId' })
			}
			query.employee = req.query.employeeId
		}
		if (req.query.ruleId) {
			if (!mongoose.isValidObjectId(req.query.ruleId)) {
				return res.status(400).json({ message: 'Invalid ruleId' })
			}
			query.rule = req.query.ruleId
		}

		const [violations, total] = await Promise.all([
			EmployeeViolation.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('employee', 'fullname phone role')
				.populate('rule', 'name defaultFineAmount')
				.populate('recordedBy', 'fullname role'),
			EmployeeViolation.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: violations })
	} catch (error) {
		console.error('List violations failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.recordViolation = async (req, res) => {
	try {
		const employeeId = String(req.body.employeeId || '').trim()
		const ruleId = String(req.body.ruleId || '').trim()
		const note = req.body.note ? String(req.body.note).trim() : undefined
		const fineOverride =
			typeof req.body.fineAmount !== 'undefined' ? Number(req.body.fineAmount) : undefined

		if (!employeeId || !ruleId) {
			return res.status(400).json({ message: 'employeeId and ruleId are required' })
		}

		if (!mongoose.isValidObjectId(employeeId)) {
			return res.status(400).json({ message: 'Invalid employeeId' })
		}
		if (!mongoose.isValidObjectId(ruleId)) {
			return res.status(400).json({ message: 'Invalid ruleId' })
		}

		if (typeof fineOverride !== 'undefined' && (!Number.isFinite(fineOverride) || fineOverride < 0)) {
			return res.status(400).json({ message: 'fineAmount must be a non-negative number' })
		}

		const [employee, rule] = await Promise.all([
			User.findById(employeeId),
			ForbiddenRule.findById(ruleId),
		])

		if (!employee) {
			return res.status(404).json({ message: 'Employee not found' })
		}
		if (!rule) {
			return res.status(404).json({ message: 'Forbidden rule not found' })
		}

		const fineAmount = typeof fineOverride !== 'undefined' ? fineOverride : rule.defaultFineAmount

		const violation = await EmployeeViolation.create({
			employee: employeeId,
			rule: ruleId,
			fineAmount,
			note,
			recordedBy: req.user.id,
		})

		employee.forbidens.push({
			rule: ruleId,
			violationId: violation._id,
			ruleName: rule.name,
			fineAmount,
			note,
			recordedAt: violation.createdAt,
		})
		await employee.save()

		if (fineAmount > 0) {
			await FinancialEvent.create({
				userId: employeeId,
				type: 'fine',
				amount: fineAmount,
				note: `Violation: ${rule.name}${note ? ` - ${note}` : ''}`,
				createdBy: req.user.id,
				relatedViolationId: violation._id,
			})
		}

		const populated = await EmployeeViolation.findById(violation._id)
			.populate('employee', 'fullname phone role')
			.populate('rule', 'name defaultFineAmount')
			.populate('recordedBy', 'fullname role')

		return res.status(201).json({
			message: 'Violation recorded',
			violation: populated,
			fineAmount,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const msg = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: msg || 'Validation failed' })
		}
		console.error('Record violation failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteViolation = async (req, res) => {
	try {
		const { violationId } = req.params
		if (!mongoose.isValidObjectId(violationId)) {
			return res.status(400).json({ message: 'Invalid violation id' })
		}

		const violation = await EmployeeViolation.findByIdAndDelete(violationId)
		if (!violation) {
			return res.status(404).json({ message: 'Violation not found' })
		}

		await User.updateOne(
			{ _id: violation.employee },
			{ $pull: { forbidens: { violationId: violation._id } } },
		)

		if (violation.fineAmount > 0) {
			await FinancialEvent.create({
				userId: violation.employee,
				type: 'fine',
				amount: -Math.abs(Number(violation.fineAmount) || 0),
				note: 'Violation reversal',
				createdBy: req.user.id,
				relatedViolationId: violation._id,
			})
		}

		return res.status(200).json({ message: 'Violation deleted and fine reversal appended' })
	} catch (error) {
		console.error('Delete violation failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
