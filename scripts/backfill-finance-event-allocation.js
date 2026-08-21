require('dotenv').config()

const mongoose = require('mongoose')
const { FinancialEvent } = require('../src/models/FinancialEvent.model')

const run = async () => {
	if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required')
	await mongoose.connect(process.env.MONGO_URI)
	// Use the native collection deliberately: the model protects normal ledger
	// writes from mutation, while this one-time additive migration only labels
	// otherwise un-attributable legacy rows and never changes money or history.
	const assigned = await FinancialEvent.collection.updateMany(
		{ groupId: { $ne: null }, allocationBucket: { $exists: false } },
		{ $set: { allocationBucket: 'assigned' } },
	)
	const unassigned = await FinancialEvent.collection.updateMany(
		{ $or: [{ groupId: null }, { groupId: { $exists: false } }], allocationBucket: { $exists: false } },
		{ $set: { allocationBucket: 'unassigned' } },
	)
	console.log({ assigned: assigned.modifiedCount, unassigned: unassigned.modifiedCount })
	await mongoose.disconnect()
}

run().catch(error => {
	console.error(error.message)
	process.exitCode = 1
})
