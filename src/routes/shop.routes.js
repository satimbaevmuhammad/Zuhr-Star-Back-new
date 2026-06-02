const express = require('express')

const shopController = require('../controllers/shop.controller')
const {
	requireAnyAuth,
	requireStudentAuth,
	allowRoles,
} = require('../middleware/auth.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

// All routes require authentication
router.use(requireAnyAuth)

/**
 * @swagger
 * /api/shop/items:
 *   post:
 *     tags: [Shop]
 *     summary: Create a new shop item
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShopItemCreateInput'
 *     responses:
 *       201:
 *         description: Shop item created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Shop item created successfully
 *                 item:
 *                   $ref: '#/components/schemas/ShopItem'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.post('/items', allowRoles('admin', 'headteacher', 'superadmin'), shopController.createShopItem)

/**
 * @swagger
 * /api/shop/items:
 *   get:
 *     tags: [Shop]
 *     summary: List shop items with optional filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: List of shop items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ShopItem'
 *                 count:
 *                   type: integer
 *                   example: 10
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get('/items', allowRoles('teacher', 'headteacher', 'admin', 'superadmin'), shopController.listShopItems)

/**
 * @swagger
 * /api/shop/items/{id}:
 *   get:
 *     tags: [Shop]
 *     summary: Get a specific shop item by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Shop item ID
 *     responses:
 *       200:
 *         description: Shop item details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 item:
 *                   $ref: '#/components/schemas/ShopItem'
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Shop item not found
 */
router.get('/items/:id', allowRoles('teacher', 'headteacher', 'admin', 'superadmin'), validateObjectId('id'), shopController.getShopItemById)

/**
 * @swagger
 * /api/shop/items/{id}:
 *   patch:
 *     tags: [Shop]
 *     summary: Update a shop item
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Shop item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShopItemUpdateInput'
 *     responses:
 *       200:
 *         description: Shop item updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Shop item updated successfully
 *                 item:
 *                   $ref: '#/components/schemas/ShopItem'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Shop item not found
 */
router.patch('/items/:id', allowRoles('admin', 'headteacher', 'superadmin'), validateObjectId('id'), shopController.updateShopItem)

/**
 * @swagger
 * /api/shop/items/{id}:
 *   delete:
 *     tags: [Shop]
 *     summary: Soft delete a shop item (set inactive)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Shop item ID
 *     responses:
 *       200:
 *         description: Shop item deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Shop item deleted successfully
 *                 item:
 *                   $ref: '#/components/schemas/ShopItem'
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Shop item not found
 */
router.delete('/items/:id', allowRoles('admin', 'headteacher', 'superadmin'), validateObjectId('id'), shopController.deleteShopItem)

/**
 * @swagger
 * /api/shop:
 *   get:
 *     tags: [Shop]
 *     summary: List active shop items for students
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200:
 *         description: List of active shop items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ShopItem'
 *                 count:
 *                   type: integer
 *                   example: 8
 */
router.get('/', requireStudentAuth, shopController.listActiveShopItems)

/**
 * @swagger
 * /api/shop/buy:
 *   post:
 *     tags: [Shop]
 *     summary: Purchase a shop item
 *     security:
 *       - studentBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PurchaseBuyInput'
 *     responses:
 *       201:
 *         description: Purchase successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Purchase successful
 *                 purchase:
 *                   $ref: '#/components/schemas/Purchase'
 *       400:
 *         description: Insufficient coins, out of stock, or validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   enum: [INSUFFICIENT_COINS, OUT_OF_STOCK]
 *       404:
 *         description: Item not found
 */
router.post('/buy', requireStudentAuth, shopController.purchaseItem)

/**
 * @swagger
 * /api/shop/purchases:
 *   get:
 *     tags: [Shop]
 *     summary: List all purchases with optional filters
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, delivered, cancelled]
 *         description: Filter by purchase status
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *         description: Filter by student ID
 *     responses:
 *       200:
 *         description: List of purchases
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 purchases:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Purchase'
 *                 count:
 *                   type: integer
 *                   example: 25
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get('/purchases', allowRoles('admin', 'headteacher', 'superadmin'), shopController.listPurchases)

/**
 * @swagger
 * /api/shop/purchases/{id}:
 *   get:
 *     tags: [Shop]
 *     summary: Get a specific purchase by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Purchase ID
 *     responses:
 *       200:
 *         description: Purchase details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 purchase:
 *                   $ref: '#/components/schemas/Purchase'
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Purchase not found
 */
router.get('/purchases/:id', allowRoles('admin', 'headteacher', 'superadmin'), validateObjectId('id'), shopController.getPurchaseById)

/**
 * @swagger
 * /api/shop/purchases/{id}/deliver:
 *   patch:
 *     tags: [Shop]
 *     summary: Mark a purchase as delivered
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Purchase ID
 *     responses:
 *       200:
 *         description: Purchase marked as delivered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Purchase marked as delivered
 *                 purchase:
 *                   $ref: '#/components/schemas/Purchase'
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Purchase not found
 *       409:
 *         description: Purchase already resolved
 */
router.patch('/purchases/:id/deliver', allowRoles('admin', 'headteacher', 'superadmin'), validateObjectId('id'), shopController.deliverPurchase)

/**
 * @swagger
 * /api/shop/purchases/{id}/cancel:
 *   patch:
 *     tags: [Shop]
 *     summary: Cancel a purchase and refund coins
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Purchase ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PurchaseCancelInput'
 *     responses:
 *       200:
 *         description: Purchase cancelled and coins refunded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Purchase cancelled and coins refunded
 *                 purchase:
 *                   $ref: '#/components/schemas/Purchase'
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden - insufficient permissions
 *       404:
 *         description: Purchase not found
 *       409:
 *         description: Purchase already resolved
 */
router.patch('/purchases/:id/cancel', allowRoles('admin', 'headteacher', 'superadmin'), validateObjectId('id'), shopController.cancelPurchase)

/**
 * @swagger
 * /api/shop/my-purchases:
 *   get:
 *     tags: [Shop]
 *     summary: Get student's own purchase history
 *     security:
 *       - studentBearerAuth: []
 *     responses:
 *       200:
 *         description: Student's purchase history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 purchases:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Purchase'
 *                 count:
 *                   type: integer
 *                   example: 5
 */
router.get('/my-purchases', requireStudentAuth, shopController.getMyPurchases)

module.exports = router