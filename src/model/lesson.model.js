const mongoose = require('mongoose')

const lessonDocumentSchema = new mongoose.Schema(
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
		uploadedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		},
		uploadedAt: {
			type: Date,
			default: Date.now,
		},
	},
	{ _id: true },
)

const lessonSchema = new mongoose.Schema(
	{
		course: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Course',
			required: true,
			index: true,
		},
		title: {
			type: String,
			required: true,
			trim: true,
			minlength: 1,
			maxlength: 150,
		},
		order: {
			type: Number,
			required: true,
			min: 1,
		},
		durationMinutes: {
			type: Number,
			min: 1,
			max: 600,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
		documents: {
			type: [lessonDocumentSchema],
			default: [],
		},
	},
	{ timestamps: true },
)

lessonSchema.index({ course: 1, order: 1 }, { unique: true })
lessonSchema.index({ course: 1, title: 1 })

module.exports = mongoose.model('Lesson', lessonSchema)
