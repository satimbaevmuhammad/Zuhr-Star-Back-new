const express = require('express')

const homeworkController = require('../controllers/homework.controller')
const { requireAuth, requireStudentAuth } = require('../middleware/auth.middleware')
const { uploadHomeworkAttachment } = require('../middleware/upload.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

/**
 * @swagger
 * /api/homework/lessons/{lessonId}:
 *   get:
 *     tags: [Homework]
 *     summary: Get homework for a lesson (student)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Homework assignment
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Homework locked or not enrolled
 *       404:
 *         description: Lesson not found
 */
router.get(
	'/lessons/:lessonId',
	requireStudentAuth,
	validateObjectId('lessonId'),
	homeworkController.getStudentHomework,
)

/**
 * @swagger
 * /api/homework/lessons/{lessonId}/submissions:
 *   post:
 *     tags: [Homework]
 *     summary: Submit homework (student)
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               description:
 *                 type: string
 *               links:
 *                 type: string
 *                 example: '["https://example.com/solution"]'
 *               groupId:
 *                 type: string
 *               document:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Homework submitted
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Homework locked or not enrolled
 *       409:
 *         description: Homework already approved
 */
router.post(
	'/lessons/:lessonId/submissions',
	requireStudentAuth,
	validateObjectId('lessonId'),
	uploadHomeworkAttachment,
	homeworkController.submitStudentHomework,
)

/**
 * @swagger
 * /api/homework/groupmates/grades:
 *   get:
 *     tags: [Homework]
 *     summary: Get graded homework scores for active groupmates (student)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: string
 *         description: Optional when student has exactly one active group
 *       - in: query
 *         name: includeSelf
 *         schema:
 *           type: boolean
 *           default: false
 *       - in: query
 *         name: onlyChecked
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: Groupmates grade list
 *       400:
 *         description: Invalid query
 *       403:
 *         description: Student is not active in requested group
 *       404:
 *         description: Group not found
 */
router.get(
	'/groupmates/grades',
	requireStudentAuth,
	homeworkController.getStudentGroupmatesGrades,
)

/**
 * @swagger
 * /api/homework/submissions:
 *   get:
 *     tags: [Homework]
 *     summary: List homework submissions (teacher/admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lessonId
 *         schema:
 *           type: string
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [submitted, approved]
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
 *         description: Homework submissions
 *       400:
 *         description: Invalid filter
 */
router.get('/submissions', requireAuth, homeworkController.listHomeworkSubmissions)

/**
 * @swagger
 * /api/homework/submissions/{submissionId}/grade:
 *   patch:
 *     tags: [Homework]
 *     summary: Grade homework submission
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: submissionId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [score]
 *             properties:
 *               score:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *     responses:
 *       200:
 *         description: Submission graded
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Submission not found
 */
router.patch(
	'/submissions/:submissionId/grade',
	requireAuth,
	validateObjectId('submissionId'),
	homeworkController.gradeHomeworkSubmission,
)

module.exports = router
