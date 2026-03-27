const cors = require('cors')
const express = require('express')
const path = require('path')
const swaggerUi = require('swagger-ui-express')

const authRoutes = require('./src/routes/auth.routes')
const studentRoutes = require('./src/routes/student.routes')
const groupRoutes = require('./src/routes/group.routes')
const courseRoutes = require('./src/routes/course.routes')
const homeworkRoutes = require('./src/routes/homework.routes')
const financeRoutes = require('./src/routes/finance.routes')
const forbiddenRoutes = require('./src/routes/forbidden.routes')
const extraLessonRoutes = require('./src/routes/extra-lesson.routes')
const leadRoutes = require('./src/routes/lead.routes')
const swaggerSpec = require('./src/config/swagger')
const AppError = require('./src/utils/AppError')
const errorHandler = require('./src/middleware/errorHandler')

const app = express()

const normalizeOrigin = value => String(value || '')
	.trim()
	.replace(/\/+$/, '')

const corsOriginEnv = String(
	process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '',
).trim()
const configuredCorsOrigins = corsOriginEnv
	.split(',')
	.map(normalizeOrigin)
	.filter(Boolean)
const allowAllCorsOrigins = configuredCorsOrigins.length === 0 || configuredCorsOrigins.includes('*')

const corsOptions = {
	origin(origin, callback) {
		if (!origin) {
			return callback(null, true)
		}

		if (allowAllCorsOrigins) {
			return callback(null, origin)
		}

		const normalizedOrigin = normalizeOrigin(origin)
		const isAllowed = configuredCorsOrigins.includes(normalizedOrigin)
		return callback(null, isAllowed ? origin : false)
	},
	credentials: true,
	methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Authorization', 'Content-Type'],
	exposedHeaders: ['Content-Disposition'],
}

const STATUS_DEFAULT_CODES = {
	400: 'BAD_REQUEST',
	401: 'UNAUTHORIZED',
	403: 'FORBIDDEN',
	404: 'NOT_FOUND',
	405: 'METHOD_NOT_ALLOWED',
	409: 'CONFLICT',
	422: 'UNPROCESSABLE_ENTITY',
	500: 'INTERNAL_SERVER_ERROR',
}

app.use(cors(corsOptions))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use((req, res, next) => {
	const originalJson = res.json.bind(res)
	res.json = payload => {
		if (res.statusCode >= 400) {
			const isObjectPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
			const basePayload = isObjectPayload ? payload : {}
			const normalizedPayload = {
				...basePayload,
				message: String(basePayload.message || 'Request failed'),
				code: String(
					basePayload.code ||
						STATUS_DEFAULT_CODES[res.statusCode] ||
						STATUS_DEFAULT_CODES[500],
				),
				field:
					Object.prototype.hasOwnProperty.call(basePayload, 'field') &&
					typeof basePayload.field !== 'undefined'
						? basePayload.field
						: null,
			}
			return originalJson(normalizedPayload)
		}

		return originalJson(payload)
	}

	return next()
})
app.use(
	'/uploads',
	cors(corsOptions),
	(req, res, next) => {
		res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
		next()
	},
	express.static(path.join(process.cwd(), 'uploads')),
)
app.use('/public', express.static(path.join(process.cwd(), 'public')))

app.get('/face-id-demo', (req, res) => {
	res.sendFile(path.join(process.cwd(), 'public', 'face-id-demo.html'))
})

app.get('/health', (req, res) => {
	res.status(200).json({ status: 'ok' })
})

app.get('/api-docs-json', (req, res) => {
	res.status(200).json(swaggerSpec)
})

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }))

app.use('/api/auth', authRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/courses', courseRoutes)
app.use('/api/homework', homeworkRoutes)
app.use('/api/finance', financeRoutes)
app.use('/api/forbidden', forbiddenRoutes)
app.use('/api/extra-lessons', extraLessonRoutes)
app.use('/api/leads', leadRoutes)

app.use((req, res, next) => {
	next(new AppError('Route not found', 'ROUTE_NOT_FOUND', 404))
})

app.use(errorHandler)

module.exports = app
