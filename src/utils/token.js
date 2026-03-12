const jwt = require('jsonwebtoken')
const crypto = require('crypto')

const getAccessSecret = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET

const ensureSecret = (secret, name) => {
	if (!secret) {
		throw new Error(`${name} is required`)
	}
}

const generateAccessToken = user => {
	const secret = getAccessSecret()
	ensureSecret(secret, 'JWT_ACCESS_SECRET or JWT_SECRET')

	return jwt.sign(
		{ id: user._id, role: user.role },
		secret,
		{ expiresIn: '5h' },
	)
}

const generateRefreshToken = user => {
	const secret = getRefreshSecret()
	ensureSecret(secret, 'JWT_REFRESH_SECRET or JWT_SECRET')

	return jwt.sign({ id: user._id }, secret, {
		expiresIn: '7d',
		jwtid: crypto.randomUUID(),
	})
}

const generateStudentAccessToken = student => {
	const secret = getAccessSecret()
	ensureSecret(secret, 'JWT_ACCESS_SECRET or JWT_SECRET')

	return jwt.sign(
		{ id: student._id, role: 'student', type: 'student' },
		secret,
		{ expiresIn: '5h' },
	)
}

const verifyAccessToken = token => {
	const secret = getAccessSecret()
	ensureSecret(secret, 'JWT_ACCESS_SECRET or JWT_SECRET')
	return jwt.verify(token, secret)
}

const verifyRefreshToken = token => {
	const secret = getRefreshSecret()
	ensureSecret(secret, 'JWT_REFRESH_SECRET or JWT_SECRET')
	return jwt.verify(token, secret)
}

module.exports = {
	generateAccessToken,
	generateRefreshToken,
	generateStudentAccessToken,
	verifyAccessToken,
	verifyRefreshToken,
}
