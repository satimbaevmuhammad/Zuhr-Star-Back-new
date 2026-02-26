const fs = require('fs')

const User = require('../model/user.model')
const { verifyAccessToken } = require('../utils/token')

const ROLE_PERMISSIONS = Object.freeze({
	teacher: ['profile:read', 'students:read', 'groups:read'],
	supporteacher: ['profile:read', 'students:read', 'groups:read'],
	headteacher: [
		'profile:read',
		'users:read',
		'students:read',
		'students:manage',
		'groups:read',
		'groups:manage',
	],
	admin: [
		'profile:read',
		'users:read',
		'users:manage',
		'users:manage_roles',
		'students:read',
		'students:manage',
		'groups:read',
		'groups:manage',
	],
	superadmin: ['*'],
})

const hasPermission = (role, permission) => {
	const permissions = ROLE_PERMISSIONS[role] || []
	return permissions.includes('*') || permissions.includes(permission)
}

const extractBearerToken = authHeader => {
	if (typeof authHeader !== 'string') {
		return null
	}

	const match = authHeader.trim().match(/^Bearer\s+(.+)$/i)
	if (!match || !match[1]) {
		return null
	}

	const token = match[1].trim()
	return token || null
}

const canCreateRoleViaRegister = (actorRole, targetRole) => {
	if (targetRole === 'superadmin') {
		return false
	}

	return actorRole === 'superadmin' && ['teacher', 'supporteacher', 'headteacher', 'admin'].includes(targetRole)
}

const requireAuth = async (req, res, next) => {
	try {
		const token = extractBearerToken(req.headers.authorization)
		if (!token) {
			return res.status(401).json({ message: 'Authorization token missing' })
		}

		const payload = verifyAccessToken(token)
		const user = await User.findById(payload.id).select('+refreshToken')

		if (!user) {
			return res.status(401).json({ message: 'Invalid token user' })
		}

		req.user = user
		next()
	} catch (error) {
		return res.status(401).json({ message: 'Invalid or expired access token' })
	}
}

const allowRoles = (...roles) => {
	return (req, res, next) => {
		if (!req.user || !roles.includes(req.user.role)) {
			return res.status(403).json({ message: 'Forbidden: insufficient role' })
		}
		next()
	}
}

const allowPermissions = (...permissions) => {
	return (req, res, next) => {
		if (!req.user) {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		const allowed = permissions.every(permission => hasPermission(req.user.role, permission))
		if (!allowed) {
			return res.status(403).json({ message: 'Forbidden: insufficient permissions' })
		}

		next()
	}
}

const removeUploadedFileIfAny = req => {
	if (!req.file || !req.file.path) {
		return
	}

	try {
		if (fs.existsSync(req.file.path)) {
			fs.unlinkSync(req.file.path)
		}
	} catch (error) {
		console.error('Failed to remove uploaded file after auth rejection:', error)
	}
}

const requireRegisterPermission = (req, res, next) => {
	const requestedRole = String(req.body.role || 'teacher')
		.trim()
		.toLowerCase()

	const token = extractBearerToken(req.headers.authorization)
	if (!token) {
		removeUploadedFileIfAny(req)
		return res.status(401).json({ message: 'Authorization token missing' })
	}

	return Promise.resolve()
		.then(async () => {
			const payload = verifyAccessToken(token)
			const user = await User.findById(payload.id).select('+refreshToken')
			if (!user) {
				removeUploadedFileIfAny(req)
				return res.status(401).json({ message: 'Invalid token user' })
			}

			req.user = user
			const canCreate = canCreateRoleViaRegister(user.role, requestedRole)
			if (!canCreate) {
				removeUploadedFileIfAny(req)
				return res.status(403).json({
					message: 'Forbidden: only superadmin can register employees',
				})
			}

			return next()
		})
		.catch(() => {
			removeUploadedFileIfAny(req)
			return res.status(401).json({ message: 'Invalid or expired access token' })
		})
}

module.exports = {
	ROLE_PERMISSIONS,
	hasPermission,
	canCreateRoleViaRegister,
	extractBearerToken,
	requireAuth,
	allowRoles,
	allowPermissions,
	requireRegisterPermission,
}
