# Frontend Developer Guide: WebRTC Integration

## Complete Setup & Integration Instructions

This guide walks you through setting up and integrating the Zuhr WebRTC client into your frontend application. Follow each section carefully.

---

## 1. Prerequisites & Setup

### 1.1 What You Need
- **Node.js** 16+ or browser environment (client-side only)
- **Socket.IO** library installed
- **Backend running** on `http://localhost:3000` (or your server)
- **Valid JWT access token** from your auth system
- **Participant ID** format: `{userType}-{userId}` (e.g., `student-65f12ca7a7720c194de6a002`)

### 1.2 Install Dependencies

```bash
# If using npm/webpack/vite:
npm install socket.io-client

# If using CDN (browser only):
# <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
```

### 1.3 Copy WebRTC Client

```bash
# Copy the fixed client library to your project
cp packages/client/src/webrtc-client.js src/services/
```

---

## 2. Architecture Overview: How WebRTC Flows Work

### 2.1 Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: REST API (HTTP)                                    │
│ - Creates room                                              │
│ - Joins/leaves participant                                  │
│ - Fetches attendance, messages                              │
│ - Manages waiting room admission                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Socket.IO Signaling (WebSocket)                    │
│ - Manages presence (who's connected)                        │
│ - Relays WebRTC offers/answers/ICE candidates              │
│ - Broadcasts chat, hand raise, media state                  │
│ - Handles waiting room admission notifications              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Peer-to-Peer Media (WebRTC)                        │
│ - Audio/video streams flow directly between browsers        │
│ - No server involvement in media routing                    │
│ - Encrypted by default                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Join Flow Sequence

```
1. User clicks "Join Meeting"
   ↓
2. Call REST: POST /api/webrtc/rooms/:roomId/join
   → Returns: admitted (true/false), admissionStatus (waiting/admitted/denied)
   ↓
3. If admitted = false:
   - Show waiting lobby UI
   - Wait for host to admit
   - Listen for 'admittedFromWaiting' event
   ↓
4. Create Socket.IO connection with JWT token
   ↓
5. Emit 'joinRoom' event with roomId + participantId
   ↓
6. Server puts socket in room "webrtc:<roomId>"
   ↓
7. Server emits 'participantJoined' to all other sockets
   ↓
8. Each existing peer receives 'participantJoined'
   - Creates new RTCPeerConnection for newcomer
   - Calls createOffer()
   - Sends offer to newcomer
   ↓
9. Newcomer receives 'offer'
   - Creates RTCPeerConnection
   - Calls createAnswer()
   - Sends answer back
   ↓
10. Both peers exchange ICE candidates
    ↓
11. Peers connect! Video/audio flows peer-to-peer
```

---

## 3. Step-by-Step Integration

### 3.1 Initialize WebRTC Client

```javascript
import io from 'socket.io-client'
import WebRTCClient from './services/webrtc-client.js'

// Step 1: Create Socket.IO connection
const socket = io('http://localhost:3000', {
  auth: {
    token: yourJWTAccessToken, // Required: JWT from auth system
  },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
})

// Step 2: Create WebRTC client
const webrtcClient = new WebRTCClient(socket, {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302'] },
    { urls: ['stun:stun1.l.google.com:19302'] },
  ],
})

// Step 3: Setup event handlers (see section 3.2)
```

### 3.2 Register Event Handlers

```javascript
// Called when local media stream is ready
webrtcClient.on('localStream', (stream) => {
  console.log('Local stream ready')
  const localVideo = document.getElementById('local-video')
  localVideo.srcObject = stream
  localVideo.play()
})

// Called when receiving remote video from a peer
webrtcClient.on('remoteStream', (participantId, stream) => {
  console.log('Received video from:', participantId)
  
  // Create video element for this participant
  let remoteVideo = document.getElementById(`remote-${participantId}`)
  if (!remoteVideo) {
    remoteVideo = document.createElement('video')
    remoteVideo.id = `remote-${participantId}`
    remoteVideo.autoplay = true
    remoteVideo.playsinline = true
    document.getElementById('video-grid').appendChild(remoteVideo)
  }
  
  remoteVideo.srcObject = stream
  remoteVideo.play()
})

// Called when a peer's video stream ends
webrtcClient.on('remoteStreamRemoved', (participantId) => {
  console.log('Participant left:', participantId)
  const remoteVideo = document.getElementById(`remote-${participantId}`)
  if (remoteVideo) {
    remoteVideo.remove()
  }
})

// Called when a new peer joins the room
webrtcClient.on('participantJoined', (participantInfo) => {
  console.log('Participant joined:', participantInfo)
  updateParticipantList(participantInfo.participantId)
})

// Called when a peer leaves the room
webrtcClient.on('participantLeft', (participantInfo) => {
  console.log('Participant left:', participantInfo)
  removeFromParticipantList(participantInfo.participantId)
})

// Called when an error occurs
webrtcClient.on('error', (error) => {
  console.error('WebRTC Error:', error.code, error.message)
  showErrorAlert(error.message)
})
```

### 3.3 Get Media & Join Room

```javascript
async function joinMeeting(roomId, participantId) {
  try {
    // Step 1: Get local media (audio + video)
    console.log('Requesting camera & microphone...')
    await webrtcClient.getLocalStream({
      audio: true,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    })

    // Step 2: Join the room
    console.log('Joining room:', roomId)
    const response = await webrtcClient.joinRoom(roomId, participantId)
    console.log('Joined room. Response:', response)

    return response
  } catch (error) {
    console.error('Failed to join meeting:', error)
    throw error
  }
}

// Call it like this:
try {
  await joinMeeting('room_123', 'student-abc-xyz')
  console.log('✓ Successfully in meeting!')
} catch (error) {
  alert('Failed to join: ' + error.message)
}
```

### 3.4 Handle Waiting Room (if enabled)

```javascript
// BEFORE calling joinMeeting, check if waiting room is enabled:

// Step 1: Call REST join first
const joinResponse = await fetch(
  `http://localhost:3000/api/webrtc/rooms/${roomId}/join`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ displayName: 'Student Name' }),
  }
)

const joinData = await joinResponse.json()
const { admitted, admissionStatus, participantId } = joinData

// Step 2: Check if waiting
if (!admitted && admissionStatus === 'waiting') {
  console.log('Host must admit you. Waiting...')
  showWaitingLobbyUI()
  
  // Listen for admission
  webrtcClient.socket.on('admittedFromWaiting', async () => {
    console.log('✓ You have been admitted!')
    hideWaitingLobbyUI()
    
    // Now join the live room
    await joinMeeting(roomId, participantId)
  })
  
  webrtcClient.socket.on('deniedFromWaiting', (event) => {
    console.log('✗ You were denied:', event.payload.reason)
    showDeniedUI()
  })
} else {
  // Already admitted, join immediately
  await joinMeeting(roomId, participantId)
}
```

### 3.5 Leave Meeting

```javascript
async function leaveMeeting() {
  try {
    console.log('Leaving meeting...')
    
    // Stop local media
    webrtcClient.stopLocalStream()
    
    // Leave room and close all connections
    await webrtcClient.leaveRoom()
    
    // Clear UI
    document.getElementById('video-grid').innerHTML = ''
    
    console.log('✓ Left meeting')
  } catch (error) {
    console.error('Error leaving:', error)
  }
}

// Call it when user clicks "Leave" or closes browser
```

---

## 4. Complete React Example

```jsx
import { useEffect, useState, useRef } from 'react'
import io from 'socket.io-client'
import WebRTCClient from './services/webrtc-client'

export function MeetingRoom({ roomId, accessToken, serverUrl }) {
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [participants, setParticipants] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [waitingForAdmission, setWaitingForAdmission] = useState(false)
  
  const webrtcRef = useRef(null)
  const remoteVideosRef = useRef(new Map())

  useEffect(() => {
    let isMounted = true

    const setupMeeting = async () => {
      try {
        setLoading(true)

        // 1. Call REST join endpoint
        const joinResponse = await fetch(
          `${serverUrl}/api/webrtc/rooms/${roomId}/join`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              displayName: 'Student User',
            }),
          }
        )

        if (!joinResponse.ok) {
          throw new Error('Failed to join room')
        }

        const joinData = await joinResponse.json()
        const participantId = joinData.participantId
        const admitted = joinData.admitted

        // 2. Check if waiting for admission
        if (!admitted) {
          if (isMounted) {
            setWaitingForAdmission(true)
          }
        }

        // 3. Connect Socket.IO
        const socket = io(serverUrl, {
          auth: { token: accessToken },
          reconnection: true,
        })

        // 4. Create WebRTC client
        const client = new WebRTCClient(socket)
        webrtcRef.current = client

        // 5. Setup handlers
        client.on('localStream', (stream) => {
          if (isMounted) {
            setLocalStream(stream)
          }
        })

        client.on('remoteStream', (id, stream) => {
          remoteVideosRef.current.set(id, stream)
          if (isMounted) {
            setRemoteStreams(new Map(remoteVideosRef.current))
            setParticipants(Array.from(remoteVideosRef.current.keys()))
          }
        })

        client.on('remoteStreamRemoved', (id) => {
          remoteVideosRef.current.delete(id)
          if (isMounted) {
            setRemoteStreams(new Map(remoteVideosRef.current))
            setParticipants(Array.from(remoteVideosRef.current.keys()))
          }
        })

        client.on('error', (err) => {
          if (isMounted) {
            setError(err.message)
          }
        })

        // 6. Handle admission
        if (!admitted) {
          socket.on('admittedFromWaiting', async () => {
            if (isMounted) {
              setWaitingForAdmission(false)
            }
            await proceedWithMeeting()
          })

          socket.on('deniedFromWaiting', (event) => {
            if (isMounted) {
              setError(`Denied: ${event.payload.reason}`)
            }
          })
        } else {
          await proceedWithMeeting()
        }

        async function proceedWithMeeting() {
          try {
            await client.getLocalStream()
            await client.joinRoom(roomId, participantId)
            if (isMounted) {
              setLoading(false)
            }
          } catch (err) {
            if (isMounted) {
              setError(err.message)
              setLoading(false)
            }
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message)
          setLoading(false)
        }
      }
    }

    setupMeeting()

    // Cleanup on unmount
    return () => {
      isMounted = false
      if (webrtcRef.current) {
        webrtcRef.current.leaveRoom()
        webrtcRef.current.stopLocalStream()
      }
    }
  }, [roomId, accessToken, serverUrl])

  if (error) {
    return (
      <div className="error-container">
        <h2>Error</h2>
        <p>{error}</p>
      </div>
    )
  }

  if (waitingForAdmission) {
    return (
      <div className="waiting-room">
        <h2>Waiting for host to admit you...</h2>
        <div className="spinner"></div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="loading-container">
        <h2>Connecting...</h2>
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div className="meeting-room">
      <div className="videos-grid">
        {/* Local video */}
        <div className="video-container local">
          {localStream ? (
            <>
              <video
                ref={(el) => {
                  if (el) el.srcObject = localStream
                }}
                autoPlay
                muted
                playsinline
              />
              <label>You</label>
            </>
          ) : (
            <div className="no-video">No local stream</div>
          )}
        </div>

        {/* Remote videos */}
        {Array.from(remoteStreams.entries()).map(([id, stream]) => (
          <div key={id} className="video-container remote">
            <video
              ref={(el) => {
                if (el) el.srcObject = stream
              }}
              autoPlay
              playsinline
            />
            <label>{id.substring(0, 20)}</label>
          </div>
        ))}
      </div>

      <div className="controls">
        <button onClick={() => webrtcRef.current?.leaveRoom()}>
          Leave Meeting
        </button>
      </div>

      <div className="participants-info">
        <h3>Connected: {participants.length + 1}</h3>
        <ul>
          <li>You (local)</li>
          {participants.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

---

## 5. Key Concepts & Important Details

### 5.1 ParticipantId Format

```javascript
// Format: "{userType}-{userId}"
const examples = [
  'student-65f12ca7a7720c194de6a002',  // Student
  'teacher-65f12ca7a7720c194de6a001',  // Teacher
  'employee-65f12ca7a7720c194de6a003', // Staff
]

// Or use custom identifiers:
const custom = [
  'user-123',
  'participant-abc',
  'unique-session-id',
]
```

### 5.2 Room States

```javascript
// Room can be in these states:
const ROOM_STATES = [
  'IDLE',           // Just created
  'WAITING_ROOM',   // Waiting for participants (waiting room enabled)
  'ACTIVE',         // Meeting in progress
  'RECORDING',      // Being recorded
  'ENDING',         // Host ended meeting
  'ARCHIVED',       // Meeting completed & archived
]

// You don't need to manage this, but it affects REST responses
```

### 5.3 AdmissionStatus vs Admitted

```javascript
// These are returned from REST join:

// admitted (boolean) — quick check
admitted = true   // Can access live signaling immediately
admitted = false  // Must wait in lobby

// admissionStatus (string) — detailed state
admissionStatus = 'admitted'  // Host approved
admissionStatus = 'waiting'   // Waiting for host
admissionStatus = 'denied'    // Host rejected
```

### 5.4 Critical: Always Set targetParticipantId

```javascript
// ✅ CORRECT: Targets specific peer
socket.emit('offer', {
  roomId,
  payload: {
    targetParticipantId: 'student-xyz',  // ← REQUIRED
    sdp: peerConnection.localDescription,
  },
})

// ❌ WRONG: Broadcasts to everyone (confuses 3+ person room)
socket.emit('offer', {
  roomId,
  payload: {
    sdp: peerConnection.localDescription,
    // Missing targetParticipantId!
  },
})
```

### 5.5 RTCPeerConnection Per Participant

```javascript
// ✅ CORRECT: Map of connections
const peerConnections = new Map()
peerConnections.set('student-1', new RTCPeerConnection())
peerConnections.set('student-2', new RTCPeerConnection())
peerConnections.set('teacher', new RTCPeerConnection())

// ❌ WRONG: Single connection (only last peer works)
let peerConnection = new RTCPeerConnection()  // WRONG!
```

---

## 6. Best Practices

### 6.1 Error Handling

```javascript
// Always wrap in try-catch
try {
  await webrtcClient.getLocalStream()
  await webrtcClient.joinRoom(roomId, participantId)
} catch (error) {
  console.error('Setup failed:', error)
  
  // Handle specific errors
  if (error.name === 'NotAllowedError') {
    alert('Please allow camera & microphone access')
  } else if (error.name === 'NotFoundError') {
    alert('No camera or microphone found')
  } else {
    alert('Connection failed: ' + error.message)
  }
}
```

### 6.2 Clean Shutdown

```javascript
// Always cleanup on unmount/leave
async function cleanupMeeting() {
  // 1. Stop media
  webrtcClient.stopLocalStream()
  
  // 2. Close all connections
  await webrtcClient.leaveRoom()
  
  // 3. Clear UI
  document.querySelectorAll('video').forEach(v => v.srcObject = null)
  
  // 4. Disconnect socket if needed
  if (webrtcClient.socket) {
    webrtcClient.socket.disconnect()
  }
}

// React cleanup
useEffect(() => {
  return () => cleanupMeeting()
}, [])
```

### 6.3 Monitor Connection State

```javascript
// Listen for connection changes
const pc = webrtcClient.peerConnections.get(participantId)

pc.onconnectionstatechange = () => {
  console.log('Connection state:', pc.connectionState)
  
  switch (pc.connectionState) {
    case 'connected':
      console.log('✓ Peer connected')
      break
    case 'failed':
    case 'disconnected':
      console.log('✗ Peer disconnected')
      webrtcClient.closePeerConnection(participantId)
      break
  }
}

pc.onsignalingstatechange = () => {
  console.log('Signaling state:', pc.signalingState)
}
```

### 6.4 Network Quality Monitoring

```javascript
// Periodically report network quality
setInterval(() => {
  // Score 0-5 based on connection quality
  const quality = estimateNetworkQuality()
  
  webrtcClient.socket.emit('networkQuality', {
    roomId,
    payload: {
      score: quality,
    },
  })
}, 10000)  // Every 10 seconds

function estimateNetworkQuality() {
  // Simple heuristic: check RTT (round-trip time)
  // 5 = excellent, 0 = no connection
  const timestamp = Date.now()
  
  webrtcClient.socket.emit('ping', { ts: timestamp })
  
  // Listen for pong
  webrtcClient.socket.once('pong', ({ ts }) => {
    const rtt = Date.now() - ts
    
    if (rtt < 20) return 5   // Excellent
    if (rtt < 50) return 4   // Good
    if (rtt < 100) return 3  // Fair
    if (rtt < 200) return 2  // Poor
    return 1                 // Very poor
  })
}
```

### 6.5 Handle Browser Permissions

```javascript
// Check permissions before asking for media
async function checkAndRequestPermissions() {
  try {
    const permissions = await navigator.permissions.query({
      name: 'camera',
    })
    
    if (permissions.state === 'denied') {
      alert('Camera permission denied. Please enable in browser settings.')
      return false
    }
    
    if (permissions.state === 'granted') {
      console.log('✓ Camera permission already granted')
      return true
    }
    
    // Will prompt user
    await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    return true
  } catch (error) {
    alert('Could not access camera: ' + error.message)
    return false
  }
}
```

---

## 7. Troubleshooting

### Issue: "Cannot see remote video"

**Checklist:**
1. ✓ Did `participantJoined` fire in console?
2. ✓ Did your client create offer? (search console for "Generated ICE candidate")
3. ✓ Is `targetParticipantId` in every offer/answer/ICE?
4. ✓ Can you see your own local video?
5. ✓ Are both clients in the same `roomId`?

**Debug:**
```javascript
// Check connection map
console.log('Connected peers:', webrtcClient.peerConnections.size)
console.log('Peer IDs:', Array.from(webrtcClient.peerConnections.keys()))

// Check specific peer connection
const pc = webrtcClient.peerConnections.get('student-xyz')
console.log('Connection state:', pc?.connectionState)
console.log('Signaling state:', pc?.signalingState)
console.log('Remote description:', pc?.remoteDescription)
```

### Issue: "Other participant sees nothing from me"

**Checklist:**
1. ✓ Did `localStream` handler fire?
2. ✓ Are tracks added to each peer connection? (should see in devtools)
3. ✓ Is microphone/camera actually enabled?

**Debug:**
```javascript
// Check local stream
const localStream = webrtcClient.localStream
console.log('Local tracks:', localStream?.getTracks().length)
localStream?.getTracks().forEach(track => {
  console.log(track.kind, track.enabled, track.readyState)
})

// Check tracks on specific peer connection
const pc = webrtcClient.peerConnections.get(peerId)
const senders = pc?.getSenders()
console.log('Sending tracks:', senders?.map(s => s.track))
```

### Issue: "Connection fails after a few seconds"

**Possible causes:**
- JWT token expired
- Socket.IO connection dropped
- ICE candidates not properly applied
- Browser privacy settings blocking STUN

**Debug:**
```javascript
// Monitor socket state
webrtcClient.socket.on('disconnect', (reason) => {
  console.log('Socket disconnected:', reason)
  // Automatically reconnects (configured in webrtc-client.js)
})

webrtcClient.socket.on('connect_error', (error) => {
  console.error('Socket connection error:', error)
})

// Monitor peer connection ICE state
pc.oniceconnectionstatechange = () => {
  console.log('ICE connection state:', pc.iceConnectionState)
}
```

### Issue: "Too much CPU usage"

**Solutions:**
- Reduce video resolution
- Limit frame rate
- Use software encoding instead of hardware

```javascript
await webrtcClient.getLocalStream({
  audio: true,
  video: {
    width: { ideal: 640 },    // Reduce from 1280
    height: { ideal: 480 },   // Reduce from 720
    frameRate: { ideal: 15 },  // Reduce from 30
  },
})
```

---

## 8. Complete Working Example (Vanilla JS)

```html
<!DOCTYPE html>
<html>
<head>
  <title>Zuhr WebRTC Meeting</title>
  <style>
    body { font-family: Arial; margin: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    video { width: 100%; background: #000; }
    button { padding: 10px 20px; margin: 5px; }
  </style>
</head>
<body>
  <h1>Join Meeting</h1>

  <div>
    <input id="roomId" placeholder="Room ID" value="room_test" />
    <input id="serverUrl" placeholder="Server URL" value="http://localhost:3000" />
    <input id="token" type="password" placeholder="Access Token" />
    <button onclick="joinMeeting()">Join</button>
    <button onclick="leaveMeeting()" disabled id="leaveBtn">Leave</button>
  </div>

  <div class="grid">
    <div>
      <h3>Local</h3>
      <video id="localVideo" autoplay muted playsinline></video>
    </div>
    <div id="remoteContainer" style="display: grid; gap: 10px;"></div>
  </div>

  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script src="webrtc-client.js"></script>
  <script>
    let webrtcClient = null

    async function joinMeeting() {
      const roomId = document.getElementById('roomId').value
      const serverUrl = document.getElementById('serverUrl').value
      const token = document.getElementById('token').value

      try {
        const socket = io(serverUrl, { auth: { token } })
        webrtcClient = new WebRTCClient(socket)

        webrtcClient.on('localStream', (stream) => {
          document.getElementById('localVideo').srcObject = stream
        })

        webrtcClient.on('remoteStream', (id, stream) => {
          const container = document.getElementById('remoteContainer')
          let video = container.querySelector(`#video-${id}`)
          if (!video) {
            video = document.createElement('video')
            video.id = `video-${id}`
            video.autoplay = true
            video.playsinline = true
            container.appendChild(video)
          }
          video.srcObject = stream
        })

        webrtcClient.on('remoteStreamRemoved', (id) => {
          const video = document.getElementById(`video-${id}`)
          if (video) video.remove()
        })

        webrtcClient.on('error', (err) => {
          alert('Error: ' + err.message)
        })

        await webrtcClient.getLocalStream()
        await webrtcClient.joinRoom(roomId, `user-${Date.now()}`)

        document.getElementById('leaveBtn').disabled = false
      } catch (error) {
        alert('Join failed: ' + error.message)
      }
    }

    async function leaveMeeting() {
      if (webrtcClient) {
        await webrtcClient.leaveRoom()
        webrtcClient.stopLocalStream()
        document.getElementById('remoteContainer').innerHTML = ''
        document.getElementById('leaveBtn').disabled = true
      }
    }
  </script>
</body>
</html>
```

---

## 9. Testing Checklist

Before deploying, verify:

- [ ] Local video appears when you join
- [ ] Multiple tabs see each other's video
- [ ] Remote video streams are smooth
- [ ] Audio works both directions
- [ ] Clicking "Leave" stops video properly
- [ ] Participants can rejoin immediately
- [ ] Works with 2, 3, and 5 participants
- [ ] No memory leaks (check DevTools Memory)
- [ ] Browser console shows no errors
- [ ] Network tab shows signaling events

---

## 10. Production Checklist

Before going live:

- [ ] Use HTTPS + WSS (secure WebSocket)
- [ ] Set short JWT expiration (15-30 min)
- [ ] Implement token refresh
- [ ] Configure CORS_ORIGINS on backend
- [ ] Monitor WebRTC stats
- [ ] Log errors to backend
- [ ] Test on real networks (not just localhost)
- [ ] Test on mobile devices
- [ ] Handle poor network gracefully
- [ ] Have fallback if WebRTC fails

---

## 11. API Reference: WebRTCClient Methods

```javascript
// Constructor
new WebRTCClient(socket, config)

// Methods
await webrtcClient.getLocalStream(constraints)
webrtcClient.stopLocalStream()
await webrtcClient.joinRoom(roomId, participantId)
await webrtcClient.leaveRoom()
webrtcClient.on(eventName, handler)
webrtcClient.getRemoteStream(participantId)
webrtcClient.getConnectedParticipants()  // Returns array of IDs
webrtcClient.closePeerConnection(participantId)

// Properties
webrtcClient.localStream          // MediaStream
webrtcClient.peerConnections      // Map<id, RTCPeerConnection>
webrtcClient.remoteStreams        // Map<id, MediaStream>
webrtcClient.roomId               // Current room
webrtcClient.participantId        // Your participant ID
webrtcClient.socket               // Socket.IO instance

// Events
webrtcClient.on('localStream', (stream) => {})
webrtcClient.on('remoteStream', (id, stream) => {})
webrtcClient.on('remoteStreamRemoved', (id) => {})
webrtcClient.on('participantJoined', (info) => {})
webrtcClient.on('participantLeft', (info) => {})
webrtcClient.on('error', (error) => {})
```

---

## 12. Support & Resources

- **Architecture details:** See `WEBRTC_AUDIT_REPORT.md`
- **Integration examples:** See `meeting.html`
- **Backend docs:** See `README.md` (main project README)
- **Socket events:** See `packages/shared/src/socket-events.ts`
- **Server code:** `src/realtime/webrtc.socket.js`

---

**Happy building! 🎥**
