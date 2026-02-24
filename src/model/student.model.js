const mongoose = require('mongoose')

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
const GROUP_STATUSES = ['active', 'paused', 'completed', 'left']

const studentGroupSchema = new mongoose.Schema(
	{
		group: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Group',
			required: true,
		},
		status: {
			type: String,
			enum: GROUP_STATUSES,
			default: 'active',
		},
		joinedAt: {
			type: Date,
			default: Date.now,
		},
		note: {
			type: String,
			trim: true,
			maxlength: 300,
		},
	},
	{ _id: false },
)

const studentSchema = new mongoose.Schema(
	{
		fullname: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
		},
		studentPhone: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			match: [PHONE_PATTERN, 'Phone must contain 7-15 digits'],
		},
		parentPhone: {
			type: String,
			required: true,
			trim: true,
			match: [PHONE_PATTERN, 'Phone must contain 7-15 digits'],
		},
		groupAttached: {
			type: Boolean,
			default: false,
		},
		gender: {
			type: String,
			required: true,
			enum: ['male', 'female'],
		},
		birthDate: {
			type: Date,
			required: true,
			validate: {
				validator: value => value <= new Date(),
				message: 'birthDate cannot be in the future',
			},
		},
		note: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
		password: {
			type: String,
			select: false,
			minlength: 8,
		},
		balance: {
			type: Number,
			default: 0,
			min: 0,
		},
		balanceResetAt: {
			type: Date,
			default: Date.now,
		},
		coinBalance: {
			type: Number,
			default: 0,
			min: 0,
		},
		groups: {
			type: [studentGroupSchema],
			default: [],
			validate: {
				validator: value => {
					const ids = value.map(item => item.group.toString())
					return new Set(ids).size === ids.length
				},
				message: 'Student cannot be attached to the same group twice',
			},
		},
	},
	{ timestamps: true },
)

studentSchema.index({ parentPhone: 1 })
studentSchema.index({ 'groups.group': 1 })

studentSchema.pre('validate', function (next) {
	this.groupAttached = this.groups.some(groupItem => groupItem.status === 'active')
	next()
})

const hideSensitiveFields = (doc, ret) => {
	delete ret.password
	delete ret.balanceResetAt
	return ret
}

studentSchema.set('toJSON', { transform: hideSensitiveFields })
studentSchema.set('toObject', { transform: hideSensitiveFields })

module.exports = mongoose.model('Student', studentSchema)
