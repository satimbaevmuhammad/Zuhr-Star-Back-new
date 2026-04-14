const fs = require('fs')

const User = require('../model/user.model')
const Student = require('../model/student.model')
const Role = require('../models/Role.model')
const { verifyAccessToken } = require('../utils/token')

const ROLE_CACHE_TTL_MS = 60 * 1000

let rolePermissionCache = new Map()
let rolePermissionCacheExpiresAt = 0

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

const normalizeRoleInput = value => {
	const normalized = String(value || '').trim()
	const lowered = normalized.toLowerCase()
	if (lowered === 'supportteacher') {
		return 'supporteacher'
	}

	return lowered
}

const canCreateRoleViaRegister = (actorRole, targetRole) => {
	if (targetRole === 'superadmin') {
		return false
	}

	return actorRole === 'superadmin' && ['teacher', 'supporteacher', 'headteacher', 'admin'].includes(targetRole)
}

const buildRequestIdentity = payload => {
	const id = String(payload.sub || payload.id || '').trim()
	return {
		id,
		// Kept for backward compatibility with existing controller code paths.
		_id: id,
		role: String(payload.role || '').trim(),
		userType: String(payload.userType || '').trim(),
	}
}

const invalidateRolePermissionsCache = () => {
	rolePermissionCache = new Map()
	rolePermissionCacheExpiresAt = 0
}

const loadRolePermissionsMap = async () => {
	const now = Date.now()
	if (rolePermissionCache.size > 0 && now < rolePermissionCacheExpiresAt) {
		return rolePermissionCache
	}

	const roles = await Role.find().select('name permissions')
	const nextCache = new Map()
	for (const roleDocument of roles) {
		nextCache.set(
			String(roleDocument.name || '').trim(),
			Array.isArray(roleDocument.permissions) ? roleDocument.permissions : [],
		)
	}

	rolePermissionCache = nextCache
	rolePermissionCacheExpiresAt = now + ROLE_CACHE_TTL_MS
	return rolePermissionCache
}

const hasPermission = async (role, permission) => {
	if (role === 'superadmin') {
		return true
	}

	const roleMap = await loadRolePermissionsMap()
	const permissions = roleMap.get(role) || []
	return permissions.includes('*') || permissions.includes(permission)
}

const verifyToken = async (req, res, next) => {
	try {
		const token = extractBearerToken(req.headers.authorization)
		if (!token) {
			return res.status(401).json({ message: 'Authorization token missing' })
		}

		const payload = verifyAccessToken(token)
		req.user = buildRequestIdentity(payload)
		return next()
	} catch (error) {
		return res.status(401).json({ message: 'Invalid or expired access token' })
	}
}

const requireAuth = async (req, res, next) => {
	return verifyToken(req, res, async () => {
		try {
			if (req.user.userType !== 'employee') {
				return res.status(401).json({ message: 'Invalid employee token' })
			}

			const userDocument = await User.findById(req.user.id).select('+refreshToken')
			if (!userDocument) {
				return res.status(401).json({ message: 'Invalid token user' })
			}

			req.userDocument = userDocument
			req.user.role = userDocument.role
			return next()
		} catch (error) {
			return res.status(401).json({ message: 'Invalid or expired access token' })
		}
	})
}

const requireStudentAuth = async (req, res, next) => {
	return verifyToken(req, res, async () => {
		try {
			if (req.user.userType !== 'student') {
				return res.status(401).json({ message: 'Invalid student token' })
			}

			const student = await Student.findById(req.user.id)
			if (!student) {
				return res.status(401).json({ message: 'Invalid token student' })
			}

			req.student = student
			return next()
		} catch (error) {
			return res.status(401).json({ message: 'Invalid or expired access token' })
		}
	})
}

const requireAnyAuth = async (req, res, next) => {
	return verifyToken(req, res, async () => {
		try {
			if (req.user.userType === 'employee') {
				const userDocument = await User.findById(req.user.id).select('+refreshToken')
				if (!userDocument) {
					return res.status(401).json({ message: 'Invalid token user' })
				}

				req.userDocument = userDocument
				req.user.role = userDocument.role
				return next()
			}

			if (req.user.userType === 'student') {
				const student = await Student.findById(req.user.id)
				if (!student) {
					return res.status(401).json({ message: 'Invalid token student' })
				}

				req.student = student
				return next()
			}

			return res.status(401).json({ message: 'Invalid token user type' })
		} catch (error) {
			return res.status(401).json({ message: 'Invalid or expired access token' })
		}
	})
}

const allowRoles = (...roles) => {
	return (req, res, next) => {
		if (!req.user || req.user.userType !== 'employee' || !roles.includes(req.user.role)) {
			return res.status(403).json({ message: 'Forbidden: insufficient role' })
		}
		return next()
	}
}

const allowPermissions = (...permissions) => {
	return async (req, res, next) => {
		if (!req.user || req.user.userType !== 'employee') {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		try {
			for (const permission of permissions) {
				const allowed = await hasPermission(req.user.role, permission)
				if (!allowed) {
					return res.status(403).json({ message: 'Forbidden: insufficient permissions' })
				}
			}

			return next()
		} catch (error) {
			return res.status(500).json({ message: 'Failed to load role permissions' })
		}
	}
}

const allowPermissionsOrStudent = (...permissions) => {
	return async (req, res, next) => {
		if (!req.user) {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		if (req.user.userType === 'student') {
			return next()
		}

		if (req.user.userType !== 'employee') {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		try {
			for (const permission of permissions) {
				const allowed = await hasPermission(req.user.role, permission)
				if (!allowed) {
					return res.status(403).json({ message: 'Forbidden: insufficient permissions' })
				}
			}

			return next()
		} catch (error) {
			return res.status(500).json({ message: 'Failed to load role permissions' })
		}
	}
}

const allowStudentSelfOrPermissions = (...permissions) => {
	return async (req, res, next) => {
		if (!req.user) {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		if (req.user.userType === 'student') {
			const routeStudentId = String(req.params.studentId || '').trim()
			if (routeStudentId && routeStudentId === req.user.id) {
				return next()
			}

			return res.status(403).json({
				message: 'Forbidden: students can only access their own data',
			})
		}

		if (req.user.userType !== 'employee') {
			return res.status(401).json({ message: 'Unauthorized' })
		}

		try {
			for (const permission of permissions) {
				const allowed = await hasPermission(req.user.role, permission)
				if (!allowed) {
					return res.status(403).json({ message: 'Forbidden: insufficient permissions' })
				}
			}

			return next()
		} catch (error) {
			return res.status(500).json({ message: 'Failed to load role permissions' })
		}
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
	const requestedRole = normalizeRoleInput(req.body.role || 'teacher')

	const token = extractBearerToken(req.headers.authorization)
	if (!token) {
		removeUploadedFileIfAny(req)
		return res.status(401).json({ message: 'Authorization token missing' })
	}

	return Promise.resolve()
		.then(async () => {
			const payload = verifyAccessToken(token)
			const identity = buildRequestIdentity(payload)
			if (identity.userType !== 'employee') {
				removeUploadedFileIfAny(req)
				return res.status(401).json({ message: 'Invalid token user' })
			}

			const user = await User.findById(identity.id).select('+refreshToken')
			if (!user) {
				removeUploadedFileIfAny(req)
				return res.status(401).json({ message: 'Invalid token user' })
			}

			req.user = identity
			req.user.role = user.role
			req.userDocument = user

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
	ROLE_CACHE_TTL_MS,
	hasPermission,
	canCreateRoleViaRegister,
	extractBearerToken,
	verifyToken,
	requireAuth,
	requireStudentAuth,
	requireAnyAuth,
	allowRoles,
	allowPermissions,
	allowPermissionsOrStudent,
	allowStudentSelfOrPermissions,
	requireRegisterPermission,
	invalidateRolePermissionsCache,
}
