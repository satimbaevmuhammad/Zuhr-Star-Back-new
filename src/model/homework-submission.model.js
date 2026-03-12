const mongoose = require('mongoose')

const submissionDocumentSchema = new mongoose.Schema(
	{
		originalName: {
			type: String,
			required: true,
			trim: true,
			maxlength: 255,
		},
		filename: {
			type: String,
			required: true,
			trim: true,
			maxlength: 255,
		},
		url: {
			type: String,
			required: true,
			trim: true,
			maxlength: 500,
		},
		mimeType: {
			type: String,
			required: true,
			trim: true,
			maxlength: 150,
		},
		size: {
			type: Number,
			required: true,
			min: 1,
		},
		uploadedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ _id: true },
)

const homeworkSubmissionSchema = new mongoose.Schema(
	{
		lesson: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Lesson',
			required: true,
			index: true,
		},
		student: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Student',
			required: true,
			index: true,
		},
		group: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Group',
			required: true,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 2000,
		},
		links: {
			type: [String],
			default: [],
			validate: {
				validator: value => {
					if (!Array.isArray(value)) {
						return false
					}

					const normalized = value
						.map(link => String(link || '').trim())
						.filter(Boolean)

					if (normalized.length !== value.length) {
						return false
					}

					if (normalized.some(link => link.length > 500)) {
						return false
					}

					return new Set(normalized).size === normalized.length
				},
				message: 'links must be unique non-empty strings up to 500 characters',
			},
		},
		documents: {
			type: [submissionDocumentSchema],
			default: [],
		},
		status: {
			type: String,
			enum: ['submitted', 'approved'],
			default: 'submitted',
		},
		score: {
			type: Number,
			min: 0,
			max: 100,
			default: null,
		},
		attemptsCount: {
			type: Number,
			default: 1,
			min: 1,
		},
		submittedAt: {
			type: Date,
			default: Date.now,
		},
		checkedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		},
		checkedAt: {
			type: Date,
		},
	},
	{ timestamps: true },
)

homeworkSubmissionSchema.index({ lesson: 1, student: 1 }, { unique: true })

module.exports = mongoose.model('HomeworkSubmission', homeworkSubmissionSchema)
