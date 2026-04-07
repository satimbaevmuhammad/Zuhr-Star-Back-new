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
 *     summary: List all finance transactions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: employeeId
 *         schema:
 *           type: string
 *         description: Filter by employee
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *         description: Filter by student
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [salary, salary_update, bonus, fine, student_payment]
 *         description: Filter by transaction type
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2025-04"
 *         description: Filter by month (YYYY-MM)
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
router.get('/transactions', allowRoles('teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'), financeController.listTransactions)

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
 *         name: month
 *         schema:
 *           type: string
 *           example: "2025-04"
 *         description: Filter finance summary to a single month (YYYY-MM)
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
router.get('/employees', allowRoles('teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'), financeController.listEmployees)

/**
 * @swagger
 * /api/finance/employees/{employeeId}:
 *   get:
 *     tags: [Finance]
 *     summary: Get per-month finance history for a specific employee
 *     description: Returns the employee's finance breakdown grouped by month (salary, bonuses, fines, net per month), sorted by month descending.
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
 *         description: Employee monthly finance history
 *       404:
 *         description: Employee not found
 */
router.get(
	'/employees/:employeeId',
	allowRoles('teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'),
	validateObjectId('employeeId'),
	financeController.getEmployeeFinanceSummary,
)

/**
 * @swagger
 * /api/finance/employees/{employeeId}/bonuses:
 *   get:
 *     tags: [Finance]
 *     summary: List all bonus events for an employee
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
 *         description: Bonus event list sorted by month descending
 *       404:
 *         description: Employee not found
 */
router.get(
	'/employees/:employeeId/bonuses',
	allowRoles('teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'),
	validateObjectId('employeeId'),
	financeController.getEmployeeBonuses,
)

/**
 * @swagger
 * /api/finance/employees/{employeeId}/fines:
 *   get:
 *     tags: [Finance]
 *     summary: List all fine events for an employee
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
 *         description: Fine event list sorted by month descending
 *       404:
 *         description: Employee not found
 */
router.get(
	'/employees/:employeeId/fines',
	allowRoles('teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'),
	validateObjectId('employeeId'),
	financeController.getEmployeeFines,
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
 *               month:
 *                 type: string
 *                 example: "2025-04"
 *                 description: Target month (YYYY-MM). Defaults to current month.
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
 *               month:
 *                 type: string
 *                 example: "2025-04"
 *                 description: Target month (YYYY-MM). Defaults to current month.
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
 *               month:
 *                 type: string
 *                 example: "2025-04"
 *                 description: Target month (YYYY-MM). Defaults to current month.
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

/**
 * @swagger
 * /api/finance/students/payments:
 *   get:
 *     tags: [Finance]
 *     summary: List all student payment events
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           example: "2025-04"
 *         description: Filter by month (YYYY-MM)
 *       - in: query
 *         name: groupId
 *         schema:
 *           type: string
 *         description: Filter by group
 *     responses:
 *       200:
 *         description: Student payment list
 */
router.get('/students/payments', allowRoles('teacher', 'supporteacher', 'headteacher', 'admin', 'superadmin'), financeController.listStudentPayments)

/**
 * @swagger
 * /api/finance/students/{studentId}/payment:
 *   post:
 *     tags: [Finance]
 *     summary: Record a payment for a student
 *     description: Creates a student_payment event and increments the student's balance.
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
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 minimum: 0.01
 *                 example: 500000
 *               month:
 *                 type: string
 *                 example: "2025-04"
 *                 description: Target month (YYYY-MM). Defaults to current month.
 *               groupId:
 *                 type: string
 *                 description: Optional group the payment is for
 *               note:
 *                 type: string
 *                 example: Monthly tuition fee
 *     responses:
 *       201:
 *         description: Payment recorded
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Student not found
 */
router.post(
	'/students/:studentId/payment',
	validateObjectId('studentId'),
	financeController.addStudentPayment,
)

/**
 * @swagger
 * /api/finance/students/{studentId}/payments:
 *   get:
 *     tags: [Finance]
 *     summary: List all payment events for a student
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
 *         description: Student payment history sorted by month descending
 *       404:
 *         description: Student not found
 */
router.get(
	'/students/:studentId/payments',
	validateObjectId('studentId'),
	financeController.getStudentPayments,
)

module.exports = router
