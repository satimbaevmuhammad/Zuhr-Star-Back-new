const mongoose = require('mongoose')

const allowedRoles = ['teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin']

const locationSchema = new mongoose.Schema(
	{
		type: {
			type: String,
			enum: ['Point'],
			required: true,
		},
		coordinates: {
			type: [Number],
			required: true,
			validate: {
				validator: value =>
					Array.isArray(value) &&
					value.length === 2 &&
					Number.isFinite(value[0]) &&
					Number.isFinite(value[1]) &&
					value[0] >= -180 &&
					value[0] <= 180 &&
					value[1] >= -90 &&
					value[1] <= 90,
				message:
					'Location coordinates must be [longitude, latitude] with valid ranges',
			},
		},
	},
	{ _id: false },
)

const userSchema = new mongoose.Schema(
	{
		fullname: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
		},
		phone: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			match: [/^\+?[0-9]{7,15}$/, 'Phone must contain 7-15 digits'],
		},
		email: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			lowercase: true,
			match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'],
		},
		refreshToken: {
			type: String,
			default: null,
			select: false,
		},
		dateOfBirth: {
			type: Date,
			required: true,
		},
		gender: {
			type: String,
			required: true,
			enum: ['male', 'female'],
		},
		password: {
			type: String,
			required: true,
			select: false,
		},
		role: {
			type: String,
			enum: allowedRoles,
			default: 'teacher',
		},
		company: {
			type: String,
			trim: true,
			maxlength: 120,
		},
		location: {
			type: locationSchema,
			default: undefined,
		},
		imgURL: {
			type: String,
			default: '/uploads/default-avatar.png',
		},
	},
	{ timestamps: true },
)

userSchema.index({ location: '2dsphere' }, { sparse: true })

const hideSensitiveFields = (doc, ret) => {
	delete ret.password
	delete ret.refreshToken
	return ret
}

userSchema.set('toJSON', { transform: hideSensitiveFields })
userSchema.set('toObject', { transform: hideSensitiveFields })

module.exports = mongoose.model('User', userSchema)
