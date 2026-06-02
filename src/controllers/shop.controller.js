const mongoose = require('mongoose')

const ShopItem = require('../model/shop-item.model')
const Purchase = require('../model/purchase.model')
const Student = require('../model/student.model')

// Shop Item Management (admin/headteacher only)
exports.createShopItem = async (req, res) => {
	try {
		const { name, description, image, price, stock, category } = req.body

		if (!name || typeof name !== 'string' || name.trim().length < 2) {
			return res.status(400).json({ message: 'name must be at least 2 characters' })
		}

		if (!price || typeof price !== 'number' || price < 0) {
			return res.status(400).json({ message: 'price must be a non-negative number' })
		}

		if (stock !== null && stock !== undefined && (typeof stock !== 'number' || stock < 0)) {
			return res.status(400).json({ message: 'stock must be a non-negative number or null' })
		}

		const shopItem = await ShopItem.create({
			name: name.trim(),
			description: description ? description.trim() : undefined,
			image: image ? image.trim() : undefined,
			price,
			stock: stock !== undefined ? stock : null,
			category: category ? category.trim() : undefined,
			createdBy: req.user._id,
		})

		return res.status(201).json({
			message: 'Shop item created successfully',
			item: shopItem,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Create shop item failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listShopItems = async (req, res) => {
	try {
		const { category, isActive } = req.query

		const filter = {}
		if (category) {
			filter.category = category
		}
		if (isActive !== undefined) {
			filter.isActive = isActive === 'true'
		}

		const items = await ShopItem.find(filter).sort({ createdAt: -1 }).maxTimeMS(5000)

		return res.status(200).json({
			items,
			count: items.length,
		})
	} catch (error) {
		console.error('List shop items failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getShopItemById = async (req, res) => {
	try {
		const itemId = req.params.id
		if (!mongoose.isValidObjectId(itemId)) {
			return res.status(400).json({ message: 'Invalid item id' })
		}

		const item = await ShopItem.findById(itemId).maxTimeMS(5000)
		if (!item) {
			return res.status(404).json({ message: 'Shop item not found' })
		}

		return res.status(200).json({ item })
	} catch (error) {
		console.error('Get shop item failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateShopItem = async (req, res) => {
	try {
		const itemId = req.params.id
		if (!mongoose.isValidObjectId(itemId)) {
			return res.status(400).json({ message: 'Invalid item id' })
		}

		const updatePayload = {}

		if (typeof req.body.name !== 'undefined') {
			const name = String(req.body.name || '').trim()
			if (!name || name.length < 2) {
				return res.status(400).json({ message: 'name must be at least 2 characters' })
			}
			updatePayload.name = name
		}

		if (typeof req.body.description !== 'undefined') {
			updatePayload.description = req.body.description ? String(req.body.description).trim() : null
		}

		if (typeof req.body.image !== 'undefined') {
			updatePayload.image = req.body.image ? String(req.body.image).trim() : null
		}

		if (typeof req.body.price !== 'undefined') {
			const price = Number(req.body.price)
			if (!Number.isFinite(price) || price < 0) {
				return res.status(400).json({ message: 'price must be a non-negative number' })
			}
			updatePayload.price = price
		}

		if (typeof req.body.stock !== 'undefined') {
			const stock = req.body.stock
			if (stock !== null && (typeof stock !== 'number' || stock < 0)) {
				return res.status(400).json({ message: 'stock must be a non-negative number or null' })
			}
			updatePayload.stock = stock
		}

		if (typeof req.body.isActive !== 'undefined') {
			updatePayload.isActive = Boolean(req.body.isActive)
		}

		if (typeof req.body.category !== 'undefined') {
			updatePayload.category = req.body.category ? String(req.body.category).trim() : null
		}

		if (Object.keys(updatePayload).length === 0) {
			return res.status(400).json({ message: 'No valid fields to update' })
		}

		const item = await ShopItem.findByIdAndUpdate(itemId, updatePayload, {
			new: true,
			runValidators: true,
		}).maxTimeMS(5000)

		if (!item) {
			return res.status(404).json({ message: 'Shop item not found' })
		}

		return res.status(200).json({
			message: 'Shop item updated successfully',
			item,
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update shop item failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteShopItem = async (req, res) => {
	try {
		const itemId = req.params.id
		if (!mongoose.isValidObjectId(itemId)) {
			return res.status(400).json({ message: 'Invalid item id' })
		}

		// Soft delete: set isActive to false
		const item = await ShopItem.findByIdAndUpdate(
			itemId,
			{ isActive: false },
			{ new: true }
		).maxTimeMS(5000)

		if (!item) {
			return res.status(404).json({ message: 'Shop item not found' })
		}

		return res.status(200).json({
			message: 'Shop item deleted successfully',
			item,
		})
	} catch (error) {
		console.error('Delete shop item failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

// Student-facing endpoints
exports.listActiveShopItems = async (req, res) => {
	try {
		const items = await ShopItem.find({ isActive: true }).sort({ createdAt: -1 })

		return res.status(200).json({
			items,
			count: items.length,
		})
	} catch (error) {
		console.error('List active shop items failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.purchaseItem = async (req, res) => {
	const session = await mongoose.startSession()
	session.startTransaction()

	try {
		const { itemId } = req.body
		const studentId = req.student._id

		if (!itemId || !mongoose.isValidObjectId(itemId)) {
			return res.status(400).json({ message: 'Valid itemId is required' })
		}

		// Find item and check if active
		const item = await ShopItem.findById(itemId).session(session)
		if (!item || !item.isActive) {
			await session.abortTransaction()
			return res.status(404).json({ error: 'ITEM_NOT_FOUND' })
		}

		// Check stock
		if (item.stock !== null && item.stock <= 0) {
			await session.abortTransaction()
			return res.status(400).json({ error: 'OUT_OF_STOCK' })
		}

		// Find student and check balance
		const student = await Student.findById(studentId).session(session)
		if (!student) {
			await session.abortTransaction()
			return res.status(404).json({ message: 'Student not found' })
		}

		if (student.coinBalance < item.price) {
			await session.abortTransaction()
			return res.status(400).json({ error: 'INSUFFICIENT_COINS' })
		}

		// Deduct coins
		student.coinBalance -= item.price

		// Decrement stock if not unlimited
		if (item.stock !== null) {
			item.stock -= 1
		}

		// Create purchase
		const purchase = await Purchase.create([{
			student: studentId,
			item: itemId,
			coinSpent: item.price,
		}], { session })

		// Save changes
		await student.save({ session })
		await item.save({ session })

		await session.commitTransaction()

		// Populate the purchase for response
		await purchase[0].populate('item')

		return res.status(201).json({
			message: 'Purchase successful',
			purchase: purchase[0],
		})
	} catch (error) {
		await session.abortTransaction()
		console.error('Purchase item failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	} finally {
		session.endSession()
	}
}

// Purchase Management (admin/headteacher)
exports.listPurchases = async (req, res) => {
	try {
		const { status, studentId } = req.query

		const filter = {}
		if (status) {
			filter.status = status
		}
		if (studentId) {
			if (!mongoose.isValidObjectId(studentId)) {
				return res.status(400).json({ message: 'Invalid studentId' })
			}
			filter.student = studentId
		}

		const purchases = await Purchase.find(filter)
			.populate('student', 'fullname studentPhone')
			.populate('item', 'name price')
			.populate('deliveredBy', 'fullname')
			.populate('cancelledBy', 'fullname')
			.sort({ createdAt: -1 })

		return res.status(200).json({
			purchases,
			count: purchases.length,
		})
	} catch (error) {
		console.error('List purchases failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getPurchaseById = async (req, res) => {
	try {
		const purchaseId = req.params.id
		if (!mongoose.isValidObjectId(purchaseId)) {
			return res.status(400).json({ message: 'Invalid purchase id' })
		}

		const purchase = await Purchase.findById(purchaseId)
			.populate('student', 'fullname studentPhone')
			.populate('item', 'name price description image category')
			.populate('deliveredBy', 'fullname')
			.populate('cancelledBy', 'fullname')

		if (!purchase) {
			return res.status(404).json({ message: 'Purchase not found' })
		}

		return res.status(200).json({ purchase })
	} catch (error) {
		console.error('Get purchase failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deliverPurchase = async (req, res) => {
	try {
		const purchaseId = req.params.id
		if (!mongoose.isValidObjectId(purchaseId)) {
			return res.status(400).json({ message: 'Invalid purchase id' })
		}

		const purchase = await Purchase.findById(purchaseId)
		if (!purchase) {
			return res.status(404).json({ message: 'Purchase not found' })
		}

		if (purchase.status !== 'pending') {
			return res.status(409).json({ error: 'ALREADY_RESOLVED' })
		}

		purchase.status = 'delivered'
		purchase.deliveredBy = req.user._id
		purchase.deliveredAt = new Date()
		await purchase.save()

		await purchase.populate('student', 'fullname studentPhone')
		await purchase.populate('item', 'name price')
		await purchase.populate('deliveredBy', 'fullname')

		return res.status(200).json({
			message: 'Purchase marked as delivered',
			purchase,
		})
	} catch (error) {
		console.error('Deliver purchase failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.cancelPurchase = async (req, res) => {
	const session = await mongoose.startSession()
	session.startTransaction()

	try {
		const purchaseId = req.params.id
		if (!mongoose.isValidObjectId(purchaseId)) {
			return res.status(400).json({ message: 'Invalid purchase id' })
		}

		const { cancelReason } = req.body
		if (!cancelReason || typeof cancelReason !== 'string' || cancelReason.trim().length === 0) {
			await session.abortTransaction()
			return res.status(400).json({ message: 'cancelReason is required' })
		}

		const purchase = await Purchase.findById(purchaseId).session(session)
		if (!purchase) {
			await session.abortTransaction()
			return res.status(404).json({ message: 'Purchase not found' })
		}

		if (purchase.status !== 'pending') {
			await session.abortTransaction()
			return res.status(409).json({ error: 'ALREADY_RESOLVED' })
		}

		// Find student and refund coins
		const student = await Student.findById(purchase.student).session(session)
		if (!student) {
			await session.abortTransaction()
			return res.status(404).json({ message: 'Student not found' })
		}

		student.coinBalance += purchase.coinSpent

		// Update purchase
		purchase.status = 'cancelled'
		purchase.cancelledBy = req.user._id
		purchase.cancelReason = cancelReason.trim()

		// Save changes
		await student.save({ session })
		await purchase.save({ session })

		await session.commitTransaction()

		await purchase.populate('student', 'fullname studentPhone')
		await purchase.populate('item', 'name price')
		await purchase.populate('cancelledBy', 'fullname')

		return res.status(200).json({
			message: 'Purchase cancelled and coins refunded',
			purchase,
		})
	} catch (error) {
		await session.abortTransaction()
		console.error('Cancel purchase failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	} finally {
		session.endSession()
	}
}

// Student's own purchases
exports.getMyPurchases = async (req, res) => {
	try {
		const studentId = req.student._id

		const purchases = await Purchase.find({ student: studentId })
			.populate('item', 'name price description image category')
			.sort({ createdAt: -1 })

		return res.status(200).json({
			purchases,
			count: purchases.length,
		})
	} catch (error) {
		console.error('Get my purchases failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}