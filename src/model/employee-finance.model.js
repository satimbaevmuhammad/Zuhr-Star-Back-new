const mongoose = require('mongoose')

// Each row is one transaction: bonus or fine
const employeeFinanceSchema = new mongoose.Schema(
	{
		employee: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		type: {
			type: String,
			enum: ['bonus', 'fine'],
			required: true,
		},
		amount: {
			type: Number,
			required: true,
			min: 0,
		},
		reason: {
			type: String,
			required: true,
			trim: true,
			maxlength: 500,
		},
		// Optional link to a violation that triggered this fine
		relatedViolation: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'EmployeeViolation',
			default: null,
		},
		recordedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
)

module.exports = mongoose.model('EmployeeFinance', employeeFinanceSchema)
