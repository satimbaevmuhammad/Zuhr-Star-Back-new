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

app.use(cors(corsOptions))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
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

app.use((req, res) => {
	res.status(404).json({ message: 'Route not found' })
})

app.use((error, req, res, next) => {
	const statusCode = error.statusCode || 500
	const message =
		statusCode === 500 ? 'Internal server error' : error.message || 'Request failed'

	if (statusCode >= 500) {
		console.error('Unhandled error:', error)
	}

	res.status(statusCode).json({ message })
})

module.exports = app
