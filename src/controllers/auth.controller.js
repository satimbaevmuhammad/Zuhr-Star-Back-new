const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')
const User = require('../model/user.model')
const Group = require('../model/group.model')
const bcrypt = require('bcrypt')
const {
	generateAccessToken,
	generateRefreshToken,
	verifyRefreshToken,
} = require('../utils/token')
const { toPublicUrl } = require('../utils/public-url')

const ALLOWED_ROLES = new Set([
	'teacher',
	'supporteacher',
	'headteacher',
	'admin',
	'superadmin',
])

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
const SUPERADMIN_REGISTERABLE_ROLES = new Set([
	'teacher',
	'supporteacher',
	'headteacher',
	'admin',
])
const ADMIN_MANAGEABLE_ROLES = new Set(['teacher', 'supporteacher', 'headteacher'])
const FACE_DESCRIPTOR_LENGTH = 128

const parseFaceDescriptor = value => {
	if (typeof value === 'undefined' || value === null) {
		return null
	}

	let parsedValue = value
	if (typeof value === 'string') {
		try {
			parsedValue = JSON.parse(value)
		} catch (error) {
			return null
		}
	}

	if (!Array.isArray(parsedValue) || parsedValue.length !== FACE_DESCRIPTOR_LENGTH) {
		return null
	}

	const descriptor = parsedValue.map(number => Number(number))
	if (!descriptor.every(number => Number.isFinite(number))) {
		return null
	}

	return descriptor
}

const parseFaceMatchThreshold = value => {
	if (typeof value === 'undefined' || value === null || value === '') {
		const envThreshold = Number(process.env.FACE_MATCH_THRESHOLD)
		if (Number.isFinite(envThreshold) && envThreshold > 0 && envThreshold <= 2) {
			return envThreshold
		}
		return 0.45
	}

	const threshold = Number(value)
	if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 2) {
		return null
	}

	return threshold
}

const euclideanDistance = (first, second) => {
	let sum = 0
	for (let index = 0; index < first.length; index += 1) {
		const delta = first[index] - second[index]
		sum += delta * delta
	}
	return Math.sqrt(sum)
}

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

const removeUploadedFileIfAny = req => {
	if (!req?.file?.path) {
		return
	}

	try {
		if (fs.existsSync(req.file.path)) {
			fs.unlinkSync(req.file.path)
		}
	} catch (error) {
		console.error('Failed to remove uploaded avatar after auth rejection:', error)
	}
}

const resolveLocalUploadPath = imgURL => {
	if (typeof imgURL !== 'string' || !imgURL.startsWith('/uploads/')) {
		return null
	}

	const normalizedPath = imgURL.replace(/^[\\/]+/, '')
	return path.join(process.cwd(), normalizedPath)
}

const sanitizeUser = (userDocument, req) => {
	const user = userDocument?.toObject ? userDocument.toObject() : { ...userDocument }
	delete user.password
	delete user.refreshToken
	delete user.faceDescriptor
	user.imgURL = toPublicUrl(req, user.imgURL)
	user.faceIdEnabled = Boolean(user.faceIdEnabled)
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
			user: sanitizeUser(user, req),
		})
	} catch (error) {
		console.error('Login failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateFaceId = async (req, res) => {
	try {
		const descriptor = parseFaceDescriptor(req.body.descriptor)
		if (!descriptor) {
			return res.status(400).json({
				message: `descriptor must be an array with exactly ${FACE_DESCRIPTOR_LENGTH} numeric values`,
			})
		}

		const user = await User.findById(req.user._id).select('+faceDescriptor +refreshToken')
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		user.faceDescriptor = descriptor
		user.faceIdEnabled = true
		await user.save()

		return res.status(200).json({
			message: 'Face ID registered successfully',
			user: sanitizeUser(user, req),
		})
	} catch (error) {
		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			return res.status(400).json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update Face ID failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.loginWithFaceId = async (req, res) => {
	try {
		const descriptor = parseFaceDescriptor(req.body.descriptor)
		if (!descriptor) {
			return res.status(400).json({
				message: `descriptor must be an array with exactly ${FACE_DESCRIPTOR_LENGTH} numeric values`,
			})
		}

		const threshold = parseFaceMatchThreshold(req.body.threshold)
		if (threshold === null) {
			return res.status(400).json({
				message: 'threshold must be a number greater than 0 and less than or equal to 2',
			})
		}

		const envMaxCandidates = Number(process.env.FACE_LOGIN_MAX_CANDIDATES)
		const maxCandidates =
			Number.isInteger(envMaxCandidates) && envMaxCandidates > 0
				? Math.min(envMaxCandidates, 10000)
				: 2000

		const users = await User.find({ faceIdEnabled: true })
			.select('+faceDescriptor +refreshToken')
			.limit(maxCandidates)

		let bestMatch = null
		for (const user of users) {
			if (!Array.isArray(user.faceDescriptor) || user.faceDescriptor.length !== FACE_DESCRIPTOR_LENGTH) {
				continue
			}

			const distance = euclideanDistance(descriptor, user.faceDescriptor)
			if (!bestMatch || distance < bestMatch.distance) {
				bestMatch = { user, distance }
			}
		}

		if (!bestMatch || bestMatch.distance > threshold) {
			return res.status(401).json({ message: 'Face ID not recognized' })
		}

		const accessToken = generateAccessToken(bestMatch.user)
		const refreshToken = generateRefreshToken(bestMatch.user)

		bestMatch.user.refreshToken = refreshToken
		await bestMatch.user.save({ validateBeforeSave: false })

		return res.status(200).json({
			accessToken,
			refreshToken,
			matchDistance: Number(bestMatch.distance.toFixed(6)),
			user: sanitizeUser(bestMatch.user, req),
		})
	} catch (error) {
		console.error('Face ID login failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.removeFaceId = async (req, res) => {
	try {
		if (!req.user) {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		const user = await User.findById(req.user._id).select('+faceDescriptor +refreshToken')
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		user.faceDescriptor = undefined
		user.faceIdEnabled = false
		await user.save({ validateBeforeSave: false })

		return res.status(200).json({
			message: 'Face ID removed successfully',
			user: sanitizeUser(user, req),
		})
	} catch (error) {
		console.error('Remove Face ID failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}


exports.register = async (req, res) => {
	let createdUserId = null
	const fail = (statusCode, message) => {
		removeUploadedFileIfAny(req)
		return res.status(statusCode).json({ message })
	}

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
		const faceDescriptorInput =
			typeof req.body.faceDescriptor !== 'undefined'
				? req.body.faceDescriptor
				: req.body.descriptor
		const faceDescriptor =
			typeof faceDescriptorInput === 'undefined'
				? null
				: parseFaceDescriptor(faceDescriptorInput)

		if (!fullname || !phone || !email || !dateOfBirth || !gender || !password) {
			return fail(400, 'Required fields missing')
		}

		if (!PHONE_PATTERN.test(phone)) {
			return fail(400, 'Invalid phone format')
		}

		if (!['male', 'female'].includes(gender)) {
			return fail(400, 'Gender must be male or female')
		}

		if (password.length < 8) {
			return fail(400, 'Password must be at least 8 characters')
		}

		if (!ALLOWED_ROLES.has(requestedRole)) {
			return fail(400, 'Invalid role provided')
		}

		if (requestedRole === 'superadmin') {
			return fail(403, 'Superadmin cannot be created from register endpoint')
		}

		if (req.body.location && !parsedLocation) {
			return fail(
				400,
				'Invalid location. Expected JSON object with coordinates [longitude, latitude]',
			)
		}

		if (typeof faceDescriptorInput !== 'undefined' && !faceDescriptor) {
			return fail(
				400,
				`descriptor must be an array with exactly ${FACE_DESCRIPTOR_LENGTH} numeric values`,
			)
		}

		const parsedDate = new Date(dateOfBirth)
		if (Number.isNaN(parsedDate.getTime())) {
			return fail(400, 'Invalid dateOfBirth value')
		}

		const existingUser = await User.findOne({
			$or: [{ phone }, { email }],
		})
		if (existingUser) {
			const duplicateField = existingUser.phone === phone ? 'Phone' : 'Email'
			return fail(409, `${duplicateField} already exists`)
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

		if (faceDescriptor) {
			userPayload.faceDescriptor = faceDescriptor
			userPayload.faceIdEnabled = true
		}

		const user = await User.create(userPayload)
		createdUserId = user._id?.toString?.() || String(user._id || '')

		res.status(201).json({
			user: sanitizeUser(user, req),
		})
	} catch (error) {
		if (error.code === 11000) {
			const duplicateField = Object.keys(error.keyPattern || {})[0] || 'Field'
			if (!createdUserId) {
				removeUploadedFileIfAny(req)
			}
			return res.status(409).json({ message: `${duplicateField} already exists` })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			if (!createdUserId) {
				removeUploadedFileIfAny(req)
			}
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Registration failed:', error)
		if (!createdUserId) {
			removeUploadedFileIfAny(req)
		}
		res.status(500).json({ message: 'Internal server error' })
	}
}

exports.updateUser = async (req, res) => {
	const fail = (statusCode, message) => {
		removeUploadedFileIfAny(req)
		return res.status(statusCode).json({ message })
	}

	try {
		const userId = req.params.userId

		if (!mongoose.isValidObjectId(userId)) {
			return fail(400, 'Invalid user id')
		}

		if (!req.user) {
			return fail(401, 'Unauthorized')
		}

		if (req.user._id.toString() !== userId) {
			return fail(403, 'You can only update your own profile')
		}

		const updatePayload = {}

		if (typeof req.body.fullname !== 'undefined') {
			const fullname = String(req.body.fullname || '').trim()
			if (!fullname) {
				return fail(400, 'fullname cannot be empty')
			}
			updatePayload.fullname = fullname
		}

		if (typeof req.body.phone !== 'undefined') {
			const phone = String(req.body.phone || '').trim()
			if (!PHONE_PATTERN.test(phone)) {
				return fail(400, 'Invalid phone format')
			}
			updatePayload.phone = phone
		}

		if (typeof req.body.email !== 'undefined') {
			const email = String(req.body.email || '')
				.trim()
				.toLowerCase()
			if (!email) {
				return fail(400, 'email cannot be empty')
			}
			updatePayload.email = email
		}

		if (typeof req.body.dateOfBirth !== 'undefined') {
			const parsedDate = new Date(req.body.dateOfBirth)
			if (Number.isNaN(parsedDate.getTime())) {
				return fail(400, 'Invalid dateOfBirth value')
			}
			updatePayload.dateOfBirth = parsedDate
		}

		if (typeof req.body.gender !== 'undefined') {
			const gender = String(req.body.gender || '')
				.trim()
				.toLowerCase()
			if (!['male', 'female'].includes(gender)) {
				return fail(400, 'Gender must be male or female')
			}
			updatePayload.gender = gender
		}

		if (typeof req.body.company !== 'undefined') {
			const company = String(req.body.company || '').trim()
			updatePayload.company = company || undefined
		}

		if (typeof req.body.location !== 'undefined') {
			if (req.body.location === null || req.body.location === '') {
				updatePayload.location = undefined
			} else {
				const parsedLocation = parseLocation(req.body.location)
				if (!parsedLocation) {
					return fail(
						400,
						'Invalid location. Expected JSON object with coordinates [longitude, latitude]',
					)
				}
				updatePayload.location = parsedLocation
			}
		}

		if (typeof req.body.password !== 'undefined') {
			const password = String(req.body.password || '')
			if (password.length < 8) {
				return fail(400, 'Password must be at least 8 characters')
			}
			updatePayload.password = await bcrypt.hash(password, 12)
		}

		if (req.file) {
			updatePayload.imgURL = `/uploads/${req.file.filename}`
		}

		const user = await User.findById(userId).select('+refreshToken')
		if (!user) {
			return fail(404, 'User not found')
		}

		const previousImgURL = user.imgURL

		Object.assign(user, updatePayload)
		await user.save()

		if (
			req.file &&
			previousImgURL &&
			previousImgURL !== user.imgURL &&
			previousImgURL !== '/uploads/default-avatar.png'
		) {
			const previousPath = resolveLocalUploadPath(previousImgURL)
			if (previousPath) {
				try {
					if (fs.existsSync(previousPath)) {
						fs.unlinkSync(previousPath)
					}
				} catch (error) {
					console.error('Failed to remove previous avatar:', error)
				}
			}
		}

		return res.status(200).json({
			message: 'User updated successfully',
			user: sanitizeUser(user, req),
		})
	} catch (error) {
		if (error.code === 11000) {
			const duplicateField = Object.keys(error.keyPattern || {})[0] || 'Field'
			removeUploadedFileIfAny(req)
			return res.status(409).json({ message: `${duplicateField} already exists` })
		}

		if (error.name === 'ValidationError') {
			const firstErrorMessage = Object.values(error.errors || {})[0]?.message
			removeUploadedFileIfAny(req)
			return res
				.status(400)
				.json({ message: firstErrorMessage || 'Validation failed' })
		}

		console.error('Update user failed:', error)
		removeUploadedFileIfAny(req)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.refreshToken = async (req, res) => {
	try {
		const refreshTokenInput = String(req.body.refreshToken || '').trim()
		if (!refreshTokenInput) {
			return res.status(400).json({ message: 'Refresh token is required' })
		}

		const refreshToken = refreshTokenInput.replace(/^Bearer\s+/i, '').trim()
		const strictRefreshTokenMatch =
			String(process.env.STRICT_REFRESH_TOKEN_MATCH || 'false')
				.trim()
				.toLowerCase() === 'true'

		const payload = verifyRefreshToken(refreshToken)
		const user = await User.findById(payload.id).select('+refreshToken')
		if (!user || !user.refreshToken) {
			return res.status(401).json({ message: 'Invalid refresh token' })
		}

		if (strictRefreshTokenMatch && user.refreshToken !== refreshToken) {
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

		return res.status(200).json({ user: sanitizeUser(req.user, req) })
	} catch (error) {
		console.error('Get profile failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}

exports.listUsers = async (req, res) => {
	try {
		const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
		const page = Math.max(Number(req.query.page) || 1, 1)
		const skip = (page - 1) * limit
		const search = String(req.query.search || '').trim()
		const role = String(req.query.role || '').trim().toLowerCase()

		const query = {}
		if (search) {
			query.$or = [
				{ fullname: { $regex: search, $options: 'i' } },
				{ phone: { $regex: search, $options: 'i' } },
				{ email: { $regex: search, $options: 'i' } },
			]
		}
		if (role && ALLOWED_ROLES.has(role)) {
			query.role = role
		}

		const [users, total] = await Promise.all([
			User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
			User.countDocuments(query),
		])

		return res.status(200).json({
			page,
			limit,
			total,
			users: users.map(user => sanitizeUser(user, req)),
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
			user: sanitizeUser(user, req),
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

exports.deleteUser = async (req, res) => {
	try {
		const userId = req.params.userId

		if (!mongoose.isValidObjectId(userId)) {
			return res.status(400).json({ message: 'Invalid user id' })
		}

		if (req.user?._id?.toString() === userId) {
			return res.status(400).json({
				message: 'You cannot delete your own account in this endpoint',
			})
		}

		const user = await User.findById(userId)
		if (!user) {
			return res.status(404).json({ message: 'User not found' })
		}

		if (req.user.role === 'admin') {
			if (!ADMIN_MANAGEABLE_ROLES.has(user.role)) {
				return res.status(403).json({
					message: 'Admin cannot delete admin or superadmin accounts',
				})
			}
		}

		if (req.user.role !== 'superadmin' && user.role === 'superadmin') {
			return res.status(403).json({ message: 'Only superadmin can delete this account' })
		}

		const linkedGroup = await Group.findOne({
			$or: [{ teacher: userId }, { supportTeachers: userId }],
		}).select('_id name')
		if (linkedGroup) {
			return res.status(409).json({
				message: 'Cannot delete user while assigned to groups',
			})
		}

		await User.deleteOne({ _id: userId })

		return res.status(200).json({ message: 'User deleted successfully' })
	} catch (error) {
		console.error('Delete user failed:', error)
		return res.status(500).json({ message: 'Internal server error' })
	}
}
