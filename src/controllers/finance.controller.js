const mongoose = require('mongoose')
const EmployeeFinance = require('../model/employee-finance.model')
const User = require('../model/user.model')

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────

exports.listTransactions = async (req, res) => {
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
		if (req.query.type && ['bonus', 'fine'].includes(req.query.type)) {
			query.type = req.query.type
		}

		const [transactions, total] = await Promise.all([
			EmployeeFinance.find(query)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate('employee', 'fullname phone role')
				.populate('recordedBy', 'fullname role')
				.populate('relatedViolation', 'note createdAt'),
			EmployeeFinance.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, transactions })
	} catch (error) {
		console.error('List finance transactions failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getEmployeeFinanceSummary = async (req, res) => {
	try {
		const { employeeId } = req.params
		if (!mongoose.isValidObjectId(employeeId)) {
			return res.status(400).json({ message: 'Invalid employee id' })
		}

		const employee = await User.findById(employeeId).select(
			'fullname phone role financeBalance forbidens',
		)
		if (!employee) {
			return res.status(404).json({ message: 'Employee not found' })
		}

		// Compute totals from transactions
		const [bonusAgg, fineAgg] = await Promise.all([
			EmployeeFinance.aggregate([
				{ $match: { employee: new mongoose.Types.ObjectId(employeeId), type: 'bonus' } },
				{ $group: { _id: null, total: { $sum: '$amount' } } },
			]),
			EmployeeFinance.aggregate([
				{ $match: { employee: new mongoose.Types.ObjectId(employeeId), type: 'fine' } },
				{ $group: { _id: null, total: { $sum: '$amount' } } },
			]),
		])

		const totalBonuses = bonusAgg[0]?.total || 0
		const totalFines = fineAgg[0]?.total || 0

		return res.status(200).json({
			employee: {
				_id: employee._id,
				fullname: employee.fullname,
				phone: employee.phone,
				role: employee.role,
				financeBalance: employee.financeBalance,
				forbidens: employee.forbidens,
			},
			summary: {
				totalBonuses,
				totalFines,
				net: totalBonuses - totalFines,
			},
		})
	} catch (error) {
		console.error('Get employee finance summary failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.addBonus = async (req, res) => {
	try {
		const { employeeId } = req.params
		if (!mongoose.isValidObjectId(employeeId)) {
			return res.status(400).json({ message: 'Invalid employee id' })
		}

		const amount = Number(req.body.amount)
		if (!Number.isFinite(amount) || amount <= 0) {
			return res.status(400).json({ message: 'amount must be a positive number' })
		}

		const reason = String(req.body.reason || '').trim()
		if (!reason) {
			return res.status(400).json({ message: 'reason is required' })
		}
		if (reason.length > 500) {
			return res.status(400).json({ message: 'reason must be 500 characters or less' })
		}

		const employee = await User.findById(employeeId)
		if (!employee) {
			return res.status(404).json({ message: 'Employee not found' })
		}

		const transaction = await EmployeeFinance.create({
			employee: employeeId,
			type: 'bonus',
			amount,
			reason,
			recordedBy: req.user._id,
		})

		employee.financeBalance += amount
		await employee.save()

		return res.status(201).json({
			message: 'Bonus added',
			transaction,
			newBalance: employee.financeBalance,
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
		if (!mongoose.isValidObjectId(employeeId)) {
			return res.status(400).json({ message: 'Invalid employee id' })
		}

		const amount = Number(req.body.amount)
		if (!Number.isFinite(amount) || amount <= 0) {
			return res.status(400).json({ message: 'amount must be a positive number' })
		}

		const reason = String(req.body.reason || '').trim()
		if (!reason) {
			return res.status(400).json({ message: 'reason is required' })
		}
		if (reason.length > 500) {
			return res.status(400).json({ message: 'reason must be 500 characters or less' })
		}

		const employee = await User.findById(employeeId)
		if (!employee) {
			return res.status(404).json({ message: 'Employee not found' })
		}

		const transaction = await EmployeeFinance.create({
			employee: employeeId,
			type: 'fine',
			amount,
			reason,
			recordedBy: req.user._id,
		})

		employee.financeBalance -= amount
		await employee.save()

		return res.status(201).json({
			message: 'Fine added',
			transaction,
			newBalance: employee.financeBalance,
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

		const tx = await EmployeeFinance.findByIdAndDelete(transactionId)
		if (!tx) {
			return res.status(404).json({ message: 'Transaction not found' })
		}

		// Reverse the balance effect
		const balanceDelta = tx.type === 'bonus' ? -tx.amount : tx.amount
		await User.updateOne(
			{ _id: tx.employee },
			{ $inc: { financeBalance: balanceDelta } },
		)

		return res.status(200).json({ message: 'Transaction deleted and balance reversed' })
	} catch (error) {
		console.error('Delete transaction failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
