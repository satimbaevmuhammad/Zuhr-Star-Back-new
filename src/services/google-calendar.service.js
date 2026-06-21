/**
 * Google Calendar / Google Meet integration service.
 *
 * A teacher connects their own Google account once (offline access, see
 * google.controller.js). We store their refresh token and use it to create
 * a Calendar event with an attached Google Meet link ("conferenceData")
 * whenever they start a meeting for one of their groups. Deleting that
 * Calendar event later invalidates the Meet link, which is how "ending" a
 * meeting works.
 */

const crypto = require('crypto')
const { google } = require('googleapis')

const User = require('../model/user.model')

const SCOPES = [
	'https://www.googleapis.com/auth/calendar.events',
	'https://www.googleapis.com/auth/userinfo.email',
	'openid',
]

const DEFAULT_TIMEZONE = 'Asia/Tashkent'

const getRedirectUri = () => {
	const configured = String(process.env.GOOGLE_REDIRECT_URI || '').trim()
	if (configured) {
		return configured
	}

	const port = process.env.PORT || 3000
	return `http://localhost:${port}/api/google/oauth-callback`
}

const ensureGoogleEnv = () => {
	const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
	const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim()
	if (!clientId || !clientSecret) {
		const error = new Error(
			'Google OAuth is not configured on the server (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)',
		)
		error.code = 'GOOGLE_NOT_CONFIGURED'
		throw error
	}

	return { clientId, clientSecret }
}

const createOAuthClient = () => {
	const { clientId, clientSecret } = ensureGoogleEnv()
	return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri())
}

/**
 * Builds the Google consent screen URL. `state` should be an opaque,
 * signed value (see google.controller.js) so the callback can be tied back
 * to the teacher who started the flow without relying on cookies/sessions.
 */
const buildAuthUrl = state => {
	const client = createOAuthClient()
	return client.generateAuthUrl({
		access_type: 'offline',
		// Force the consent screen every time so Google always re-issues a
		// refresh_token, even if the teacher connected before and revoked it
		// outside of our app.
		prompt: 'consent',
		scope: SCOPES,
		state,
		include_granted_scopes: true,
	})
}

const exchangeCodeForTokens = async code => {
	const client = createOAuthClient()
	const { tokens } = await client.getToken(code)
	client.setCredentials(tokens)

	const oauth2 = google.oauth2({ auth: client, version: 'v2' })
	const { data: profile } = await oauth2.userinfo.get()

	return { tokens, profile }
}

const persistRotatedTokens = async (userId, tokens) => {
	const update = {}
	if (tokens.access_token) {
		update['googleAccount.accessToken'] = tokens.access_token
	}
	if (tokens.expiry_date) {
		update['googleAccount.accessTokenExpiresAt'] = new Date(tokens.expiry_date)
	}
	if (tokens.refresh_token) {
		update['googleAccount.refreshToken'] = tokens.refresh_token
	}

	if (Object.keys(update).length === 0) {
		return
	}

	await User.updateOne({ _id: userId }, { $set: update })
}

/**
 * Returns an OAuth2 client authorized for API calls on behalf of `user`,
 * using their stored refresh token. Requires `user.googleAccount.refreshToken`
 * to have been loaded (select('+googleAccount.refreshToken')).
 */
const getAuthorizedClientForUser = async user => {
	const refreshToken = user?.googleAccount?.refreshToken
	if (!refreshToken) {
		const error = new Error('Google account is not connected for this user')
		error.code = 'GOOGLE_ACCOUNT_NOT_CONNECTED'
		throw error
	}

	const client = createOAuthClient()
	client.setCredentials({ refresh_token: refreshToken })

	client.on('tokens', tokens => {
		persistRotatedTokens(user._id, tokens).catch(persistError => {
			console.error('Failed to persist rotated Google tokens:', persistError.message)
		})
	})

	try {
		await client.getAccessToken()
	} catch (refreshError) {
		const error = new Error(
			'Google access could not be refreshed. The teacher needs to reconnect their Google account.',
		)
		error.code = 'GOOGLE_AUTH_EXPIRED'
		error.cause = refreshError
		throw error
	}

	return client
}

/**
 * Creates a Calendar event with an attached Google Meet link on the given
 * user's primary calendar.
 */
const createMeetEvent = async ({ user, summary, description, startTime, endTime, timeZone, attendees }) => {
	const auth = await getAuthorizedClientForUser(user)
	const calendar = google.calendar({ version: 'v3', auth })

	const { data } = await calendar.events.insert({
		calendarId: 'primary',
		conferenceDataVersion: 1,
		sendUpdates: 'all',
		requestBody: {
			summary,
			description,
			start: { dateTime: startTime.toISOString(), timeZone: timeZone || DEFAULT_TIMEZONE },
			end: { dateTime: endTime.toISOString(), timeZone: timeZone || DEFAULT_TIMEZONE },
			attendees: Array.isArray(attendees) && attendees.length > 0 ? attendees : undefined,
			conferenceData: {
				createRequest: {
					requestId: crypto.randomUUID(),
					conferenceSolutionKey: { type: 'hangoutsMeet' },
				},
			},
		},
	})

	return data
}

/**
 * Deletes the Calendar event that backs a group's Meet link. Treats
 * "already gone" responses as success since the end goal (no usable link)
 * is already true.
 */
const deleteEvent = async ({ user, eventId, calendarId = 'primary' }) => {
	const auth = await getAuthorizedClientForUser(user)
	const calendar = google.calendar({ version: 'v3', auth })

	try {
		await calendar.events.delete({ calendarId, eventId, sendUpdates: 'all' })
	} catch (error) {
		const status = error?.code || error?.response?.status
		if (status === 404 || status === 410) {
			return
		}
		throw error
	}
}

const revokeUserToken = async user => {
	const refreshToken = user?.googleAccount?.refreshToken
	if (!refreshToken) {
		return
	}

	const client = createOAuthClient()
	try {
		await client.revokeToken(refreshToken)
	} catch (error) {
		console.error('Failed to revoke Google token (disconnecting locally anyway):', error.message)
	}
}

module.exports = {
	SCOPES,
	buildAuthUrl,
	exchangeCodeForTokens,
	getAuthorizedClientForUser,
	createMeetEvent,
	deleteEvent,
	revokeUserToken,
}
