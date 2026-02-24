const express = require('express')
const groupController = require('../controllers/group.controller')
const { requireAuth, allowPermissions } = require('../middleware/auth.middleware')

const router = express.Router()

router.use(requireAuth)

/**
 * @swagger
 * /api/groups:
 *   get:
 *     tags: [Groups]
 *     summary: List groups
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [planned, active, paused, completed, archived]
 *     responses:
 *       200:
 *         description: Paginated group list
 *       403:
 *         description: Forbidden
 *   post:
 *     tags: [Groups]
 *     summary: Create group
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupCreateInput'
 *     responses:
 *       201:
 *         description: Group created
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Duplicate group
 */
router.get('/', allowPermissions('groups:read'), groupController.getGroups)
router.post('/', allowPermissions('groups:manage'), groupController.createGroup)

/**
 * @swagger
 * /api/groups/{groupId}:
 *   get:
 *     tags: [Groups]
 *     summary: Get group by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group details
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Group not found
 *   patch:
 *     tags: [Groups]
 *     summary: Update group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupUpdateInput'
 *     responses:
 *       200:
 *         description: Group updated
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Group not found
 *   delete:
 *     tags: [Groups]
 *     summary: Delete group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group deleted
 *       400:
 *         description: Invalid id
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Group not found
 */
router.get('/:groupId', allowPermissions('groups:read'), groupController.getGroupById)
router.patch('/:groupId', allowPermissions('groups:manage'), groupController.updateGroup)
router.delete('/:groupId', allowPermissions('groups:manage'), groupController.deleteGroup)

/**
 * @swagger
 * /api/groups/{groupId}/students:
 *   get:
 *     tags: [Groups]
 *     summary: List students attached to a group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: membershipStatus
 *         schema:
 *           type: string
 *           enum: [active, paused, completed, left]
 *     responses:
 *       200:
 *         description: Group students list
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Group not found
 */
router.get(
	'/:groupId/students',
	allowPermissions('groups:read', 'students:read'),
	groupController.getGroupStudents,
)

/**
 * @swagger
 * /api/groups/{groupId}/students/{studentId}:
 *   post:
 *     tags: [Groups]
 *     summary: Attach or update student membership in a group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupMembershipInput'
 *     responses:
 *       200:
 *         description: Membership updated
 *       201:
 *         description: Membership created
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Student or group not found
 *       409:
 *         description: Group capacity reached
 *   delete:
 *     tags: [Groups]
 *     summary: Detach student from a group
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
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
 *         description: Membership removed
 *       400:
 *         description: Invalid id
 *       404:
 *         description: Group, student, or membership not found
 */
router.post(
	'/:groupId/students/:studentId',
	allowPermissions('groups:manage'),
	groupController.attachStudentToGroup,
)
router.delete(
	'/:groupId/students/:studentId',
	allowPermissions('groups:manage'),
	groupController.detachStudentFromGroup,
)

/**
 * @swagger
 * /api/groups/{groupId}/attendance:
 *   post:
 *     tags: [Groups]
 *     summary: Create or update group attendance for a date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, records]
 *             properties:
 *               date:
 *                 type: string
 *                 format: date-time
 *               records:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/GroupAttendanceRecordInput'
 *     responses:
 *       200:
 *         description: Attendance updated
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Group not found
 */
router.post(
	'/:groupId/attendance',
	allowPermissions('groups:manage'),
	groupController.upsertGroupAttendance,
)

module.exports = router

