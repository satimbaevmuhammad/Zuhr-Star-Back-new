const swaggerJsdoc = require('swagger-jsdoc')

const port = Number(process.env.PORT) || 3000

const options = {
	definition: {
		openapi: '3.0.3',
		info: {
			title: 'BackZuhr API',
			version: '1.0.0',
			description: 'Authentication and student management API',
		},
		servers: [
			{
				url: `http://localhost:${port}`,
				description: 'Local development',
			},
			{
				url: `https://zuhr-star-back-new-production.up.railway.app`,
				description: 'Production server',
			},
		],
		tags: [
			{ name: 'Auth', description: 'Authentication and user role management' },
			{ name: 'Students', description: 'Student CRUD and listing' },
			{ name: 'Groups', description: 'Group CRUD, membership, and attendance' },
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
						email: {
							type: 'string',
							format: 'email',
							example: 'john@example.com',
						},
						dateOfBirth: { type: 'string', format: 'date-time' },
						gender: { type: 'string', enum: ['male', 'female'] },
						role: {
							type: 'string',
							enum: [
								'teacher',
								'supporteacher',
								'headteacher',
								'admin',
								'superadmin',
							],
						},
						company: { type: 'string', example: 'OpenAI' },
						imgURL: { type: 'string', example: '/uploads/avatar.png' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				GroupScheduleInput: {
					type: 'object',
					required: ['dayOfWeek', 'startTime', 'durationMinutes'],
					properties: {
						dayOfWeek: {
							type: 'string',
							enum: [
								'monday',
								'tuesday',
								'wednesday',
								'thursday',
								'friday',
								'saturday',
								'sunday',
							],
						},
						startTime: { type: 'string', example: '09:30' },
						durationMinutes: {
							type: 'number',
							example: 90,
							minimum: 30,
							maximum: 300,
						},
					},
				},
				GroupMembershipInput: {
					type: 'object',
					properties: {
						status: {
							type: 'string',
							enum: ['active', 'paused', 'completed', 'left'],
							example: 'active',
						},
						joinedAt: { type: 'string', format: 'date-time' },
						note: { type: 'string', example: 'Joined after trial' },
					},
				},
				GroupAttendanceRecordInput: {
					type: 'object',
					required: ['student'],
					properties: {
						student: { type: 'string', example: '65f12ca7a7720c194de6a010' },
						status: {
							type: 'string',
							enum: ['present', 'absent', 'late', 'excused'],
							example: 'present',
						},
						note: { type: 'string', example: 'Arrived 10 minutes late' },
					},
				},
				GroupCreateInput: {
					type: 'object',
					required: ['name', 'course', 'teacher', 'startDate', 'schedule'],
					properties: {
						name: { type: 'string', example: 'IELTS A1 - Morning' },
						course: { type: 'string', example: 'IELTS Foundation' },
						level: { type: 'string', example: 'A1' },
						teacher: { type: 'string', example: '65f12ca7a7720c194de6a095' },
						supportTeachers: {
							type: 'array',
							items: { type: 'string' },
						},
						maxStudents: {
							type: 'number',
							minimum: 1,
							maximum: 100,
							example: 15,
						},
						status: {
							type: 'string',
							enum: ['planned', 'active', 'paused', 'completed', 'archived'],
							example: 'planned',
						},
						startDate: { type: 'string', format: 'date-time' },
						endDate: { type: 'string', format: 'date-time', nullable: true },
						schedule: {
							type: 'array',
							items: { $ref: '#/components/schemas/GroupScheduleInput' },
						},
						room: { type: 'string', example: 'Room 204' },
						monthlyFee: { type: 'number', minimum: 0, example: 800000 },
						note: { type: 'string', example: 'Priority speaking group' },
					},
				},
				GroupUpdateInput: {
					type: 'object',
					properties: {
						name: { type: 'string' },
						course: { type: 'string' },
						level: { type: 'string' },
						teacher: { type: 'string' },
						supportTeachers: {
							type: 'array',
							items: { type: 'string' },
						},
						maxStudents: { type: 'number', minimum: 1, maximum: 100 },
						status: {
							type: 'string',
							enum: ['planned', 'active', 'paused', 'completed', 'archived'],
						},
						startDate: { type: 'string', format: 'date-time' },
						endDate: { type: 'string', format: 'date-time', nullable: true },
						schedule: {
							type: 'array',
							items: { $ref: '#/components/schemas/GroupScheduleInput' },
						},
						room: { type: 'string' },
						monthlyFee: { type: 'number', minimum: 0 },
						note: { type: 'string' },
					},
				},
				Group: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6a011' },
						name: { type: 'string', example: 'IELTS A1 - Morning' },
						course: { type: 'string', example: 'IELTS Foundation' },
						level: { type: 'string', example: 'A1' },
						teacher: {
							oneOf: [
								{ type: 'string' },
								{ $ref: '#/components/schemas/User' },
							],
						},
						supportTeachers: {
							type: 'array',
							items: {
								oneOf: [
									{ type: 'string' },
									{ $ref: '#/components/schemas/User' },
								],
							},
						},
						students: {
							type: 'array',
							items: {
								oneOf: [
									{ type: 'string' },
									{ $ref: '#/components/schemas/Student' },
								],
							},
						},
						maxStudents: { type: 'number', example: 15 },
						studentsCount: { type: 'number', example: 8 },
						status: {
							type: 'string',
							enum: ['planned', 'active', 'paused', 'completed', 'archived'],
						},
						startDate: { type: 'string', format: 'date-time' },
						endDate: { type: 'string', format: 'date-time', nullable: true },
						schedule: {
							type: 'array',
							items: { $ref: '#/components/schemas/GroupScheduleInput' },
						},
						room: { type: 'string', example: 'Room 204' },
						monthlyFee: { type: 'number', example: 800000 },
						coinBalance: { type: 'number', example: 1600 },
						note: { type: 'string', example: 'Priority speaking group' },
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
				StudentCoinRewardInput: {
					type: 'object',
					required: ['amount'],
					properties: {
						amount: { type: 'integer', minimum: 1, example: 100 },
						note: { type: 'string', example: 'Great homework performance' },
					},
				},
			},
		},
	},
	apis: ['src/routes/*.js', 'app.js'],
}

const swaggerSpec = swaggerJsdoc(options)

module.exports = swaggerSpec
