const User = require('../model/user.model')
const bcrypt = require('bcrypt')
const {
	generateAccessToken,
	generateRefreshToken,
	verifyRefreshToken,
} = require('../utils/token')

const ALLOWED_ROLES = new Set([
	'teacher',
	'supporteacher',
	'headteacher',
	'admin',
	'superadmin',
])

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
const ADMIN_REGISTERABLE_ROLES = new Set(['teacher', 'supporteacher', 'headteacher'])
const SUPERADMIN_REGISTERABLE_ROLES = new Set([
	'teacher',
	'supporteacher',
	'headteacher',
	'admin',
])
const ADMIN_MANAGEABLE_ROLES = new Set(['teacher', 'supporteacher', 'headteacher'])

const parseLocation = location => {
	if (!location) {
		return undefined
	}

	let parsedLocation = location
	if (typeof location === 'string') {
		try {
			parsedLocation = JSON.parse(location)
		} catch (error) {
			return null
		}
	}

	if (
		!parsedLocation ||
		!Array.isArray(parsedLocation.coordinates) ||
		parsedLocation.coordinates.length !== 2
	) {
		return null
	}

	const longitude = Number(parsedLocation.coordinates[0])
	const latitude = Number(parsedLocation.coordinates[1])
	if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
		return null
	}

	if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
		return null
	}

	return {
		type: 'Point',
		coordinates: [longitude, latitude],
	}
}

const sanitizeUser = userDocument => {
	const user = userDocument.toObject()
	delete user.password
	delete user.refreshToken
	return user
}

exports.login = async (req, res) => {
	try {
		const phone = String(req.body.phone || '').trim()
		const password = req.body.password

		if (!phone || !password) {
			return res.status(400).json({ message: 'Phone and password required' })
		}

		const user = await User.findOne({ phone }).select('+password +refreshToken')
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		const isMatch = await bcrypt.compare(password, user.password)
		if (!isMatch) {
			return res.status(401).json({ message: 'Invalid credentials' })
		}

		const accessToken = generateAccessToken(user)
		const refreshToken = generateRefreshToken(user)

		user.refreshToken = refreshToken
		await user.save({ validateBeforeSave: false })

		res.status(200).json({
			accessToken,
			refreshToken,
			user: sanitizeUser(user),
		})
	} catch (error) {
		console.error('Login failed:', error)
		res.status(500).json({ message: 'Internal server error' })
	}
}


exports.register = async (req, res) => {
	try {
		const fullname = String(req.body.fullname || '').trim()
		const phone = String(req.body.phone || '').trim()
		const email = String(req.body.email || '')
			.trim()
			.toLowerCase()
		const dateOfBirth = req.body.dateOfBirth
		const gender = String(req.body.gender || '')
			.trim()
			.toLowerCase()
		const password = req.body.password
		const requestedRole = String(req.body.role || 'teacher')
			.trim()
			.toLowerCase()
		const company = req.body.company ? String(req.body.company).trim() : undefined
		const parsedLocation = parseLocation(req.body.location)

		if (!fullname || !phone || !email || !dateOfBirth || !gender || !password) {
			return res.status(400).json({ message: 'Required fields missing' })
		}

		if (!PHONE_PATTERN.test(phone)) {
			return res.status(400).json({ message: 'Invalid phone format' })
		}

		if (!['male', 'female'].includes(gender)) {
			return res.status(400).json({ message: 'Gender must be male or female' })
		}

		if (password.length < 8) {
			return res.status(400).json({ message: 'Password must be at least 8 characters' })
		}

		if (!ALLOWED_ROLES.has(requestedRole)) {
			return res.status(400).json({ message: 'Invalid role provided' })
		}

		if (requestedRole === 'superadmin') {
			return res
				.status(403)
				.json({ message: 'Superadmin cannot be created from register endpoint' })
		}

		if (!req.user) {
			return res.status(401).json({ message: 'Authorization token missing' })
		}

		const creatorRole = req.user.role
		let canCreateRequestedRole = false
		if (creatorRole === 'superadmin') {
			canCreateRequestedRole = SUPERADMIN_REGISTERABLE_ROLES.has(requestedRole)
		} else if (creatorRole === 'admin') {
			canCreateRequestedRole = ADMIN_REGISTERABLE_ROLES.has(requestedRole)
		}

		if (!canCreateRequestedRole) {
			return res.status(403).json({
				message:
					'Forbidden: only superadmin can create admin, and admin can create only teacher/supporteacher/headteacher',
			})
		}

		if (req.body.location && !parsedLocation) {
			return res.status(400).json({
				message:
					'Invalid location. Expected JSON object with coordinates [longitude, latitude]',
			})
		}

		const parsedDate = new Date(dateOfBirth)
		if (Number.isNaN(parsedDate.getTime())) {
			return res.status(400).json({ message: 'Invalid dateOfBirth value' })
		}

		const existingUser = await User.findOne({
			$or: [{ phone }, { email }],
		})
		if (existingUser) {
			const duplicateField = existingUser.phone === phone ? 'Phone' : 'Email'
			return res.status(409).json({ message: `${duplicateField} already exists` })
		}

		const hashedPassword = await bcrypt.hash(password, 12)

		const userPayload = {
			fullname,
			phone,
			email,
			dateOfBirth: parsedDate,
			gender,
			password: hashedPassword,
			role: requestedRole,
			company,
		}

		if (parsedLocation) {
			userPayload.location = parsedLocation
		}

		if (req.file) {
			userPayload.imgURL = `/uploads/${req.file.filename}`
		}

		const user = await User.create(userPayload)

		const accessToken = generateAccessToken(user)
		const refreshToken = generateRefreshToken(user)

		user.refreshToken = refreshToken
		await user.save({ validateBeforeSave: false })

		const userResponse = await User.findById(user._id)

		res.status(201).json({
			accessToken,
			refreshToken,
			user: userResponse,
		})
	} catch (error) {
		if (error.code === 11000) {
			const duplicateField = Object.keys(error.keyPattern || {})[0] || 'Field'
			return res.status(409).json({ message: `${duplicateField} already exists` })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Registration failed:', error)
		res.status(500).json({ message: 'Internal server error' })
	}
}

exports.refreshToken = async (req, res) => {
	try {
		const refreshToken = String(req.body.refreshToken || '').trim()
		if (!refreshToken) {
			return res.status(400).json({ message: 'Refresh token is required' })
		}

		const payload = verifyRefreshToken(refreshToken)
		const user = await User.findById(payload.id).select('+refreshToken')
		if (!user || !user.refreshToken) {
			return res.status(401).json({ message: 'Invalid refresh token' })
		}

		if (user.refreshToken !== refreshToken) {
			return res.status(401).json({ message: 'Refresh token mismatch' })
		}

		const newAccessToken = generateAccessToken(user)
		const newRefreshToken = generateRefreshToken(user)
		user.refreshToken = newRefreshToken
		await user.save({ validateBeforeSave: false })

		return res.status(200).json({
			accessToken: newAccessToken,
			refreshToken: newRefreshToken,
		})
	} catch (error) {
		console.error('Refresh token failed:', error)
		return res.status(401).json({ message: 'Invalid or expired refresh token' })
	}
}

exports.logout = async (req, res) => {
	try {
		if (!req.user) {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		req.user.refreshToken = null
		await req.user.save({ validateBeforeSave: false })
		return res.status(200).json({ message: 'Logged out successfully' })
	} catch (error) {
		console.error('Logout failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.me = async (req, res) => {
	try {
		if (!req.user) {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		return res.status(200).json({ user: sanitizeUser(req.user) })
	} catch (error) {
		console.error('Get profile failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listUsers = async (req, res) => {
	try {
		const limit = Math.min(Number(req.query.limit) || 20, 100)
		const users = await User.find({})
			.sort({ createdAt: -1 })
			.limit(limit)

		return res.status(200).json({
			count: users.length,
			users,
		})
	} catch (error) {
		console.error('List users failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateUserRole = async (req, res) => {
	try {
		const userId = req.params.userId
		const role = String(req.body.role || '')
			.trim()
			.toLowerCase()

		if (!ALLOWED_ROLES.has(role)) {
			return res.status(400).json({ message: 'Invalid role provided' })
		}

		if (!['admin', 'superadmin'].includes(req.user.role)) {
			return res.status(403).json({
				message: 'Only admin or superadmin can change user roles',
			})
		}

		if (req.user._id.toString() === userId && role !== 'superadmin') {
			return res.status(400).json({
				message: 'You cannot remove your own superadmin access in this endpoint',
			})
		}

		const user = await User.findById(userId)
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		if (req.user.role === 'admin') {
			if (!ADMIN_MANAGEABLE_ROLES.has(role)) {
				return res.status(403).json({
					message:
						'Admin can only assign teacher, supporteacher, or headteacher roles',
				})
			}

			if (['admin', 'superadmin'].includes(user.role)) {
				return res.status(403).json({
					message: 'Admin cannot change admin or superadmin accounts',
				})
			}
		}

		if (req.user.role === 'superadmin' && role === 'superadmin' && user.role !== 'superadmin') {
			return res.status(403).json({
				message:
					'Use a dedicated secure bootstrap flow to assign superadmin to another account',
			})
		}

		user.role = role
		await user.save()

		return res.status(200).json({
			message: 'User role updated successfully',
			user,
		})
	} catch (error) {
		if (error.name === 'CastError') {
			return res.status(400).json({ message: 'Invalid user id' })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update user role failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
