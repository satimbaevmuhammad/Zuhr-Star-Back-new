/**
 * FinancialEvent model.
 * Stores append-only immutable finance ledger events for employees and students.
 */

const mongoose = require('mongoose')

const FINANCIAL_EVENT_TYPES = ['salary', 'bonus', 'fine', 'salary_update', 'student_payment']

const getCurrentMonth = () => {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const financialEventSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			default: null,
			index: true,
		},
		type: {
			type: String,
			enum: FINANCIAL_EVENT_TYPES,
			required: true,
		},
		amount: {
			type: Number,
			required: true,
		},
		month: {
			type: String,
			match: [/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format'],
			default: getCurrentMonth,
			required: true,
		},
		note: {
			type: String,
			trim: true,
			maxlength: 1000,
			default: '',
		},
		studentId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Student',
			default: null,
		},
		groupId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Group',
			default: null,
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		relatedViolationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'EmployeeViolation',
			default: null,
		},
		createdAt: {
			type: Date,
			default: Date.now,
		},
	},
	{
		versionKey: false,
	},
)

financialEventSchema.pre(
	['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
	function () {
		throw new Error('FinancialEvent is append-only and cannot be modified')
	},
)

financialEventSchema.index({ userId: 1, createdAt: -1 })
financialEventSchema.index({ studentId: 1, createdAt: -1 })
financialEventSchema.index({ relatedViolationId: 1 })
financialEventSchema.index({ month: 1 })

module.exports = {
	FinancialEvent: mongoose.model('FinancialEvent', financialEventSchema),
	FINANCIAL_EVENT_TYPES,
	getCurrentMonth,
}
