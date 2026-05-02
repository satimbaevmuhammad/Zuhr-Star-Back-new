const express = require('express')
const extraLessonController = require('../controllers/extra-lesson.controller')
const { requireAuth, requireStudentAuth, allowPermissions } = require('../middleware/auth.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: All routes with literal path segments (e.g. /availability, /book,
// /my-lessons, /requests, /support-teachers) MUST be declared before any route
// that uses a dynamic segment like /:lessonId. Otherwise Express would try to
// match the literal string as a lesson ObjectId and return 400 INVALID_OBJECT_ID.
// ─────────────────────────────────────────────────────────────────────────────

// ─── SUPPORT TEACHER MANAGEMENT ──────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/support-teachers:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: List designated extra-lesson support teachers
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
 *                 data:
 *                   type: array
 */
router.get(
	'/support-teachers',
	requireAuth,
	allowPermissions('users:read'),
	extraLessonController.listSupportTeachers,
)

/**
 * @swagger
 * /api/extra-lessons/support-teachers/{userId}:
 *   post:
 *     tags: [ExtraLessons]
 *     summary: Assign a user as an extra-lesson support teacher
 *     description: Marks a user as a support teacher.
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
 *         description: User assigned as support teacher
 *       409:
 *         description: User is already a support teacher
 *       404:
 *         description: User not found
 *   delete:
 *     tags: [ExtraLessons]
 *     summary: Remove a user from extra-lesson support teachers
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
	requireAuth,
	allowPermissions('users:manage'),
	validateObjectId('userId'),
	extraLessonController.assignSupportTeacher,
)
router.delete(
	'/support-teachers/:userId',
	requireAuth,
	allowPermissions('users:manage'),
	validateObjectId('userId'),
	extraLessonController.removeSupportTeacher,
)

// ─── AVAILABILITY (STUDENT AUTH) ────────────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/availability:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: Get available slots for your group's support teacher
 *     description: |
 *       Returns all 5 daily slots (14:00 / 15:10 / 16:20 / 17:30 / 18:40 local UTC+5).
 *       Requires student authentication and only allows teachers assigned to the
 *       student's group(s).
 *     security:
 *       - studentBearerAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: teacherId
 *         required: false
 *         schema:
 *           type: string
 *         description: |
 *           MongoDB ObjectId of the support teacher. Required only when the
 *           student belongs to multiple groups with different support teachers.
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: '2026-03-28'
 *         description: Local date (YYYY-MM-DD, UTC+5). Defaults to today.
 *     responses:
 *       200:
 *         description: Slot availability for the teacher on the given date
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 teacherId:
 *                   type: string
 *                 date:
 *                   type: string
 *                 teacher:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     fullname:
 *                       type: string
 *                 lessonsToday:
 *                   type: integer
 *                 remainingSlots:
 *                   type: integer
 *                 slots:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       scheduledAt:
 *                         type: string
 *                         format: date-time
 *                         description: UTC ISO 8601 — pass this value back when booking
 *                       localTime:
 *                         type: string
 *                         example: '14:00'
 *                       isFree:
 *                         type: boolean
 *       400:
 *         description: teacherId missing/invalid, or date format error
 *       404:
 *         description: Teacher not found
 */
router.get('/availability', requireStudentAuth, extraLessonController.getAvailability)

// ─── STUDENT BOOKING ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/book:
 *   post:
 *     tags: [ExtraLessons]
 *     summary: Student submits a booking request for an extra lesson
 *     description: |
 *       Creates a lesson in `pending_approval` status. The support teacher must
 *       approve it via `PATCH /api/extra-lessons/{lessonId}/approve`.
 *       Each lesson lasts 60 minutes. Only valid slot times are accepted
 *       (14:00, 15:10, 16:20, 17:30, 18:40 local UTC+5).
 *     security:
 *       - studentBearerAuth: []
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [teacherId, scheduledAt]
 *             properties:
 *               teacherId:
 *                 type: string
 *                 description: MongoDB ObjectId of the support teacher
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 description: One of the valid UTC slot times from GET /availability
 *               studentNote:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional note — e.g. topic the student needs help with
 *     responses:
 *       201:
 *         description: Booking request submitted, pending approval
 *       400:
 *         description: Invalid input or slot time
 *       409:
 *         description: Slot already taken, daily cap reached, or student already has a lesson at this time
 *       404:
 *         description: Teacher not found
 */
router.post('/book', requireStudentAuth, extraLessonController.bookLesson)

// ─── STUDENT: MY LESSONS ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/my-lessons:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: Student retrieves their own extra lessons
 *     security:
 *       - studentBearerAuth: []
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending_approval, confirmed, cancelled, completed]
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
 *         description: Paginated list of the student's lessons
 */
router.get('/my-lessons', requireStudentAuth, extraLessonController.getMyLessons)

// ─── EMPLOYEE: PENDING REQUEST QUEUE ─────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/requests:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: List pending booking requests
 *     description: |
 *       Support teachers see only requests assigned to them.
 *       Admin / superadmin see all pending requests (filterable by teacherId).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: teacherId
 *         schema:
 *           type: string
 *         description: Admin-only filter by teacher
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
 *         description: Paginated pending requests
 */
router.get('/requests', requireAuth, extraLessonController.listPendingRequests)

// ─── ADMIN / EMPLOYEE: LIST ALL & CREATE ─────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: List all extra lessons (admin / employee view)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending_approval, confirmed, cancelled, completed]
 *       - in: query
 *         name: teacherId
 *         schema:
 *           type: string
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *           example: '2026-03-28'
 *         description: Filter by local date (YYYY-MM-DD, UTC+5)
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
 *     summary: Support teacher creates an extra lesson directly (auto-confirmed)
 *     description: |
 *       The lesson is immediately confirmed — no student request / approval flow.
 *       The caller must be an isExtraLessonSupport teacher, or an admin who provides
 *       an explicit `assignedTeacherId`.
 *       Slot rules still apply: only 14:00 / 15:10 / 16:20 / 17:30 / 18:40 local UTC+5
 *       are valid; max 5 lessons per teacher per day; slot must be free.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scheduledAt]
 *             properties:
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *               assignedTeacherId:
 *                 type: string
 *                 description: Admin-only — create on behalf of a specific support teacher
 *               subject:
 *                 type: string
 *               teacherNote:
 *                 type: string
 *                 maxLength: 500
 *               room:
 *                 type: string
 *               studentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 maxItems: 3
 *                 description: Optional pre-enrolled students (max 3)
 *     responses:
 *       201:
 *         description: Extra lesson created and confirmed
 *       400:
 *         description: Validation error or invalid slot
 *       403:
 *         description: Caller is not a support teacher
 *       409:
 *         description: Slot conflict or daily cap reached
 */
router.get('/', requireAuth, extraLessonController.listExtraLessons)
router.post(
	'/',
	requireAuth,
	extraLessonController.createExtraLesson,
)

// ─── SINGLE LESSON ACTIONS (all use :lessonId — declared AFTER literal routes) ─

/**
 * @swagger
 * /api/extra-lessons/{lessonId}:
 *   get:
 *     tags: [ExtraLessons]
 *     summary: Get full details of a single extra lesson
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
 *         description: Extra lesson document with populated references
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [ExtraLessons]
 *     summary: Update mutable fields of a lesson (assigned teacher or admin)
 *     description: |
 *       Fields that can be updated: subject, teacherNote, room.
 *       Rescheduling (changing scheduledAt) is admin-only and re-validates the slot.
 *       Cannot edit a cancelled or completed lesson.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               subject:
 *                 type: string
 *               teacherNote:
 *                 type: string
 *               room:
 *                 type: string
 *               scheduledAt:
 *                 type: string
 *                 format: date-time
 *                 description: Admin-only rescheduling
 *     responses:
 *       200:
 *         description: Lesson updated
 *       403:
 *         description: Not the assigned teacher / not admin
 *       404:
 *         description: Not found
 *       409:
 *         description: Lesson is already completed or cancelled
 *   delete:
 *     tags: [ExtraLessons]
 *     summary: Hard-delete an extra lesson (admin only)
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
router.get(
	'/:lessonId',
	requireAuth,
	validateObjectId('lessonId'),
	extraLessonController.getExtraLessonById,
)
router.patch(
	'/:lessonId',
	requireAuth,
	validateObjectId('lessonId'),
	extraLessonController.updateExtraLesson,
)
router.delete(
	'/:lessonId',
	requireAuth,
	validateObjectId('lessonId'),
	extraLessonController.deleteExtraLesson,
)

// ─── APPROVE / DENY / COMPLETE ────────────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/approve:
 *   patch:
 *     tags: [ExtraLessons]
 *     summary: Approve a student's pending booking request
 *     description: |
 *       Moves the lesson from `pending_approval` to `confirmed`.
 *       Only the assigned teacher or admin can approve.
 *       Re-validates the slot is still free before confirming.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               teacherNote:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Request approved, lesson confirmed
 *       409:
 *         description: Lesson is not pending, or slot conflict detected
 *       403:
 *         description: Not the assigned teacher / not admin
 *       404:
 *         description: Not found
 */
router.patch(
	'/:lessonId/approve',
	requireAuth,
	allowPermissions('groups:read'),
	validateObjectId('lessonId'),
	extraLessonController.approveRequest,
)

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/deny:
 *   patch:
 *     tags: [ExtraLessons]
 *     summary: Deny a student's pending booking request
 *     description: |
 *       Moves the lesson from `pending_approval` to `cancelled`.
 *       `denialReason` is required so the student knows why they were rejected.
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
 *             required: [denialReason]
 *             properties:
 *               denialReason:
 *                 type: string
 *                 maxLength: 500
 *               teacherNote:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Request denied
 *       400:
 *         description: denialReason missing
 *       409:
 *         description: Lesson is not in pending_approval state
 *       403:
 *         description: Not the assigned teacher / not admin
 *       404:
 *         description: Not found
 */
router.patch(
	'/:lessonId/deny',
	requireAuth,
	allowPermissions('groups:read'),
	validateObjectId('lessonId'),
	extraLessonController.denyRequest,
)

router.patch(
	'/:lessonId/cancel',
	requireAuth,
	allowPermissions('groups:manage'),
	validateObjectId('lessonId'),
	extraLessonController.cancelConfirmedLesson,
)

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/complete:
 *   patch:
 *     tags: [ExtraLessons]
 *     summary: Mark a confirmed lesson as completed
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               teacherNote:
 *                 type: string
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Lesson marked as completed
 *       409:
 *         description: Lesson is not confirmed
 *       403:
 *         description: Not the assigned teacher / not admin
 *       404:
 *         description: Not found
 */
router.patch(
	'/:lessonId/complete',
	requireAuth,
	allowPermissions('groups:read'),
	validateObjectId('lessonId'),
	extraLessonController.markCompleted,
)

// ─── STUDENT ENROLLMENT MANAGEMENT ───────────────────────────────────────────

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/students:
 *   post:
 *     tags: [ExtraLessons]
 *     summary: Add one or more students to a lesson (assigned teacher or admin)
 *     description: |
 *       A teacher can add 1–3 students total per lesson.
 *       Accepts an array of studentIds. Students already enrolled are skipped.
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
 *             required: [studentIds]
 *             properties:
 *               studentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 maxItems: 3
 *                 example: ['65f12ca7a7720c194de6a010', '65f12ca7a7720c194de6a011']
 *     responses:
 *       200:
 *         description: Students added
 *       400:
 *         description: Validation error
 *       409:
 *         description: Would exceed max students or all already enrolled
 *       404:
 *         description: Lesson or a student not found
 */
router.post(
	'/:lessonId/students',
	requireAuth,
	validateObjectId('lessonId'),
	extraLessonController.addStudents,
)

/**
 * @swagger
 * /api/extra-lessons/{lessonId}/students/{studentId}:
 *   delete:
 *     tags: [ExtraLessons]
 *     summary: Remove a student from a lesson (assigned teacher or admin)
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
 *         description: Lesson not found or student not enrolled
 */
router.delete(
	'/:lessonId/students/:studentId',
	requireAuth,
	validateObjectId('lessonId', 'studentId'),
	extraLessonController.removeStudent,
)

module.exports = router

