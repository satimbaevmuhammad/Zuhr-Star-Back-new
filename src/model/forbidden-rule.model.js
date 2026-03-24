const mongoose = require('mongoose')

const forbiddenRuleSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 500,
		},
		defaultFineAmount: {
			type: Number,
			default: 0,
			min: 0,
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
)

module.exports = mongoose.model('ForbiddenRule', forbiddenRuleSchema)
