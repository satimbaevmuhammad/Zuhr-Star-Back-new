const express = require('express')
const extraLessonController = require('../controllers/extra-lesson.controller')
const { requireAuth, allowPermissions, allowRoles } = require('../middleware/auth.middleware')

const router = express.Router()

router.use(requireAuth)

// ─── GLOBAL SUPPORT TEACHER MANAGEMENT ───────────────────────────────────────
// Only 2-3 designated support teachers control ALL extra lessons (not per-group).

/**
 * @swagger
 * /api/extra-lessons/support-teachers:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: Get the global extra lesson support teachers (max 3)
 *     description: Returns the list of users designated to manage all extra lessons. Maximum 3 allowed.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of support teachers
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   example: 2
 *                 max:
 *                   type: integer
 *                   example: 3
 *                 teachers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 */
router.get(
	'/support-teachers',
	allowPermissions('users:read'),
	extraLessonController.listSupportTeachers,
)

/**
 * @swagger
 * /api/extra-lessons/support-teachers/{userId}:
 *   post:
 *     tags: [ExtraLessons]
 *     summary: Assign a user as an extra lesson support teacher
 *     description: Marks a user as a global extra lesson support teacher. Max 3 allowed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User assigned
 *       404:
 *         description: User not found
 *       409:
 *         description: Already 3 support teachers assigned
 *   delete:
 *     tags: [ExtraLessons]
 *     summary: Remove a user from extra lesson support teachers
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User removed
 *       404:
 *         description: User not found
 */
router.post(
	'/support-teachers/:userId',
	allowRoles('admin', 'superadmin'),
	extraLessonController.assignSupportTeacher,
)
router.delete(
	'/support-teachers/:userId',
	allowRoles('admin', 'superadmin'),
	extraLessonController.removeSupportTeacher,
)

// ─── EXTRA LESSON CRUD ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: List all extra lessons
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [scheduled, completed, cancelled]
 *       - in: query
 *         name: teacherId
 *         schema:
 *           type: string
 *         description: Filter by assigned support teacher
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Paginated extra lessons
 *   post:
 *     tags: [ExtraLessons]
 *     summary: Create an extra lesson
 *     description: |
 *       The `assignedTeacher` must be a user who has been designated as an extra lesson
 *       support teacher via `POST /api/extra-lessons/support-teachers/{userId}`.
 *       Only support teachers + admin/superadmin can create extra lessons.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, scheduledAt, assignedTeacher]
 *             properties:
 *               title:
 *                 type: string
 *                 example: Extra Math Practice
 *               description:
 *                 type: string
 *               subject:
 *                 type: string
 *                 example: Mathematics
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 example: '2026-03-25T10:00:00Z'
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 15
 *                 example: 90
 *               assignedTeacher:
 *                 type: string
 *                 description: Must be a designated extra lesson support teacher
 *                 example: 65f12ca7a7720c194de6a095
 *               room:
 *                 type: string
 *                 example: Room 101
 *               note:
 *                 type: string
 *     responses:
 *       201:
 *         description: Extra lesson created
 *       403:
 *         description: Assigned teacher is not a support teacher
 *       404:
 *         description: Assigned teacher not found
 */
router.get('/', allowPermissions('groups:read'), extraLessonController.listExtraLessons)
router.post(
	'/',
	allowRoles('admin', 'superadmin', 'headteacher', 'supporteacher', 'teacher'),
	extraLessonController.createExtraLesson,
)

/**
 * @swagger
 * /api/extra-lessons/{lessonId}:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: Get extra lesson by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Extra lesson details
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [ExtraLessons]
 *     summary: Update an extra lesson
 *     description: Only the assigned teacher or admin/superadmin can update.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               subject:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: integer
 *               assignedTeacher:
 *                 type: string
 *               room:
 *                 type: string
 *               note:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [scheduled, completed, cancelled]
 *     responses:
 *       200:
 *         description: Extra lesson updated
 *       403:
 *         description: Not the assigned teacher
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [ExtraLessons]
 *     summary: Delete an extra lesson
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.get('/:lessonId', allowPermissions('groups:read'), extraLessonController.getExtraLessonById)
router.patch('/:lessonId', requireAuth, extraLessonController.updateExtraLesson)
router.delete('/:lessonId', allowRoles('admin', 'superadmin'), extraLessonController.deleteExtraLesson)

// ─── STUDENT ENROLLMENT ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/students:
 *   post:
 *     tags: [ExtraLessons]
 *     summary: Add a student to an extra lesson
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [studentId]
 *             properties:
 *               studentId:
 *                 type: string
 *                 example: 65f12ca7a7720c194de6a010
 *     responses:
 *       200:
 *         description: Student added
 *       404:
 *         description: Lesson or student not found
 *       409:
 *         description: Student already enrolled
 */
router.post(
	'/:lessonId/students',
	allowPermissions('students:manage'),
	extraLessonController.addStudent,
)

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/students/{studentId}:
 *   delete:
 *     tags: [ExtraLessons]
 *     summary: Remove a student from an extra lesson
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student removed
 *       404:
 *         description: Lesson or student not found
 */
router.delete(
	'/:lessonId/students/:studentId',
	allowPermissions('students:manage'),
	extraLessonController.removeStudent,
)

module.exports = router
