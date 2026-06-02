/**
 * Finance service helpers.
 * Exports ledger aggregation functions to compute finance summaries from FinancialEvent.
 */

const mongoose = require('mongoose')
const { FinancialEvent } = require('../models/FinancialEvent.model')

const SALARY_EVENT_TYPES = ['salary', 'salary_update']

const toMoneyNumber = value => {
	const number = Number(value)
	return Number.isFinite(number) ? number : 0
}

const normalizeUserIds = userIds =>
	[...new Set((userIds || []).map(userId => String(userId || '').trim()))].filter(userId =>
		mongoose.isValidObjectId(userId),
	)

const buildEmptySummary = () => ({
	salary: 0,
	totalBonuses: 0,
	totalFines: 0,
	net: 0,
	takeHomeEstimate: 0,
})

const finalizeSummary = summary => {
	const salary = toMoneyNumber(summary.salary)
	const totalBonuses = toMoneyNumber(summary.totalBonuses)
	const totalFines = toMoneyNumber(summary.totalFines)
	const net = salary + totalBonuses - totalFines

	return {
		salary,
		totalBonuses,
		totalFines,
		net,
		takeHomeEstimate: net,
	}
}

// Derive effectiveMonth from the month field, falling back to createdAt for legacy docs
const EFFECTIVE_MONTH_FIELD = {
	effectiveMonth: {
		$ifNull: ['$month', { $dateToString: { format: '%Y-%m', date: '$createdAt' } }],
	},
}

const getFinanceSummariesByUserIds = async userIds => {
	const normalizedUserIds = normalizeUserIds(userIds)
	if (normalizedUserIds.length === 0) {
		return new Map()
	}

	const objectIds = normalizedUserIds.map(userId => new mongoose.Types.ObjectId(userId))

	const [salaryRows, totalsRows] = await Promise.all([
		FinancialEvent.aggregate([
			{
				$match: {
					userId: { $in: objectIds },
					type: { $in: SALARY_EVENT_TYPES },
				},
			},
			{
				$sort: { createdAt: -1, _id: -1 },
			},
			{
				$group: {
					_id: '$userId',
					salary: { $first: '$amount' },
				},
			},
		]),
		FinancialEvent.aggregate([
			{
				$match: {
					userId: { $in: objectIds },
				},
			},
			{
				$group: {
					_id: '$userId',
					totalBonuses: {
						$sum: {
							$cond: [{ $eq: ['$type', 'bonus'] }, '$amount', 0],
						},
					},
					totalFines: {
						$sum: {
							$cond: [{ $eq: ['$type', 'fine'] }, '$amount', 0],
						},
					},
				},
			},
		]),
	])

	const summaries = new Map()
	for (const userId of normalizedUserIds) {
		summaries.set(userId, buildEmptySummary())
	}

	for (const salaryRow of salaryRows) {
		const userId = salaryRow?._id?.toString?.()
		if (!userId) {
			continue
		}
		const summary = summaries.get(userId) || buildEmptySummary()
		summary.salary = toMoneyNumber(salaryRow.salary)
		summaries.set(userId, summary)
	}

	for (const totalsRow of totalsRows) {
		const userId = totalsRow?._id?.toString?.()
		if (!userId) {
			continue
		}
		const summary = summaries.get(userId) || buildEmptySummary()
		summary.totalBonuses = toMoneyNumber(totalsRow.totalBonuses)
		summary.totalFines = toMoneyNumber(totalsRow.totalFines)
		summaries.set(userId, summary)
	}

	for (const [userId, summary] of summaries.entries()) {
		summaries.set(userId, finalizeSummary(summary))
	}

	return summaries
}

/**
 * Returns a single-month finance summary for each userId in the list.
 * For salary: latest salary_update event within that month.
 * For bonus/fine: sum of all events of each type within that month.
 */
const getFinanceSummariesByUserIdsForMonth = async (userIds, month) => {
	const normalizedUserIds = normalizeUserIds(userIds)
	if (normalizedUserIds.length === 0) return new Map()

	const objectIds = normalizedUserIds.map(userId => new mongoose.Types.ObjectId(userId))
	const [year, monthNum] = month.split('-').map(Number)
	const startDate = new Date(year, monthNum - 1, 1)
	const endDate = new Date(year, monthNum, 1)

	// Matches docs belonging to the target month, handling legacy docs (no month field)
	const monthOr = [
		{ month },
		{ month: null, createdAt: { $gte: startDate, $lt: endDate } },
	]

	const [salaryRows, totalsRows] = await Promise.all([
		FinancialEvent.aggregate([
			{
				$match: {
					userId: { $in: objectIds },
					type: { $in: SALARY_EVENT_TYPES },
					$or: monthOr,
				},
			},
			{ $sort: { createdAt: -1, _id: -1 } },
			{ $group: { _id: '$userId', salary: { $first: '$amount' } } },
		]),
		FinancialEvent.aggregate([
			{
				$match: {
					userId: { $in: objectIds },
					$or: monthOr,
				},
			},
			{
				$group: {
					_id: '$userId',
					totalBonuses: { $sum: { $cond: [{ $eq: ['$type', 'bonus'] }, '$amount', 0] } },
					totalFines: { $sum: { $cond: [{ $eq: ['$type', 'fine'] }, '$amount', 0] } },
				},
			},
		]),
	])

	const summaries = new Map()
	for (const userId of normalizedUserIds) {
		summaries.set(userId, buildEmptySummary())
	}
	for (const salaryRow of salaryRows) {
		const userId = salaryRow?._id?.toString?.()
		if (!userId) continue
		const summary = summaries.get(userId) || buildEmptySummary()
		summary.salary = toMoneyNumber(salaryRow.salary)
		summaries.set(userId, summary)
	}
	for (const totalsRow of totalsRows) {
		const userId = totalsRow?._id?.toString?.()
		if (!userId) continue
		const summary = summaries.get(userId) || buildEmptySummary()
		summary.totalBonuses = toMoneyNumber(totalsRow.totalBonuses)
		summary.totalFines = toMoneyNumber(totalsRow.totalFines)
		summaries.set(userId, summary)
	}
	for (const [userId, summary] of summaries.entries()) {
		summaries.set(userId, finalizeSummary(summary))
	}

	return summaries
}

/**
 * Returns a per-month breakdown array for a single employee, sorted by month descending.
 * Each entry: { month, salary, bonuses, fines, net }
 * salary = latest salary_update within that month (0 if none).
 * bonuses/fines = sum of all events of each type within that month.
 */
const getEmployeeMonthlyHistory = async userId => {
	if (!mongoose.isValidObjectId(userId)) return []
	const objectId = new mongoose.Types.ObjectId(userId)

	const [salaryRows, bonusFineRows] = await Promise.all([
		FinancialEvent.aggregate([
			{ $match: { userId: objectId, type: { $in: SALARY_EVENT_TYPES } } },
			{ $addFields: EFFECTIVE_MONTH_FIELD },
			{ $sort: { effectiveMonth: -1, createdAt: -1 } },
			{ $group: { _id: '$effectiveMonth', salary: { $first: '$amount' } } },
		]),
		FinancialEvent.aggregate([
			{ $match: { userId: objectId, type: { $in: ['bonus', 'fine'] } } },
			{ $addFields: EFFECTIVE_MONTH_FIELD },
			{
				$group: {
					_id: '$effectiveMonth',
					totalBonuses: { $sum: { $cond: [{ $eq: ['$type', 'bonus'] }, '$amount', 0] } },
					totalFines: { $sum: { $cond: [{ $eq: ['$type', 'fine'] }, '$amount', 0] } },
				},
			},
		]),
	])

	const monthsMap = new Map()

	for (const row of salaryRows) {
		if (!row._id) continue
		monthsMap.set(row._id, {
			month: row._id,
			salary: toMoneyNumber(row.salary),
			bonuses: 0,
			fines: 0,
		})
	}

	for (const row of bonusFineRows) {
		if (!row._id) continue
		const existing = monthsMap.get(row._id) || { month: row._id, salary: 0, bonuses: 0, fines: 0 }
		existing.bonuses = toMoneyNumber(row.totalBonuses)
		existing.fines = toMoneyNumber(row.totalFines)
		monthsMap.set(row._id, existing)
	}

	return [...monthsMap.values()]
		.map(entry => ({
			month: entry.month,
			salary: entry.salary,
			bonuses: entry.bonuses,
			fines: entry.fines,
			net: entry.salary + entry.bonuses - entry.fines,
		}))
		.sort((a, b) => b.month.localeCompare(a.month))
}

const getFinanceSummary = async userId => {
	const normalizedUserId = String(userId || '').trim()
	const summaries = await getFinanceSummariesByUserIds([normalizedUserId])
	return summaries.get(normalizedUserId) || buildEmptySummary()
}

module.exports = {
	getFinanceSummary,
	getFinanceSummariesByUserIds,
	getFinanceSummariesByUserIdsForMonth,
	getEmployeeMonthlyHistory,
}


// ----------------- Additional helpers for new requirements -----------------
const Student = require('../model/student.model')
const User = require('../model/user.model')

const computeStudentPayableAmount = student => {
 	const original = Number(student.originalCoursePrice || 0)
 	const discount = Number(student.activeDiscountAmount || 0)
 	return Math.max(0, original - discount)
}

// Process extra-lesson payment atomically: deduct from student, credit teacher, append events
const processExtraLessonPayment = async ({ studentId, teacherId, amount, actorId }) => {
 	if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(teacherId)) {
 		throw new Error('Invalid ids')
 	}

 	return await mongoose.startSession().then(async session => {
 		let result
 		await session.withTransaction(async () => {
 			const student = await Student.findById(studentId).session(session)
 			const teacher = await User.findById(teacherId).session(session)
 			if (!student) throw new Error('Student not found')
 			if (!teacher) throw new Error('Teacher not found')

 			// Deduct from student.balance
 			student.balance = Number(student.balance || 0) - Number(amount)
 			await student.save({ session })

 			// Credit teacher.balance if present
 			if (typeof teacher.balance !== 'undefined') {
 				teacher.balance = Number(teacher.balance || 0) + Number(amount)
 				await teacher.save({ session })
 			}

 			// Create financial events
 			await FinancialEvent.create([
 				{ type: 'extra_lesson_payment', amount: -Math.abs(amount), studentId: student._id, createdBy: actorId },
 				{ type: 'teacher_payment', amount: Math.abs(amount), userId: teacher._id, createdBy: actorId },
 			], { session })

 			result = { student: student.toObject(), teacher: teacher.toObject() }
 		})
 		await session.endSession()
 		return result
 	})
}

module.exports = Object.assign(module.exports, {
 	computeStudentPayableAmount,
 	processExtraLessonPayment,
})
