const dotenv = require('dotenv')
dotenv.config()

const connectDB = require('./src/config/db')
const app = require('./app')

const port = Number(process.env.PORT) || 3000

// Start the HTTP server immediately so nodemon doesn't crash
app.listen(port, () => {
	console.log(`Server is running on port ${port}`)
})

// Connect to MongoDB in the background with retry logic
connectDB().catch(error => {
	console.error('All MongoDB connection attempts failed:', error.message)
	console.error('Server is running but DB is unavailable. Restart to retry.')
})
