const mongoose = require('mongoose')

const LEAD_SOURCES = ['INSTAGRAM', 'TELEGRAM', 'CALL_CENTER', 'WEBSITE', 'LANDING', 'FRIEND']

const leadSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
		},
		number: {
			type: String,
			trim: true,
		},
		email: {
			type: String,
			trim: true,
			lowercase: true,
		},
		username: {
			type: String,
			trim: true,
			maxlength: 100,
		},
		source: {
			type: String,
			enum: LEAD_SOURCES,
			required: true,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
		referral: {
			type: String,
			trim: true,
			maxlength: 200,
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		},
	},
	{ timestamps: true },
)

module.exports = mongoose.model('Lead', leadSchema)
