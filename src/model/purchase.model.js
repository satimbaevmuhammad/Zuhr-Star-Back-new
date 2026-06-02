const mongoose = require('mongoose')

const purchaseSchema = new mongoose.Schema(
	{
		student: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'Student',
			required: true,
		},
		item: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'ShopItem',
			required: true,
		},
		coinSpent: {
			type: Number,
			required: true,
			min: 0,
		},
		status: {
			type: String,
			enum: ['pending', 'delivered', 'cancelled'],
			default: 'pending',
		},
		deliveredBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		},
		deliveredAt: {
			type: Date,
		},
		cancelledBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
		},
		cancelReason: {
			type: String,
			trim: true,
			maxlength: 300,
		},
	},
	{ timestamps: true },
)

purchaseSchema.index({ student: 1, createdAt: -1 })
purchaseSchema.index({ status: 1, createdAt: -1 })
purchaseSchema.index({ item: 1 })

module.exports = mongoose.model('Purchase', purchaseSchema)