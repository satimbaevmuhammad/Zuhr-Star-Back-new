const cors = require('cors')
const express = require('express')
const path = require('path')
const swaggerUi = require('swagger-ui-express')

const authRoutes = require('./src/routes/auth.routes')
const studentRoutes = require('./src/routes/student.routes')
const swaggerSpec = require('./src/config/swagger')

const app = express()

app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.get('/health', (req, res) => {
	res.status(200).json({ status: 'ok' })
})

app.get('/api-docs-json', (req, res) => {
	res.status(200).json(swaggerSpec)
})

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }))

app.use('/api/auth', authRoutes)
app.use('/api/students', studentRoutes)

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
