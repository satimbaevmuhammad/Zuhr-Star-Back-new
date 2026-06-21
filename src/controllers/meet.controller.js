const mongoose = require('mongoose')

const Group = require('../model/group.model')
const User = require('../model/user.model')
const googleCalendarService = require('../services/google-calendar.service')

const MIN_DURATION_MINUTES = 15
const MAX_DURATION_MINUTES = 300
const DEFAULT_DURATION_MINUTES = 60

const clampDuration = value => {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) {
		return DEFAULT_DURATION_MINUTES
	}
	return Math.min(Math.max(Math.round(parsed), MIN_DURATION_MINUTES), MAX_DURATION_MINUTES)
}

// Only what students/teachers actually need to join or display the meeting —
// never leaks the Calendar eventId/calendarId internals.
const serializeMeeting = group => {
	const meet = group.googleMeet
	if (!meet || meet.status === 'none' || !meet.meetLink) {
		return null
	}

	return {
		status: meet.status,
		meetLink: meet.meetLink,
		htmlLink: meet.htmlLink || null,
		summary: meet.summary || null,
		startTime: meet.startTime || null,
		endTime: meet.endTime || null,
		createdByName: meet.createdByName || null,
		createdAt: meet.createdAt || null,
		endedAt: meet.endedAt || null,
	}
}

const googleErrorResponse = (res, error) => {
	if (error.code === 'GOOGLE_ACCOUNT_NOT_CONNECTED') {
		return res.status(409).json({
			message: 'Connect your Google account before creating a Google Meet (see /api/google/connect)',
			code: 'GOOGLE_ACCOUNT_NOT_CONNECTED',
		})
	}
	if (error.code === 'GOOGLE_AUTH_EXPIRED') {
		return res.status(409).json({
			message: 'Google access expired. Please reconnect your Google account.',
			code: 'GOOGLE_REAUTH_REQUIRED',
		})
	}
	if (error.code === 'GOOGLE_NOT_CONFIGURED') {
		return res.status(503).json({ message: error.message, code: 'GOOGLE_NOT_CONFIGURED' })
	}
	return null
}

/**
 * POST /api/groups/:groupId/meet
 * Creates a Google Calendar event (with a Meet link) on the acting
 * teacher's Google account and links it to the group.
 */
exports.createGroupMeeting = async (req, res) => {
	try {
		const groupId = req.params.groupId
		const group = await Group.findById(groupId)
		if (!group) {
			return res.status(404).json({ message: 'Group not found', code: 'NOT_FOUND' })
		}

		if (group.googleMeet?.status === 'scheduled' && group.googleMeet?.meetLink) {
			return res.status(409).json({
				message: 'This group already has an active Google Meet. End it before creating a new one.',
				code: 'MEETING_ALREADY_EXISTS',
				googleMeet: serializeMeeting(group),
			})
		}

		const user = await User.findById(req.user.id).select(
			'+googleAccount.refreshToken +googleAccount.accessToken +googleAccount.accessTokenExpiresAt',
		)
		if (!user?.googleAccount?.connected || !user.googleAccount.refreshToken) {
			return res.status(409).json({
				message: 'Connect your Google account before creating a Google Meet (see /api/google/connect)',
				code: 'GOOGLE_ACCOUNT_NOT_CONNECTED',
			})
		}

		const title = String(req.body.title || '').trim() || `${group.name} - ${group.course}`
		const description = req.body.description
			? String(req.body.description).trim()
			: `Live lesson room for ${group.name}`

		let startTime = new Date()
		if (req.body.startTime) {
			startTime = new Date(req.body.startTime)
			if (Number.isNaN(startTime.getTime())) {
				return res.status(400).json({ message: 'startTime must be a valid date', code: 'VALIDATION_ERROR', field: 'startTime' })
			}
		}

		const durationMinutes = clampDuration(req.body.durationMinutes)
		const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)

		const event = await googleCalendarService.createMeetEvent({
			user,
			summary: title,
			description,
			startTime,
			endTime,
		})

		const meetLink =
			event.hangoutLink ||
			event.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video')?.uri ||
			null

		if (!meetLink) {
			return res.status(502).json({
				message: 'Google did not return a Meet link for this event. Please try again.',
				code: 'GOOGLE_MEET_LINK_MISSING',
			})
		}

		group.googleMeet = {
			eventId: event.id,
			calendarId: 'primary',
			meetLink,
			htmlLink: event.htmlLink || null,
			summary: title,
			status: 'scheduled',
			startTime,
			endTime,
			createdBy: user._id,
			createdByName: user.fullname,
			createdAt: new Date(),
			endedAt: null,
		}
		await group.save()

		return res.status(201).json({ googleMeet: serializeMeeting(group) })
	} catch (error) {
		const googleResponse = googleErrorResponse(res, error)
		if (googleResponse) {
			return googleResponse
		}

		console.error('Create group Google Meet failed:', error)
		return res.status(500).json({ message: 'Failed to create Google Meet', code: 'INTERNAL_SERVER_ERROR' })
	}
}

/**
 * GET /api/groups/:groupId/meet
 * Returns the group's current Meet link, or null if none has been created
 * (or it was ended). Visible to staff and to students enrolled in the group.
 */
exports.getGroupMeeting = async (req, res) => {
	try {
		const groupId = req.params.groupId
		const group = await Group.findById(groupId).select('googleMeet name course')
		if (!group) {
			return res.status(404).json({ message: 'Group not found', code: 'NOT_FOUND' })
		}

		return res.status(200).json({ googleMeet: serializeMeeting(group) })
	} catch (error) {
		console.error('Get group Google Meet failed:', error)
		return res.status(500).json({ message: 'Failed to load Google Meet', code: 'INTERNAL_SERVER_ERROR' })
	}
}

/**
 * DELETE /api/groups/:groupId/meet
 * Ends the group's active Meet by deleting the backing Calendar event
 * (using the original creator's Google credentials) and marking it ended.
 */
exports.endGroupMeeting = async (req, res) => {
	try {
		const groupId = req.params.groupId
		const group = await Group.findById(groupId)
		if (!group) {
			return res.status(404).json({ message: 'Group not found', code: 'NOT_FOUND' })
		}

		if (!group.googleMeet?.eventId || group.googleMeet.status !== 'scheduled') {
			return res.status(404).json({ message: 'No active Google Meet for this group', code: 'NOT_FOUND' })
		}

		const creatorId = group.googleMeet.createdBy
		let eventOwner = null
		if (creatorId && mongoose.isValidObjectId(creatorId)) {
			eventOwner = await User.findById(creatorId).select(
				'+googleAccount.refreshToken +googleAccount.accessToken +googleAccount.accessTokenExpiresAt',
			)
		}

		if (eventOwner?.googleAccount?.refreshToken) {
			try {
				await googleCalendarService.deleteEvent({ user: eventOwner, eventId: group.googleMeet.eventId })
			} catch (calendarError) {
				// Don't block ending the meeting locally just because the calendar
				// call failed (e.g. the teacher revoked access from Google's side).
				console.error('Failed to delete Google Calendar event (ending locally anyway):', calendarError.message)
			}
		}

		group.googleMeet.status = 'ended'
		group.googleMeet.endedAt = new Date()
		await group.save()

		return res.status(200).json({ googleMeet: serializeMeeting(group) })
	} catch (error) {
		console.error('End group Google Meet failed:', error)
		return res.status(500).json({ message: 'Failed to end Google Meet', code: 'INTERNAL_SERVER_ERROR' })
	}
}
