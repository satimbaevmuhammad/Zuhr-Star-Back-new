# Frontend Quick Reference Card

## 1. Installation (2 min setup)

```bash
# Copy the WebRTC client
cp packages/client/src/webrtc-client.js src/services/

# Install Socket.IO
npm install socket.io-client
```

## 2. 5-Minute Integration Template

```javascript
import io from 'socket.io-client'
import WebRTCClient from './services/webrtc-client.js'

// Create socket
const socket = io('http://localhost:3000', {
  auth: { token: yourJWT }
})

// Create WebRTC client
const client = new WebRTCClient(socket)

// Setup handlers
client.on('localStream', stream => {
  videoEl.srcObject = stream
})

client.on('remoteStream', (id, stream) => {
  remoteVideoEl.srcObject = stream
})

client.on('error', err => console.error(err))

// Join meeting
await client.getLocalStream()
await client.joinRoom('room_123', 'user-123')

// Leave
await client.leaveRoom()
client.stopLocalStream()
```

## 3. REST Join + Socket.IO Flow

```
User clicks "Join"
    ↓
POST /api/webrtc/rooms/:roomId/join  ← Returns: admitted (true/false)
    ↓
Socket.IO connect with JWT token
    ↓
emit('joinRoom', { roomId, payload: { participantId } })
    ↓
Server adds you to room "webrtc:<roomId>"
    ↓
Server emits 'participantJoined' to others
    ↓
Each peer creates offer → answer → ICE exchange
    ↓
✓ P2P video connection established
```

## 4. Event Handlers (All 6)

```javascript
client.on('localStream', stream => {
  // Your camera is ready
  videoEl.srcObject = stream
})

client.on('remoteStream', (participantId, stream) => {
  // Got video from peer
  remoteEls[participantId].srcObject = stream
})

client.on('remoteStreamRemoved', participantId => {
  // Peer disconnected
  delete remoteEls[participantId]
})

client.on('participantJoined', info => {
  // Someone entered the room
  updateList(info.participantId)
})

client.on('participantLeft', info => {
  // Someone left the room
  removeFromList(info.participantId)
})

client.on('error', error => {
  // Something went wrong
  console.error(error.code, error.message)
})
```

## 5. Handle Waiting Room

```javascript
// Step 1: Call REST join
const res = await fetch(`/api/webrtc/rooms/${roomId}/join`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ displayName })
})

const { admitted, participantId } = await res.json()

// Step 2: Check if waiting
if (!admitted) {
  showWaitingUI()
  
  socket.on('admittedFromWaiting', async () => {
    // Now join the live room
    await client.joinRoom(roomId, participantId)
  })
} else {
  // Join immediately
  await client.joinRoom(roomId, participantId)
}
```

## 6. Critical Do's & Don'ts

✅ DO:
- Use `Map` for multiple RTCPeerConnections (one per participant)
- Include `targetParticipantId` in every offer/answer/iceCandidate
- Queue ICE candidates until `setRemoteDescription()` completes
- Add local tracks to EVERY new connection BEFORE createOffer
- Close connections on `participantLeft`
- Check `signalingState` before mutations

❌ DON'T:
- Use single `peerConnection` variable (breaks with 3+ people)
- Broadcast offers without `targetParticipantId`
- Apply ICE candidates before setRemoteDescription
- Call createOffer before addTrack
- Leave stale connections in memory
- Ignore signalingState (causes InvalidStateError)

## 7. Debug Commands

```javascript
// Check who's connected
console.log(client.peerConnections.size)  // Number of peers
console.log(Array.from(client.peerConnections.keys()))  // Peer IDs

// Check specific peer
const pc = client.peerConnections.get('student-123')
console.log(pc?.connectionState)  // 'new', 'connecting', 'connected', 'failed'
console.log(pc?.signalingState)   // 'stable', 'have-local-offer', etc.

// Check local stream
console.log(client.localStream?.getTracks().length)
client.localStream?.getTracks().forEach(t => {
  console.log(t.kind, t.enabled, t.readyState)
})
```

## 8. Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot set remote description in state` | Out-of-order events | ✓ Already fixed in webrtc-client.js |
| `Cannot read property 'size' of undefined` | peerConnections not Map | ✓ Use webrtc-client.js (provides Map) |
| Only see 1 peer's video with 3+ people | Missing targetParticipantId | ✓ webrtc-client.js includes it |
| No remote video at all | No offer on participantJoined | ✓ webrtc-client.js handles this |
| "NotAllowedError" on getUserMedia | Permission denied | Ask user to allow camera |
| Connection drops after 30s | JWT expired | Refresh token before join |

## 9. File Structure

```
src/
├── services/
│   └── webrtc-client.js         ← Main library
├── components/
│   ├── MeetingRoom.jsx          ← Use webrtc-client here
│   ├── VideoGrid.jsx
│   └── ParticipantList.jsx
├── pages/
│   └── Meeting.jsx
└── utils/
    └── meeting-helpers.js       ← Token refresh, room creation
```

## 10. React Hook Pattern

```jsx
export function useMeeting(roomId, accessToken, serverUrl) {
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const clientRef = useRef(null)

  useEffect(() => {
    const setup = async () => {
      const socket = io(serverUrl, { auth: { token: accessToken } })
      const client = new WebRTCClient(socket)
      clientRef.current = client

      client.on('localStream', setLocalStream)
      client.on('remoteStream', (id, stream) => {
        setRemoteStreams(m => new Map(m).set(id, stream))
      })
      client.on('remoteStreamRemoved', (id) => {
        setRemoteStreams(m => {
          const n = new Map(m)
          n.delete(id)
          return n
        })
      })

      await client.getLocalStream()
      await client.joinRoom(roomId, 'user-' + Date.now())
    }

    setup()

    return () => {
      clientRef.current?.leaveRoom()
      clientRef.current?.stopLocalStream()
    }
  }, [roomId, accessToken, serverUrl])

  return { localStream, remoteStreams, client: clientRef.current }
}

// Usage
export function Meeting() {
  const { localStream, remoteStreams } = useMeeting(
    'room_123',
    token,
    'http://localhost:3000'
  )

  return (
    <div>
      {localStream && <video srcObject={localStream} autoPlay muted />}
      {Array.from(remoteStreams.values()).map((stream, i) => (
        <video key={i} srcObject={stream} autoPlay />
      ))}
    </div>
  )
}
```

## 11. Testing (Copy-Paste Test)

```bash
# Terminal 1: Backend
npm start

# Terminal 2: Frontend dev server
npm run dev

# Browser: Open 2-3 tabs to http://localhost:3000/meeting
# Use same Room ID, different names
# → Should see all videos in real-time
```

## 12. Docs Reference

| Document | For... |
|----------|--------|
| **FRONTEND_GUIDE.md** (THIS) | Complete setup & integration |
| **QUICK_START.md** | Integration examples & troubleshooting |
| **WEBRTC_AUDIT_REPORT.md** | Technical deep-dive of 7 bugs |
| **FIX_SUMMARY.md** | Executive summary |
| **webrtc-client.js** | The library (read source comments) |
| **meeting.html** | Working demo (copy patterns) |

## 13. Production Checklist

```
[ ] Use HTTPS + WSS (wss://)
[ ] JWT tokens short-lived (15-30 min)
[ ] Implement token refresh
[ ] Test with real network (not localhost)
[ ] Test on mobile
[ ] Monitor WebRTC stats
[ ] Log errors to backend
[ ] Handle network failures
[ ] Set CORS_ORIGINS on backend
[ ] Limit to 6-10 participants (P2P limits)
```

## 14. One-Liner Tests

```javascript
// Is local stream ready?
client.localStream?.getTracks().length > 0

// How many peers connected?
client.peerConnections.size

// Are we in a room?
client.roomId && client.participantId

// Are all connections stable?
Array.from(client.peerConnections.values())
  .every(pc => pc.connectionState === 'connected')
```

---

**Need help?** See FRONTEND_GUIDE.md for the full tutorial!
