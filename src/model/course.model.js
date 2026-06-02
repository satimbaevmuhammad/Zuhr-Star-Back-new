const mongoose = require('mongoose')

const courseSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
			unique: true,
		},
		durationMonths: {
			type: Number,
			required: true,
			min: 1,
			max: 120,
		},
		price: {
			type: Number,
			required: true,
			min: 0,
		},
		groupsCount: {
			type: Number,
			default: 0,
			min: 0,
		},
		methodology: {
			type: [
				{
					type: mongoose.Schema.Types.ObjectId,
					ref: 'Lesson',
				},
			],
			default: [],
			validate: [
				{
					validator: value => {
						const ids = value.map(item => item.toString())
						return new Set(ids).size === ids.length
					},
					message: 'Methodology cannot contain duplicate lessons',
				},
				{
					validator: function (value) {
						const durationMonths = Number(this.durationMonths) || 0
						const maxLessons = durationMonths * 12
						return value.length <= maxLessons
					},
					message: 'Methodology lesson count cannot exceed durationMonths * 12',
				},
			],
		},
		note: {
			type: String,
			trim: true,
			maxlength: 1000,
		},
	},
	{ timestamps: true },
)

module.exports = mongoose.model('Course', courseSchema)
