# WebRTC Meeting - Quick Start Guide

## 3-Minute Setup

### **For Teachers:**

**1. Go to Teacher Dashboard**
```
http://localhost:3000/teacher
```

**2. Fill in Your Details**
```
Your Name:     Mr. Ahmed
Class Name:    English 101
Server URL:    http://localhost:3000
Your Token:    [paste your JWT]
```

**3. Click "Create Meeting"**
You'll get: **Room ID** ✅

**4. Share Student Links**
System shows:
```
Student 1: http://localhost:3000/join?roomId=room_123&token=token1&displayName=Ali
Student 2: http://localhost:3000/join?roomId=room_123&token=token2&displayName=Fatima
Student 3: http://localhost:3000/join?roomId=room_123&token=token3&displayName=Hassan
```

**5. Click "Join Meeting"**
You enter the meeting alone (waiting for students)

---

### **For Students:**

**1. Click the link teacher sent**
```
http://localhost:3000/join?roomId=...&token=...&displayName=...
```

**2. Wait for loading screen (2-3 seconds)**
- Auto-joins the room
- Requests camera/mic access

**3. Click "Allow" for camera/mic**

**4. See everyone's videos** ✅

---

## What You'll See

### **Teacher View:**
- Your own video (top-left)
- Student videos as they join
- "Connected Participants" list updating

### **Student View:**
- Your own video (top-left)
- Teacher's video
- Other students' videos
- All in a grid

---

## Testing (Do This First!)

### **Terminal 1: Start Server**
```bash
npm start
```

### **Terminal 2: Run Tests**
```bash
npm run test:webrtc
```

Should see: ✅ All Tests Passed!

### **Browser: Manual Test**

**Tab 1 (Teacher):**
```
http://localhost:3000/teacher
- Create Name: "Teacher"
- Click: Create Meeting
- Click: Join Meeting
```

**Tab 2 (Student 1):**
```
http://localhost:3000/join?roomId=[COPY_FROM_TAB_1]&token=[YOUR_JWT]&displayName=Student1
```

**Tab 3 (Student 2):**
```
http://localhost:3000/join?roomId=[SAME_ID]&token=[YOUR_JWT]&displayName=Student2
```

**Result:** All 3 tabs show videos of each other ✅

---

## How It Works Under the Hood

```
Teacher Creates Meeting
    ↓
    REST: POST /api/webrtc/rooms → Get Room ID
    ↓
Teacher Joins
    ↓
    REST: POST /api/webrtc/rooms/{roomId}/join → Get Participant ID
    ↓
    Socket.IO: Connect with JWT token
    ↓
    Socket Event: joinRoom → Server broadcasts to all
    ↓

Students Click Link
    ↓
    Auto-join page loads
    ↓
    REST: POST /api/webrtc/rooms/{roomId}/join
    ↓
    Redirects to /meeting page
    ↓
    Socket.IO: Connect
    ↓
    WebRTC Offer/Answer exchange
    ↓
    ICE Candidates exchanged
    ↓
    Video streams received
    ↓

Everyone Sees Each Other ✅
```

---

## Files Involved

| File | What it does |
|------|------------|
| `/teacher` | Teacher creates meetings and gets links |
| `/join` | Auto-join page for students |
| `/meeting` | Main video conference room |
| `/public/webrtc-client.js` | Handles WebRTC connections |
| `/public/teacher.html` | Teacher dashboard UI |
| `/public/join.html` | Auto-join loading page |
| `/public/meeting.html` | Video room UI |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Route not found" | Server not running on 3000 |
| "No video" | Allow camera permission when asked |
| "Can't see others" | Check both in same room (same roomId) |
| "Stuck on loading" | Check browser console for errors |
| "Token error" | Make sure JWT is valid |

---

## Production Checklist

- [ ] Replace `http://localhost:3000` with actual server URL
- [ ] Use HTTPS instead of HTTP
- [ ] Add room password protection
- [ ] Add end-to-end encryption
- [ ] Add room recording
- [ ] Add analytics/logging
- [ ] Set rate limits on room creation
- [ ] Add database to persist room history

---

## Example URLs

### **For Development:**
```
Teacher:   http://localhost:3000/teacher
Student 1: http://localhost:3000/join?roomId=test_123&token=jwt_1&displayName=Ali
Student 2: http://localhost:3000/join?roomId=test_123&token=jwt_2&displayName=Fatima
```

### **For Production:**
```
Teacher:   https://yourdomain.com/teacher
Student 1: https://yourdomain.com/join?roomId=test_123&token=jwt_1&displayName=Ali
Student 2: https://yourdomain.com/join?roomId=test_123&token=jwt_2&displayName=Fatima
```

---

## Next Features to Add

1. **Mute/Unmute Button** - Control audio
2. **Camera On/Off Button** - Control video
3. **Screen Sharing** - Share screen with class
4. **Recording** - Record the meeting
5. **Chat** - Text message in meeting
6. **Reactions** - Emoji reactions
7. **Raised Hand** - Request to speak
8. **Meeting History** - Save past meetings
9. **Invite Link** - Copy/share meeting link
10. **Meeting Settings** - Lock room, set time limit

