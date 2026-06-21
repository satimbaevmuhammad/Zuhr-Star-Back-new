const jwt = require('jsonwebtoken')

const User = require('../model/user.model')
const googleCalendarService = require('../services/google-calendar.service')

const STATE_AUDIENCE = 'google-oauth-state'
const STATE_EXPIRES_IN = '15m'

const resolveJwtSecret = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET

const signState = userId => {
	const secret = resolveJwtSecret()
	if (!secret) {
		throw new Error('JWT_SECRET is required to start the Google OAuth flow')
	}
	return jwt.sign({ sub: String(userId), aud: STATE_AUDIENCE }, secret, { expiresIn: STATE_EXPIRES_IN })
}

const verifyState = state => {
	const secret = resolveJwtSecret()
	const payload = jwt.verify(state, secret, { audience: STATE_AUDIENCE })
	return String(payload.sub || '')
}

const resolveFrontendRedirect = outcome => {
	const successUrl = String(process.env.GOOGLE_CONNECT_SUCCESS_URL || '').trim()
	const errorUrl = String(process.env.GOOGLE_CONNECT_ERROR_URL || '').trim()
	if (outcome === 'success' && successUrl) {
		return successUrl
	}
	if (outcome === 'error' && errorUrl) {
		return errorUrl
	}
	return null
}

const renderResultPage = (res, { ok, title, message }) => {
	return res.status(ok ? 200 : 400).send(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>${title}</title>
</head>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; background:#f5f5f5;">
	<div style="text-align:center; padding:32px; background:#fff; border-radius:12px; box-shadow:0 2px 12px rgba(0,0,0,0.08); max-width:420px;">
		<h2 style="color:${ok ? '#1a73e8' : '#d93025'}; margin:0 0 12px;">${title}</h2>
		<p style="color:#444; margin:0 0 16px;">${message}</p>
		<p style="color:#888; font-size:13px; margin:0;">You can close this tab and return to the app.</p>
	</div>
</body>
</html>`)
}

/**
 * GET /api/google/connect (employee auth required)
 * Returns the Google consent URL the teacher's browser should open.
 */
exports.getConnectUrl = async (req, res) => {
	try {
		const state = signState(req.user.id)
		const url = googleCalendarService.buildAuthUrl(state)
		return res.status(200).json({ url })
	} catch (error) {
		if (error.code === 'GOOGLE_NOT_CONFIGURED') {
			return res.status(503).json({ message: error.message, code: 'GOOGLE_NOT_CONFIGURED' })
		}
		console.error('Build Google connect URL failed:', error)
		return res.status(500).json({ message: 'Failed to start Google connect flow', code: 'INTERNAL_SERVER_ERROR' })
	}
}

/**
 * GET /api/google/oauth-callback (no auth header — Google redirects the
 * teacher's browser here directly). Exchanges the code for tokens and
 * stores them on the teacher's account.
 */
exports.oauthCallback = async (req, res) => {
	const { code, state, error: googleError } = req.query

	if (googleError) {
		const redirect = resolveFrontendRedirect('error')
		if (redirect) {
			return res.redirect(`${redirect}?status=error&reason=${encodeURIComponent(String(googleError))}`)
		}
		return renderResultPage(res, {
			ok: false,
			title: 'Google connection cancelled',
			message: 'The Google sign-in was cancelled or denied. You can try connecting again from the app.',
		})
	}

	if (!code || !state) {
		return renderResultPage(res, {
			ok: false,
			title: 'Invalid request',
			message: 'Missing authorization code or state from Google.',
		})
	}

	try {
		const userId = verifyState(String(state))
		const user = await User.findById(userId)
		if (!user) {
			return renderResultPage(res, {
				ok: false,
				title: 'Account not found',
				message: 'We could not match this Google connection to a teacher account.',
			})
		}

		const { tokens, profile } = await googleCalendarService.exchangeCodeForTokens(String(code))
		if (!tokens.refresh_token) {
			// Google only issues a refresh_token on the first consent (or when we
			// force prompt=consent, which we always do). If it is still missing,
			// surface a clear "try again" message instead of silently failing later.
			const redirect = resolveFrontendRedirect('error')
			if (redirect) {
				return res.redirect(`${redirect}?status=error&reason=no_refresh_token`)
			}
			return renderResultPage(res, {
				ok: false,
				title: 'Reconnect required',
				message: 'Google did not grant offline access. Please try connecting your Google account again.',
			})
		}

		user.googleAccount = {
			connected: true,
			googleId: profile.id || null,
			email: profile.email || null,
			refreshToken: tokens.refresh_token,
			accessToken: tokens.access_token || null,
			accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
			scope: tokens.scope || null,
			connectedAt: new Date(),
		}
		await user.save({ validateBeforeSave: false })

		const redirect = resolveFrontendRedirect('success')
		if (redirect) {
			return res.redirect(`${redirect}?status=success`)
		}
		return renderResultPage(res, {
			ok: true,
			title: 'Google account connected',
			message: `Connected as ${profile.email || 'your Google account'}. You can now create Google Meet rooms for your groups.`,
		})
	} catch (error) {
		console.error('Google OAuth callback failed:', error)
		const redirect = resolveFrontendRedirect('error')
		if (redirect) {
			return res.redirect(`${redirect}?status=error`)
		}
		return renderResultPage(res, {
			ok: false,
			title: 'Connection failed',
			message: 'Something went wrong while connecting your Google account. Please try again.',
		})
	}
}

/**
 * GET /api/google/status (employee auth required)
 */
exports.getStatus = async (req, res) => {
	try {
		const user = req.userDocument || (await User.findById(req.user.id))
		return res.status(200).json({
			connected: Boolean(user?.googleAccount?.connected),
			email: user?.googleAccount?.email || null,
			connectedAt: user?.googleAccount?.connectedAt || null,
		})
	} catch (error) {
		console.error('Get Google account status failed:', error)
		return res.status(500).json({ message: 'Failed to load Google account status', code: 'INTERNAL_SERVER_ERROR' })
	}
}

/**
 * DELETE /api/google/disconnect (employee auth required)
 */
exports.disconnect = async (req, res) => {
	try {
		const user = await User.findById(req.user.id).select('+googleAccount.refreshToken')
		if (!user) {
			return res.status(404).json({ message: 'User not found', code: 'NOT_FOUND' })
		}

		await googleCalendarService.revokeUserToken(user)

		user.googleAccount = {
			connected: false,
			googleId: null,
			email: null,
			refreshToken: null,
			accessToken: null,
			accessTokenExpiresAt: null,
			scope: null,
			connectedAt: null,
		}
		await user.save({ validateBeforeSave: false })

		return res.status(200).json({ message: 'Google account disconnected', code: 'GOOGLE_DISCONNECTED' })
	} catch (error) {
		console.error('Disconnect Google account failed:', error)
		return res.status(500).json({ message: 'Failed to disconnect Google account', code: 'INTERNAL_SERVER_ERROR' })
	}
}
