/**
 * Unified JWT utilities for employee and student authentication.
 * Exports helpers to sign/verify access and refresh tokens with one secret.
 */

const jwt = require('jsonwebtoken')

const JWT_ALGORITHM = 'HS256'
const EMPLOYEE_ACCESS_EXPIRES_IN = '24h'
const EMPLOYEE_REFRESH_EXPIRES_IN = '7d'
const STUDENT_ACCESS_EXPIRES_IN = '24h'
const STUDENT_REFRESH_EXPIRES_IN = '7d'

const resolveSecret = () =>
	process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET

const ensureSecret = () => {
	const secret = resolveSecret()
	if (!secret) {
		throw new Error('JWT_SECRET is required')
	}
	return secret
}

const resolveEntityId = entity => String(entity?._id || entity?.id || entity?.sub || '').trim()

const signToken = ({ sub, role, userType, tokenType, expiresIn }) => {
	const secret = ensureSecret()
	return jwt.sign(
		{
			sub,
			id: sub, // legacy compatibility for existing consumers
			role,
			userType,
			tokenType,
		},
		secret,
		{
			expiresIn,
			algorithm: JWT_ALGORITHM,
		},
	)
}

const generateAccessToken = user => {
	const sub = resolveEntityId(user)
	return signToken({
		sub,
		role: String(user?.role || '').trim() || 'teacher',
		userType: 'employee',
		tokenType: 'access',
		expiresIn: EMPLOYEE_ACCESS_EXPIRES_IN,
	})
}

const generateRefreshToken = user => {
	const sub = resolveEntityId(user)
	return signToken({
		sub,
		role: String(user?.role || '').trim() || 'teacher',
		userType: 'employee',
		tokenType: 'refresh',
		expiresIn: EMPLOYEE_REFRESH_EXPIRES_IN,
	})
}

const generateStudentAccessToken = student => {
	const sub = resolveEntityId(student)
	return signToken({
		sub,
		role: 'student',
		userType: 'student',
		tokenType: 'access',
		expiresIn: STUDENT_ACCESS_EXPIRES_IN,
	})
}

const generateStudentRefreshToken = student => {
	const sub = resolveEntityId(student)
	return signToken({
		sub,
		role: 'student',
		userType: 'student',
		tokenType: 'refresh',
		expiresIn: STUDENT_REFRESH_EXPIRES_IN,
	})
}

const verifyToken = (token, { expectedTokenType } = {}) => {
	const secret = ensureSecret()
	const payload = jwt.verify(token, secret, {
		algorithms: [JWT_ALGORITHM],
	})

	if (
		!payload ||
		typeof payload.sub !== 'string' ||
		typeof payload.role !== 'string' ||
		typeof payload.userType !== 'string'
	) {
		throw new Error('Invalid token payload')
	}

	if (expectedTokenType && payload.tokenType !== expectedTokenType) {
		throw new Error('Invalid token type')
	}

	return payload
}

const verifyAccessToken = token => verifyToken(token, { expectedTokenType: 'access' })
const verifyRefreshToken = token => verifyToken(token, { expectedTokenType: 'refresh' })

module.exports = {
	JWT_ALGORITHM,
	generateAccessToken,
	generateRefreshToken,
	generateStudentAccessToken,
	generateStudentRefreshToken,
	verifyToken,
	verifyAccessToken,
	verifyRefreshToken,
}
