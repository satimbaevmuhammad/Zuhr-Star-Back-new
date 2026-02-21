const multer = require('multer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const uploadDir = path.join(process.cwd(), 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadDir)
	},
	filename: function (req, file, cb) {
		const extension = path.extname(file.originalname).toLowerCase()
		const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`
		cb(null, uniqueName)
	},
})

const fileFilter = (req, file, cb) => {
	if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
		return cb(new Error('Only JPG, PNG, or WEBP images are allowed'))
	}

	cb(null, true)
}

const upload = multer({
	storage,
	limits: {
		fileSize: MAX_FILE_SIZE,
		files: 1,
	},
	fileFilter,
})

const uploadAvatar = (req, res, next) => {
	upload.single('avatar')(req, res, error => {
		if (!error) {
			return next()
		}

		if (error instanceof multer.MulterError) {
			if (error.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({ message: 'Avatar size must be 2MB or less' })
			}
			return res.status(400).json({ message: error.message })
		}

		return res.status(400).json({ message: error.message })
	})
}

module.exports = {
	upload,
	uploadAvatar,
}
