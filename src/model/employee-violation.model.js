const mongoose = require('mongoose')

const employeeViolationSchema = new mongoose.Schema(
	{
		employee: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			index: true,
		},
		rule: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'ForbiddenRule',
			required: true,
		},
		fineAmount: {
			type: Number,
			default: 0,
			min: 0,
		},
		note: {
			type: String,
			trim: true,
			maxlength: 500,
		},
		recordedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
)

module.exports = mongoose.model('EmployeeViolation', employeeViolationSchema)
