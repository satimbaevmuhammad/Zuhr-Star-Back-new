# Google Meet Integration — Setup & Frontend Guide

This replaces the old self-built WebRTC video system. Instead of hosting our
own signaling/video infra, a teacher connects their **own Google account**
once, and the backend uses the real **Google Calendar API** to create a
Calendar event with an attached **Google Meet** link. That link is saved on
the group, so every student in the group can see it and join with Google
Meet directly (camera, mic, screenshare, recording, etc. are all handled by
Google — nothing for us to build or maintain).

---

## 1. One-time Google Cloud setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create (or pick) a project.
2. **APIs & Services → Library** → enable the **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: External (or Internal if you use Google Workspace).
   - Add the scopes: `.../auth/calendar.events` and
     `.../auth/userinfo.email`.
   - Add your teachers as test users if the app is in "Testing" mode, or
     publish the app for production use.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `https://YOUR_API_DOMAIN/api/google/oauth-callback`
     (use `http://localhost:3000/api/google/oauth-callback` for local dev).
5. Copy the generated **Client ID** and **Client Secret**.

## 2. Environment variables

Add to `.env`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://YOUR_API_DOMAIN/api/google/oauth-callback

# Optional: if set, the OAuth callback redirects the browser here instead of
# showing a plain confirmation page. Useful so the popup/tab can close itself
# or send a postMessage back to the main app window.
GOOGLE_CONNECT_SUCCESS_URL=https://your-frontend.com/settings/google?status=success
GOOGLE_CONNECT_ERROR_URL=https://your-frontend.com/settings/google?status=error
```

`GOOGLE_REDIRECT_URI` **must exactly match** the redirect URI registered in
step 1.4 above (including http vs https and trailing slashes).

---

## 3. How it works

- A **refresh token** is stored on the teacher's `User` document
  (`googleAccount.refreshToken`), never exposed in API responses.
- A **Group** stores at most one active Meet at a time, in
  `group.googleMeet`. The Meet link does **not** expire based on
  `startTime`/`endTime` — Google Meet links created via Calendar stay valid
  indefinitely until the Calendar event is deleted. So a teacher typically
  creates **one Meet per group** and reuses the same link for every lesson,
  then "ends" it (deletes the event) when the course finishes.
- Whoever creates the meeting must have connected their Google account —
  the Meet is created on *their* calendar using *their* Google identity, as
  requested. Any teacher/admin with `groups:manage` permission can end it
  later (ending uses the original creator's stored credentials, not the
  actor's, since the Calendar event lives on the creator's calendar).

---

## 4. API reference

All endpoints require the existing JWT auth (`Authorization: Bearer <token>`).

### Connect Google (teacher/employee only)

```
GET /api/google/connect
→ { "url": "https://accounts.google.com/o/oauth2/v2/auth?..." }
```
Open `url` in a browser tab/popup. After consent, Google redirects to
`/api/google/oauth-callback`, which stores the tokens and then either
redirects to `GOOGLE_CONNECT_SUCCESS_URL` or shows a plain confirmation page.

```
GET /api/google/status
→ { "connected": true, "email": "teacher@gmail.com", "connectedAt": "2026-06-01T10:00:00.000Z" }

DELETE /api/google/disconnect
→ { "message": "Google account disconnected", "code": "GOOGLE_DISCONNECTED" }
```

### Create a Meet room for a group

```
POST /api/groups/:groupId/meet
Body (all optional):
{
  "title": "Algebra 101 - Live lesson",
  "description": "Weekly live lesson room",
  "startTime": "2026-06-20T10:00:00.000Z",
  "durationMinutes": 60
}

201 →
{
  "googleMeet": {
    "status": "scheduled",
    "meetLink": "https://meet.google.com/abc-defg-hij",
    "htmlLink": "https://www.google.com/calendar/event?eid=...",
    "summary": "Algebra 101 - Live lesson",
    "startTime": "2026-06-20T10:00:00.000Z",
    "endTime": "2026-06-20T11:00:00.000Z",
    "createdByName": "Mr. Ahmed",
    "createdAt": "2026-06-20T09:55:00.000Z",
    "endedAt": null
  }
}
```

Possible error responses:
- `409 GOOGLE_ACCOUNT_NOT_CONNECTED` — teacher needs to call `/api/google/connect` first.
- `409 GOOGLE_REAUTH_REQUIRED` — stored token is no longer valid; reconnect.
- `409 MEETING_ALREADY_EXISTS` — group already has an active Meet; end it first.

### Get the group's current Meet (teachers, support teachers, admins, **and enrolled students**)

```
GET /api/groups/:groupId/meet
→ { "googleMeet": { ...same shape as above... } }   // or { "googleMeet": null } if none yet
```

This is what the student app should poll/fetch to show the "Join class"
button — once a teacher links a Meet to the group, it shows up here
automatically.

### End the group's Meet

```
DELETE /api/groups/:groupId/meet
→ { "googleMeet": { "status": "ended", "meetLink": "...", "endedAt": "..." } }
```

Deletes the underlying Calendar event (which invalidates the Meet link) and
marks it ended. A teacher can then create a fresh Meet for the group with
another `POST`.

---

## 5. Minimal frontend flow

**Teacher settings page:**
```js
// Check connection status
const { connected, email } = await fetch('/api/google/status', { headers }).then(r => r.json())

if (!connected) {
  const { url } = await fetch('/api/google/connect', { headers }).then(r => r.json())
  window.open(url, '_blank') // teacher grants access, tab can close itself afterwards
}
```

**Teacher group page — "Start Google Meet" button:**
```js
const res = await fetch(`/api/groups/${groupId}/meet`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: `${groupName} - Live lesson` }),
})
const { googleMeet } = await res.json()
// googleMeet.meetLink → show as a "Join" button / share with students
```

**Student group page:**
```js
const { googleMeet } = await fetch(`/api/groups/${groupId}/meet`, { headers }).then(r => r.json())
if (googleMeet?.status === 'scheduled') {
  // render a "Join Google Meet" button linking to googleMeet.meetLink
}
```

That's the whole integration — no signaling server, no STUN/TURN, no custom
video UI to maintain.
