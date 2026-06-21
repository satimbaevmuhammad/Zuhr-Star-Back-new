const express = require('express')

const googleController = require('../controllers/google.controller')
const { requireAuth } = require('../middleware/auth.middleware')

const router = express.Router()

/**
 * @swagger
 * /api/google/connect:
 *   get:
 *     tags: [GoogleMeet]
 *     summary: Get the Google sign-in URL for the logged-in teacher
 *     description: |
 *       Returns a Google OAuth consent URL. Open it in a browser (e.g.
 *       `window.location.href = url` or a popup). After the teacher grants
 *       Calendar access, Google redirects to `/api/google/oauth-callback`,
 *       which stores a refresh token on their account so the backend can
 *       create Google Meet rooms on their behalf without asking again.
 *
 *       Who can use it: any authenticated employee (teacher, support
 *       teacher, headteacher, admin, superadmin).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent URL
 *         content:
 *           application/json:
 *             example:
 *               url: https://accounts.google.com/o/oauth2/v2/auth?client_id=...
 *       401:
 *         description: Token missing or invalid
 *       503:
 *         description: Google OAuth is not configured on the server
 */
router.get('/connect', requireAuth, googleController.getConnectUrl)

/**
 * @swagger
 * /api/google/oauth-callback:
 *   get:
 *     tags: [GoogleMeet]
 *     summary: Google OAuth redirect target (Google calls this, not the frontend)
 *     description: |
 *       Google redirects the teacher's browser here after consent with
 *       `code` and `state` query params. Exchanges the code for tokens,
 *       saves them on the teacher's account, then either redirects to
 *       `GOOGLE_CONNECT_SUCCESS_URL` / `GOOGLE_CONNECT_ERROR_URL` (if
 *       configured) or shows a simple confirmation page.
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: HTML confirmation page
 *       302:
 *         description: Redirect to the configured frontend success/error page
 */
router.get('/oauth-callback', googleController.oauthCallback)

/**
 * @swagger
 * /api/google/status:
 *   get:
 *     tags: [GoogleMeet]
 *     summary: Check whether the logged-in teacher has connected Google
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connection status
 *         content:
 *           application/json:
 *             example:
 *               connected: true
 *               email: teacher@gmail.com
 *               connectedAt: 2026-06-01T10:00:00.000Z
 */
router.get('/status', requireAuth, googleController.getStatus)

/**
 * @swagger
 * /api/google/disconnect:
 *   delete:
 *     tags: [GoogleMeet]
 *     summary: Disconnect the teacher's Google account
 *     description: Revokes the stored token with Google and clears it from the teacher's account. Existing Meet links already created stay on Google Calendar until ended.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Disconnected
 */
router.delete('/disconnect', requireAuth, googleController.disconnect)

module.exports = router
