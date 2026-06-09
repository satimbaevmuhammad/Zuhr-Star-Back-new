# WebRTC Meeting System - Frontend Integration Guide

## Overview
Complete frontend solution for teachers to create meetings and share auto-joining links with students.

---

## Architecture

```
Teacher Dashboard (/teacher)
    ↓
    Creates Meeting (REST API)
    ↓
    Gets Room ID + Generate Student Links
    ↓
    Shares Links with Students (via SMS/Email/etc)
    ↓
Student Joins (/join?roomId=...&token=...)
    ↓
    Auto-joins Meeting (/meeting)
    ↓
    WebRTC Connect (Socket.IO)
    ↓
    Video/Audio Stream
```

---

## Pages & Routes

### 1. **Teacher Dashboard** - `/teacher`
**What teacher does:**
- Enter their name
- Enter class name
- Enter JWT token
- Click "Create Meeting"
- System generates **Room ID**
- Gets unique links for each student
- Can join meeting or share links

**Files involved:**
- `/public/teacher.html` (Frontend)
- REST API: `POST /api/webrtc/rooms` (Backend)

**Flow:**
```javascript
// Frontend action
POST /api/webrtc/rooms
Headers: Authorization: Bearer TEACHER_TOKEN
Body: { displayName: "Teacher 1" }

// Response
{
  roomId: "room_123abc",
  participantId: "teach_xyz",
  admitted: true
}
```

---

### 2. **Auto-Join Page** - `/join`
**What student sees:**
- Loading screen "Joining Meeting..."
- Automatically calls REST API to join room
- Redirects to meeting page with all data pre-filled

**Files involved:**
- `/public/join.html` (Frontend)
- REST API: `POST /api/webrtc/rooms/{roomId}/join` (Backend)

**URL Format:**
```
http://localhost:3000/join?roomId=ROOM_ID&token=STUDENT_TOKEN&displayName=Student%20Name
```

**Flow:**
```javascript
// Frontend action (automatic)
POST /api/webrtc/rooms/{roomId}/join
Headers: Authorization: Bearer STUDENT_TOKEN
Body: { displayName: "Student 1" }

// Response
{
  participantId: "student_123",
  admitted: true,
  roomId: "room_123abc"
}

// Then redirect to:
/meeting?roomId=room_123abc&accessToken=STUDENT_TOKEN&displayName=Student%201&participantId=student_123
```

---

### 3. **Meeting Room** - `/meeting`
**What everyone sees:**
- Their own video (top-left)
- All other participants' videos in grid
- Connected participants list
- Leave button

**Files involved:**
- `/public/meeting.html` (Frontend)
- `/public/webrtc-client.js` (WebRTC Logic)
- Socket.IO: `joinRoom`, `offer`, `answer`, `iceCandidate` events (Backend)

**Initialization:**
```javascript
// URL params (auto-filled from /join)
const roomId = "room_123abc"
const participantId = "student_123"
const accessToken = "JWT_TOKEN"

// 1. Connect WebRTC client
socket = io(SERVER_URL, { auth: { token: accessToken } })
webrtcClient = new WebRTCClient(socket)

// 2. Get local media
await webrtcClient.getLocalStream()

// 3. Join room
await webrtcClient.joinRoom(roomId, participantId)

// 4. Listen for remote streams
webrtcClient.on('remoteStream', (participantId, stream) => {
  // Add video element for remote participant
})
```

---

## Complete Student Journey

### **Scenario: Teacher wants 3 students in meeting**

#### **Step 1: Teacher Creates Meeting**
```
URL: http://localhost:3000/teacher

Action:
- Name: "Mr. Ahmed"
- Class: "English 101"
- Token: "eyJhbGc..." (JWT)
- Click: "Create Meeting"

Result:
- Room ID: room_1718043600000
- Teacher can now generate student links
```

#### **Step 2: System Generates Student Links**

```javascript
// Backend generates these for teacher to share:

// Link 1 (for Ali)
http://localhost:3000/join?
  roomId=room_1718043600000&
  token=eyJhbGc_student1_jwt&
  displayName=Ali

// Link 2 (for Fatima)
http://localhost:3000/join?
  roomId=room_1718043600000&
  token=eyJhbGc_student2_jwt&
  displayName=Fatima

// Link 3 (for Hassan)
http://localhost:3000/join?
  roomId=room_1718043600000&
  token=eyJhbGc_student3_jwt&
  displayName=Hassan
```

#### **Step 3: Teacher Joins Meeting**
```
Action: Click "Join Meeting" button
Result: Redirects to /meeting with teacher info
```

#### **Step 4: Students Click Their Links**
```
Ali clicks: http://localhost:3000/join?roomId=...&token=...&displayName=Ali
↓
/join page loads
↓
Auto-joins room (REST API call)
↓
Redirects to /meeting page
↓
WebRTC connects
↓
Ali's video appears for everyone
```

**Same for Fatima and Hassan**

---

## Frontend Components

### **1. WebRTC Client** (`/public/webrtc-client.js`)
Handles:
- Local media capture (camera/mic)
- Peer connections (1 per student)
- Signaling (offer/answer/ICE)
- Event handlers for UI updates

**Key methods:**
```javascript
webrtcClient.getLocalStream()           // Get camera/mic
webrtcClient.joinRoom(roomId, participantId)  // Join meeting
webrtcClient.on('remoteStream', callback)    // Listen for videos
webrtcClient.leaveRoom()                // Disconnect
```

### **2. Meeting Page** (`/public/meeting.html`)
Displays:
- Video grid (CSS Grid)
- Connected participants list
- Leave button
- Status messages

**Event handlers:**
```javascript
webrtcClient.on('remoteStream', (id, stream) => {
  // Create video element
  // Add to grid
  // Start playing
})

webrtcClient.on('participantLeft', (id) => {
  // Remove video element
  // Update participants list
})
```

### **3. Teacher Dashboard** (`/public/teacher.html`)
Features:
- Create meeting form
- Display room ID
- Generate/copy student links
- Join meeting button
- Persists data in localStorage

---

## API Integration

### **Create Room** (Teacher action)
```
POST /api/webrtc/rooms
Authorization: Bearer TEACHER_TOKEN
{
  "title": "English 101 Class"
}

Response (201 or 200):
{
  "roomId": "room_f768570b-a770-4e9d-b3ba-c54fce36e006",
  "meetingId": "6a2727bae91fb066d31a9f62",
  "participantId": "employee-69ce7a691a7c1a90f611b46b",
  "title": "English 101 Class",
  "state": "ACTIVE",
  "admitted": true
}
```

### **Join Room** (Student action)
```
POST /api/webrtc/rooms/{roomId}/join
Authorization: Bearer STUDENT_TOKEN
{
  "displayName": "Ali"
}

Response (200):
{
  "participantId": "student-123-xyz",
  "roomId": "room_f768570b-a770-4e9d-b3ba-c54fce36e006",
  "admitted": true,
  "displayName": "Ali"
}
```

### **Get Room Details** (Get participants list)
```
GET /api/webrtc/rooms/{roomId}
Authorization: Bearer TOKEN

Response (200):
{
  "room": {
    "_id": "6a2727bae91fb066d31a9f62",
    "roomId": "room_f768570b-a770-4e9d-b3ba-c54fce36e006",
    "title": "English 101 Class",
    "state": "ACTIVE",
    "participants": [
      {
        "participantId": "employee-69ce7a691a7c1a90f611b46b",
        "userId": "69ce7a691a7c1a90f611b46b",
        "displayName": "Mr. Ahmed (Teacher)",
        "role": "teacher",
        "admitted": true,
        "joinedAt": "2026-06-08T20:36:10.507Z",
        "leftAt": null
      },
      {
        "participantId": "student-123-xyz",
        "userId": "student-123",
        "displayName": "Ali",
        "role": "student",
        "admitted": true,
        "joinedAt": "2026-06-08T20:36:15.123Z",
        "leftAt": null
      }
    ]
  }
}
```

### **Leave Room**
```
POST /api/webrtc/rooms/{roomId}/leave
Authorization: Bearer TOKEN
{
  "participantId": "student-123-xyz"
}

Response (200):
{
  "message": "Successfully left room"
}
```

---

## Socket.IO Events

### **Client → Server**

**1. Join Room**
```javascript
socket.emit('joinRoom', {
  roomId: 'room_123',
  payload: { participantId: 'student_123' }
}, (response) => {
  console.log('Joined:', response)
})
```

**2. Send Offer**
```javascript
socket.emit('offer', {
  roomId: 'room_123',
  payload: {
    targetParticipantId: 'student_456',
    sdp: RTCSessionDescription
  }
})
```

**3. Send Answer**
```javascript
socket.emit('answer', {
  roomId: 'room_123',
  payload: {
    targetParticipantId: 'student_456',
    sdp: RTCSessionDescription
  }
})
```

**4. Send ICE Candidate**
```javascript
socket.emit('iceCandidate', {
  roomId: 'room_123',
  payload: {
    targetParticipantId: 'student_456',
    candidate: RTCIceCandidate
  }
})
```

### **Server → Client**

**1. Room Participants**
```javascript
socket.on('roomParticipants', (event) => {
  const { participants } = event.payload
  // Create connections to all participants
})
```

**2. Participant Joined**
```javascript
socket.on('participantJoined', (event) => {
  const { participantId, displayName } = event.payload
  // Create connection to new participant
})
```

**3. Receive Offer**
```javascript
socket.on('offer', (event) => {
  const { fromParticipantId, sdp } = event.payload
  // Create answer and send back
})
```

**4. Receive Answer**
```javascript
socket.on('answer', (event) => {
  const { fromParticipantId, sdp } = event.payload
  // Set remote description
})
```

**5. Receive ICE Candidate**
```javascript
socket.on('iceCandidate', (event) => {
  const { fromParticipantId, candidate } = event.payload
  // Add to peer connection
})
```

---

## Frontend Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    TEACHER DASHBOARD                         │
│  Input: Name, Class, Token                                   │
│  Action: Create Meeting                                      │
│  Output: Room ID, Student Links                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                   REST API Call
                    Create Room
                         │
                         ↓
        ┌─────────────────────────────────┐
        │   Backend Room Created          │
        │   roomId: room_123              │
        │   participantId: teach_xyz      │
        └─────────────────────┬───────────┘
                              │
        ┌─────────────────────┴───────────┐
        │                                 │
        ↓                                 ↓
  ┌──────────────────┐          ┌──────────────────┐
  │  Teacher Joins   │          │ Student 1 Joins  │
  │   /meeting       │          │    /join         │
  └────────┬─────────┘          └────────┬─────────┘
           │                             │
           │                    Auto REST Call
           │                    Join Room
           │                             │
           │                             ↓
           │                    ┌──────────────────┐
           │                    │ Backend: Joined  │
           │                    │ participantId: s1│
           │                    └────────┬─────────┘
           │                             │
           │                    Redirect /meeting
           │                             │
           └────────────┬────────────────┘
                        │
                   Socket.IO Connect
                        │
                        ↓
           ┌────────────────────────────┐
           │  joinRoom Socket Event     │
           │  Server broadcasts to all  │
           └────────────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ↓                           ↓
        ┌──────────────┐          ┌──────────────┐
        │ Create Offer │          │ Create Answer│
        │ Send via     │          │ Send via     │
        │ Socket       │          │ Socket       │
        └──────────────┘          └──────────────┘
              │                           │
              └─────────────┬─────────────┘
                            │
                   Exchange ICE Candidates
                            │
                            ↓
                   WebRTC Connected
                            │
                            ↓
            ┌───────────────────────────┐
            │  Both See Each Other's    │
            │  Video in Real-Time ✅    │
            └───────────────────────────┘
```

---

## Testing Checklist

- [ ] Teacher can create meeting (go to `/teacher`)
- [ ] Room ID is displayed
- [ ] Teacher can join meeting (see their own video)
- [ ] Student link is generated
- [ ] Student can click link and auto-joins
- [ ] Student sees their own video
- [ ] Teacher sees student's video
- [ ] Student sees teacher's video
- [ ] Multiple students can join same room
- [ ] All can see each other simultaneously
- [ ] Participants list updates in real-time
- [ ] When someone leaves, video disappears

---

## Troubleshooting

**"Route not found" error:**
- Make sure server is running on port 3000
- Check URL spelling: `/teacher`, `/join`, `/meeting`

**"No video showing":**
- Check browser permissions (camera/mic)
- Check console for errors
- Verify WebRTC client is loading (`/public/webrtc-client.js`)

**"Can't see other person":**
- Check both are in same room (same roomId)
- Check Socket.IO connected (look for `socket connected` in console)
- Check peer connections created

**"Signaling failed":**
- Check backend is running
- Check JWT token is valid
- Check `/api/webrtc/rooms/{roomId}/join` endpoint

---

## Security Notes

- Store JWT tokens securely (not in URL in production)
- Use HTTPS in production
- Validate all Socket.IO events on backend
- Rate-limit room creation
- Authenticate all endpoints

---

## Next Steps

1. **Deploy:** Move to production server
2. **Database:** Store meeting history
3. **Recording:** Add video recording feature
4. **Chat:** Add text chat functionality
5. **Screen Sharing:** Add screen share option

