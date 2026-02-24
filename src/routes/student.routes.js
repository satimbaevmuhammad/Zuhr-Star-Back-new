const express = require('express')

const studentController = require('../controllers/student.controller')
const { requireAuth, allowPermissions } = require('../middleware/auth.middleware')

const router = express.Router()

router.use(requireAuth)

/**
 * @swagger
 * /api/students:
 *   get:
 *     tags: [Students]
 *     summary: List students
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
 *         description: Paginated students
 *       403:
 *         description: Forbidden
 */
router.get('/', allowPermissions('students:read'), studentController.getStudents)

/**
 * @swagger
 * /api/students/{studentId}/groups:
 *   get:
 *     tags: [Students]
 *     summary: List groups connected to a student
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: membershipStatus
 *         schema:
 *           type: string
 *           enum: [active, paused, completed, left]
 *     responses:
 *       200:
 *         description: Student groups list
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Student not found
 */
router.get(
	'/:studentId/groups',
	allowPermissions('students:read', 'groups:read'),
	studentController.getStudentGroups,
)

/**
 * @swagger
 * /api/students/{studentId}/reward-coins:
 *   post:
 *     tags: [Students]
 *     summary: Reward student with coins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StudentCoinRewardInput'
 *     responses:
 *       200:
 *         description: Coins added successfully
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Student not found
 */
router.post(
	'/:studentId/reward-coins',
	allowPermissions('students:manage'),
	studentController.rewardStudentCoins,
)

/**
 * @swagger
 * /api/students/{studentId}:
 *   get:
 *     tags: [Students]
 *     summary: Get student by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student details
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Student not found
 */
router.get('/:studentId', allowPermissions('students:read'), studentController.getStudentById)

/**
 * @swagger
 * /api/students:
 *   post:
 *     tags: [Students]
 *     summary: Create student
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullname
 *               - studentPhone
 *               - parentPhone
 *               - gender
 *               - birthDate
 *               - password
 *             properties:
 *               fullname:
 *                 type: string
 *               studentPhone:
 *                 type: string
 *               parentPhone:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *               birthDate:
 *                 type: string
 *                 example: 2012-01-12
 *               password:
 *                 type: string
 *                 minLength: 8
 *               note:
 *                 type: string
 *               groups:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["65f12ca7a7720c194de6a011", "65f12ca7a7720c194de6a012"]
 *     responses:
 *       201:
 *         description: Student created
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Duplicate student
 */
router.post('/', allowPermissions('students:manage'), studentController.createStudent)

/**
 * @swagger
 * /api/students/{studentId}:
 *   patch:
 *     tags: [Students]
 *     summary: Update student
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
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
 *               fullname:
 *                 type: string
 *               studentPhone:
 *                 type: string
 *               parentPhone:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *               birthDate:
 *                 type: string
 *               note:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *               balance:
 *                 type: number
 *                 minimum: 0
 *               coinBalance:
 *                 type: number
 *                 minimum: 0
 *               groups:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["65f12ca7a7720c194de6a011", "65f12ca7a7720c194de6a012"]
 *     responses:
 *       200:
 *         description: Student updated
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Student not found
 *       409:
 *         description: Duplicate student phone
 */
router.patch('/:studentId', allowPermissions('students:manage'), studentController.updateStudent)

/**
 * @swagger
 * /api/students/{studentId}:
 *   delete:
 *     tags: [Students]
 *     summary: Delete student
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student deleted
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Student not found
 */
router.delete('/:studentId', allowPermissions('students:manage'), studentController.deleteStudent)

module.exports = router
