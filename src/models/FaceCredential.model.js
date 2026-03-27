/**
 * FaceCredential model.
 * Stores biometric face descriptors separately from User documents.
 */

const mongoose = require('mongoose')

const FACE_DESCRIPTOR_LENGTH = 128

const faceCredentialSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: 'User',
			required: true,
			unique: true,
			index: true,
		},
		descriptor: {
			type: [Number],
			required: true,
			select: false,
			validate: {
				validator: value => {
					if (!Array.isArray(value) || value.length !== FACE_DESCRIPTOR_LENGTH) {
						return false
					}

					return value.every(number => Number.isFinite(number))
				},
				message: `descriptor must contain exactly ${FACE_DESCRIPTOR_LENGTH} numeric values`,
			},
		},
	},
	{
		timestamps: true,
	},
)

module.exports = mongoose.model('FaceCredential', faceCredentialSchema)