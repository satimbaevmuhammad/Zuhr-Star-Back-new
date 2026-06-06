# Quick Start: Integrating the Fixed WebRTC Client

## Files Provided

- `webrtc-client.js` — Class-based WebRTC signaling client (all bugs fixed)
- `meeting.html` — Standalone demo with UI
- `WEBRTC_AUDIT_REPORT.md` — Full audit of all 7 bugs & fixes

---

## Installation

### 1. Copy the client file

```bash
cp packages/client/src/webrtc-client.js path/to/your/frontend/
```

### 2. Include in your HTML

```html
<!-- CDN for Socket.IO -->
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>

<!-- Your WebRTC client -->
<script src="/webrtc-client.js"></script>
```

Or with npm/bundler:

```bash
npm install socket.io-client
# Copy webrtc-client.js to your src folder
import WebRTCClient from './webrtc-client.js'
```

---

## Basic Integration Example

```javascript
import io from 'socket.io-client'
import WebRTCClient from './webrtc-client.js'

class MeetingComponent {
  constructor() {
    this.socket = null
    this.webrtcClient = null
    this.remoteVideos = new Map()
  }

  async joinMeeting(roomId, participantId, serverUrl, accessToken) {
    try {
      // 1. Call REST join endpoint
      const response = await fetch(
        `${serverUrl}/api/webrtc/rooms/${roomId}/join`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ displayName: 'User' }),
        }
      )

      const joinData = await response.json()

      // 2. Connect Socket.IO
      this.socket = io(serverUrl, {
        auth: { token: accessToken },
      })

      // 3. Create WebRTC client
      this.webrtcClient = new WebRTCClient(this.socket)

      // 4. Setup event handlers
      this.webrtcClient.on('localStream', (stream) => {
        this.renderLocalVideo(stream)
      })

      this.webrtcClient.on('remoteStream', (id, stream) => {
        this.renderRemoteVideo(id, stream)
      })

      this.webrtcClient.on('remoteStreamRemoved', (id) => {
        this.removeRemoteVideo(id)
      })

      this.webrtcClient.on('error', (error) => {
        console.error('WebRTC Error:', error)
        this.showError(error.message)
      })

      // 5. Get local media
      await this.webrtcClient.getLocalStream()

      // 6. Join room
      await this.webrtcClient.joinRoom(roomId, participantId)

      console.log('Successfully joined meeting')
    } catch (error) {
      console.error('Failed to join:', error)
      this.showError(error.message)
    }
  }

  renderLocalVideo(stream) {
    const videoEl = document.getElementById('local-video')
    videoEl.srcObject = stream
    videoEl.play()
  }

  renderRemoteVideo(participantId, stream) {
    let container = document.getElementById(`remote-${participantId}`)
    if (!container) {
      container = document.createElement('div')
      container.id = `remote-${participantId}`
      container.innerHTML = `
        <video autoplay playsinline></video>
        <label>${participantId}</label>
      `
      document.getElementById('remote-videos').appendChild(container)
    }

    const video = container.querySelector('video')
    video.srcObject = stream
    video.play()
    this.remoteVideos.set(participantId, container)
  }

  removeRemoteVideo(participantId) {
    const container = this.remoteVideos.get(participantId)
    if (container) {
      container.remove()
      this.remoteVideos.delete(participantId)
    }
  }

  async leaveMeeting() {
    try {
      if (this.webrtcClient) {
        this.webrtcClient.stopLocalStream()
        await this.webrtcClient.leaveRoom()
      }

      if (this.socket) {
        this.socket.disconnect()
      }

      // Clear UI
      this.remoteVideos.forEach((container) => container.remove())
      this.remoteVideos.clear()
    } catch (error) {
      console.error('Error leaving:', error)
    }
  }

  showError(message) {
    console.error(message)
    // Update UI with error
  }
}

// Usage
const meeting = new MeetingComponent()
await meeting.joinMeeting(
  'room_123',           // roomId
  'student-abc-123',    // participantId
  'https://your-server.com',  // serverUrl
  'your-jwt-token'      // accessToken
)

// Later: leave
await meeting.leaveMeeting()
```

---

## React Example

```jsx
import { useEffect, useState, useRef } from 'react'
import io from 'socket.io-client'
import WebRTCClient from './webrtc-client'

export function MeetingRoom({ roomId, accessToken, serverUrl }) {
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [error, setError] = useState(null)
  const webrtcRef = useRef(null)
  const remoteVideosRef = useRef(new Map())

  useEffect(() => {
    const joinMeeting = async () => {
      try {
        // REST join
        const res = await fetch(
          `${serverUrl}/api/webrtc/rooms/${roomId}/join`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ displayName: 'Student' }),
          }
        )
        const data = await res.json()
        const participantId = data.participantId

        // Socket.IO
        const socket = io(serverUrl, { auth: { token: accessToken } })

        // WebRTC client
        const client = new WebRTCClient(socket)
        webrtcRef.current = client

        client.on('localStream', (stream) => {
          setLocalStream(stream)
        })

        client.on('remoteStream', (id, stream) => {
          remoteVideosRef.current.set(id, stream)
          setRemoteStreams(new Map(remoteVideosRef.current))
        })

        client.on('remoteStreamRemoved', (id) => {
          remoteVideosRef.current.delete(id)
          setRemoteStreams(new Map(remoteVideosRef.current))
        })

        client.on('error', (err) => {
          setError(err.message)
        })

        await client.getLocalStream()
        await client.joinRoom(roomId, participantId)
      } catch (err) {
        setError(err.message)
      }
    }

    joinMeeting()

    return () => {
      if (webrtcRef.current) {
        webrtcRef.current.leaveRoom()
        webrtcRef.current.stopLocalStream()
      }
    }
  }, [roomId, accessToken, serverUrl])

  if (error) {
    return <div className="error">{error}</div>
  }

  return (
    <div className="meeting-room">
      <div className="local-video-container">
        {localStream ? (
          <video
            ref={(el) => {
              if (el) el.srcObject = localStream
            }}
            autoPlay
            muted
            playsinline
          />
        ) : (
          <div className="loading">Joining...</div>
        )}
      </div>

      <div className="remote-videos-grid">
        {Array.from(remoteStreams.entries()).map(([id, stream]) => (
          <RemoteVideo key={id} participantId={id} stream={stream} />
        ))}
      </div>
    </div>
  )
}

function RemoteVideo({ participantId, stream }) {
  return (
    <div className="remote-video-container">
      <video
        ref={(el) => {
          if (el) el.srcObject = stream
        }}
        autoPlay
        playsinline
      />
      <label>{participantId}</label>
    </div>
  )
}
```

---

## Testing Locally

### 1. Start the backend

```bash
cd Zuhr-Star-Back-new
npm install
npm start
```

The server runs on `http://localhost:3000`

### 2. Start the frontend

```bash
# Option A: Use the provided meeting.html
npx http-server packages/client/src -p 8080

# Option B: Your own dev server
npm start  # or yarn start
```

### 3. Test with multiple participants

Open multiple browser windows/tabs:
- `http://localhost:8080/meeting.html` (Student 1)
- `http://localhost:8080/meeting.html` (Student 2)
- `http://localhost:8080/meeting.html` (Student 3)

Use the **same Room ID** and different display names. You should see:
- ✅ Local video in each window
- ✅ Remote videos from all other participants
- ✅ Audio/video synced in real-time
- ✅ Participants can join/leave dynamically

---

## Troubleshooting

### "Cannot see remote video"

**Check:**
1. Did `participantJoined` event fire? (check browser console)
2. Did client call `createOffer`? (should see "Generated ICE candidate" logs)
3. Is `targetParticipantId` in all offers/answers/ICE? (check network tab)
4. Run the provided `meeting.html` test first to isolate issues

### "Connection failed with X participants"

**This was BUG 2** — the fix stores connections in a Map keyed by participantId, not a single variable.

Check:
```javascript
console.log(this.peerConnections.size)  // Should equal number of peers
```

### "ICE candidates not being applied"

**This was BUG 3** — the fix queues candidates until `setRemoteDescription` completes.

Check console for: `"Queued ICE candidate for..."` and `"Flushing X queued ICE candidates..."`

### "Memory leaks / connection state corrupted"

**This was BUG 6** — ensure `participantLeft` calls `closePeerConnection()`.

Check that on leave: `peerConnections.delete()` is called.

---

## Next Steps

1. **Deploy to production:**
   - Use HTTPS and WSS (secure WebSocket)
   - Set `CORS_ORIGINS` in your `.env`
   - Test with many participants

2. **Add features:**
   - Screen sharing (add video track with `appData.type = 'screen'`)
   - Mute/unmute (toggle `getUserMedia` constraints)
   - Recording (integrate mediasoup SFU)
   - Chat (already in Socket.IO: `sendMessage` → `messageCreated`)

3. **Monitor quality:**
   - Emit `networkQuality` events periodically
   - Track connection state changes
   - Log stats to backend for debugging

---

For full details on all 7 bugs and their fixes, see [WEBRTC_AUDIT_REPORT.md](./WEBRTC_AUDIT_REPORT.md).
