#!/usr/bin/env node
/* eslint-disable no-console */

require('./load-env.cjs');

const path = require('node:path');
const { opendir, rmdir, stat, unlink } = require('node:fs/promises');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function parseArgs(argv) {
	const args = new Set(argv.slice(2));
	return {
		delete: args.has('--delete'),
		json: args.has('--json')
	};
}

function getLocalStorageRoot() {
	return process.env.LOCAL_STORAGE_ROOT || path.join(process.cwd(), '.local-storage');
}

function normalizeStorageKey(value) {
	return String(value || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+/, '');
}

function formatBytes(value) {
	const bytes = Number(value || 0);
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function pushSample(items, value, limit = 15) {
	if (items.length < limit) items.push(value);
}

async function scanCandidateStorage({ candidateRoot, localStorageRoot, referencedByKey, shouldDelete }) {
	const seenStorageKeys = new Set();
	const samples = [];
	const counters = {
		totalFiles: 0,
		totalBytes: 0,
		referencedFiles: 0,
		referencedBytes: 0,
		orphanFiles: 0,
		orphanBytes: 0,
		seedFiles: 0,
		seedBytes: 0,
		inboundEmailFiles: 0,
		inboundEmailBytes: 0,
		directoriesVisited: 0,
		emptyDirectories: 0,
		deletedCount: 0,
		deletedBytes: 0,
		deleteErrors: 0,
		prunedDirectories: 0,
		pruneErrors: 0
	};

	async function walk(currentDirectory, isRoot = false) {
		counters.directoriesVisited += 1;
		let containsRemainingEntries = false;
		let directory;
		try {
			directory = await opendir(currentDirectory);
		} catch (error) {
			if (error?.code === 'ENOENT' && isRoot) return false;
			throw error;
		}

		for await (const entry of directory) {
			const absolutePath = path.join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				if (await walk(absolutePath)) containsRemainingEntries = true;
				continue;
			}
			if (!entry.isFile()) {
				containsRemainingEntries = true;
				continue;
			}

			const storageKey = normalizeStorageKey(path.relative(localStorageRoot, absolutePath));
			const fileStats = await stat(absolutePath);
			const sizeBytes = Number(fileStats.size || 0);
			const isReferenced = referencedByKey.has(storageKey);
			seenStorageKeys.add(storageKey);
			counters.totalFiles += 1;
			counters.totalBytes += sizeBytes;

			if (storageKey.includes('/seed/')) {
				counters.seedFiles += 1;
				counters.seedBytes += sizeBytes;
			}
			if (storageKey.includes('/inbound-email/')) {
				counters.inboundEmailFiles += 1;
				counters.inboundEmailBytes += sizeBytes;
			}

			if (isReferenced) {
				counters.referencedFiles += 1;
				counters.referencedBytes += sizeBytes;
				containsRemainingEntries = true;
				continue;
			}

			counters.orphanFiles += 1;
			counters.orphanBytes += sizeBytes;
			pushSample(samples, storageKey);
			if (!shouldDelete) {
				containsRemainingEntries = true;
				continue;
			}
			try {
				await unlink(absolutePath);
				counters.deletedCount += 1;
				counters.deletedBytes += sizeBytes;
			} catch {
				counters.deleteErrors += 1;
				containsRemainingEntries = true;
			}
		}

		if (!containsRemainingEntries && !isRoot) {
			counters.emptyDirectories += 1;
			if (shouldDelete) {
				try {
					await rmdir(currentDirectory);
					counters.prunedDirectories += 1;
				} catch (error) {
					if (error?.code !== 'ENOENT') counters.pruneErrors += 1;
					return true;
				}
			}
		}

		return containsRemainingEntries;
	}

	await walk(candidateRoot, true);
	return { counters, seenStorageKeys, samples };
}

async function main() {
	const options = parseArgs(process.argv);
	const localStorageRoot = path.resolve(getLocalStorageRoot());
	const candidateRoot = path.join(localStorageRoot, 'candidates');

	const attachmentRows = await prisma.candidateAttachment.findMany({
		where: {
			storageProvider: 'local',
			storageKey: {
				startsWith: 'candidates/'
			}
		},
		select: {
			id: true,
			storageKey: true,
			sizeBytes: true,
			fileName: true,
			candidateId: true,
			isResume: true
		}
	});

	const referencedByKey = new Map(
		attachmentRows.map((row) => [normalizeStorageKey(row.storageKey), row])
	);
	const scan = await scanCandidateStorage({
		candidateRoot,
		localStorageRoot,
		referencedByKey,
		shouldDelete: options.delete
	});
	const missingFiles = attachmentRows
		.map((row) => ({
			...row,
			storageKey: normalizeStorageKey(row.storageKey)
		}))
		.filter((row) => !scan.seenStorageKeys.has(row.storageKey));
	const { counters } = scan;

	const report = {
		localStorageRoot,
		candidateRoot,
		mode: options.delete ? 'delete' : 'audit',
		db: {
			referencedAttachmentRows: attachmentRows.length,
			missingFiles: missingFiles.length
		},
		disk: {
			totalFiles: counters.totalFiles,
			totalBytes: counters.totalBytes,
			referencedFiles: counters.referencedFiles,
			referencedBytes: counters.referencedBytes,
			orphanFiles: counters.orphanFiles,
			orphanBytes: counters.orphanBytes,
			seedFiles: counters.seedFiles,
			seedBytes: counters.seedBytes,
			inboundEmailFiles: counters.inboundEmailFiles,
			inboundEmailBytes: counters.inboundEmailBytes,
			directoriesVisited: counters.directoriesVisited,
			emptyDirectories: counters.emptyDirectories
		},
		deleteResult: {
			deletedCount: counters.deletedCount,
			deletedBytes: counters.deletedBytes,
			deleteErrors: counters.deleteErrors,
			prunedDirectories: counters.prunedDirectories,
			pruneErrors: counters.pruneErrors
		},
		samples: {
			orphanFiles: scan.samples,
			missingFiles: missingFiles.slice(0, 15).map((item) => item.storageKey)
		}
	};

	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	console.log(`[candidate-local-storage] Root: ${localStorageRoot}`);
	console.log(`[candidate-local-storage] Mode: ${report.mode}`);
	console.log(`[candidate-local-storage] DB referenced attachments: ${report.db.referencedAttachmentRows}`);
	console.log(`[candidate-local-storage] DB rows missing on disk: ${report.db.missingFiles}`);
	console.log(`[candidate-local-storage] Directories visited: ${report.disk.directoriesVisited}`);
	console.log(`[candidate-local-storage] Empty directories: ${report.disk.emptyDirectories}`);
	console.log(`[candidate-local-storage] Disk files under candidates/: ${report.disk.totalFiles} (${formatBytes(report.disk.totalBytes)})`);
	console.log(
		`[candidate-local-storage] Referenced on disk: ${report.disk.referencedFiles} (${formatBytes(report.disk.referencedBytes)})`
	);
	console.log(
		`[candidate-local-storage] Orphaned on disk: ${report.disk.orphanFiles} (${formatBytes(report.disk.orphanBytes)})`
	);
	console.log(
		`[candidate-local-storage] Seed files on disk: ${report.disk.seedFiles} (${formatBytes(report.disk.seedBytes)})`
	);
	console.log(
		`[candidate-local-storage] Inbound email files on disk: ${report.disk.inboundEmailFiles} (${formatBytes(report.disk.inboundEmailBytes)})`
	);

	if (options.delete) {
		console.log(
			`[candidate-local-storage] Deleted orphaned files: ${report.deleteResult.deletedCount} (${formatBytes(report.deleteResult.deletedBytes)})`
		);
		console.log(`[candidate-local-storage] Delete errors: ${report.deleteResult.deleteErrors}`);
		console.log(`[candidate-local-storage] Pruned empty directories: ${report.deleteResult.prunedDirectories}`);
		console.log(`[candidate-local-storage] Directory prune errors: ${report.deleteResult.pruneErrors}`);
	} else {
		console.log('[candidate-local-storage] Dry run only. Re-run with --delete to remove orphaned files.');
	}

	if (report.samples.orphanFiles.length > 0) {
		console.log('[candidate-local-storage] Sample orphaned files:');
		for (const fileKey of report.samples.orphanFiles) {
			console.log(`  - ${fileKey}`);
		}
	}

	if (report.samples.missingFiles.length > 0) {
		console.log('[candidate-local-storage] Sample DB rows missing on disk:');
		for (const fileKey of report.samples.missingFiles) {
			console.log(`  - ${fileKey}`);
		}
	}
}

main()
	.catch((error) => {
		console.error('[candidate-local-storage] Failed.');
		console.error(error?.message || error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
