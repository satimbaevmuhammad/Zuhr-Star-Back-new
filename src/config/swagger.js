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
			{ name: 'Courses', description: 'Course CRUD and methodology management' },
			{ name: 'Lessons', description: 'Lessons linked to specific courses' },
			{ name: 'Homework', description: 'Homework assignments and submissions' },
			{ name: 'Finance', description: 'Employee finance — bonuses and fines' },
			{ name: 'Forbidden', description: 'Forbidden behavior rules and employee violations' },
			{ name: 'ExtraLessons', description: 'Extra lessons managed by up to 3 global support teachers' },
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
						faceIdEnabled: { type: 'boolean', example: false },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				Lesson: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6b001' },
						course: { type: 'string', example: '65f12ca7a7720c194de6a201' },
						title: { type: 'string', example: 'Lesson 1: Numbers and Counting' },
						order: { type: 'integer', minimum: 1, example: 1 },
						durationMinutes: { type: 'integer', minimum: 1, example: 90 },
						description: { type: 'string', example: 'Introduction to numbers and operations' },
						homework: { type: 'string', example: 'Solve exercises 1-10 on page 12' },
						homeworkLinks: {
							type: 'array',
							items: { type: 'string' },
							example: ['https://example.com/worksheet-1'],
						},
						homeworkDocuments: {
							type: 'array',
							items: { $ref: '#/components/schemas/LessonDocument' },
						},
						documents: {
							type: 'array',
							items: { $ref: '#/components/schemas/LessonDocument' },
						},
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				LessonDocument: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6b0f1' },
						originalName: { type: 'string', example: 'Algebra-Lesson-1.pdf' },
						filename: { type: 'string', example: '1772600000000-a1b2c3d4.pdf' },
						url: { type: 'string', example: '/uploads/1772600000000-a1b2c3d4.pdf' },
						mimeType: { type: 'string', example: 'application/pdf' },
						size: { type: 'integer', example: 245760 },
						uploadedBy: {
							oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/User' }],
						},
						uploadedAt: { type: 'string', format: 'date-time' },
					},
				},
				LessonCreateInput: {
					type: 'object',
					required: ['title'],
					properties: {
						title: { type: 'string', example: 'Lesson 1: Algebra Basics' },
						durationMinutes: { type: 'integer', minimum: 1, example: 90 },
						description: { type: 'string', example: 'Variables and simple equations' },
						homework: {
							oneOf: [
								{
									type: 'string',
									example: 'Practice equations 1-5 in the workbook',
								},
								{
									type: 'object',
									properties: {
										description: {
											type: 'string',
											example: 'Practice equations 1-5 in the workbook',
										},
										links: {
											type: 'array',
											items: { type: 'string' },
											example: ['https://example.com/homework-1'],
										},
									},
								},
							],
						},
						homeworkLinks: {
							type: 'array',
							items: { type: 'string' },
							example: ['https://example.com/homework-1'],
						},
					},
				},
				LessonUpdateInput: {
					type: 'object',
					properties: {
						title: { type: 'string', example: 'Lesson 1: Algebra Basics' },
						durationMinutes: { type: 'integer', minimum: 1, example: 100 },
						description: { type: 'string', example: 'Updated lesson description' },
						homework: {
							oneOf: [
								{
									type: 'string',
									example: 'Review formulas on page 3',
								},
								{
									type: 'object',
									properties: {
										description: {
											type: 'string',
											example: 'Review formulas on page 3',
										},
										links: {
											type: 'array',
											items: { type: 'string' },
											example: ['https://example.com/homework-1'],
										},
									},
								},
							],
						},
						homeworkLinks: {
							type: 'array',
							items: { type: 'string' },
							example: ['https://example.com/homework-1'],
						},
					},
				},
				HomeworkAssignment: {
					type: 'object',
					properties: {
						description: {
							type: 'string',
							example: 'Solve exercises 1-10 on page 12',
						},
						links: {
							type: 'array',
							items: { type: 'string' },
							example: ['https://example.com/worksheet-1'],
						},
						documents: {
							type: 'array',
							items: { $ref: '#/components/schemas/LessonDocument' },
						},
					},
				},
				HomeworkSubmission: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6d101' },
						lesson: {
							oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Lesson' }],
						},
						student: {
							oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Student' }],
						},
						group: {
							oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/Group' }],
						},
						description: { type: 'string', example: 'My homework notes' },
						links: {
							type: 'array',
							items: { type: 'string' },
							example: ['https://example.com/solution'],
						},
						documents: {
							type: 'array',
							items: { $ref: '#/components/schemas/LessonDocument' },
						},
						status: {
							type: 'string',
							enum: ['submitted', 'approved'],
						},
						score: { type: 'number', example: 85 },
						attemptsCount: { type: 'integer', example: 1 },
						submittedAt: { type: 'string', format: 'date-time' },
						checkedBy: {
							oneOf: [{ type: 'string' }, { $ref: '#/components/schemas/User' }],
						},
						checkedAt: { type: 'string', format: 'date-time' },
						createdAt: { type: 'string', format: 'date-time' },
						updatedAt: { type: 'string', format: 'date-time' },
					},
				},
				CourseCreateInput: {
					type: 'object',
					required: ['name', 'durationMonths', 'price'],
					properties: {
						name: { type: 'string', example: 'Mathematics' },
						durationMonths: { type: 'integer', minimum: 1, maximum: 120, example: 6 },
						price: { type: 'number', minimum: 0, example: 1200000 },
						note: { type: 'string', example: 'Core mathematics program for beginners' },
					},
				},
				CourseUpdateInput: {
					type: 'object',
					properties: {
						name: { type: 'string', example: 'Advanced Mathematics' },
						durationMonths: { type: 'integer', minimum: 1, maximum: 120, example: 8 },
						price: { type: 'number', minimum: 0, example: 1500000 },
						note: { type: 'string', example: 'Updated program details' },
					},
				},
				Course: {
					type: 'object',
					properties: {
						_id: { type: 'string', example: '65f12ca7a7720c194de6a201' },
						name: { type: 'string', example: 'English' },
						durationMonths: { type: 'integer', example: 6 },
						maxLessons: {
							type: 'integer',
							example: 72,
							description: 'Computed automatically as durationMonths * 12',
						},
						price: { type: 'number', example: 900000 },
						groupsCount: { type: 'integer', example: 3 },
						methodology: {
							type: 'array',
							items: {
								oneOf: [
									{ type: 'string' },
									{ $ref: '#/components/schemas/Lesson' },
								],
							},
						},
						note: { type: 'string', example: 'English foundation course' },
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
					required: ['name', 'groupType', 'teacher', 'startDate', 'schedule'],
					properties: {
						name: { type: 'string', example: 'IELTS A1 - Morning' },
						course: { type: 'string', example: 'IELTS Foundation' },
						courseId: {
							type: 'string',
							example: '65f12ca7a7720c194de6a201',
							description: 'Optional. If passed, group course name and lessons are auto-linked from course',
						},
						groupType: {
							type: 'string',
							enum: ['odd', 'even'],
							example: 'odd',
							description:
								'odd => monday/wednesday/friday, even => tuesday/thursday/saturday',
						},
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
						courseId: { type: 'string' },
						groupType: { type: 'string', enum: ['odd', 'even'] },
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
						groupType: { type: 'string', enum: ['odd', 'even'], example: 'odd' },
						courseRef: {
							oneOf: [
								{ type: 'string' },
								{ $ref: '#/components/schemas/Course' },
							],
						},
						lessons: {
							type: 'array',
							items: {
								oneOf: [
									{ type: 'string' },
									{ $ref: '#/components/schemas/Lesson' },
								],
							},
						},
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
						homeworks: {
							type: 'array',
							items: {
								oneOf: [
									{ type: 'string' },
									{ $ref: '#/components/schemas/HomeworkSubmission' },
								],
							},
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
