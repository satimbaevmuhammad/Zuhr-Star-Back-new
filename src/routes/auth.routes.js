const express = require('express')

const authController = require('../controllers/auth.controller')
const {
	requireAuth,
	allowPermissions,
	requireRegisterPermission,
} = require('../middleware/auth.middleware')
const { uploadAvatar } = require('../middleware/upload.middleware')

const router = express.Router()

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a user
 *     description: Register is protected. Only superadmin can create teacher/supporteacher/headteacher/admin. Employees cannot self-register.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - fullname
 *               - phone
 *               - email
 *               - dateOfBirth
 *               - gender
 *               - password
 *             properties:
 *               fullname:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               dateOfBirth:
 *                 type: string
 *                 example: 2000-10-20
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *               password:
 *                 type: string
 *                 minLength: 8
 *               role:
 *                 type: string
 *                 enum: [teacher, supporteacher, headteacher, admin]
 *               company:
 *                 type: string
 *               location:
 *                 type: string
 *                 example: '{"type":"Point","coordinates":[69.2401,41.2995]}'
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Registered successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Duplicate user
 */
router.post(
	'/register',
	uploadAvatar,
	requireRegisterPermission,
	authController.register,
)

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, password]
 *             properties:
 *               phone:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged in
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', authController.login)

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tokens refreshed
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh-token', authController.refreshToken)

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout current user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', requireAuth, authController.logout)

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 */
router.get('/me', requireAuth, authController.me)

/**
 * @swagger
 * /api/auth/users:
 *   get:
 *     tags: [Auth]
 *     summary: List users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *     responses:
 *       200:
 *         description: User list
 *       403:
 *         description: Forbidden
 */
router.get('/users', requireAuth, allowPermissions('users:read'), authController.listUsers)

/**
 * @swagger
 * /api/auth/users/{userId}/role:
 *   patch:
 *     tags: [Auth]
 *     summary: Update user role
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [teacher, supporteacher, headteacher, admin, superadmin]
 *     responses:
 *       200:
 *         description: Role updated successfully
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.patch(
	'/users/:userId/role',
	requireAuth,
	allowPermissions('users:manage_roles'),
	authController.updateUserRole,
)

module.exports = router
