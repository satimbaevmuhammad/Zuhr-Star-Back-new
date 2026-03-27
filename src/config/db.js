const mongoose = require('mongoose')
const { seedRoles } = require('../seeders/roles.seeder')

const MAX_RETRIES = 5
const RETRY_DELAY_MS = 5000

const connectDB = async () => {
	const mongoUri = process.env.MONGO_URI

	if (!mongoUri) {
		throw new Error('MONGO_URI is required')
	}

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
		try {
			await mongoose.connect(mongoUri, {
				serverSelectionTimeoutMS: 15000,
			})
			await seedRoles()
			console.log('MongoDB connected successfully')
			return
		} catch (error) {
			console.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`)

			if (attempt === MAX_RETRIES) {
				throw error
			}

			console.log(`Retrying in ${RETRY_DELAY_MS / 1000}s...`)
			await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
		}
	}
}

module.exports = connectDB
