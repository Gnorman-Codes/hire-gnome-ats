import { prisma } from '@/lib/prisma';
import { extractResumeTextFromBuffer } from '@/lib/resume-file-parser';
import { parseResumeDraft } from '@/lib/resume-parse-service';
import { normalizeCandidateData } from '@/lib/candidate-data';
import { withInferredCityStateFromZip } from '@/lib/zip-code-lookup';
import { resolveCandidateSkills, resolveSkillSetForWrite } from '@/lib/candidate-skills';
import {
	normalizeCandidateEducationRecords,
	normalizeCandidateWorkExperienceRecords
} from '@/lib/candidate-history';
import { deriveResumeSearchTextFromBuffer } from '@/lib/candidate-resume-search';
import {
	buildCandidateAttachmentStorageKey,
	deleteObject,
	uploadObjectBuffer
} from '@/lib/object-storage';
import { resolveOwnershipForWrite } from '@/lib/access-control';
import { createRecordId } from '@/lib/record-id';
import { logCreate } from '@/lib/audit-log';
import { isValidEmailAddress } from '@/lib/email-validation';
import {
	CANDIDATE_ATTACHMENT_MAX_BYTES,
	isAllowedCandidateAttachmentContentType,
	isAllowedCandidateAttachmentFileName
} from '@/lib/candidate-attachment-options';

const BULK_IMPORT_SOURCE = 'Bulk Resume Import';
const BULK_IMPORT_STATUS = 'new';
const MIN_RESUME_TEXT_LENGTH = 40;

/**
 * Result statuses returned per file:
 * - 'created'   candidate + resume attachment created
 * - 'duplicate' a candidate with the parsed email already exists
 * - 'skipped'   file was readable but lacked the minimum info to create safely
 * - 'failed'    file could not be read/parsed
 */
function result(fileName, status, extra = {}) {
	return { fileName: fileName || '(unnamed file)', status, ...extra };
}

function capitalize(value) {
	const cleaned = String(value || '').trim();
	if (!cleaned) return '';
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Best-effort name resolution: prefer parsed name, then the email local part,
 * then the file name. Guarantees non-empty first/last so the DB (which requires
 * both) always accepts the record.
 */
function resolveNames(draft, email, fileName) {
	let firstName = String(draft.firstName || '').trim();
	let lastName = String(draft.lastName || '').trim();
	if (firstName && lastName) {
		return { firstName, lastName };
	}

	const localPart = String(email || '').split('@')[0] || '';
	const emailParts = localPart.replace(/[._+-]+/g, ' ').split(/\s+/).filter(Boolean);
	if (!firstName && emailParts[0]) firstName = capitalize(emailParts[0]);
	if (!lastName && emailParts.length > 1) lastName = capitalize(emailParts.slice(1).join(' '));

	if (!firstName || !lastName) {
		const base = String(fileName || '')
			.replace(/\.[^.]+$/, '')
			.replace(/[._-]+/g, ' ')
			.replace(/\b(resume|cv|curriculum vitae)\b/gi, '')
			.trim();
		const fileParts = base.split(/\s+/).filter(Boolean);
		if (!firstName && fileParts[0]) firstName = capitalize(fileParts[0]);
		if (!lastName && fileParts.length > 1) lastName = capitalize(fileParts.slice(1).join(' '));
	}

	return {
		firstName: firstName || 'Unknown',
		lastName: lastName || 'Candidate'
	};
}

function fileValidationError(file) {
	if (!file || typeof file.arrayBuffer !== 'function') {
		return 'Not a valid file.';
	}
	if (!file.name || !isAllowedCandidateAttachmentFileName(file.name)) {
		return 'Unsupported file type. Upload PDF, DOC, or DOCX.';
	}
	if (!isAllowedCandidateAttachmentContentType(file.name, file.type)) {
		return 'Unsupported file content type.';
	}
	if (file.size <= 0) {
		return 'File is empty.';
	}
	if (file.size > CANDIDATE_ATTACHMENT_MAX_BYTES) {
		return `File exceeds ${Math.floor(CANDIDATE_ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB limit.`;
	}
	return '';
}

/**
 * Parse a single resume file and create a candidate (plus resume attachment and
 * searchable resume text) from it. Never throws — always resolves to a result
 * object describing the outcome so callers can aggregate a batch.
 *
 * @param {object} params
 * @param {File} params.file            Web File from multipart form data.
 * @param {object} params.actingUser    Result of getActingUser().
 * @param {number|null} [params.defaultDivisionId]  Division to assign when the
 *        acting user is an administrator without an explicit division.
 */
export async function createCandidateFromResumeFile({ file, actingUser, defaultDivisionId = null }) {
	const fileName = file?.name || '';

	const validationError = fileValidationError(file);
	if (validationError) {
		return result(fileName, 'failed', { message: validationError });
	}

	let buffer;
	let resumeText;
	try {
		buffer = Buffer.from(await file.arrayBuffer());
		const extracted = await extractResumeTextFromBuffer({
			buffer,
			fileName,
			contentType: file.type
		});
		resumeText = extracted.text;
	} catch (error) {
		return result(fileName, 'failed', {
			message: error?.message || 'Could not read the file.'
		});
	}

	if (!resumeText || resumeText.length < MIN_RESUME_TEXT_LENGTH) {
		return result(fileName, 'failed', {
			message: 'Could not extract enough text from the file (is it a scanned image?).'
		});
	}

	const parsed = await parseResumeDraft(resumeText);
	const draft = parsed.draft || {};
	const email = String(draft.email || '').trim().toLowerCase();

	// Require a real email: it is the unique key and we do not fabricate one.
	if (!email || !isValidEmailAddress(email)) {
		return result(fileName, 'skipped', {
			message: 'No email address detected — add this candidate manually.'
		});
	}

	const { firstName, lastName } = resolveNames(draft, email, fileName);

	const candidateInput = {
		firstName,
		lastName,
		email,
		mobile: draft.mobile || null,
		status: BULK_IMPORT_STATUS,
		source: BULK_IMPORT_SOURCE,
		ownerId: actingUser?.id,
		divisionId: defaultDivisionId || actingUser?.divisionId || null,
		currentJobTitle: draft.currentJobTitle || null,
		currentEmployer: draft.currentEmployer || null,
		experienceYears: draft.experienceYears || null,
		city: draft.city || null,
		state: draft.state || null,
		zipCode: draft.zipCode || null,
		website: draft.website || null,
		linkedinUrl: draft.linkedinUrl || null,
		skillSet: draft.skillSet || null,
		summary: draft.summary || null
	};

	let resumeUploadMeta = null;
	try {
		const normalized = await withInferredCityStateFromZip(
			prisma,
			normalizeCandidateData(candidateInput)
		);
		const resolvedSkills = await resolveCandidateSkills(undefined, parsed.parsedSkills);
		const normalizedEducationRecords = normalizeCandidateEducationRecords(parsed.educationRecords);
		const normalizedWorkExperienceRecords = normalizeCandidateWorkExperienceRecords(
			parsed.workExperienceRecords
		);
		const resolvedSkillSet = await resolveSkillSetForWrite({
			normalizedSkillSet: normalized.skillSet,
			unmatchedParsedSkillNames: resolvedSkills.unmatchedParsedSkillNames,
			extraKnownSkillNames: resolvedSkills.skillNames
		});
		const ownership = await resolveOwnershipForWrite({
			actingUser,
			ownerIdInput: actingUser?.id,
			divisionIdInput: normalized.divisionId
		});
		const resumeSearchText = await deriveResumeSearchTextFromBuffer({
			buffer,
			fileName,
			contentType: file.type
		});

		const candidate = await prisma.$transaction(async (tx) => {
			const createdCandidate = await tx.candidate.create({
				data: {
					...normalized,
					recordId: createRecordId('Candidate'),
					skillSet: resolvedSkillSet,
					resumeSearchText: resumeSearchText || null,
					ownerId: ownership.ownerId,
					divisionId: ownership.divisionId,
					...(resolvedSkills.hasSkillIds && resolvedSkills.skillIds.length > 0
						? {
								candidateSkills: {
									createMany: {
										data: resolvedSkills.skillIds.map((skillId) => ({ skillId })),
										skipDuplicates: true
									}
								}
							}
						: {}),
					...(normalizedEducationRecords.length > 0
						? {
								candidateEducations: {
									create: normalizedEducationRecords.map((record) => ({
										recordId: createRecordId('CandidateEducation'),
										...record
									}))
								}
							}
						: {}),
					...(normalizedWorkExperienceRecords.length > 0
						? {
								candidateWorkExperiences: {
									create: normalizedWorkExperienceRecords.map((record) => ({
										recordId: createRecordId('CandidateWorkExperience'),
										...record
									}))
								}
							}
						: {})
				}
			});

			const storageKey = buildCandidateAttachmentStorageKey(createdCandidate.id, fileName);
			const uploaded = await uploadObjectBuffer({
				key: storageKey,
				body: buffer,
				contentType: file.type || 'application/octet-stream'
			});
			resumeUploadMeta = {
				storageProvider: uploaded.storageProvider,
				storageBucket: uploaded.storageBucket,
				storageKey: uploaded.storageKey
			};

			await tx.candidateAttachment.create({
				data: {
					recordId: createRecordId('CandidateAttachment'),
					candidateId: createdCandidate.id,
					fileName,
					isResume: true,
					contentType: file.type || null,
					sizeBytes: file.size,
					storageProvider: uploaded.storageProvider,
					storageBucket: uploaded.storageBucket,
					storageKey: uploaded.storageKey,
					uploadedByUserId: actingUser?.id || null
				}
			});

			await tx.candidateStatusChange.create({
				data: {
					recordId: createRecordId('CandidateStatusChange'),
					candidateId: createdCandidate.id,
					fromStatus: null,
					toStatus: createdCandidate.status,
					reason: 'Imported via bulk resume upload.',
					changedByUserId: actingUser?.id || null
				}
			});

			return createdCandidate;
		});

		await logCreate({
			actorUserId: actingUser?.id,
			entityType: 'CANDIDATE',
			entity: candidate
		});

		return result(fileName, 'created', {
			candidateId: candidate.id,
			candidateName: `${candidate.firstName} ${candidate.lastName}`.trim(),
			email: candidate.email,
			parser: parsed.parser
		});
	} catch (error) {
		if (resumeUploadMeta) {
			await deleteObject(resumeUploadMeta).catch(() => null);
		}
		if (error?.code === 'P2002') {
			return result(fileName, 'duplicate', {
				email,
				message: 'A candidate with this email already exists.'
			});
		}
		return result(fileName, 'failed', {
			message: error?.message || 'Failed to create candidate.'
		});
	}
}
