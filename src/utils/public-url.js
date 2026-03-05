const normalizeBaseUrl = value =>
	String(value || '')
		.trim()
		.replace(/\/+$/, '')

const getRequestBaseUrl = req => {
	const configuredBaseUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '')
	if (configuredBaseUrl) {
		return configuredBaseUrl
	}

	const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '')
		.split(',')[0]
		.trim()
	const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '')
		.split(',')[0]
		.trim()
	const host = forwardedHost || String(req?.get?.('host') || req?.headers?.host || '').trim()
	if (!host) {
		return ''
	}

	const protocol = forwardedProto || req?.protocol || 'http'
	return `${protocol}://${host}`
}

const toPublicUrl = (req, value) => {
	const rawValue = String(value || '').trim()
	if (!rawValue) {
		return rawValue
	}

	if (/^https?:\/\//i.test(rawValue)) {
		return rawValue
	}

	const path = rawValue.startsWith('/') ? rawValue : `/${rawValue}`
	const baseUrl = getRequestBaseUrl(req)
	if (!baseUrl) {
		return path
	}

	return `${baseUrl}${path}`
}

module.exports = {
	toPublicUrl,
}
