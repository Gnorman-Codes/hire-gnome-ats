import crypto from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { deleteObject } from '@/lib/object-storage';

const PURGE_DELETE_PLAN = Object.freeze([
	['clientSubmissionFeedback', 'Client feedback'],
	['clientPortalAccess', 'Client portal access'],
	['offer', 'Placements'],
	['interview', 'Interviews'],
	['matchExplanation', 'Match explanations'],
	['submission', 'Submissions'],
	['candidateStatusChange', 'Candidate status changes'],
	['candidateNote', 'Candidate notes'],
	['candidateActivity', 'Candidate activities'],
	['candidateEducation', 'Candidate education'],
	['candidateWorkExperience', 'Candidate work history'],
	['candidateSkill', 'Candidate skills'],
	['candidateAttachment', 'Candidate files'],
	['candidateAiSummary', 'Candidate AI summaries'],
	['syncedActivityNoteChange', 'Pending synced note changes'],
	['clientNote', 'Client notes'],
	['contactNote', 'Contact notes'],
	['contact', 'Contacts'],
	['jobOrder', 'Job orders'],
	['client', 'Clients'],
	['candidate', 'Candidates'],
	['bullhornExportJob', 'Bullhorn export jobs'],
	['appNotification', 'Notifications'],
	['archivedEntity', 'Archived entities'],
	['auditLog', 'Audit logs'],
	['inboundEmailEvent', 'Inbound email events'],
	['passwordResetToken', 'Password reset tokens'],
	['requestThrottleEvent', 'Request throttle events'],
	['apiErrorLog', 'API error logs']
]);

const PURGE_CONFIRM_WORDS = Object.freeze([
	'EMBER',
	'ANCHOR',
	'IRON',
	'CINDER',
	'MAPLE',
	'RIVET',
	'BRIDGE',
	'GRANITE',
	'COMET',
	'HARBOR'
]);

function getAdminPurgeSecret() {
	return String(process.env.AUTH_SESSION_SECRET || 'dev-admin-purge-secret-change-me').trim();
}

function signAdminPurgePayload(payloadBase64Url) {
	return crypto.createHmac('sha256', getAdminPurgeSecret()).update(payloadBase64Url).digest('base64url');
}

function encodeChallengePayload(payload) {
	const payloadJson = JSON.stringify(payload);
	const payloadBase64Url = Buffer.from(payloadJson, 'utf8').toString('base64url');
	return `${payloadBase64Url}.${signAdminPurgePayload(payloadBase64Url)}`;
}

function decodeChallengeToken(token) {
	const raw = String(token || '').trim();
	if (!raw.includes('.')) return null;
	const [payloadBase64Url, signature] = raw.split('.');
	if (!payloadBase64Url || !signature) return null;
	const expectedSignature = signAdminPurgePayload(payloadBase64Url);
	const providedBuffer = Buffer.from(signature, 'utf8');
	const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
	if (providedBuffer.length !== expectedBuffer.length) return null;
	if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
	try {
		return JSON.parse(Buffer.from(payloadBase64Url, 'base64url').toString('utf8'));
	} catch {
		return null;
	}
}

export function createAdminPurgeChallenge() {
	const wordRoot = PURGE_CONFIRM_WORDS[crypto.randomInt(0, PURGE_CONFIRM_WORDS.length)];
	const suffix = crypto.randomInt(100, 1000);
	const word = `${wordRoot}-${suffix}`;
	const issuedAt = Date.now();
	return {
		word,
		token: encodeChallengePayload({
			word,
			issuedAt,
			purpose: 'admin-operational-purge'
		}),
		expiresAt: new Date(issuedAt + 15 * 60 * 1000).toISOString()
	};
}

export function verifyAdminPurgeChallenge({ token, word, confirmation }) {
	const payload = decodeChallengeToken(token);
	if (!payload) return { ok: false, reason: 'The purge confirmation is invalid.' };
	if (payload.purpose !== 'admin-operational-purge') {
		return { ok: false, reason: 'The purge confirmation is invalid.' };
	}
	if (Date.now() - Number(payload.issuedAt || 0) > 15 * 60 * 1000) {
		return { ok: false, reason: 'The purge confirmation expired. Generate a new one.' };
	}
	if (String(payload.word || '') !== String(word || '')) {
		return { ok: false, reason: 'The purge confirmation is invalid.' };
	}
	if (String(confirmation || '').trim().toUpperCase() !== String(word || '').trim().toUpperCase()) {
		return { ok: false, reason: 'The confirmation word did not match.' };
	}
	return { ok: true };
}

export function getOperationalPurgeDescription() {
	return 'Deletes operational ATS data including candidates, clients, contacts, job orders, submissions, interviews, placements, notes, activities, files, notifications, archives, Bullhorn export jobs, and migration artifacts. Preserves users, divisions, system settings, skills, custom field definitions, and zip codes.';
}

export async function purgeOperationalData(prisma) {
	const attachmentFiles = await prisma.candidateAttachment.findMany({
		select: {
			storageProvider: true,
			storageBucket: true,
			storageKey: true
		}
	});
	const exportJobFiles = await prisma.bullhornExportJob.findMany({
		select: {
			filePath: true
		}
	});

	const summary = [];
	await prisma.$transaction(async (tx) => {
		for (const [modelKey, label] of PURGE_DELETE_PLAN) {
			const result = await tx[modelKey].deleteMany({});
			summary.push({
				modelKey,
				label,
				count: Number(result?.count || 0)
			});
		}
	});

	const storageCleanup = {
		attachmentFilesDeleted: 0,
		attachmentFileErrors: 0,
		exportArtifactsDeleted: 0,
		exportArtifactErrors: 0
	};

	for (const attachment of attachmentFiles) {
		try {
			await deleteObject({
				key: attachment.storageKey,
				storageProvider: attachment.storageProvider,
				storageBucket: attachment.storageBucket
			});
			storageCleanup.attachmentFilesDeleted += 1;
		} catch {
			storageCleanup.attachmentFileErrors += 1;
		}
	}

	for (const exportJob of exportJobFiles) {
		const filePath = String(exportJob?.filePath || '').trim();
		if (!filePath) continue;
		try {
			await unlink(filePath);
			storageCleanup.exportArtifactsDeleted += 1;
		} catch {
			storageCleanup.exportArtifactErrors += 1;
		}
	}

	return {
		summary,
		storageCleanup
	};
}
