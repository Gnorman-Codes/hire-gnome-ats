export const CANDIDATE_ATTACHMENT_ALLOWED_EXTENSIONS = [
	'.pdf',
	'.doc',
	'.docx',
	'.txt',
	'.rtf',
	'.odt',
	'.png',
	'.jpg',
	'.jpeg'
];

export const CANDIDATE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const RESUME_UPLOAD_ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];
export const RESUME_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
// Maximum resume files accepted in a single bulk upload request.
export const BULK_RESUME_UPLOAD_MAX_FILES = 25;

const allowedExtensionsSet = new Set(CANDIDATE_ATTACHMENT_ALLOWED_EXTENSIONS);
const resumeAllowedExtensionsSet = new Set(RESUME_UPLOAD_ALLOWED_EXTENSIONS);

const candidateAttachmentContentTypesByExtension = new Map([
	['.pdf', new Set(['application/pdf'])],
	['.doc', new Set(['application/msword', 'application/octet-stream'])],
	[
		'.docx',
		new Set([
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/zip',
			'application/octet-stream'
		])
	],
	['.txt', new Set(['text/plain', 'application/octet-stream'])],
	['.rtf', new Set(['application/rtf', 'text/rtf', 'application/octet-stream'])],
	['.odt', new Set(['application/vnd.oasis.opendocument.text', 'application/octet-stream'])],
	['.png', new Set(['image/png'])],
	['.jpg', new Set(['image/jpeg'])],
	['.jpeg', new Set(['image/jpeg'])]
]);

const resumeUploadContentTypesByExtension = new Map([
	['.pdf', new Set(['application/pdf'])],
	['.doc', new Set(['application/msword', 'application/octet-stream'])],
	[
		'.docx',
		new Set([
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/zip',
			'application/octet-stream'
		])
	]
]);

function extractExtension(fileName) {
	const normalized = String(fileName || '').trim().toLowerCase();
	const lastDotIndex = normalized.lastIndexOf('.');
	if (lastDotIndex <= 0 || lastDotIndex === normalized.length - 1) {
		return '';
	}
	return normalized.slice(lastDotIndex);
}

function normalizeContentType(contentType) {
	return String(contentType || '')
		.trim()
		.toLowerCase()
		.split(';')[0]
		.trim();
}

function isAllowedContentTypeForFile(fileName, contentType, allowedMap) {
	const normalizedType = normalizeContentType(contentType);
	if (!normalizedType) return true;

	const extension = extractExtension(fileName);
	if (!extension) return false;
	if (normalizedType === 'application/octet-stream') return true;

	const allowedTypes = allowedMap.get(extension);
	if (!allowedTypes || allowedTypes.size === 0) return true;
	return allowedTypes.has(normalizedType);
}

export function isAllowedCandidateAttachmentFileName(fileName) {
	const extension = extractExtension(fileName);
	return Boolean(extension) && allowedExtensionsSet.has(extension);
}

export function isAllowedCandidateAttachmentContentType(fileName, contentType) {
	return isAllowedContentTypeForFile(fileName, contentType, candidateAttachmentContentTypesByExtension);
}

export function isAllowedResumeUploadFileName(fileName) {
	const extension = extractExtension(fileName);
	return Boolean(extension) && resumeAllowedExtensionsSet.has(extension);
}

export function isAllowedResumeUploadContentType(fileName, contentType) {
	return isAllowedContentTypeForFile(fileName, contentType, resumeUploadContentTypesByExtension);
}

export function candidateAttachmentAcceptString() {
	return CANDIDATE_ATTACHMENT_ALLOWED_EXTENSIONS.join(',');
}

export function resumeUploadAcceptString() {
	return RESUME_UPLOAD_ALLOWED_EXTENSIONS.join(',');
}
