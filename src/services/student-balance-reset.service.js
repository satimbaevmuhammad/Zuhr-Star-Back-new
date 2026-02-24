const Student = require('../model/student.model')

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_MIN_GAP_MS = 5 * 60 * 1000

let resetInterval = null
let isResetRunning = false
let lastResetRunAt = 0

const normalizeResultCount = (result, primaryKey, fallbackKey) => {
	if (typeof result?.[primaryKey] === 'number') {
		return result[primaryKey]
	}

	if (typeof result?.[fallbackKey] === 'number') {
		return result[fallbackKey]
	}

	return 0
}

const resetStudentBalancesIfNeeded = async ({ force = false } = {}) => {
	const now = Date.now()
	const minGapMs = Math.max(
		Number(process.env.STUDENT_BALANCE_RESET_MIN_GAP_MS) || DEFAULT_MIN_GAP_MS,
		10 * 1000,
	)

	if (!force && now - lastResetRunAt < minGapMs) {
		return { skipped: true, reason: 'throttled' }
	}

	if (isResetRunning) {
		return { skipped: true, reason: 'in_progress' }
	}

	isResetRunning = true
	lastResetRunAt = now

	try {
		const resetAt = new Date(now)
		const dueBefore = new Date(now - THIRTY_DAYS_MS)

		const result = await Student.updateMany(
			{
				$or: [{ balanceResetAt: { $exists: false } }, { balanceResetAt: { $lte: dueBefore } }],
			},
			{
				$set: {
					balance: 0,
					balanceResetAt: resetAt,
				},
			},
		)

		return {
			skipped: false,
			matched: normalizeResultCount(result, 'matchedCount', 'n'),
			modified: normalizeResultCount(result, 'modifiedCount', 'nModified'),
		}
	} finally {
		isResetRunning = false
	}
}

const startStudentBalanceResetJob = () => {
	if (resetInterval) {
		return resetInterval
	}

	const intervalMs = Math.max(
		Number(process.env.STUDENT_BALANCE_RESET_INTERVAL_MS) || DEFAULT_INTERVAL_MS,
		60 * 1000,
	)

	resetStudentBalancesIfNeeded({ force: true }).catch(error => {
		console.error('Student balance reset startup run failed:', error)
	})

	resetInterval = setInterval(() => {
		resetStudentBalancesIfNeeded({ force: true }).catch(error => {
			console.error('Student balance reset scheduled run failed:', error)
		})
	}, intervalMs)

	if (typeof resetInterval.unref === 'function') {
		resetInterval.unref()
	}

	return resetInterval
}

module.exports = {
	resetStudentBalancesIfNeeded,
	startStudentBalanceResetJob,
}
