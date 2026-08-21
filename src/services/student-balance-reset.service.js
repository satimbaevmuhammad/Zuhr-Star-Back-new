const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

let resetInterval = null

// Kept as a no-op for backwards compatibility with existing controller calls.
// A running balance is not a monthly counter: resetting it destroys credits,
// debts, and the meaning of the append-only finance ledger.
const resetStudentBalancesIfNeeded = async ({ force = false } = {}) => {
	return { skipped: true, reason: 'balance_reset_disabled', force: Boolean(force) }
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
