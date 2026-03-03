const express = require('express')

const courseController = require('../controllers/course.controller')
const { requireAuth, allowPermissions } = require('../middleware/auth.middleware')
const { uploadLessonDocument } = require('../middleware/upload.middleware')

const router = express.Router()

router.use(requireAuth)

/**
 * @swagger
 * /api/courses:
 *   get:
 *     tags: [Courses]
 *     summary: List courses
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated courses
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [Courses]
 *     summary: Create course
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CourseCreateInput'
 *     responses:
 *       201:
 *         description: Course created
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Duplicate course
 */
router.get('/', allowPermissions('groups:read'), courseController.getCourses)
router.post('/', allowPermissions('groups:manage'), courseController.createCourse)

/**
 * @swagger
 * /api/courses/{courseId}:
 *   get:
 *     tags: [Courses]
 *     summary: Get course by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course details
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Course not found
 *   patch:
 *     tags: [Courses]
 *     summary: Update course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CourseUpdateInput'
 *     responses:
 *       200:
 *         description: Course updated
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Course not found
 *       409:
 *         description: Duplicate course
 *   delete:
 *     tags: [Courses]
 *     summary: Delete course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course deleted
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Course not found
 *       409:
 *         description: Course has linked groups
 */
router.get('/:courseId', allowPermissions('groups:read'), courseController.getCourseById)
router.patch('/:courseId', allowPermissions('groups:manage'), courseController.updateCourse)
router.delete('/:courseId', allowPermissions('groups:manage'), courseController.deleteCourse)

/**
 * @swagger
 * /api/courses/{courseId}/lessons:
 *   get:
 *     tags: [Lessons]
 *     summary: List lessons for a course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Course lessons list
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Course not found
 *   post:
 *     tags: [Lessons]
 *     summary: Create lesson and attach it to course methodology
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LessonCreateInput'
 *     responses:
 *       201:
 *         description: Lesson created
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Course not found
 *       409:
 *         description: Duplicate lesson order
 */
router.get(
	'/:courseId/lessons',
	allowPermissions('groups:read'),
	courseController.getCourseLessons,
)
router.post(
	'/:courseId/lessons',
	allowPermissions('groups:manage'),
	courseController.createCourseLesson,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}:
 *   patch:
 *     tags: [Lessons]
 *     summary: Update lesson in a course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
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
 *             $ref: '#/components/schemas/LessonUpdateInput'
 *     responses:
 *       200:
 *         description: Lesson updated
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson not found
 *       409:
 *         description: Duplicate lesson order
 *   delete:
 *     tags: [Lessons]
 *     summary: Delete lesson from a course
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson deleted
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson not found
 */
router.patch(
	'/:courseId/lessons/:lessonId',
	allowPermissions('groups:manage'),
	courseController.updateCourseLesson,
)
router.delete(
	'/:courseId/lessons/:lessonId',
	allowPermissions('groups:manage'),
	courseController.deleteCourseLesson,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}/documents:
 *   get:
 *     tags: [Lessons]
 *     summary: List lesson documents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson documents list
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Lesson not found
 *   post:
 *     tags: [Lessons]
 *     summary: Upload lesson document (pdf, pptx, docx, and other docs)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [document]
 *             properties:
 *               document:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Lesson document uploaded
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson not found
 */
router.get(
	'/:courseId/lessons/:lessonId/documents',
	allowPermissions('groups:read'),
	courseController.getLessonDocuments,
)
router.post(
	'/:courseId/lessons/:lessonId/documents',
	allowPermissions('groups:manage'),
	uploadLessonDocument,
	courseController.uploadLessonDocument,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}/documents/{documentId}:
 *   delete:
 *     tags: [Lessons]
 *     summary: Delete lesson document
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: documentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lesson document deleted
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson or document not found
 */
router.delete(
	'/:courseId/lessons/:lessonId/documents/:documentId',
	allowPermissions('groups:manage'),
	courseController.deleteLessonDocument,
)

/**
 * @swagger
 * /api/courses/{courseId}/rebuild-methodology:
 *   post:
 *     tags: [Courses]
 *     summary: Rebuild methodology array from course lessons
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: courseId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Methodology rebuilt
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Course not found
 */
router.post(
	'/:courseId/rebuild-methodology',
	allowPermissions('groups:manage'),
	courseController.rebuildCourseMethodology,
)

module.exports = router
