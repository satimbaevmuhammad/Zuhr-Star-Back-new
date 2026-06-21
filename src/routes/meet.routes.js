const express = require('express')

const meetController = require('../controllers/meet.controller')
const { allowPermissions, allowPermissionsOrStudent } = require('../middleware/auth.middleware')

// mergeParams so :groupId from the parent router (group.routes.js) is visible here.
const router = express.Router({ mergeParams: true })

/**
 * @swagger
 * /api/groups/{groupId}/meet:
 *   post:
 *     tags: [GoogleMeet]
 *     summary: Create a Google Meet room for a group
 *     description: |
 *       Creates a Google Calendar event with an attached Google Meet link
 *       using the acting teacher's connected Google account, and links it
 *       to the group so every enrolled student can see the join link.
 *
 *       The teacher must connect their Google account first via
 *       `GET /api/google/connect`. The Meet link does not expire with
 *       startTime/endTime — it stays valid for every lesson until ended.
 *
 *       Who can use it: any employee with the `groups:manage` permission
 *       (teacher, headteacher, admin, superadmin).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: Algebra 101 - Live lesson
 *               description:
 *                 type: string
 *               startTime:
 *                 type: string
 *                 format: date-time
 *               durationMinutes:
 *                 type: integer
 *                 minimum: 15
 *                 maximum: 300
 *                 default: 60
 *           example:
 *             title: Algebra 101 - Live lesson
 *             durationMinutes: 60
 *     responses:
 *       201:
 *         description: Google Meet created and linked to the group
 *         content:
 *           application/json:
 *             example:
 *               googleMeet:
 *                 status: scheduled
 *                 meetLink: https://meet.google.com/abc-defg-hij
 *                 htmlLink: https://www.google.com/calendar/event?eid=...
 *                 summary: Algebra 101 - Live lesson
 *                 startTime: 2026-06-20T10:00:00.000Z
 *                 endTime: 2026-06-20T11:00:00.000Z
 *                 createdByName: Mr. Ahmed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Group not found
 *       409:
 *         description: Google account not connected, or a meeting already exists for this group
 *   get:
 *     tags: [GoogleMeet]
 *     summary: Get the current Google Meet for a group
 *     description: Returns the active/ended Meet link, or `null` if one has never been created. Visible to staff and to students enrolled in the group.
 *     security:
 *       - bearerAuth: []
 *       - studentBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current meeting info (or null)
 *       404:
 *         description: Group not found
 *   delete:
 *     tags: [GoogleMeet]
 *     summary: End the group's current Google Meet
 *     description: Deletes the backing Calendar event (removing the Meet link) and marks the meeting ended for the group.
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
 *         description: Meeting ended
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Group or active meeting not found
 */
router.post('/', allowPermissions('groups:manage'), meetController.createGroupMeeting)
router.get('/', allowPermissionsOrStudent('groups:read'), meetController.getGroupMeeting)
router.delete('/', allowPermissions('groups:manage'), meetController.endGroupMeeting)

module.exports = router
