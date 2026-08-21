const isDiscountActiveForCourse = ({ student, courseId }) => {
	if (!student || !courseId || !student.discountCourseId) return false
	return String(student.discountCourseId) === String(courseId) && Number(student.activeDiscountAmount) > 0
}

const getEffectiveMonthlyPrice = ({ coursePrice, student, courseId }) =>
	isDiscountActiveForCourse({ student, courseId })
		? Math.max(0, Number(student.payableCourseAmount) || 0)
		: Math.max(0, Number(coursePrice) || 0)

const buildLessonPricing = ({ coursePrice, student, courseId, lessonsScheduledThisMonth }) => {
	const effectiveMonthlyPrice = getEffectiveMonthlyPrice({ coursePrice, student, courseId })
	const denominator = Number(lessonsScheduledThisMonth) || 0
	return {
		effectiveMonthlyPrice,
		lessonsScheduledThisMonth: denominator,
		lessonPrice: denominator > 0 ? effectiveMonthlyPrice / denominator : 0,
	}
}

const getRefundAmount = originalCharge => Math.abs(Number(originalCharge?.amount) || 0)

module.exports = { isDiscountActiveForCourse, getEffectiveMonthlyPrice, buildLessonPricing, getRefundAmount }
