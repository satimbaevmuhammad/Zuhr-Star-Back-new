require('dotenv').config();

const http = require('http');
const connectDB = require('./src/config/db');
const app = require('./app');
const { attachWebRtcSocketServer } = require('./src/realtime/webrtc.socket');

const port = process.env.PORT || 3000;
const server = http.createServer(app);

attachWebRtcSocketServer(server);

console.log("ENV TEST:", process.env.MONGO_URI);

// Start server immediately
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`WebRTC signaling is available on Socket.IO path /socket.io`);
});

// DB connect in background
connectDB().catch((error) => {
  console.error('All MongoDB connection attempts failed:', error.message);
  console.error('Server is running but DB is unavailable.');
});
