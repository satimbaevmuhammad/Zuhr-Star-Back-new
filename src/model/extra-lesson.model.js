const mongoose = require('mongoose')

// Extra lessons are managed globally by 2-3 designated support teachers.
// They are NOT tied to a specific group — any student can attend.
const extraLessonSchema = new mongoose.Schema(
	{
		title: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 150,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
		subject: {
			type: String,
			trim: true,
			maxlength: 120,
		},
		scheduledAt: {
			type: Date,
			required: true,
		},
		durationMinutes: {
			type: Number,
			min: 15,
			max: 480,
		},
		// The support teacher responsible for this extra lesson.
		// Must be a user with isExtraLessonSupport === true.
		assignedTeacher: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		students: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: 'Student',
			},
		],
		status: {
			type: String,
			enum: ['scheduled', 'completed', 'cancelled'],
			default: 'scheduled',
		},
		room: {
			type: String,
			trim: true,
			maxlength: 100,
		},
		note: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
)

extraLessonSchema.index({ assignedTeacher: 1, scheduledAt: 1 })
extraLessonSchema.index({ status: 1, scheduledAt: 1 })

module.exports = mongoose.model('ExtraLesson', extraLessonSchema)
