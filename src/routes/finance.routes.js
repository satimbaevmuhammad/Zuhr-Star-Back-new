const express = require('express')
const financeController = require('../controllers/finance.controller')
const { requireAuth, allowPermissions, allowRoles } = require('../middleware/auth.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

router.use(requireAuth)

/**
 * @swagger
 * /api/finance/transactions:
 *   get:
 *     tags: [Finance]
 *     summary: List all employee finance transactions (bonuses and fines)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: string
 *         description: Filter by employee
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [bonus, fine]
 *         description: Filter by transaction type
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
 *         description: Paginated transaction list
 */
router.get('/transactions', allowPermissions('users:read'), financeController.listTransactions)

/**
 * @swagger
 * /api/finance/transactions/{transactionId}:
 *   delete:
 *     tags: [Finance]
 *     summary: Attempt to delete a finance transaction (transactions are immutable)
 *     description: Finance transactions are append-only and cannot be deleted. This endpoint always returns 405. Violation-linked transactions must be managed via DELETE /api/forbidden/violations/{violationId}.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       405:
 *         description: Transactions are immutable and cannot be deleted
 *       404:
 *         description: Transaction not found
 *       409:
 *         description: Transaction is linked to a violation
 */
router.delete(
	'/transactions/:transactionId',
	allowRoles('admin', 'superadmin'),
	validateObjectId('transactionId'),
	financeController.deleteTransaction,
)

/**
 * @swagger
 * /api/finance/employees:
 *   get:
 *     tags: [Finance]
 *     summary: List employees with finance info
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
 *         description: Search by fullname, phone, or email
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [teacher, supporteacher, headteacher, admin, superadmin]
 *         description: Filter by role
 *     responses:
 *       200:
 *         description: Paginated employee list
 */
router.get('/employees', allowPermissions('users:read'), financeController.listEmployees)

/**
 * @swagger
 * /api/finance/employees/{employeeId}:
 *   get:
 *     tags: [Finance]
 *     summary: Get finance summary for a specific employee
 *     description: Returns the employee's current balance, total bonuses, total fines, and their list of forbidden behavior violations.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Employee finance summary
 *       404:
 *         description: Employee not found
 */
router.get(
	'/employees/:employeeId',
	allowPermissions('users:read'),
	validateObjectId('employeeId'),
	financeController.getEmployeeFinanceSummary,
)

/**
 * @swagger
 * /api/finance/employees/{employeeId}/salary:
 *   patch:
 *     tags: [Finance]
 *     summary: Set base salary for an employee
 *     description: Sets the employee's base salary value directly (not a bonus/fine).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [salary]
 *             properties:
 *               salary:
 *                 type: number
 *                 minimum: 0
 *                 example: 3000000
 *     responses:
 *       200:
 *         description: Salary updated
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Employee not found
 */
router.patch(
	'/employees/:employeeId/salary',
	allowRoles('admin', 'superadmin'),
	validateObjectId('employeeId'),
	financeController.updateEmployeeSalary,
)

/**
 * @swagger
 * /api/finance/employees/{employeeId}/bonus:
 *   post:
 *     tags: [Finance]
 *     summary: Add a bonus to an employee
 *     description: Records a bonus transaction and increases the employee's finance balance.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, reason]
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 200000
 *               reason:
 *                 type: string
 *                 example: Excellent performance this month
 *     responses:
 *       201:
 *         description: Bonus added
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Employee not found
 */
router.post(
	'/employees/:employeeId/bonus',
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('employeeId'),
	financeController.addBonus,
)

/**
 * @swagger
 * /api/finance/employees/{employeeId}/fine:
 *   post:
 *     tags: [Finance]
 *     summary: Add a manual fine to an employee
 *     description: Records a fine transaction and decreases the employee's finance balance. For violation-linked fines, use POST /api/forbidden/violations instead.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: employeeId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount, reason]
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 50000
 *               reason:
 *                 type: string
 *                 example: Late to work 3 times this week
 *     responses:
 *       201:
 *         description: Fine added
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Employee not found
 */
router.post(
	'/employees/:employeeId/fine',
	allowRoles('admin', 'superadmin', 'headteacher'),
	validateObjectId('employeeId'),
	financeController.addFine,
)

module.exports = router
