const mongoose = require('mongoose')

const connectDB = async () => {
	const mongoUri = process.env.MONGO_URI

	if (!mongoUri) {
		throw new Error('MONGO_URI is required')
	}

	try {
		await mongoose.connect(mongoUri, {
			serverSelectionTimeoutMS: 10000,
		})
		console.log('MongoDB connected successfully')
	} catch (error) {
		console.error('MongoDB connection failed:', error.message)
		throw error
	}
}

module.exports = connectDB
