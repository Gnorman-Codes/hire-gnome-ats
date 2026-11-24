#!/usr/bin/env node
/* eslint-disable no-console */

require('./load-env.cjs');

const { PrismaClient } = require('@prisma/client');
const { unlink } = require('node:fs/promises');

const prisma = new PrismaClient();

const DELETE_PLAN = [
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
];

async function main() {
	console.log('[clear-operational-data] Clearing operational data while preserving users, divisions, settings, skills, custom fields, and zip codes.');

	const summary = [];
	const { deleteObject } = await import('../lib/object-storage.js');
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

	await prisma.$transaction(async (tx) => {
		for (const [modelKey, label] of DELETE_PLAN) {
			const count = await tx[modelKey].deleteMany({});
			summary.push([label, count.count]);
		}
	});

	let attachmentFilesDeleted = 0;
	let attachmentFileErrors = 0;
	for (const attachment of attachmentFiles) {
		try {
			await deleteObject({
				key: attachment.storageKey,
				storageProvider: attachment.storageProvider,
				storageBucket: attachment.storageBucket
			});
			attachmentFilesDeleted += 1;
		} catch {
			attachmentFileErrors += 1;
		}
	}

	let exportArtifactsDeleted = 0;
	let exportArtifactErrors = 0;
	for (const exportJob of exportJobFiles) {
		const filePath = String(exportJob?.filePath || '').trim();
		if (!filePath) continue;
		try {
			await unlink(filePath);
			exportArtifactsDeleted += 1;
		} catch {
			exportArtifactErrors += 1;
		}
	}

	console.log('[clear-operational-data] Completed.');
	for (const [label, count] of summary) {
		console.log(`${label}: ${count}`);
	}
	console.log(`Candidate attachment files deleted: ${attachmentFilesDeleted}`);
	console.log(`Candidate attachment cleanup errors: ${attachmentFileErrors}`);
	console.log(`Bullhorn export artifacts deleted: ${exportArtifactsDeleted}`);
	console.log(`Bullhorn export artifact cleanup errors: ${exportArtifactErrors}`);
}

main()
	.catch((error) => {
		console.error('[clear-operational-data] Failed.');
		console.error(error?.message || error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
