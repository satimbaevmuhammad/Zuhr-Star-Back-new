const mongoose = require('mongoose')
const Lead = require('../model/lead.model')

const LEAD_SOURCES = ['INSTAGRAM', 'TELEGRAM', 'CALL_CENTER', 'WEBSITE', 'LANDING', 'FRIEND']

exports.createLead = async (req, res) => {
	try {
		const name = String(req.body.name || '').trim()
		const source = String(req.body.source || '').trim().toUpperCase()
		const number = req.body.number ? String(req.body.number).trim() : undefined
		const email = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined
		const username = req.body.username ? String(req.body.username).trim() : undefined
		const description = req.body.description ? String(req.body.description).trim() : undefined
		const referral = req.body.referral ? String(req.body.referral).trim() : undefined

		if (!name) {
			return res.status(400).json({ message: 'name is required' })
		}

		if (!source || !LEAD_SOURCES.includes(source)) {
			return res.status(400).json({
				message: `source must be one of: ${LEAD_SOURCES.join(', ')}`,
			})
		}

		const lead = await Lead.create({
			name,
			source,
			number,
			email,
			username,
			description,
			referral,
			createdBy: req.user?._id,
		})

		return res.status(201).json({ lead })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}
		console.error('Create lead failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listLeads = async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit
		const search = String(req.query.search || '').trim()
		const source = String(req.query.source || '').trim().toUpperCase()

		const query = {}
		if (search) {
			query.$or = [
				{ name: { $regex: search, $options: 'i' } },
				{ number: { $regex: search, $options: 'i' } },
				{ email: { $regex: search, $options: 'i' } },
				{ username: { $regex: search, $options: 'i' } },
			]
		}
		if (source && LEAD_SOURCES.includes(source)) {
			query.source = source
		}

		const [leads, total] = await Promise.all([
			Lead.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
			Lead.countDocuments(query),
		])

		return res.status(200).json({ page, limit, total, data: leads })
	} catch (error) {
		console.error('List leads failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.getLead = async (req, res) => {
	try {
		const { leadId } = req.params
		if (!mongoose.isValidObjectId(leadId)) {
			return res.status(400).json({ message: 'Invalid lead id' })
		}

		const lead = await Lead.findById(leadId)
		if (!lead) {
			return res.status(404).json({ message: 'Lead not found' })
		}

		return res.status(200).json({ lead })
	} catch (error) {
		console.error('Get lead failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateLead = async (req, res) => {
	try {
		const { leadId } = req.params
		if (!mongoose.isValidObjectId(leadId)) {
			return res.status(400).json({ message: 'Invalid lead id' })
		}

		const lead = await Lead.findById(leadId)
		if (!lead) {
			return res.status(404).json({ message: 'Lead not found' })
		}

		const updatePayload = {}

		if (typeof req.body.name !== 'undefined') {
			const name = String(req.body.name || '').trim()
			if (!name) return res.status(400).json({ message: 'name cannot be empty' })
			updatePayload.name = name
		}

		if (typeof req.body.source !== 'undefined') {
			const source = String(req.body.source || '').trim().toUpperCase()
			if (!LEAD_SOURCES.includes(source)) {
				return res.status(400).json({
					message: `source must be one of: ${LEAD_SOURCES.join(', ')}`,
				})
			}
			updatePayload.source = source
		}

		if (typeof req.body.number !== 'undefined') {
			updatePayload.number = req.body.number ? String(req.body.number).trim() : undefined
		}

		if (typeof req.body.email !== 'undefined') {
			updatePayload.email = req.body.email
				? String(req.body.email).trim().toLowerCase()
				: undefined
		}

		if (typeof req.body.username !== 'undefined') {
			updatePayload.username = req.body.username
				? String(req.body.username).trim()
				: undefined
		}

		if (typeof req.body.description !== 'undefined') {
			updatePayload.description = req.body.description
				? String(req.body.description).trim()
				: undefined
		}

		if (typeof req.body.referral !== 'undefined') {
			updatePayload.referral = req.body.referral
				? String(req.body.referral).trim()
				: undefined
		}

		Object.assign(lead, updatePayload)
		await lead.save()

		return res.status(200).json({ message: 'Lead updated successfully', lead })
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}
		console.error('Update lead failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.deleteLead = async (req, res) => {
	try {
		const { leadId } = req.params
		if (!mongoose.isValidObjectId(leadId)) {
			return res.status(400).json({ message: 'Invalid lead id' })
		}

		const lead = await Lead.findById(leadId)
		if (!lead) {
			return res.status(404).json({ message: 'Lead not found' })
		}

		await Lead.deleteOne({ _id: leadId })

		return res.status(200).json({ message: 'Lead deleted successfully' })
	} catch (error) {
		console.error('Delete lead failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
