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

const getFinanceSummary = async userId => {
	const normalizedUserId = String(userId || '').trim()
	const summaries = await getFinanceSummariesByUserIds([normalizedUserId])
	return summaries.get(normalizedUserId) || buildEmptySummary()
}

module.exports = {
	getFinanceSummary,
	getFinanceSummariesByUserIds,
}
