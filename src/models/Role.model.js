/**
 * Role model.
 * Stores role names and permission strings for dynamic RBAC.
 */

const mongoose = require('mongoose')

const roleSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			unique: true,
			trim: true,
		},
		permissions: {
			type: [String],
			default: [],
		},
	},
	{
		timestamps: true,
	},
)

module.exports = mongoose.model('Role', roleSchema)