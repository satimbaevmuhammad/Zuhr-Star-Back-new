const multer = require('multer')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const uploadDir = path.join(process.cwd(), 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const ALLOWED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const MAX_LESSON_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024 // 25MB
const MAX_HOMEWORK_FILE_SIZE = 25 * 1024 * 1024 // 25MB

const ALLOWED_LESSON_DOCUMENT_MIME_TYPES = new Set([
	'application/pdf',
	'application/msword',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.ms-excel',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.ms-powerpoint',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'text/plain',
	'text/csv',
	'application/rtf',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.spreadsheet',
	'application/vnd.oasis.opendocument.presentation',
	'application/zip',
	'application/x-rar-compressed',
	'application/octet-stream',
])

const ALLOWED_LESSON_DOCUMENT_EXTENSIONS = new Set([
	'.pdf',
	'.doc',
	'.docx',
	'.xls',
	'.xlsx',
	'.ppt',
	'.pptx',
	'.txt',
	'.csv',
	'.rtf',
	'.odt',
	'.ods',
	'.odp',
	'.zip',
	'.rar',
])

const ALLOWED_HOMEWORK_MIME_TYPES = new Set([
	...ALLOWED_LESSON_DOCUMENT_MIME_TYPES,
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
])

const ALLOWED_HOMEWORK_EXTENSIONS = new Set([
	...ALLOWED_LESSON_DOCUMENT_EXTENSIONS,
	'.jpg',
	'.jpeg',
	'.png',
	'.webp',
	'.gif',
])

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

const avatarFileFilter = (req, file, cb) => {
	if (!ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
		return cb(new Error('Only JPG, PNG, or WEBP images are allowed'))
	}

	cb(null, true)
}

const lessonDocumentFileFilter = (req, file, cb) => {
	const extension = path.extname(file.originalname || '').toLowerCase()
	const allowedMime = ALLOWED_LESSON_DOCUMENT_MIME_TYPES.has(file.mimetype)
	const allowedExtension = ALLOWED_LESSON_DOCUMENT_EXTENSIONS.has(extension)

	if (!allowedMime && !allowedExtension) {
		return cb(
			new Error(
				'Only document files are allowed (pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, rtf, odt, ods, odp, zip, rar)',
			),
		)
	}

	cb(null, true)
}

const homeworkFileFilter = (req, file, cb) => {
	const extension = path.extname(file.originalname || '').toLowerCase()
	const allowedMime = ALLOWED_HOMEWORK_MIME_TYPES.has(file.mimetype)
	const allowedExtension = ALLOWED_HOMEWORK_EXTENSIONS.has(extension)

	if (!allowedMime && !allowedExtension) {
		return cb(
			new Error(
				'Only document or image files are allowed (pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, rtf, odt, ods, odp, zip, rar, jpg, jpeg, png, webp, gif)',
			),
		)
	}

	cb(null, true)
}

const avatarUpload = multer({
	storage,
	limits: {
		fileSize: MAX_AVATAR_FILE_SIZE,
		files: 1,
	},
	fileFilter: avatarFileFilter,
})

const lessonDocumentUpload = multer({
	storage,
	limits: {
		fileSize: MAX_LESSON_DOCUMENT_FILE_SIZE,
		files: 1,
	},
	fileFilter: lessonDocumentFileFilter,
})

const homeworkUpload = multer({
	storage,
	limits: {
		fileSize: MAX_HOMEWORK_FILE_SIZE,
		files: 1,
	},
	fileFilter: homeworkFileFilter,
})

const uploadAvatar = (req, res, next) => {
	avatarUpload.single('avatar')(req, res, error => {
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

const uploadLessonDocument = (req, res, next) => {
	lessonDocumentUpload.single('document')(req, res, error => {
		if (!error) {
			return next()
		}

		if (error instanceof multer.MulterError) {
			if (error.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({
					message: 'Document size must be 25MB or less',
				})
			}
			return res.status(400).json({ message: error.message })
		}

		return res.status(400).json({ message: error.message })
	})
}

const uploadHomeworkAttachment = (req, res, next) => {
	homeworkUpload.single('document')(req, res, error => {
		if (!error) {
			return next()
		}

		if (error instanceof multer.MulterError) {
			if (error.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({
					message: 'Homework attachment size must be 25MB or less',
				})
			}
			return res.status(400).json({ message: error.message })
		}

		return res.status(400).json({ message: error.message })
	})
}

module.exports = {
	uploadAvatar,
	uploadLessonDocument,
	uploadHomeworkAttachment,
}
