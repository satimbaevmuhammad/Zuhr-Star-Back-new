const express = require('express')

const authController = require('../controllers/auth.controller')
const {
	requireAuth,
	allowPermissions,
	allowRoles,
	requireRegisterPermission,
} = require('../middleware/auth.middleware')
const { uploadAvatar } = require('../middleware/upload.middleware')
const validateObjectId = require('../middleware/validateObjectId')

const router = express.Router()

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a user
 *     description: Protected. Only superadmin can create employees (teacher/supporteacher/headteacher/admin). Returns the created user. To set Face ID at creation time, include faceDescriptor in the body.
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
 *               salary:
 *                 type: number
 *                 minimum: 0
 *                 example: 3000000
 *               location:
 *                 type: string
 *                 example: '{"type":"Point","coordinates":[69.2401,41.2995]}'
 *               faceDescriptor:
 *                 type: array
 *                 minItems: 128
 *                 maxItems: 128
 *                 description: Optional Face ID descriptor. Also accepted as "descriptor" in JSON.
 *                 items:
 *                   type: number
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
 * /api/auth/login/face:
 *   post:
 *     tags: [Auth]
 *     summary: Login using Face ID descriptor
 *     description: Swagger UI cannot open webcam and generate descriptor automatically. Use /face-id-demo for camera-based testing.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [descriptor]
 *             properties:
 *               descriptor:
 *                 type: array
 *                 minItems: 128
 *                 maxItems: 128
 *                 items:
 *                   type: number
 *               threshold:
 *                 type: number
 *                 description: Optional override for match threshold. Lower means stricter.
 *                 example: 0.45
 *     responses:
 *       200:
 *         description: Logged in by face
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Face not recognized
 */
router.post('/login/face', authController.loginWithFaceId)

/**
 * @swagger
 * /api/auth/face:
 *   patch:
 *     tags: [Auth]
 *     summary: Register or update Face ID for current user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [descriptor]
 *             properties:
 *               descriptor:
 *                 type: array
 *                 minItems: 128
 *                 maxItems: 128
 *                 items:
 *                   type: number
 *     responses:
 *       200:
 *         description: Face ID registered
 *       400:
 *         description: Invalid descriptor
 *       401:
 *         description: Unauthorized
 *   delete:
 *     tags: [Auth]
 *     summary: Remove current user's Face ID
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Face ID removed
 *       401:
 *         description: Unauthorized
 */
router.patch('/face', requireAuth, authController.updateFaceId)
router.delete('/face', requireAuth, authController.removeFaceId)

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
 *         description: Search by fullname, phone, or email
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [teacher, supporteacher, headteacher, admin, superadmin]
 *     responses:
 *       200:
 *         description: User list
 *       403:
 *         description: Forbidden
 */
router.get('/users', requireAuth, allowPermissions('users:read'), authController.listUsers)

router.get(
	'/roles',
	requireAuth,
	allowRoles('superadmin'),
	authController.listRoles,
)

router.patch(
	'/roles/:roleId',
	requireAuth,
	allowRoles('superadmin'),
	validateObjectId('roleId'),
	authController.updateRolePermissions,
)

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
	validateObjectId('userId'),
	authController.updateUserRole,
)

/**
 * @swagger
 * /api/auth/users/{userId}:
 *   patch:
 *     tags: [Auth]
 *     summary: Update user profile
 *     description: Authenticated users can only update their own profile.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               fullname:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *               gender:
 *                 type: string
 *                 enum: [male, female]
 *               company:
 *                 type: string
 *               location:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 8
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       409:
 *         description: Duplicate phone or email
 */
router.patch(
	'/users/:userId',
	uploadAvatar,
	requireAuth,
	validateObjectId('userId'),
	authController.updateUser,
)

/**
 * @swagger
 * /api/auth/users/{userId}:
 *   delete:
 *     tags: [Auth]
 *     summary: Delete user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 *       409:
 *         description: User has linked groups
 */
router.delete(
	'/users/:userId',
	requireAuth,
	allowPermissions('users:manage'),
	validateObjectId('userId'),
	authController.deleteUser,
)

module.exports = router
