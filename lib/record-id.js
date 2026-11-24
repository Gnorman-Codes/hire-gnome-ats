import crypto from 'node:crypto';

const RECORD_ID_RANDOM_LENGTH = 8;
const RECORD_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const RECORD_ID_PREFIX_BY_MODEL = Object.freeze({
	Division: 'DIV',
	SystemSetting: 'SYS',
	User: 'USR',
	AuditLog: 'AUD',
	ApiErrorLog: 'AEL',
	AppNotification: 'NTF',
	InboundEmailEvent: 'IEM',
	ArchivedEntity: 'ARC',
	Candidate: 'CAN',
	Skill: 'SKL',
	CandidateNote: 'CNO',
	CandidateActivity: 'CAT',
	CandidateStatusChange: 'CSC',
	CandidateEducation: 'CED',
	CandidateWorkExperience: 'CWR',
	CandidateAttachment: 'CAF',
	CandidateAiSummary: 'CAS',
	MatchExplanation: 'MTX',
	Client: 'CLI',
	Contact: 'CON',
	ClientPortalAccess: 'CPA',
	ClientSubmissionFeedback: 'CSF',
	ClientNote: 'CLN',
	ContactNote: 'CTN',
	JobOrder: 'JOB',
	Submission: 'SUB',
	Interview: 'INT',
	Offer: 'PLC',
	PasswordResetToken: 'PRT'
});

function randomToken(length = RECORD_ID_RANDOM_LENGTH) {
	let token = '';
	for (let index = 0; index < length; index += 1) {
		token += RECORD_ID_ALPHABET[crypto.randomInt(0, RECORD_ID_ALPHABET.length)];
	}
	return token;
}

export function getRecordIdPrefix(modelName) {
	if (!modelName) return '';
	return RECORD_ID_PREFIX_BY_MODEL[modelName] || '';
}

export function createRecordId(modelNameOrPrefix) {
	const prefix =
		RECORD_ID_PREFIX_BY_MODEL[modelNameOrPrefix] ||
		String(modelNameOrPrefix || '')
			.trim()
			.toUpperCase();
	if (!prefix) {
		return randomToken();
	}
	return `${prefix}-${randomToken()}`;
}
