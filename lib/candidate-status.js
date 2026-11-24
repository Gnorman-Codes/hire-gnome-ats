export const CANDIDATE_STATUS_OPTIONS = [
	{ value: 'new', label: 'New' },
	{ value: 'in_review', label: 'In Review' },
	{ value: 'qualified', label: 'Qualified' },
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'interview', label: 'Interview' },
	{ value: 'offered', label: 'Offered' },
	{ value: 'hired', label: 'Hired' },
	{ value: 'rejected', label: 'Rejected' }
];

const CANDIDATE_STATUS_RANK = Object.freeze({
	new: 1,
	in_review: 2,
	qualified: 3,
	submitted: 4,
	interview: 5,
	offered: 6,
	hired: 7,
	rejected: 0
});

const CANDIDATE_STATUS_LABEL_BY_VALUE = Object.freeze(
	Object.fromEntries(CANDIDATE_STATUS_OPTIONS.map((option) => [option.value, option.label]))
);

export const QUALIFIED_CANDIDATE_STATUSES = Object.freeze([
	'qualified',
	'submitted',
	'interview',
	'offered',
	'hired'
]);

export const SUBMISSION_CANDIDATE_STATUSES = Object.freeze([
	'in_review',
	...QUALIFIED_CANDIDATE_STATUSES
]);

const QUALIFIED_STATUS_SET = new Set(QUALIFIED_CANDIDATE_STATUSES);

export function getCandidateStatusRank(status) {
	const key = String(status || '').trim();
	return CANDIDATE_STATUS_RANK[key] ?? -1;
}

export function chooseMostAdvancedCandidateStatus(currentStatus, incomingStatus) {
	const currentRank = getCandidateStatusRank(currentStatus);
	const incomingRank = getCandidateStatusRank(incomingStatus);
	return incomingRank > currentRank ? incomingStatus : currentStatus;
}

export function isCandidateQualifiedForPipeline(status) {
	const key = String(status || '').trim();
	return QUALIFIED_STATUS_SET.has(key);
}

export function isCandidateEligibleForSubmission(status) {
	return SUBMISSION_CANDIDATE_STATUSES.includes(String(status || '').trim());
}

export function formatCandidateStatusLabel(status) {
	const key = String(status || '').trim();
	if (!key) return '-';
	return CANDIDATE_STATUS_LABEL_BY_VALUE[key] || key;
}
