const dotenv = require('dotenv')
dotenv.config()

const connectDB = require('./src/config/db')
const app = require('./app')

const port = Number(process.env.PORT) || 3000

const startServer = async () => {
	try {
		await connectDB()
		app.listen(port, () => {
			console.log(`Server is running on port ${port}`)
		})
	} catch (error) {
		console.error('Failed to start server:', error.message)
		process.exit(1)
	}
}

startServer()
