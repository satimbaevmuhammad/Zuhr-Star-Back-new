const assert = require('assert')
const mongoose = require('mongoose')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'senior-suite-secret'
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
process.env.STRICT_REFRESH_TOKEN_MATCH = 'false'

const {
	generateAccessToken,
	generateRefreshToken,
	verifyAccessToken,
	verifyRefreshToken,
} = require('../src/utils/token')
const authMiddleware = require('../src/middleware/auth.middleware')
const authController = require('../src/controllers/auth.controller')
const studentController = require('../src/controllers/student.controller')
const groupController = require('../src/controllers/group.controller')
const courseController = require('../src/controllers/course.controller')
const {
	resetStudentBalancesIfNeeded,
} = require('../src/services/student-balance-reset.service')
const {
	getGroupsCountByCourseIds,
	syncCourseGroupsCount,
} = require('../src/services/course-sync.service')

const User = require('../src/model/user.model')
const Student = require('../src/model/student.model')
const Group = require('../src/model/group.model')
const Course = require('../src/model/course.model')
const Lesson = require('../src/model/lesson.model')

const DAYS_OF_WEEK = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
]

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

const callHandler = async (handler, req = {}) => {
	const response = makeRes()
	await handler(req, response)
	return response
}

const makeQuery = value => {
	const query = {
		sort() {
			return query
		},
		skip() {
			return query
		},
		limit() {
			return query
		},
		populate() {
			return query
		},
		select() {
			return query
		},
		lean() {
			return query
		},
		exec() {
			return Promise.resolve(value)
		},
		then(resolve, reject) {
			return Promise.resolve(value).then(resolve, reject)
		},
		catch(reject) {
			return Promise.resolve(value).catch(reject)
		},
	}

	return query
}

const patchMethod = (obj, key, replacement) => {
	const original = obj[key]
	obj[key] = replacement
	return () => {
		obj[key] = original
	}
}

const withPatchedMethods = async (patches, callback) => {
	const restores = patches.map(([obj, key, replacement]) =>
		patchMethod(obj, key, replacement),
	)

	try {
		return await callback()
	} finally {
		for (const restore of restores.reverse()) {
			restore()
		}
	}
}

const runMiddleware = async (middleware, req) => {
	const res = makeRes()
	let nextCalled = false
	await middleware(req, res, () => {
		nextCalled = true
	})

	return { res, nextCalled }
}

const runTests = async () => {
	let passed = 0
	let failed = 0

	const test = async (name, callback) => {
		try {
			await callback()
			passed += 1
			console.log(`PASS ${name}`)
		} catch (error) {
			failed += 1
			console.error(`FAIL ${name}`)
			console.error(error)
		}
	}

	const restoreGlobalUpdateMany = patchMethod(Student, 'updateMany', async () => ({
		matchedCount: 0,
		modifiedCount: 0,
	}))

	try {
		await test('token utils generate and verify access/refresh tokens', async () => {
			const user = { _id: '507f1f77bcf86cd799439011', role: 'admin' }
			const accessToken = generateAccessToken(user)
			const refreshToken = generateRefreshToken(user)
			const accessPayload = verifyAccessToken(accessToken)
			const refreshPayload = verifyRefreshToken(refreshToken)

			assert.strictEqual(accessPayload.id, user._id)
			assert.strictEqual(accessPayload.role, user.role)
			assert.strictEqual(refreshPayload.id, user._id)
		})

		await test('permission middleware enforces all required permissions', async () => {
			const canReadBoth = authMiddleware.allowPermissions('groups:read', 'students:read')
			const ok = await runMiddleware(canReadBoth, { user: { role: 'teacher' } })
			assert.strictEqual(ok.nextCalled, true)

			const mustManage = authMiddleware.allowPermissions('students:manage')
			const denied = await runMiddleware(mustManage, { user: { role: 'teacher' } })
			assert.strictEqual(denied.nextCalled, false)
			assert.strictEqual(denied.res.statusCode, 403)
		})

		await test('refresh token rejects mismatch when strict mode enabled', async () => {
			const userId = '507f1f77bcf86cd799439012'
			const incomingRefresh = generateRefreshToken({ _id: userId, role: 'teacher' })
			process.env.STRICT_REFRESH_TOKEN_MATCH = 'true'

			await withPatchedMethods(
				[
					[
						User,
						'findById',
						() => ({
							select: async () => ({
								_id: userId,
								role: 'teacher',
								refreshToken: 'some-other-token',
								save: async () => {},
							}),
						}),
					],
				],
				async () => {
					const res = await callHandler(authController.refreshToken, {
						body: { refreshToken: `Bearer ${incomingRefresh}` },
					})

					assert.strictEqual(res.statusCode, 401)
					assert.strictEqual(res.body.message, 'Refresh token mismatch')
				},
			)
		})

		await test('refresh token accepts bearer prefix and rotates tokens', async () => {
			const userId = '507f1f77bcf86cd799439013'
			const incomingRefresh = generateRefreshToken({ _id: userId, role: 'teacher' })
			process.env.STRICT_REFRESH_TOKEN_MATCH = 'false'

			await withPatchedMethods(
				[
					[
						User,
						'findById',
						() => ({
							select: async () => ({
								_id: userId,
								role: 'teacher',
								refreshToken: incomingRefresh,
								save: async () => {},
							}),
						}),
					],
				],
				async () => {
					const res = await callHandler(authController.refreshToken, {
						body: { refreshToken: `Bearer ${incomingRefresh}` },
					})

					assert.strictEqual(res.statusCode, 200)
					assert.ok(typeof res.body.accessToken === 'string')
					assert.ok(typeof res.body.refreshToken === 'string')
					assert.notStrictEqual(res.body.refreshToken, incomingRefresh)
				},
			)
		})

		await test('registerFaceId stores descriptor for current user', async () => {
			const userId = '507f1f77bcf86cd799439014'
			const descriptor = Array.from({ length: 128 }, (_, index) => Number((index / 1000).toFixed(6)))
			const userDoc = {
				_id: userId,
				role: 'teacher',
				imgURL: '/uploads/default-avatar.png',
				faceDescriptor: undefined,
				faceIdEnabled: false,
				save: async () => {},
				toObject() {
					return {
						_id: this._id,
						role: this.role,
						imgURL: this.imgURL,
						faceDescriptor: this.faceDescriptor,
						faceIdEnabled: this.faceIdEnabled,
					}
				},
			}

			await withPatchedMethods(
				[
					[
						User,
						'findById',
						() => ({
							select: async () => userDoc,
						}),
					],
				],
				async () => {
					const res = await callHandler(authController.registerFaceId, {
						user: { _id: userId, role: 'teacher' },
						body: { descriptor },
					})

					assert.strictEqual(res.statusCode, 200)
					assert.strictEqual(userDoc.faceIdEnabled, true)
					assert.strictEqual(userDoc.faceDescriptor.length, 128)
				},
			)
		})

		await test('loginWithFaceId returns tokens when best match is within threshold', async () => {
			const userId = '507f1f77bcf86cd799439015'
			const baseDescriptor = Array.from({ length: 128 }, (_, index) =>
				Number((0.05 + index / 5000).toFixed(6)),
			)
			const loginDescriptor = baseDescriptor.map((value, index) =>
				Number((value + (index % 2 === 0 ? 0.001 : -0.001)).toFixed(6)),
			)
			const userDoc = {
				_id: userId,
				role: 'teacher',
				imgURL: '/uploads/default-avatar.png',
				faceDescriptor: baseDescriptor,
				faceIdEnabled: true,
				refreshToken: null,
				save: async () => {},
				toObject() {
					return {
						_id: this._id,
						role: this.role,
						imgURL: this.imgURL,
						faceIdEnabled: this.faceIdEnabled,
					}
				},
			}

			await withPatchedMethods(
				[[User, 'find', () => makeQuery([userDoc])]],
				async () => {
					const res = await callHandler(authController.loginWithFaceId, {
						body: { descriptor: loginDescriptor, threshold: 0.3 },
						headers: { host: 'localhost:3000' },
						protocol: 'http',
						get(headerName) {
							return this.headers[String(headerName || '').toLowerCase()]
						},
					})

					assert.strictEqual(res.statusCode, 200)
					assert.ok(typeof res.body.accessToken === 'string')
					assert.ok(typeof res.body.refreshToken === 'string')
					assert.strictEqual(res.body.user.faceIdEnabled, true)
				},
			)
		})

		await test('createStudent rejects invalid groups payload shape', async () => {
			const res = await callHandler(studentController.createStudent, {
				body: {
					fullname: 'Student One',
					studentPhone: '+998901234567',
					parentPhone: '+998909876543',
					gender: 'male',
					birthDate: '2012-02-20',
					password: 'strongpass',
					groups: { id: '507f1f77bcf86cd799439111' },
				},
			})

			assert.strictEqual(res.statusCode, 400)
			assert.strictEqual(res.body.message, 'groups must be an array of group ObjectId strings')
		})

		await test('createStudent 500 responses do not leak internal stack', async () => {
			await withPatchedMethods(
				[
					[console, 'error', () => {}],
					[Student, 'findOne', async () => null],
					[Student, 'create', async () => {
						throw new Error('boom')
					}],
				],
				async () => {
					const res = await callHandler(studentController.createStudent, {
						body: {
							fullname: 'Student Two',
							studentPhone: '+998901234568',
							parentPhone: '+998909876544',
							gender: 'male',
							birthDate: '2013-03-21',
							password: 'strongpass',
						},
					})

					assert.strictEqual(res.statusCode, 500)
					assert.deepStrictEqual(res.body, { message: 'Internal server error' })
				},
			)
		})

		await test('rewardStudentCoins increments student balance', async () => {
			const studentDoc = {
				_id: '507f1f77bcf86cd799439021',
				coinBalance: 40,
				save: async () => {},
			}

			await withPatchedMethods(
				[[Student, 'findById', async () => studentDoc]],
				async () => {
					const res = await callHandler(studentController.rewardStudentCoins, {
						params: { studentId: studentDoc._id },
						body: { amount: 60, note: 'Great class performance' },
					})

					assert.strictEqual(res.statusCode, 200)
					assert.strictEqual(res.body.rewardedCoins, 60)
					assert.strictEqual(studentDoc.coinBalance, 100)
				},
			)
		})

		await test('bulk attendance rejects non-today date', async () => {
			const groupId = '507f1f77bcf86cd799439031'
			const teacherId = '507f1f77bcf86cd799439032'
			const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)

			await withPatchedMethods(
				[
					[
						Group,
						'findById',
						async () => ({
							_id: groupId,
							teacher: teacherId,
							supportTeachers: [],
							schedule: [
								{ dayOfWeek: 'monday', startTime: '09:00', durationMinutes: 90 },
							],
							attendance: [],
						}),
					],
				],
				async () => {
					const res = await callHandler(groupController.upsertGroupAttendance, {
						params: { groupId },
						user: { _id: teacherId, role: 'teacher' },
						body: {
							date: yesterday.toISOString(),
							records: [
								{
									student: '507f1f77bcf86cd799439033',
									status: 'present',
								},
							],
						},
					})

					assert.strictEqual(res.statusCode, 400)
					assert.strictEqual(res.body.message, 'Attendance date must be today')
				},
			)
		})

		await test('single-student attendance rejects outside lesson window', async () => {
			const groupId = '507f1f77bcf86cd799439041'
			const studentId = '507f1f77bcf86cd799439042'
			const teacherId = '507f1f77bcf86cd799439043'
			const now = new Date()
			const currentDay = DAYS_OF_WEEK[now.getDay()]
			const differentDay = DAYS_OF_WEEK[(now.getDay() + 1) % DAYS_OF_WEEK.length]
			const scheduleDay = differentDay === currentDay ? 'monday' : differentDay

			await withPatchedMethods(
				[
					[
						Group,
						'findById',
						async () => ({
							_id: groupId,
							teacher: teacherId,
							supportTeachers: [],
							schedule: [
								{ dayOfWeek: scheduleDay, startTime: '10:00', durationMinutes: 90 },
							],
							attendance: [],
						}),
					],
				],
				async () => {
					const res = await callHandler(groupController.markGroupAttendanceStudent, {
						params: { groupId, studentId },
						user: { _id: teacherId, role: 'teacher' },
						body: {
							date: now.toISOString(),
							status: 'present',
						},
					})

					assert.strictEqual(res.statusCode, 403)
					assert.strictEqual(
						res.body.message,
						'Attendance can only be updated during scheduled lesson time',
					)
				},
			)
		})

		await test('createGroup with courseId auto-links lessons from course methodology', async () => {
			const groupId = '507f1f77bcf86cd799439051'
			const courseId = '507f1f77bcf86cd799439052'
			const teacherId = '507f1f77bcf86cd799439053'
			const lessonOne = new mongoose.Types.ObjectId('507f1f77bcf86cd799439054')
			const lessonTwo = new mongoose.Types.ObjectId('507f1f77bcf86cd799439055')
			let capturedGroupPayload = null

			await withPatchedMethods(
				[
					[
						Course,
						'findById',
						() => ({
							select: async () => ({
								_id: courseId,
								name: 'Mathematics',
								methodology: [lessonOne, lessonTwo],
							}),
						}),
					],
					[
						User,
						'find',
						() => ({
							select: async () => [{ _id: teacherId }],
						}),
					],
					[
						Group,
						'create',
						async payload => {
							capturedGroupPayload = payload
							return { _id: groupId, courseRef: courseId }
						},
					],
					[Group, 'aggregate', async () => [{ _id: new mongoose.Types.ObjectId(courseId), groupsCount: 1 }]],
					[Course, 'bulkWrite', async () => ({ ok: 1 })],
					[
						Group,
						'findById',
						() =>
							makeQuery({
								_id: groupId,
								name: 'Math Group A',
								course: 'Mathematics',
								courseRef: courseId,
								lessons: [lessonOne, lessonTwo],
								toObject() {
									return {
										_id: this._id,
										name: this.name,
										course: this.course,
										courseRef: this.courseRef,
										lessons: this.lessons,
									}
								},
							}),
					],
				],
				async () => {
					const res = await callHandler(groupController.createGroup, {
						body: {
							name: 'Math Group A',
							courseId,
							groupType: 'odd',
							teacher: teacherId,
							startDate: '2026-03-03',
							schedule: [
								{ dayOfWeek: 'monday', startTime: '09:00', durationMinutes: 90 },
								{ dayOfWeek: 'wednesday', startTime: '09:00', durationMinutes: 90 },
								{ dayOfWeek: 'friday', startTime: '09:00', durationMinutes: 90 },
							],
						},
					})

					assert.strictEqual(res.statusCode, 201)
					assert.ok(capturedGroupPayload)
					assert.strictEqual(capturedGroupPayload.course, 'Mathematics')
					assert.strictEqual(String(capturedGroupPayload.courseRef), courseId)
					assert.strictEqual(capturedGroupPayload.groupType, 'odd')
					assert.strictEqual(capturedGroupPayload.lessons.length, 2)
				},
			)
		})

		await test('updateCourse propagates renamed course title to linked groups', async () => {
			const courseId = '507f1f77bcf86cd799439061'
			let groupUpdateCall = null
			const courseDoc = {
				_id: courseId,
				name: 'Old Name',
				durationMonths: 6,
				price: 1000000,
				note: '',
				methodology: [],
				save: async () => {},
				toObject() {
					return {
						_id: this._id,
						name: this.name,
						durationMonths: this.durationMonths,
						price: this.price,
						note: this.note,
						methodology: this.methodology,
						groupsCount: 0,
					}
				},
			}

			await withPatchedMethods(
				[
					[Course, 'findById', () => makeQuery(courseDoc)],
					[
						Group,
						'updateMany',
						async (filter, update) => {
							groupUpdateCall = { filter, update }
							return { matchedCount: 2, modifiedCount: 2 }
						},
					],
					[Group, 'aggregate', async () => []],
				],
				async () => {
					const res = await callHandler(courseController.updateCourse, {
						params: { courseId },
						body: { name: 'New Name' },
					})

					assert.strictEqual(res.statusCode, 200)
					assert.strictEqual(courseDoc.name, 'New Name')
					assert.ok(groupUpdateCall)
					assert.deepStrictEqual(groupUpdateCall.filter, { courseRef: courseId })
					assert.deepStrictEqual(groupUpdateCall.update, { $set: { course: 'New Name' } })
				},
			)
		})

		await test('createCourseLesson auto-updates course methodology and linked groups', async () => {
			const courseId = '507f1f77bcf86cd799439071'
			const lessonId = '507f1f77bcf86cd799439072'
			let courseUpdateCall = null
			let groupUpdateCall = null

			await withPatchedMethods(
				[
					[
						Course,
						'findById',
						() => ({
							select: async () => ({ _id: courseId, durationMonths: 6 }),
						}),
					],
					[Lesson, 'findOne', () => makeQuery(null)],
					[Lesson, 'countDocuments', async () => 0],
					[
						Lesson,
						'create',
						async payload => ({
							_id: lessonId,
							...payload,
						}),
					],
					[
						Course,
						'updateOne',
						async (filter, update) => {
							courseUpdateCall = { filter, update }
							return { matchedCount: 1, modifiedCount: 1 }
						},
					],
					[
						Group,
						'updateMany',
						async (filter, update) => {
							groupUpdateCall = { filter, update }
							return { matchedCount: 2, modifiedCount: 2 }
						},
					],
				],
				async () => {
					const res = await callHandler(courseController.createCourseLesson, {
						params: { courseId },
						body: { title: 'Lesson 1: Algebra Basics' },
					})

					assert.strictEqual(res.statusCode, 201)
					assert.ok(courseUpdateCall)
					assert.ok(groupUpdateCall)
					assert.deepStrictEqual(courseUpdateCall.filter, { _id: courseId })
					assert.deepStrictEqual(groupUpdateCall.filter, { courseRef: courseId })
					assert.ok(courseUpdateCall.update.$addToSet.methodology)
					assert.ok(groupUpdateCall.update.$addToSet.lessons)
				},
			)
		})

		await test('createCourseLesson ignores incoming order and always uses next sequence', async () => {
			const courseId = '507f1f77bcf86cd799439090'
			let createdLessonPayload = null

			await withPatchedMethods(
				[
					[
						Course,
						'findById',
						() => ({
							select: async () => ({ _id: courseId, durationMonths: 6 }),
						}),
					],
					[Lesson, 'countDocuments', async () => 0],
					[Lesson, 'findOne', () => makeQuery({ order: 3 })],
					[
						Lesson,
						'create',
						async payload => {
							createdLessonPayload = payload
							return { _id: new mongoose.Types.ObjectId(), ...payload }
						},
					],
					[Course, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 })],
					[Group, 'updateMany', async () => ({ matchedCount: 1, modifiedCount: 1 })],
				],
				async () => {
					const res = await callHandler(courseController.createCourseLesson, {
						params: { courseId },
						body: { title: 'Auto order lesson', order: 99 },
					})

					assert.strictEqual(res.statusCode, 201)
					assert.ok(createdLessonPayload)
					assert.strictEqual(createdLessonPayload.order, 4)
				},
			)
		})

		await test('updateCourseLesson ignores incoming order changes', async () => {
			const courseId = '507f1f77bcf86cd799439091'
			const lessonId = '507f1f77bcf86cd799439092'
			const lessonDoc = {
				_id: lessonId,
				course: courseId,
				title: 'Before update',
				order: 1,
				documents: [],
				save: async () => {},
			}

			await withPatchedMethods(
				[[Lesson, 'findOne', async () => lessonDoc]],
				async () => {
					const res = await callHandler(courseController.updateCourseLesson, {
						params: { courseId, lessonId },
						body: { title: 'After update', order: 50 },
					})

					assert.strictEqual(res.statusCode, 200)
					assert.strictEqual(lessonDoc.title, 'After update')
					assert.strictEqual(lessonDoc.order, 1)
				},
			)
		})

		await test('createCourseLesson stores uploaded document metadata when file is provided', async () => {
			const courseId = '507f1f77bcf86cd79943907f'
			const lessonId = '507f1f77bcf86cd799439080'
			const uploaderId = '507f1f77bcf86cd799439081'
			let createdLessonPayload = null

			await withPatchedMethods(
				[
					[
						Course,
						'findById',
						() => ({
							select: async () => ({ _id: courseId, durationMonths: 6 }),
						}),
					],
					[Lesson, 'findOne', () => makeQuery(null)],
					[Lesson, 'countDocuments', async () => 0],
					[
						Lesson,
						'create',
						async payload => {
							createdLessonPayload = payload
							return {
								_id: lessonId,
								...payload,
							}
						},
					],
					[Course, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 })],
					[Group, 'updateMany', async () => ({ matchedCount: 1, modifiedCount: 1 })],
				],
				async () => {
					const res = await callHandler(courseController.createCourseLesson, {
						params: { courseId },
						body: { title: 'Lesson with File' },
						user: { _id: uploaderId, role: 'teacher' },
						file: {
							originalname: 'lesson-create.pdf',
							filename: '1772600001111-aabbccdd.pdf',
							mimetype: 'application/pdf',
							size: 654321,
							path: 'uploads/1772600001111-aabbccdd.pdf',
						},
					})

					assert.strictEqual(res.statusCode, 201)
					assert.ok(createdLessonPayload)
					assert.ok(Array.isArray(createdLessonPayload.documents))
					assert.strictEqual(createdLessonPayload.documents.length, 1)
					assert.strictEqual(
						createdLessonPayload.documents[0].url,
						'/uploads/1772600001111-aabbccdd.pdf',
					)
					assert.strictEqual(String(createdLessonPayload.documents[0].uploadedBy), uploaderId)
				},
			)
		})

		await test('updateCourseLesson appends uploaded document metadata when file is provided', async () => {
			const courseId = '507f1f77bcf86cd799439082'
			const lessonId = '507f1f77bcf86cd799439083'
			const uploaderId = '507f1f77bcf86cd799439084'
			const lessonDoc = {
				_id: lessonId,
				course: courseId,
				title: 'Lesson to patch',
				order: 1,
				documents: [],
				save: async () => {},
			}

			await withPatchedMethods(
				[[Lesson, 'findOne', async () => lessonDoc]],
				async () => {
					const res = await callHandler(courseController.updateCourseLesson, {
						params: { courseId, lessonId },
						body: {},
						user: { _id: uploaderId, role: 'teacher' },
						file: {
							originalname: 'lesson-update.docx',
							filename: '1772600002222-eeff0011.docx',
							mimetype:
								'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
							size: 222222,
							path: 'uploads/1772600002222-eeff0011.docx',
						},
					})

					assert.strictEqual(res.statusCode, 200)
					assert.strictEqual(lessonDoc.documents.length, 1)
					assert.strictEqual(
						lessonDoc.documents[0].filename,
						'1772600002222-eeff0011.docx',
					)
					assert.strictEqual(String(lessonDoc.documents[0].uploadedBy), uploaderId)
				},
			)
		})

		await test('createCourseLesson rejects when lesson limit is reached', async () => {
			const courseId = '507f1f77bcf86cd79943907b'

			await withPatchedMethods(
				[
					[
						Course,
						'findById',
						() => ({
							select: async () => ({ _id: courseId, durationMonths: 1 }),
						}),
					],
					[Lesson, 'countDocuments', async () => 12],
				],
				async () => {
					const res = await callHandler(courseController.createCourseLesson, {
						params: { courseId },
						body: { title: 'Lesson over limit' },
					})

					assert.strictEqual(res.statusCode, 409)
					assert.strictEqual(
						res.body.message,
						'Course has reached maximum lesson limit (12)',
					)
				},
			)
		})

		await test('updateCourse rejects duration that cannot fit existing lessons count', async () => {
			const courseId = '507f1f77bcf86cd79943907c'
			const courseDoc = {
				_id: courseId,
				name: 'History',
				durationMonths: 6,
				price: 1000000,
				note: '',
				save: async () => {},
				toObject() {
					return {
						_id: this._id,
						name: this.name,
						durationMonths: this.durationMonths,
						price: this.price,
						note: this.note,
						methodology: [],
						groupsCount: 0,
					}
				},
			}

			await withPatchedMethods(
				[
					[Course, 'findById', () => makeQuery(courseDoc)],
					[Lesson, 'countDocuments', async () => 13],
				],
				async () => {
					const res = await callHandler(courseController.updateCourse, {
						params: { courseId },
						body: { durationMonths: 1 },
					})

					assert.strictEqual(res.statusCode, 400)
					assert.ok(String(res.body.message).includes('allows maximum 12 lessons'))
				},
			)
		})

		await test('createGroup rejects schedule that does not match odd/even groupType', async () => {
			const courseId = '507f1f77bcf86cd79943907d'
			const teacherId = '507f1f77bcf86cd79943907e'

			await withPatchedMethods(
				[
					[
						Course,
						'findById',
						() => ({
							select: async () => ({
								_id: courseId,
								name: 'Biology',
								methodology: [],
							}),
						}),
					],
					[
						User,
						'find',
						() => ({
							select: async () => [{ _id: teacherId }],
						}),
					],
				],
				async () => {
					const res = await callHandler(groupController.createGroup, {
						body: {
							name: 'Bio Group A',
							courseId,
							groupType: 'odd',
							teacher: teacherId,
							startDate: '2026-03-03',
							schedule: [
								{ dayOfWeek: 'tuesday', startTime: '09:00', durationMinutes: 90 },
								{ dayOfWeek: 'thursday', startTime: '09:00', durationMinutes: 90 },
								{ dayOfWeek: 'saturday', startTime: '09:00', durationMinutes: 90 },
							],
						},
					})

					assert.strictEqual(res.statusCode, 400)
					assert.ok(String(res.body.message).includes('Invalid schedule for groupType'))
				},
			)
		})

		await test('uploadLessonDocument rejects request without file', async () => {
			const courseId = '507f1f77bcf86cd799439073'
			const lessonId = '507f1f77bcf86cd799439074'

			const res = await callHandler(courseController.uploadLessonDocument, {
				params: { courseId, lessonId },
				body: {},
			})

			assert.strictEqual(res.statusCode, 400)
			assert.strictEqual(res.body.message, 'document file is required')
		})

		await test('uploadLessonDocument stores document metadata on lesson', async () => {
			const courseId = '507f1f77bcf86cd799439075'
			const lessonId = '507f1f77bcf86cd799439076'
			const uploaderId = '507f1f77bcf86cd799439077'
			const lessonDoc = {
				_id: lessonId,
				course: courseId,
				documents: [],
				save: async () => {},
			}

			await withPatchedMethods(
				[[Lesson, 'findOne', async () => lessonDoc]],
				async () => {
					const res = await callHandler(courseController.uploadLessonDocument, {
						params: { courseId, lessonId },
						user: { _id: uploaderId, role: 'teacher' },
						file: {
							originalname: 'lesson-1.pdf',
							filename: '1772600000000-a1b2c3d4.pdf',
							mimetype: 'application/pdf',
							size: 123456,
							path: 'uploads/1772600000000-a1b2c3d4.pdf',
						},
					})

					assert.strictEqual(res.statusCode, 201)
					assert.strictEqual(lessonDoc.documents.length, 1)
					assert.strictEqual(lessonDoc.documents[0].url, '/uploads/1772600000000-a1b2c3d4.pdf')
					assert.strictEqual(String(lessonDoc.documents[0].uploadedBy), uploaderId)
				},
			)
		})

		await test('deleteLessonDocument removes document from lesson', async () => {
			const courseId = '507f1f77bcf86cd799439078'
			const lessonId = '507f1f77bcf86cd799439079'
			const documentId = '507f1f77bcf86cd79943907a'
			const lessonDoc = {
				_id: lessonId,
				course: courseId,
				documents: [
					{
						_id: documentId,
						filename: '1772600000001-z9y8x7w6.pptx',
					},
				],
				save: async () => {},
			}

			await withPatchedMethods(
				[[Lesson, 'findOne', async () => lessonDoc]],
				async () => {
					const res = await callHandler(courseController.deleteLessonDocument, {
						params: { courseId, lessonId, documentId },
					})

					assert.strictEqual(res.statusCode, 200)
					assert.strictEqual(lessonDoc.documents.length, 0)
				},
			)
		})

		await test('course sync service returns 0 for courses with no groups', async () => {
			const courseIdWithGroups = '507f1f77bcf86cd799439081'
			const courseIdWithoutGroups = '507f1f77bcf86cd799439082'

			await withPatchedMethods(
				[
					[
						Group,
						'aggregate',
						async () => [
							{
								_id: new mongoose.Types.ObjectId(courseIdWithGroups),
								groupsCount: 3,
							},
						],
					],
				],
				async () => {
					const counts = await getGroupsCountByCourseIds([
						courseIdWithGroups,
						courseIdWithoutGroups,
					])
					assert.strictEqual(counts.get(courseIdWithGroups), 3)
					assert.strictEqual(counts.get(courseIdWithoutGroups), 0)
				},
			)
		})

		await test('syncCourseGroupsCount writes computed counts to courses', async () => {
			const courseId = '507f1f77bcf86cd799439091'
			let bulkWritePayload = null

			await withPatchedMethods(
				[
					[
						Group,
						'aggregate',
						async () => [
							{
								_id: new mongoose.Types.ObjectId(courseId),
								groupsCount: 4,
							},
						],
					],
					[
						Course,
						'bulkWrite',
						async operations => {
							bulkWritePayload = operations
							return { ok: 1 }
						},
					],
				],
				async () => {
					const result = await syncCourseGroupsCount([courseId])
					assert.strictEqual(result.get(courseId), 4)
					assert.ok(Array.isArray(bulkWritePayload))
					assert.strictEqual(bulkWritePayload.length, 1)
					assert.deepStrictEqual(bulkWritePayload[0].updateOne.filter, { _id: courseId })
				},
			)
		})

		await test('student balance reset service throttles repeated non-forced calls', async () => {
			let updateManyCalls = 0
			await withPatchedMethods(
				[
					[
						Student,
						'updateMany',
						async () => {
							updateManyCalls += 1
							return { matchedCount: 5, modifiedCount: 5 }
						},
					],
				],
				async () => {
					const first = await resetStudentBalancesIfNeeded({ force: true })
					const second = await resetStudentBalancesIfNeeded()

					assert.strictEqual(first.skipped, false)
					assert.strictEqual(second.skipped, true)
					assert.strictEqual(second.reason, 'throttled')
					assert.strictEqual(updateManyCalls, 1)
				},
			)
		})

		await test('course model rejects duplicate methodology lessons', async () => {
			const lessonId = new mongoose.Types.ObjectId()
			const course = new Course({
				name: `Course-${Date.now()}`,
				durationMonths: 6,
				price: 1000,
				methodology: [lessonId, lessonId],
			})

			let validationError = null
			try {
				await course.validate()
			} catch (error) {
				validationError = error
			}

			assert.ok(validationError)
			assert.ok(String(validationError.message).includes('Methodology cannot contain duplicate lessons'))
		})

		await test('course model rejects methodology longer than durationMonths * 12', async () => {
			const lessonIds = Array.from({ length: 13 }, () => new mongoose.Types.ObjectId())
			const course = new Course({
				name: `Course-Limit-${Date.now()}`,
				durationMonths: 1,
				price: 1000,
				methodology: lessonIds,
			})

			let validationError = null
			try {
				await course.validate()
			} catch (error) {
				validationError = error
			}

			assert.ok(validationError)
			assert.ok(
				String(validationError.message).includes(
					'Methodology lesson count cannot exceed durationMonths * 12',
				),
			)
		})

		await test('group model rejects duplicate lessons in group', async () => {
			const lessonId = new mongoose.Types.ObjectId()
			const group = new Group({
				name: `Group-${Date.now()}`,
				course: 'Physics',
				groupType: 'odd',
				teacher: new mongoose.Types.ObjectId(),
				startDate: new Date(),
				schedule: [
					{ dayOfWeek: 'monday', startTime: '09:00', durationMinutes: 90 },
					{ dayOfWeek: 'wednesday', startTime: '09:00', durationMinutes: 90 },
					{ dayOfWeek: 'friday', startTime: '09:00', durationMinutes: 90 },
				],
				lessons: [lessonId, lessonId],
			})

			let validationError = null
			try {
				await group.validate()
			} catch (error) {
				validationError = error
			}

			assert.ok(validationError)
			assert.ok(String(validationError.message).includes('Lessons list cannot contain duplicates'))
		})

		await test('student model auto-sets groupAttached when active group exists', async () => {
			const student = new Student({
				fullname: 'Attached Student',
				studentPhone: '+998901111111',
				parentPhone: '+998902222222',
				gender: 'male',
				birthDate: new Date('2012-02-20'),
				password: '12345678',
				groups: [
					{
						group: new mongoose.Types.ObjectId(),
						status: 'active',
					},
				],
			})

			await student.validate()
			assert.strictEqual(student.groupAttached, true)
		})
	} finally {
		restoreGlobalUpdateMany()
	}

	if (failed > 0) {
		throw new Error(`Senior suite failed: ${failed} failed, ${passed} passed`)
	}

	console.log(`Senior suite passed: ${passed} tests`)
}

runTests().catch(error => {
	console.error(error)
	process.exit(1)
})
