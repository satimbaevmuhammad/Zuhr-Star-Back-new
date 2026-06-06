# Zuhr WebRTC Client Documentation

## 📚 Start Here: Choose Your Path

### 🚀 I want to integrate WebRTC in 5 minutes
→ Read [QUICK_REF.md](./QUICK_REF.md) (cheat sheet)

### 📖 I want a complete tutorial with examples
→ Read [FRONTEND_GUIDE.md](./FRONTEND_GUIDE.md) (comprehensive)

### 🔍 I want to understand the bugs that were fixed
→ Read [WEBRTC_AUDIT_REPORT.md](./WEBRTC_AUDIT_REPORT.md) (technical deep-dive)

### 💡 I want to see a working example
→ Open [src/meeting.html](./src/meeting.html) in your browser

### ⚙️ I want quick start examples
→ Read [QUICK_START.md](./QUICK_START.md) (integration patterns)

### 📋 I want the executive summary
→ Read [FIX_SUMMARY.md](./FIX_SUMMARY.md) (overview)

---

## 📁 What's In This Directory

```
packages/client/
├── src/
│   ├── webrtc-client.js         ← ⭐ Main library (156 lines)
│   └── meeting.html             ← ⭐ Working demo (copy patterns)
│
├── FRONTEND_GUIDE.md            ← Complete integration guide
├── QUICK_REF.md                 ← Quick reference card
├── QUICK_START.md               ← Integration examples
├── WEBRTC_AUDIT_REPORT.md       ← Technical audit of 7 bugs
├── FIX_SUMMARY.md               ← Executive summary
└── README.md                     ← This file
```

---

## 🎯 Quick Start (30 seconds)

### 1. Copy the library
```bash
cp packages/client/src/webrtc-client.js src/services/
npm install socket.io-client
```

### 2. Use it in your code
```javascript
import WebRTCClient from './services/webrtc-client.js'
import io from 'socket.io-client'

const socket = io('http://localhost:3000', { auth: { token } })
const client = new WebRTCClient(socket)

client.on('remoteStream', (id, stream) => {
  videoEl.srcObject = stream
})

await client.getLocalStream()
await client.joinRoom('room_123', 'user-123')
```

### 3. Done! ✓
Students can now see and hear each other.

---

## 🏗️ Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: REST API (HTTP)                                │
│ POST /api/webrtc/rooms/:roomId/join                     │
│ Returns: admitted (true/false), participantId           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Socket.IO (WebSocket)                          │
│ Signaling: offer, answer, iceCandidate                 │
│ Presence: participantJoined, participantLeft           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ Layer 3: WebRTC P2P (Direct peer-to-peer)              │
│ Audio/video streams flow directly browser-to-browser   │
└─────────────────────────────────────────────────────────┘
```

**Key insight:** REST handles rooms, Socket.IO handles signaling, WebRTC carries media.

---

## 🐛 What Was Fixed

| Bug | Impact | Fixed |
|-----|--------|-------|
| 1. No offer on participantJoined | No peer connections formed | ✅ |
| 2. Single peerConnection variable | Only works for 2 people | ✅ |
| 3. ICE candidate race condition | Connections fail | ✅ |
| 4. Missing targetParticipantId | Confused signaling with 3+ peers | ✅ |
| 5. Tracks not added to new connections | Asymmetric media | ✅ |
| 6. Stale connections on rejoin | Memory leaks, state corruption | ✅ |
| 7. No signalingState guard | InvalidStateError crashes | ✅ |

**All 7 bugs are fixed in `webrtc-client.js`**

---

## 📖 Documentation Roadmap

### For Frontend Developers Getting Started
1. **QUICK_REF.md** (5 min) — Copy-paste templates
2. **FRONTEND_GUIDE.md** (30 min) — Full tutorial with React example
3. **QUICK_START.md** (10 min) — Integration recipes

### For Understanding the Implementation
4. **WEBRTC_AUDIT_REPORT.md** — Why each bug occurred & how it was fixed
5. **FIX_SUMMARY.md** — Executive summary
6. **webrtc-client.js source code** — Inline comments explain every fix

### For Testing & Debugging
7. **meeting.html** — Standalone demo (just open in browser)
8. FRONTEND_GUIDE.md → Section 7: "Troubleshooting"
9. QUICK_REF.md → Section 7: "Debug Commands"

---

## 💻 Integration Paths

### Vanilla JavaScript
```javascript
import WebRTCClient from './webrtc-client.js'

const socket = io(serverUrl, { auth: { token } })
const client = new WebRTCClient(socket)

client.on('remoteStream', (id, stream) => {
  // Handle remote video
})

await client.getLocalStream()
await client.joinRoom(roomId, participantId)
```

### React (with hooks)
```jsx
function MeetingRoom() {
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const clientRef = useRef(null)

  useEffect(() => {
    const setup = async () => {
      const socket = io(serverUrl, { auth: { token } })
      const client = new WebRTCClient(socket)
      clientRef.current = client

      client.on('remoteStream', (id, stream) => {
        setRemoteStreams(m => new Map(m).set(id, stream))
      })

      await client.getLocalStream()
      await client.joinRoom(roomId, participantId)
    }

    setup()
    return () => clientRef.current?.leaveRoom()
  }, [])

  return (
    <div className="grid">
      {Array.from(remoteStreams.values()).map((stream, i) => (
        <video key={i} srcObject={stream} autoPlay />
      ))}
    </div>
  )
}
```

### Vue 3
```vue
<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import WebRTCClient from './webrtc-client.js'

const remoteStreams = ref(new Map())
let client = null

onMounted(async () => {
  const socket = io(serverUrl, { auth: { token } })
  client = new WebRTCClient(socket)

  client.on('remoteStream', (id, stream) => {
    remoteStreams.value.set(id, stream)
  })

  await client.getLocalStream()
  await client.joinRoom(roomId, participantId)
})

onUnmounted(async () => {
  await client?.leaveRoom()
})
</script>

<template>
  <div class="grid">
    <video
      v-for="[id, stream] in remoteStreams"
      :key="id"
      :src-object="stream"
      autoplay
    />
  </div>
</template>
```

---

## 🧪 Test It Locally (1 minute)

### 1. Start the backend
```bash
cd Zuhr-Star-Back-new && npm start
# Backend runs on http://localhost:3000
```

### 2. Open the demo
```bash
# In another terminal
cd packages/client/src
npx http-server . -p 8080
# Open http://localhost:8080/meeting.html
```

### 3. Test with multiple tabs
- Open 2-3 browser tabs to `http://localhost:8080/meeting.html`
- Use **same Room ID**, **different names**
- Click "Join Meeting"
- ✓ You should see all participants' videos live!

---

## 🔐 Security Checklist

- [ ] Use HTTPS (not HTTP)
- [ ] Use WSS (wss://, not ws://)
- [ ] JWT tokens short-lived (15-30 min)
- [ ] Implement token refresh before expiry
- [ ] Validate token on every request
- [ ] Configure CORS_ORIGINS on backend
- [ ] Limit participants (P2P max 6-10)
- [ ] Monitor for abuse

---

## 🎥 API Reference

### Constructor
```javascript
const client = new WebRTCClient(socket, config)
```

### Methods
```javascript
await client.getLocalStream(constraints)
await client.joinRoom(roomId, participantId)
await client.leaveRoom()
client.stopLocalStream()
client.on(eventName, handler)
client.getRemoteStream(participantId)
client.getConnectedParticipants()
```

### Events
```javascript
client.on('localStream', stream => {})           // Your camera ready
client.on('remoteStream', (id, stream) => {})    // Peer video received
client.on('remoteStreamRemoved', id => {})       // Peer disconnected
client.on('participantJoined', info => {})       // Someone joined room
client.on('participantLeft', info => {})         // Someone left room
client.on('error', error => {})                  // Error occurred
```

### Properties
```javascript
client.localStream              // MediaStream
client.peerConnections          // Map<id, RTCPeerConnection>
client.remoteStreams            // Map<id, MediaStream>
client.roomId                   // Current room ID
client.participantId            // Your participant ID
client.socket                   // Socket.IO instance
```

---

## 🆘 Common Issues

| Problem | Solution |
|---------|----------|
| "Cannot see remote video" | Verify both in same room, check console for errors |
| "Only 1 peer's video visible" | Use webrtc-client.js (handles Map of connections) |
| "Connection drops after 30s" | Refresh JWT token before join |
| "Permission denied" | Allow camera/mic in browser settings |
| "High CPU usage" | Reduce video resolution in constraints |

See **FRONTEND_GUIDE.md → Section 7** for detailed troubleshooting.

---

## 🚀 Deployment

### Prerequisites
- HTTPS enabled
- WSS (secure WebSocket) configured
- JWT refresh token logic
- Error monitoring (e.g., Sentry)

### Deployment Steps
1. Copy `webrtc-client.js` to your frontend project
2. Update serverUrl from `localhost:3000` to your production domain
3. Ensure JWT tokens are refreshed before expiry
4. Configure CORS on backend
5. Test with real network (not localhost)
6. Monitor connection quality & errors

---

## 📞 Support

- **Questions about integration?** → See FRONTEND_GUIDE.md
- **Need copy-paste examples?** → See QUICK_START.md
- **Want to understand the bugs?** → See WEBRTC_AUDIT_REPORT.md
- **Need a quick reference?** → See QUICK_REF.md
- **Want a working demo?** → Open meeting.html

---

## 📦 What You Get

✅ Production-ready WebRTC client (156 lines)  
✅ Handles all 7 known bugs  
✅ Works with 2-N participants  
✅ Full error handling  
✅ Comprehensive documentation  
✅ Working demo (meeting.html)  
✅ React & Vue examples  
✅ Troubleshooting guide  

---

## 🎓 Learning Resources

- **WebRTC MDN Docs:** https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API
- **Socket.IO Docs:** https://socket.io/docs/
- **RTCPeerConnection:** https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection
- **SDP (Session Description Protocol):** https://tools.ietf.org/html/rfc4566

---

## 🤝 Contributing

Found a bug? Want to improve docs?

1. Test with the provided demo
2. Document the issue
3. Check WEBRTC_AUDIT_REPORT.md for known issues
4. Submit feedback

---

**Ready to build? Start with [QUICK_REF.md](./QUICK_REF.md) or [FRONTEND_GUIDE.md](./FRONTEND_GUIDE.md)!** 🚀
