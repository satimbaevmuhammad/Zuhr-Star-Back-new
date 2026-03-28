/**
 * Roles seeder.
 * Seeds default roles and permissions using idempotent upserts.
 */

const Role = require('../models/Role.model')

const DEFAULT_ROLE_PERMISSIONS = [
	{
		name: 'teacher',
		permissions: ['profile:read', 'students:read', 'groups:read'],
	},
	{
		name: 'supporteacher',
		permissions: ['profile:read', 'students:read', 'groups:read'],
	},
	{
		name: 'headteacher',
		permissions: [
			'profile:read',
			'users:read',
			'students:read',
			'students:manage',
			'groups:read',
			'groups:manage',
		],
	},
	{
		name: 'admin',
		permissions: [
			'profile:read',
			'users:read',
			'users:manage',
			'users:manage_roles',
			'students:read',
			'students:manage',
			'groups:read',
			'groups:manage',
		],
	},
	{
		name: 'superadmin',
		permissions: ['*'],
	},
]

const seedRoles = async () => {
	const operations = DEFAULT_ROLE_PERMISSIONS.map(role => ({
		updateOne: {
			filter: { name: role.name },
			update: { $set: { permissions: role.permissions } },
			upsert: true,
		},
	}))

	if (operations.length > 0) {
		await Role.bulkWrite(operations)
	}
}

module.exports = {
	DEFAULT_ROLE_PERMISSIONS,
	seedRoles,
}