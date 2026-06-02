const express = require('express')
const leadController = require('../controllers/lead.controller')
const { requireAuth } = require('../middleware/auth.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

/**
 * @swagger
 * /api/leads:
 *   get:
 *     tags: [Leads]
 *     summary: List leads
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, number, email, or username
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [INSTAGRAM, TELEGRAM, CALL_CENTER, WEBSITE, LANDING, FRIEND]
 *     responses:
 *       200:
 *         description: Lead list
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [Leads]
 *     summary: Create lead
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, source]
 *             properties:
 *               name:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [INSTAGRAM, TELEGRAM, CALL_CENTER, WEBSITE, LANDING, FRIEND]
 *               number:
 *                 type: string
 *               email:
 *                 type: string
 *               username:
 *                 type: string
 *               description:
 *                 type: string
 *               referral:
 *                 type: string
 *     responses:
 *       201:
 *         description: Lead created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.get('/', requireAuth, leadController.listLeads)
router.post('/', requireAuth, leadController.createLead)

/**
 * @swagger
 * /api/leads/{leadId}:
 *   get:
 *     tags: [Leads]
 *     summary: Get lead by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lead
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Leads]
 *     summary: Update lead
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               source:
 *                 type: string
 *                 enum: [INSTAGRAM, TELEGRAM, CALL_CENTER, WEBSITE, LANDING, FRIEND]
 *               number:
 *                 type: string
 *               email:
 *                 type: string
 *               username:
 *                 type: string
 *               description:
 *                 type: string
 *               referral:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [Leads]
 *     summary: Delete lead
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */
router.get('/:leadId', requireAuth, validateObjectId('leadId'), leadController.getLead)
router.patch('/:leadId', requireAuth, validateObjectId('leadId'), leadController.updateLead)
router.delete('/:leadId', requireAuth, validateObjectId('leadId'), leadController.deleteLead)

module.exports = router
