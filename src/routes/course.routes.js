const express = require('express')

const courseController = require('../controllers/course.controller')
const {
	requireAnyAuth,
	allowPermissions,
	allowPermissionsOrStudent,
	allowRoles,
} = require('../middleware/auth.middleware')
const validateObjectId = require('../middleware/validateObjectId')
const {
	uploadLessonDocument,
	uploadHomeworkAttachment,
} = require('../middleware/upload.middleware')

const router = express.Router()

router.use(requireAnyAuth)

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
router.get('/', allowPermissionsOrStudent('groups:read'), courseController.getCourses)
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
router.get(
	'/:courseId',
	allowPermissionsOrStudent('groups:read'),
	validateObjectId('courseId'),
	courseController.getCourseById,
)
router.patch(
	'/:courseId',
	allowPermissions('groups:manage'),
	validateObjectId('courseId'),
	courseController.updateCourse,
)
router.delete(
	'/:courseId',
	allowPermissions('groups:manage'),
	validateObjectId('courseId'),
	courseController.deleteCourse,
)

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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               title:
 *                 type: string
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 600
 *               description:
 *                 type: string
 *               homework:
 *                 type: string
 *                 description: Optional homework description or JSON object string with { "description", "links" }.
 *                 example: '{"description":"Solve exercises 1-5","links":["https://example.com/homework-1"]}'
 *               homeworkLinks:
 *                 type: string
 *                 example: '["https://example.com/homework-1"]'
 *               document:
 *                 type: string
 *                 format: binary
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
	allowPermissionsOrStudent('groups:read'),
	validateObjectId('courseId'),
	courseController.getCourseLessons,
)
router.post(
	'/:courseId/lessons',
	allowRoles('admin', 'headteacher', 'superadmin'),
	validateObjectId('courseId'),
	uploadLessonDocument,
	courseController.createCourseLesson,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}:
 *   patch:
 *     tags: [Homework]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 600
 *               description:
 *                 type: string
 *               homework:
 *                 type: string
 *                 description: Optional homework description or JSON object string with { "description", "links" }.
 *                 example: '{"description":"Read chapter 2","links":["https://example.com/homework-2"]}'
 *               homeworkLinks:
 *                 type: string
 *                 example: '["https://example.com/homework-1"]'
 *               document:
 *                 type: string
 *                 format: binary
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
 *     tags: [Homework]
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
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('courseId', 'lessonId'),
	uploadLessonDocument,
	courseController.updateCourseLesson,
)
router.delete(
	'/:courseId/lessons/:lessonId',
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('courseId', 'lessonId'),
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
 */
router.get(
	'/:courseId/lessons/:lessonId/documents',
	allowPermissionsOrStudent('groups:read'),
	validateObjectId('courseId', 'lessonId'),
	courseController.getLessonDocuments,
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
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('courseId', 'lessonId', 'documentId'),
	courseController.deleteLessonDocument,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}/homework:
 *   get:
 *     tags: [Lessons]
 *     summary: Get homework for a lesson
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
 *         description: Lesson homework
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Lesson not found
 *   patch:
 *     tags: [Lessons]
 *     summary: Update homework for a lesson
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
 *             type: object
 *             properties:
 *               homework:
 *                 type: string
 *                 description: Optional homework description or JSON object string with { "description", "links" }.
 *                 example: '{"description":"Solve exercises 1-5","links":["https://example.com/homework-1"]}'
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *               links:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Homework updated successfully
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson not found
 */
router.get(
	'/:courseId/lessons/:lessonId/homework',
	allowPermissionsOrStudent('groups:read'),
	validateObjectId('courseId', 'lessonId'),
	courseController.getLessonHomework,
)
router.patch(
	'/:courseId/lessons/:lessonId/homework',
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('courseId', 'lessonId'),
	courseController.updateLessonHomework,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}/homework/documents:
 *   post:
 *     tags: [Lessons]
 *     summary: Upload homework attachment
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
 *         description: Homework document uploaded
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson not found
 */
router.post(
	'/:courseId/lessons/:lessonId/homework/documents',
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('courseId', 'lessonId'),
	uploadHomeworkAttachment,
	courseController.uploadLessonHomeworkDocument,
)

/**
 * @swagger
 * /api/courses/{courseId}/lessons/{lessonId}/homework/documents/{documentId}:
 *   delete:
 *     tags: [Lessons]
 *     summary: Delete homework attachment
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
 *         description: Homework document deleted
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Lesson or document not found
 */
router.delete(
	'/:courseId/lessons/:lessonId/homework/documents/:documentId',
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('courseId', 'lessonId', 'documentId'),
	courseController.deleteLessonHomeworkDocument,
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
	validateObjectId('courseId'),
	courseController.rebuildCourseMethodology,
)

module.exports = router
