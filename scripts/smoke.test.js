const assert = require('assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawnSync } = require('child_process')

const filesToCheck = [
	'index.js',
	'app.js',
	'src/config/db.js',
	'src/config/swagger.js',
	'src/middleware/auth.middleware.js',
	'src/middleware/upload.middleware.js',
	'src/routes/auth.routes.js',
	'src/routes/student.routes.js',
	'src/routes/group.routes.js',
	'src/controllers/auth.controller.js',
	'src/controllers/student.controller.js',
	'src/controllers/group.controller.js',
	'src/model/user.model.js',
	'src/model/student.model.js',
	'src/model/group.model.js',
	'src/utils/token.js',
]

const checkSyntax = file => {
	const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
	assert.strictEqual(
		check.status,
		0,
		`Syntax check failed for ${file}\n${check.stderr || check.stdout}`,
	)
}

const makeRequest = (port, path) =>
	new Promise((resolve, reject) => {
		http
			.get({ hostname: '127.0.0.1', port, path }, response => {
				let body = ''
				response.on('data', chunk => {
					body += chunk
				})
				response.on('end', () => {
					resolve({ statusCode: response.statusCode, body })
				})
			})
			.on('error', reject)
	})

const run = async () => {
	filesToCheck.forEach(checkSyntax)

	const {
		hasPermission,
		extractBearerToken,
		requireRegisterPermission,
	} = require('../src/middleware/auth.middleware')
	const { generateAccessToken } = require('../src/utils/token')
	const User = require('../src/model/user.model')

	process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'smoke-access-secret'
	process.env.JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET

	assert.strictEqual(hasPermission('superadmin', 'users:manage_roles'), true)
	assert.strictEqual(hasPermission('admin', 'users:manage_roles'), true)
	assert.strictEqual(hasPermission('teacher', 'users:read'), false)
	assert.strictEqual(hasPermission('admin', 'students:manage'), true)
	assert.strictEqual(hasPermission('teacher', 'students:manage'), false)
	assert.strictEqual(hasPermission('teacher', 'students:read'), true)
	assert.strictEqual(extractBearerToken(`Bearer abc.def.ghi`), 'abc.def.ghi')
	assert.strictEqual(extractBearerToken(`bearer abc.def.ghi`), 'abc.def.ghi')
	assert.strictEqual(extractBearerToken(`BEARER abc.def.ghi`), 'abc.def.ghi')
	assert.strictEqual(extractBearerToken(`Token abc.def.ghi`), null)

	const makeRes = () => ({
		statusCode: 200,
		body: null,
		status(code) {
			this.statusCode = code
			return this
		},
		json(payload) {
			this.body = payload
			return this
		},
	})

	const callMiddleware = async req => {
		const res = makeRes()
		let nextCalled = false
		await requireRegisterPermission(req, res, () => {
			nextCalled = true
		})
		return { nextCalled, res }
	}

	const superadminId = '507f1f77bcf86cd799439011'
	const adminId = '507f1f77bcf86cd799439013'
	const teacherId = '507f1f77bcf86cd799439012'
	const superadminToken = generateAccessToken({ _id: superadminId, role: 'superadmin' })
	const adminToken = generateAccessToken({ _id: adminId, role: 'admin' })
	const teacherToken = generateAccessToken({ _id: teacherId, role: 'teacher' })

	const originalFindById = User.findById
	User.findById = id => {
		return {
			select: async () => {
				if (id === superadminId) {
					return { _id: superadminId, role: 'superadmin' }
				}
				if (id === teacherId) {
					return { _id: teacherId, role: 'teacher' }
				}
				if (id === adminId) {
					return { _id: adminId, role: 'admin' }
				}
				return null
			},
		}
	}

	try {
		const noTokenCheck = await callMiddleware({
			body: { role: 'admin' },
			headers: {},
		})
		assert.strictEqual(noTokenCheck.nextCalled, false)
		assert.strictEqual(noTokenCheck.res.statusCode, 401)

		const tempUploadPath = path.join(process.cwd(), 'uploads', `smoke-${Date.now()}.tmp`)
		fs.mkdirSync(path.dirname(tempUploadPath), { recursive: true })
		fs.writeFileSync(tempUploadPath, 'temp-upload')

		const noTokenWithFileCheck = await callMiddleware({
			body: { role: 'admin' },
			headers: {},
			file: { path: tempUploadPath },
		})
		assert.strictEqual(noTokenWithFileCheck.nextCalled, false)
		assert.strictEqual(noTokenWithFileCheck.res.statusCode, 401)
		assert.strictEqual(fs.existsSync(tempUploadPath), false)

		const teacherTokenCheck = await callMiddleware({
			body: { role: 'admin' },
			headers: { authorization: `Bearer ${teacherToken}` },
		})
		assert.strictEqual(teacherTokenCheck.nextCalled, false)
		assert.strictEqual(teacherTokenCheck.res.statusCode, 403)

		const teacherSelfRegisterCheck = await callMiddleware({
			body: { role: 'teacher' },
			headers: { authorization: `Bearer ${teacherToken}` },
		})
		assert.strictEqual(teacherSelfRegisterCheck.nextCalled, false)
		assert.strictEqual(teacherSelfRegisterCheck.res.statusCode, 403)

		const adminHeadteacherCreateCheck = await callMiddleware({
			body: { role: 'headteacher' },
			headers: { authorization: `Bearer ${adminToken}` },
		})
		assert.strictEqual(adminHeadteacherCreateCheck.nextCalled, false)
		assert.strictEqual(adminHeadteacherCreateCheck.res.statusCode, 403)

		const adminCreatesAdminCheck = await callMiddleware({
			body: { role: 'admin' },
			headers: { authorization: `Bearer ${adminToken}` },
		})
		assert.strictEqual(adminCreatesAdminCheck.nextCalled, false)
		assert.strictEqual(adminCreatesAdminCheck.res.statusCode, 403)

		const superadminTokenCheck = await callMiddleware({
			body: { role: 'admin' },
			headers: { authorization: `Bearer ${superadminToken}` },
		})
		assert.strictEqual(superadminTokenCheck.nextCalled, true)
		assert.strictEqual(superadminTokenCheck.res.body, null)

		const superadminCreatesSuperadminCheck = await callMiddleware({
			body: { role: 'superadmin' },
			headers: { authorization: `Bearer ${superadminToken}` },
		})
		assert.strictEqual(superadminCreatesSuperadminCheck.nextCalled, false)
		assert.strictEqual(superadminCreatesSuperadminCheck.res.statusCode, 403)

		const superadminLowercaseBearerCheck = await callMiddleware({
			body: { role: 'admin' },
			headers: { authorization: `bearer ${superadminToken}` },
		})
		assert.strictEqual(superadminLowercaseBearerCheck.nextCalled, true)
		assert.strictEqual(superadminLowercaseBearerCheck.res.body, null)
	} finally {
		User.findById = originalFindById
	}

	const app = require('../app')
	const server = app.listen(0)
	const port = server.address().port

	try {
		const health = await makeRequest(port, '/health')
		assert.strictEqual(health.statusCode, 200)
		assert.strictEqual(health.body, '{"status":"ok"}')

		const docsJson = await makeRequest(port, '/api-docs-json')
		assert.strictEqual(docsJson.statusCode, 200)
		assert.ok(docsJson.body.includes('"openapi":"3.0.3"'))

		const notFound = await makeRequest(port, '/missing-route')
		assert.strictEqual(notFound.statusCode, 404)
		assert.strictEqual(notFound.body, '{"message":"Route not found"}')
	} finally {
		server.close()
	}

	console.log('Smoke tests passed')
}

run().catch(error => {
	console.error(error)
	process.exit(1)
})
