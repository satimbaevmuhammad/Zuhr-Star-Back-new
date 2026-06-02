/**
 * AppError utility.
 * Exports a typed error class with status, machine-readable code, and optional field.
 */

class AppError extends Error {
	constructor(message, code, statusCode, field = null) {
		super(message)
		this.name = 'AppError'
		this.code = code
		this.statusCode = statusCode
		this.field = field
	}
}

module.exports = AppError