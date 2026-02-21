const swaggerJsdoc = require('swagger-jsdoc')

const port = Number(process.env.PORT) || 3000

const options = {
	definition: {
		openapi: '3.0.3',
		info: {
			title: 'BackZuhr CRM API',
			version: '1.0.0',
			description: 'Authentication and student management API',
		},
		servers: [
			{
				url: `http://localhost:${port}`,
				description: 'Local development',
			},
		],
		tags: [
			{ name: 'Auth', description: 'Authentication and user role management' },
			{ name: 'Students', description: 'Student CRUD and listing' },
			{ name: 'System', description: 'System endpoints' },
		],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
				},
			},
			schemas: {
				ErrorResponse: {
					type: 'object',
					properties: {
						message: {
							type: 'string',
							example: 'Internal server error',
						},
					},
				},
				User: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6a095' },
						fullname: { type: 'string', example: 'John Doe' },
						phone: { type: 'string', example: '+998901112233' },
						email: { type: 'string', format: 'email', example: 'john@example.com' },
						dateOfBirth: { type: 'string', format: 'date-time' },
						gender: { type: 'string', enum: ['male', 'female'] },
						role: {
							type: 'string',
							enum: ['teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'],
						},
						company: { type: 'string', example: 'OpenAI' },
						imgURL: { type: 'string', example: '/uploads/avatar.png' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				StudentGroupInput: {
					type: 'object',
					required: ['group'],
					properties: {
						group: { type: 'string', example: '65f12ca7a7720c194de6a011' },
						status: {
							type: 'string',
							enum: ['active', 'paused', 'completed', 'left'],
							example: 'active',
						},
						joinedAt: { type: 'string', format: 'date-time' },
						note: { type: 'string', example: 'Placed after trial lesson' },
					},
				},
				Student: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6a010' },
						fullname: { type: 'string', example: 'Student One' },
						studentPhone: { type: 'string', example: '+998901234567' },
						parentPhone: { type: 'string', example: '+998909876543' },
						groupAttached: { type: 'boolean', example: true },
						gender: { type: 'string', enum: ['male', 'female'] },
						birthDate: { type: 'string', format: 'date-time' },
						note: { type: 'string', example: 'Needs extra speaking practice' },
						balance: { type: 'number', example: 150000 },
						coinBalance: { type: 'number', example: 250 },
						groups: {
							type: 'array',
							items: { $ref: '#/components/schemas/StudentGroupInput' },
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
			},
		},
	},
	apis: ['src/routes/*.js', 'app.js'],
}

const swaggerSpec = swaggerJsdoc(options)

module.exports = swaggerSpec
