/**
 * Global error handler middleware.
 * Exports an Express error handler that serializes AppError into API error contract.
 */

const AppError = require('../utils/AppError')

const STATUS_DEFAULT_CODES = {
	400: 'BAD_REQUEST',
	401: 'UNAUTHORIZED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	405: 'METHOD_NOT_ALLOWED',
	409: 'CONFLICT',
	422: 'UNPROCESSABLE_ENTITY',
	500: 'INTERNAL_SERVER_ERROR',
}

const errorHandler = (error, req, res, next) => {
	if (res.headersSent) {
		return next(error)
	}

	const normalizedError =
		error instanceof AppError
			? error
			: new AppError(
				error?.message || 'Internal server error',
				STATUS_DEFAULT_CODES[error?.statusCode] || STATUS_DEFAULT_CODES[500],
				error?.statusCode || 500,
				error?.field || null,
			)

	const statusCode = Number(normalizedError.statusCode) || 500
	const code =
		String(normalizedError.code || '').trim() ||
		STATUS_DEFAULT_CODES[statusCode] ||
		STATUS_DEFAULT_CODES[500]
	const message =
		statusCode >= 500
			? 'Internal server error'
			: String(normalizedError.message || 'Request failed')
	const field = typeof normalizedError.field === 'undefined' ? null : normalizedError.field

	if (statusCode >= 500) {
		console.error('Unhandled error:', error)
	}

	return res.status(statusCode).json({ message, code, field })
}

module.exports = errorHandler