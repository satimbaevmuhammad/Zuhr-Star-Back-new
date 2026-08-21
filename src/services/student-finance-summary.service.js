const Course = require('../model/course.model')
const Group = require('../model/group.model')
const { FinancialEvent } = require('../models/FinancialEvent.model')
const { buildLessonPricing, isDiscountActiveForCourse } = require('./attendance-billing.service')

const toMoney = value => {
	const amount = Number(value)
	return Number.isFinite(amount) && amount >= 0 ? amount : 0
}

const getScheduledLessonsThisMonth = group => {
	const scheduledDays = new Set((group?.schedule || []).map(item => String(item?.dayOfWeek || '').toLowerCase()))
	if (!scheduledDays.size) return 0
	const now = new Date()
	const year = now.getFullYear()
	const month = now.getMonth()
	const days = new Date(year, month + 1, 0).getDate()
	let count = 0
	for (let day = 1; day <= days; day += 1) {
		const date = new Date(year, month, day)
		const name = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()]
		if (scheduledDays.has(name)) count += 1
	}
	return count
}

const getActiveGroupIds = student =>
	(student?.groups || [])
		.filter(membership => membership?.status === 'active' && membership.group)
		.map(membership => String(membership.group?._id || membership.group))

// Financial data is derived. Course.price is the source of truth for a current
// course; group.monthlyFee is only a legacy fallback for unlinked groups.
const getStudentFinancialSummaries = async students => {
	const studentList = Array.isArray(students) ? students : [students]
	const groupIds = [...new Set(studentList.flatMap(getActiveGroupIds))]
	const groups = groupIds.length > 0
		? await Group.find({ _id: { $in: groupIds } }).select('_id name course courseRef monthlyFee')
		: []
	const groupsById = new Map(groups.map(group => [String(group._id), group]))
	const courseIds = [...new Set(groups.filter(group => group.courseRef).map(group => String(group.courseRef)))]
	const courses = courseIds.length > 0
		? await Course.find({ _id: { $in: courseIds } }).select('_id name price')
		: []
	const coursesById = new Map(courses.map(course => [String(course._id), course]))
	const studentIds = studentList.filter(Boolean).map(student => student._id)
	const ledgerRows = studentIds.length && groupIds.length
		? await FinancialEvent.aggregate([
			{ $match: { studentId: { $in: studentIds }, groupId: { $in: groupIds }, type: { $in: ['student_payment', 'lesson_charge', 'attendance_adjustment'] } } },
			{ $group: { _id: { studentId: '$studentId', groupId: '$groupId' }, balance: { $sum: '$amount' } } },
		])
		: []
	const balancesByMembership = new Map(ledgerRows.map(row => [`${row._id.studentId}:${row._id.groupId}`, Number(row.balance) || 0]))

	const summaries = new Map()
	for (const student of studentList) {
		if (!student) continue
		const monthlyFees = getActiveGroupIds(student)
			.map(groupId => {
				const group = groupsById.get(groupId)
				if (!group) return null
				const course = group.courseRef ? coursesById.get(String(group.courseRef)) : null
				return {
					groupId,
					groupName: String(group.name || '').trim(),
					courseId: course ? String(course._id) : group.courseRef ? String(group.courseRef) : null,
					courseName: String(course?.name || group.course || '').trim(),
					monthlyFee: course ? toMoney(course.price) : toMoney(group.monthlyFee),
				}
			})
			.filter(Boolean)
		const balance = Number(student.balance) || 0
		const groupSummaries = monthlyFees.map(item => {
			const group = groupsById.get(item.groupId)
			const course = item.courseId ? coursesById.get(item.courseId) : null
			const discountActive = isDiscountActiveForCourse({ student, courseId: item.courseId })
			const pricing = buildLessonPricing({ coursePrice: item.monthlyFee, student, courseId: item.courseId, lessonsScheduledThisMonth: getScheduledLessonsThisMonth(group) })
			const groupBalance = balancesByMembership.get(`${student._id}:${item.groupId}`) || 0
			return {
				groupId: item.groupId, courseId: item.courseId, balance: groupBalance,
				lessonsBehind: groupBalance < 0 && pricing.lessonPrice > 0 ? Number((Math.abs(groupBalance) / pricing.lessonPrice).toFixed(2)) : 0,
				paymentStatus: groupBalance >= 0 ? 'paid' : 'overdue', monthlyFee: item.monthlyFee,
				discount: { active: discountActive, amount: discountActive ? Number(student.activeDiscountAmount) || 0 : 0, payableCourseAmount: discountActive ? Number(student.payableCourseAmount) || 0 : item.monthlyFee },
			}
		})
		summaries.set(String(student._id), {
			balance,
			monthlyFee: monthlyFees.reduce((total, item) => total + item.monthlyFee, 0),
			debt: Math.max(0, -balance),
			monthlyFees,
			groups: groupSummaries,
		})
	}

	return summaries
}

module.exports = { getStudentFinancialSummaries }
