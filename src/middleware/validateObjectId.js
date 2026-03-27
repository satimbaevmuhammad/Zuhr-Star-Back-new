/**
 * ObjectId validation middleware factory.
 * Exports validateObjectId(...paramNames) to validate route params before controllers.
 */

const mongoose = require('mongoose')
const AppError = require('../utils/AppError')

const validateObjectId = (...paramNames) => {
	const fields = paramNames
		.map(field => String(field || '').trim())
		.filter(Boolean)

	return (req, res, next) => {
		for (const field of fields) {
			const value = req.params?.[field]
			if (!mongoose.isValidObjectId(value)) {
				return next(new AppError('Invalid id format', 'INVALID_OBJECT_ID', 400, field))
			}
		}

		return next()
	}
}

module.exports = validateObjectId
