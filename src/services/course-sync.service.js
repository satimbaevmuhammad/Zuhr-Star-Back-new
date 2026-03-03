const mongoose = require('mongoose')

const Course = require('../model/course.model')
const Group = require('../model/group.model')

const normalizeCourseIds = courseIds => {
	if (!Array.isArray(courseIds)) {
		return []
	}

	return [...new Set(courseIds.map(courseId => String(courseId || '').trim()))].filter(
		courseId => mongoose.isValidObjectId(courseId),
	)
}

const getGroupsCountByCourseIds = async courseIds => {
	const normalizedCourseIds = normalizeCourseIds(courseIds)
	if (normalizedCourseIds.length === 0) {
		return new Map()
	}

	const objectIds = normalizedCourseIds.map(courseId => new mongoose.Types.ObjectId(courseId))
	const stats = await Group.aggregate([
		{
			$match: {
				courseRef: { $in: objectIds },
			},
		},
		{
			$group: {
				_id: '$courseRef',
				groupsCount: { $sum: 1 },
			},
		},
	])

	const countMap = new Map()
	for (const item of stats) {
		countMap.set(item._id.toString(), item.groupsCount)
	}

	for (const courseId of normalizedCourseIds) {
		if (!countMap.has(courseId)) {
			countMap.set(courseId, 0)
		}
	}

	return countMap
}

const syncCourseGroupsCount = async courseIds => {
	const normalizedCourseIds = normalizeCourseIds(courseIds)
	if (normalizedCourseIds.length === 0) {
		return new Map()
	}

	const countMap = await getGroupsCountByCourseIds(normalizedCourseIds)
	const updates = normalizedCourseIds.map(courseId => ({
		updateOne: {
			filter: { _id: courseId },
			update: { $set: { groupsCount: countMap.get(courseId) || 0 } },
		},
	}))

	if (updates.length > 0) {
		await Course.bulkWrite(updates)
	}

	return countMap
}

module.exports = {
	getGroupsCountByCourseIds,
	syncCourseGroupsCount,
}
