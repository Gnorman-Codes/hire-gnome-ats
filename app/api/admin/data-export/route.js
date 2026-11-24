import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { AccessControlError, getActingUser } from '@/lib/access-control';
import { withApiLogging } from '@/lib/api-logging';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const SUPPORTED_EXPORT_FORMATS = new Set(['json', 'ndjson', 'zip']);
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXPORT_VERSION = '2026-03-09';

class ExportValidationError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ExportValidationError';
		this.status = 400;
	}
}

function toBooleanFlag(value, fallback = false) {
	if (value == null) return fallback;
	const normalized = String(value).trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function parseExportFormat(value) {
	const normalized = String(value || 'json').trim().toLowerCase();
	if (!SUPPORTED_EXPORT_FORMATS.has(normalized)) {
		throw new ExportValidationError('Unsupported export format.');
	}
	return normalized;
}

function parseDateTimeInput(value, { endOfDay = false } = {}) {
	if (value == null) return null;
	const raw = String(value).trim();
	if (!raw) return null;

	let nextValue = raw;
	if (DATE_ONLY_PATTERN.test(raw)) {
		nextValue = endOfDay ? `${raw}T23:59:59.999Z` : `${raw}T00:00:00.000Z`;
	}

	const parsed = new Date(nextValue);
	if (Number.isNaN(parsed.getTime())) {
		throw new ExportValidationError('Invalid date filter provided.');
	}
	return parsed;
}

function parseDateRange(searchParams) {
	const from = parseDateTimeInput(searchParams.get('dateFrom'), { endOfDay: false });
	const to = parseDateTimeInput(searchParams.get('dateTo'), { endOfDay: true });
	if (from && to && from.getTime() > to.getTime()) {
		throw new ExportValidationError('Date range is invalid. `dateFrom` must be before `dateTo`.');
	}
	return { from, to };
}

function getRecordTimestamp(record) {
	if (!record || typeof record !== 'object') return null;
	const timestampCandidate = record.updatedAt ?? record.createdAt ?? null;
	if (!timestampCandidate) return null;
	const parsed = new Date(timestampCandidate);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed;
}

function isInDateRange(record, dateRange) {
	const hasRange = Boolean(dateRange.from || dateRange.to);
	if (!hasRange) return true;
	const timestamp = getRecordTimestamp(record);
	if (!timestamp) return false;
	if (dateRange.from && timestamp.getTime() < dateRange.from.getTime()) return false;
	if (dateRange.to && timestamp.getTime() > dateRange.to.getTime()) return false;
	return true;
}

function filterDataByDateRange(data, dateRange) {
	const hasRange = Boolean(dateRange.from || dateRange.to);
	if (!hasRange) return data;

	return Object.fromEntries(
		Object.entries(data).map(([entity, value]) => {
			if (Array.isArray(value)) {
				return [entity, value.filter((record) => isInDateRange(record, dateRange))];
			}
			if (value && typeof value === 'object') {
				return [entity, isInDateRange(value, dateRange) ? value : null];
			}
			return [entity, value];
		})
	);
}

function extractSafeSystemSettings(setting) {
	if (!setting) return null;
	return {
		id: setting.id,
		recordId: setting.recordId,
		siteName: setting.siteName,
		siteTitle: setting.siteTitle,
		themeKey: setting.themeKey,
		careerSiteEnabled: setting.careerSiteEnabled,
		apiErrorLogRetentionDays: setting.apiErrorLogRetentionDays,
		smtpSecure: setting.smtpSecure,
		objectStorageProvider: setting.objectStorageProvider,
		objectStorageRegion: setting.objectStorageRegion,
		objectStorageForcePathStyle: setting.objectStorageForcePathStyle,
		logoStorageProvider: setting.logoStorageProvider,
		logoStorageBucket: setting.logoStorageBucket,
		logoStorageKey: setting.logoStorageKey,
		logoContentType: setting.logoContentType,
		logoFileName: setting.logoFileName,
		hasGoogleMapsApiKey: Boolean(String(setting.googleMapsApiKey || '').trim()),
		hasOpenAiApiKey: Boolean(String(setting.openAiApiKey || '').trim()),
		hasSmtpHost: Boolean(String(setting.smtpHost || '').trim()),
		hasSmtpUser: Boolean(String(setting.smtpUser || '').trim()),
		hasSmtpPass: Boolean(String(setting.smtpPass || '').trim()),
		hasSmtpFromEmail: Boolean(String(setting.smtpFromEmail || '').trim()),
		hasObjectStorageBucket: Boolean(String(setting.objectStorageBucket || '').trim()),
		hasObjectStorageEndpoint: Boolean(String(setting.objectStorageEndpoint || '').trim()),
		hasObjectStorageAccessKeyId: Boolean(String(setting.objectStorageAccessKeyId || '').trim()),
		hasObjectStorageSecretAccessKey: Boolean(String(setting.objectStorageSecretAccessKey || '').trim()),
		createdAt: setting.createdAt,
		updatedAt: setting.updatedAt
	};
}

function buildEntityCounts(data) {
	return Object.fromEntries(
		Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0])
	);
}

function buildNdjsonPayload(payload) {
	const { data, ...meta } = payload;
	const lines = [JSON.stringify({ type: 'meta', payload: meta })];
	for (const [entity, value] of Object.entries(data)) {
		if (Array.isArray(value)) {
			for (const record of value) {
				lines.push(JSON.stringify({ type: 'record', entity, record }));
			}
			continue;
		}
		if (value != null) {
			lines.push(JSON.stringify({ type: 'record', entity, record: value }));
		}
	}
	return `${lines.join('\n')}\n`;
}

async function buildZipBuffer(payload) {
	const zip = new JSZip();
	const { data, ...meta } = payload;
	const manifest = {
		version: EXPORT_VERSION,
		format: 'json_per_entity',
		entityOrder: Object.keys(data)
	};

	zip.file('manifest.json', JSON.stringify(manifest, null, 2));
	zip.file('metadata.json', JSON.stringify(meta, null, 2));
	zip.file('entity-counts.json', JSON.stringify(payload.entityCounts, null, 2));

	const dataFolder = zip.folder('data');
	for (const [entity, value] of Object.entries(data)) {
		dataFolder.file(`${entity}.json`, JSON.stringify(value, null, 2));
	}

	return zip.generateAsync({
		type: 'nodebuffer',
		compression: 'DEFLATE',
		compressionOptions: { level: 6 }
	});
}

function buildExportFileName({ exportedAt, format }) {
	const timestamp = exportedAt.replace(/[:.]/g, '-');
	if (format === 'zip') return `hire-gnome-data-export-${timestamp}.zip`;
	if (format === 'ndjson') return `hire-gnome-data-export-${timestamp}.ndjson`;
	return `hire-gnome-data-export-${timestamp}.json`;
}

function buildExportPayload({ actingUser, options, data }) {
	return {
		exportVersion: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		exportedBy: {
			userId: actingUser.id,
			userRecordId: actingUser.recordId || null,
			email: actingUser.email,
			role: actingUser.role
		},
		options,
		entityCounts: buildEntityCounts(data),
		data
	};
}

async function getAdmin_dataExportHandler(req) {
	const actingUser = await getActingUser(req, { allowFallback: false });
	if (actingUser?.role !== 'ADMINISTRATOR') {
		throw new AccessControlError('Only administrators can export data.', 403);
	}

	const url = new URL(req.url);
	const format = parseExportFormat(url.searchParams.get('format'));
	const includeAuditLogs = toBooleanFlag(url.searchParams.get('includeAuditLogs'), false);
	const includeApiErrorLogs = toBooleanFlag(url.searchParams.get('includeApiErrorLogs'), false);
	const dateRange = parseDateRange(url.searchParams);

	const [
		systemSetting,
		divisions,
		users,
		skills,
		customFieldDefinitions,
		candidates,
		candidateSkills,
		candidateNotes,
		candidateActivities,
		candidateEducations,
		candidateWorkExperiences,
		candidateAttachments,
		candidateStatusChanges,
		clients,
		clientNotes,
		contacts,
		contactNotes,
		jobOrders,
		submissions,
		interviews,
		placements,
		notifications,
		archivedEntities,
		auditLogs,
		apiErrorLogs
	] = await Promise.all([
		prisma.systemSetting.findFirst({ orderBy: { id: 'asc' } }),
		prisma.division.findMany({ orderBy: { id: 'asc' } }),
		prisma.user.findMany({
			orderBy: { id: 'asc' },
			select: {
				id: true,
				recordId: true,
				firstName: true,
				lastName: true,
				email: true,
				notifyCareerSiteApplications: true,
				notifyClientPortalFeedback: true,
				tableColumnPreferences: true,
				savedListViews: true,
				role: true,
				divisionId: true,
				isActive: true,
				sessionVersion: true,
				createdAt: true,
				updatedAt: true
			}
		}),
		prisma.skill.findMany({ orderBy: { id: 'asc' } }),
		prisma.customFieldDefinition.findMany({
			orderBy: [{ moduleKey: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }]
		}),
		prisma.candidate.findMany({ orderBy: { id: 'asc' } }),
		prisma.candidateSkill.findMany({ orderBy: [{ candidateId: 'asc' }, { skillId: 'asc' }] }),
		prisma.candidateNote.findMany({ orderBy: { id: 'asc' } }),
		prisma.candidateActivity.findMany({ orderBy: { id: 'asc' } }),
		prisma.candidateEducation.findMany({ orderBy: { id: 'asc' } }),
		prisma.candidateWorkExperience.findMany({ orderBy: { id: 'asc' } }),
		prisma.candidateAttachment.findMany({ orderBy: { id: 'asc' } }),
		prisma.candidateStatusChange.findMany({ orderBy: { id: 'asc' } }),
		prisma.client.findMany({ orderBy: { id: 'asc' } }),
		prisma.clientNote.findMany({ orderBy: { id: 'asc' } }),
		prisma.contact.findMany({ orderBy: { id: 'asc' } }),
		prisma.contactNote.findMany({ orderBy: { id: 'asc' } }),
		prisma.jobOrder.findMany({ orderBy: { id: 'asc' } }),
		prisma.submission.findMany({ orderBy: { id: 'asc' } }),
		prisma.interview.findMany({ orderBy: { id: 'asc' } }),
		prisma.offer.findMany({ orderBy: { id: 'asc' } }),
		prisma.appNotification.findMany({ orderBy: { id: 'asc' } }),
		prisma.archivedEntity.findMany({ orderBy: { id: 'asc' } }),
		includeAuditLogs ? prisma.auditLog.findMany({ orderBy: { id: 'asc' } }) : Promise.resolve([]),
		includeApiErrorLogs ? prisma.apiErrorLog.findMany({ orderBy: { id: 'asc' } }) : Promise.resolve([])
	]);

	const unfilteredData = {
		systemSettings: extractSafeSystemSettings(systemSetting),
		divisions,
		users,
		skills,
		customFieldDefinitions,
		candidates,
		candidateSkills,
		candidateNotes,
		candidateActivities,
		candidateEducations,
		candidateWorkExperiences,
		candidateAttachments,
		candidateStatusChanges,
		clients,
		clientNotes,
		contacts,
		contactNotes,
		jobOrders,
		submissions,
		interviews,
		placements,
		notifications,
		archivedEntities,
		auditLogs,
		apiErrorLogs
	};

	const filteredData = filterDataByDateRange(unfilteredData, dateRange);
	const payload = buildExportPayload({
		actingUser,
		options: {
			format,
			includeAuditLogs,
			includeApiErrorLogs,
			dateFrom: dateRange.from ? dateRange.from.toISOString() : null,
			dateTo: dateRange.to ? dateRange.to.toISOString() : null
		},
		data: filteredData
	});

	const fileName = buildExportFileName({ exportedAt: payload.exportedAt, format });
	if (format === 'zip') {
		const zipBuffer = await buildZipBuffer(payload);
		return new NextResponse(zipBuffer, {
			status: 200,
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${fileName}"`,
				'Cache-Control': 'no-store'
			}
		});
	}

	if (format === 'ndjson') {
		const ndjson = buildNdjsonPayload(payload);
		return new NextResponse(ndjson, {
			status: 200,
			headers: {
				'Content-Type': 'application/x-ndjson; charset=utf-8',
				'Content-Disposition': `attachment; filename="${fileName}"`,
				'Cache-Control': 'no-store'
			}
		});
	}

	return new NextResponse(JSON.stringify(payload, null, 2), {
		status: 200,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="${fileName}"`,
			'Cache-Control': 'no-store'
		}
	});
}

function handleError(error) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ExportValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status || 400 });
	}
	return NextResponse.json({ error: 'Failed to export data.' }, { status: 500 });
}

async function routeHandler(req) {
	try {
		return await getAdmin_dataExportHandler(req);
	} catch (error) {
		return handleError(error);
	}
}

export const GET = withApiLogging('admin.data_export.get', routeHandler);
