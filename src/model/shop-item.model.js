const mongoose = require('mongoose')

const shopItemSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			minlength: 2,
			maxlength: 120,
		},
		description: {
			type: String,
			trim: true,
			maxlength: 500,
		},
		image: {
			type: String,
			trim: true,
		},
		price: {
			type: Number,
			required: true,
			min: 0,
		},
		stock: {
			type: Number,
			default: null, // null = unlimited
			min: 0,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
		category: {
			type: String,
			trim: true,
			maxlength: 50,
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
	},
	{ timestamps: true },
)

shopItemSchema.index({ isActive: 1, category: 1 })
shopItemSchema.index({ createdBy: 1 })

module.exports = mongoose.model('ShopItem', shopItemSchema)