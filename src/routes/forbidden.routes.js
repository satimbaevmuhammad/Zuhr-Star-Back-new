const express = require('express')
const forbiddenController = require('../controllers/forbidden.controller')
const { requireAuth, allowPermissions, allowRoles } = require('../middleware/auth.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

router.use(requireAuth)

// ─── FORBIDDEN RULES ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/forbidden/rules:
 *   get:
 *     tags: [Forbidden]
 *     summary: List all forbidden behavior rules
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of forbidden rules
 *   post:
 *     tags: [Forbidden]
 *     summary: Create a forbidden behavior rule (e.g. smoking)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Smoking
 *               description:
 *                 type: string
 *                 example: Employee caught smoking on school grounds
 *               defaultFineAmount:
 *                 type: number
 *                 example: 50000
 *                 description: Default fine charged when this rule is violated
 *     responses:
 *       201:
 *         description: Rule created
 *       400:
 *         description: Validation failed
 *       409:
 *         description: Rule name already exists
 */
router.get('/rules', allowPermissions('users:read'), forbiddenController.listRules)
router.post('/rules', allowRoles('admin', 'superadmin'), forbiddenController.createRule)

/**
 * @swagger
 * /api/forbidden/rules/{ruleId}:
 *   patch:
 *     tags: [Forbidden]
 *     summary: Update a forbidden behavior rule
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               defaultFineAmount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Rule updated
 *       404:
 *         description: Rule not found
 *   delete:
 *     tags: [Forbidden]
 *     summary: Delete a forbidden behavior rule
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rule deleted
 *       404:
 *         description: Rule not found
 */
router.patch(
	'/rules/:ruleId',
	allowRoles('admin', 'superadmin'),
	validateObjectId('ruleId'),
	forbiddenController.updateRule,
)
router.delete(
	'/rules/:ruleId',
	allowRoles('admin', 'superadmin'),
	validateObjectId('ruleId'),
	forbiddenController.deleteRule,
)

// ─── VIOLATIONS ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/forbidden/violations:
 *   get:
 *     tags: [Forbidden]
 *     summary: List employee violations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: string
 *         description: Filter by employee
 *       - in: query
 *         name: ruleId
 *         schema:
 *           type: string
 *         description: Filter by rule
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
 *         description: Violations list
 *   post:
 *     tags: [Forbidden]
 *     summary: Record a violation against an employee
 *     description: |
 *       Records a forbidden behavior violation (e.g. smoking). Automatically:
 *       - Adds the rule to the employee's `forbidens` array
 *       - Creates a fine finance transaction if the rule has a fine amount
 *       - Reduces the employee's finance balance
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [employeeId, ruleId]
 *             properties:
 *               employeeId:
 *                 type: string
 *                 example: 65f12ca7a7720c194de6a095
 *               ruleId:
 *                 type: string
 *                 example: 65f12ca7a7720c194de6b100
 *               fineAmount:
 *                 type: number
 *                 description: Override the rule's default fine amount
 *                 example: 75000
 *               note:
 *                 type: string
 *                 example: Caught smoking near the front entrance
 *     responses:
 *       201:
 *         description: Violation recorded and fine applied
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Employee or rule not found
 */
router.get('/violations', allowPermissions('users:read'), forbiddenController.listViolations)
router.post(
	'/violations',
	allowRoles('admin', 'superadmin', 'headteacher'),
	forbiddenController.recordViolation,
)

/**
 * @swagger
 * /api/forbidden/violations/{violationId}:
 *   delete:
 *     tags: [Forbidden]
 *     summary: Delete a violation and reverse the fine
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: violationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Violation deleted and fine reversed
 *       404:
 *         description: Violation not found
 */
router.delete(
	'/violations/:violationId',
	allowRoles('admin', 'superadmin'),
	validateObjectId('violationId'),
	forbiddenController.deleteViolation,
)

module.exports = router
