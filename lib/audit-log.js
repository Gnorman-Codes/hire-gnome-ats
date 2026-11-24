import { prisma } from '@/lib/prisma';

const SKIPPED_FIELDS = new Set(['updatedAt']);

function normalizeScalar(value) {
	if (value == null) return null;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	return undefined;
}

function normalizeScalarArray(values) {
	if (!Array.isArray(values)) return undefined;
	const normalized = values.map((value) => normalizeScalar(value));
	if (normalized.some((value) => value === undefined)) return undefined;
	return normalized;
}

function toSnapshot(record) {
	if (!record || typeof record !== 'object') {
		return null;
	}

	const snapshot = {};
	for (const [key, value] of Object.entries(record)) {
		if (SKIPPED_FIELDS.has(key)) continue;

		const normalizedScalar = normalizeScalar(value);
		if (normalizedScalar !== undefined) {
			snapshot[key] = normalizedScalar;
			continue;
		}

		const normalizedArray = normalizeScalarArray(value);
		if (normalizedArray !== undefined) {
			snapshot[key] = normalizedArray;
		}
	}

	return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function listChangedFields(beforeData, afterData) {
	if (!beforeData || !afterData) return null;

	const keys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)]);
	const changedFields = [];

	for (const key of keys) {
		const beforeValue = beforeData[key];
		const afterValue = afterData[key];
		if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
			changedFields.push(key);
		}
	}

	return changedFields.length > 0 ? changedFields : null;
}

function buildDefaultSummary({ action, entityType, entityId, changedFields }) {
	const label = `${action} ${entityType}${entityId ? ` #${entityId}` : ''}`;
	if (action !== 'UPDATE' || !changedFields || changedFields.length === 0) {
		return label;
	}

	const fieldList = changedFields.slice(0, 8).join(', ');
	const suffix = changedFields.length > 8 ? ', ...' : '';
	return `${label} (${fieldList}${suffix})`;
}

export async function writeAuditLog({
	actorUserId,
	action,
	entityType,
	entityId = null,
	before = null,
	after = null,
	summary,
	metadata = null
}, db = prisma) {
	const beforeData = toSnapshot(before);
	const afterData = toSnapshot(after);
	const changedFields = action === 'UPDATE' ? listChangedFields(beforeData, afterData) : null;

	await db.auditLog.create({
		data: {
			entityType,
			entityId: entityId == null ? null : Number(entityId),
			action,
			actorUserId: actorUserId == null ? null : Number(actorUserId),
			summary: summary || buildDefaultSummary({ action, entityType, entityId, changedFields }),
			beforeData,
			afterData,
			changedFields,
			metadata: metadata || null
		}
	});
}

export async function logCreate({ actorUserId, entityType, entity, summary, metadata }) {
	if (!entity) return;
	await writeAuditLog({
		actorUserId,
		action: 'CREATE',
		entityType,
		entityId: entity.id,
		after: entity,
		summary,
		metadata
	});
}

export async function logUpdate({ actorUserId, entityType, before, after, summary, metadata }) {
	if (!after && !before) return;
	await writeAuditLog({
		actorUserId,
		action: 'UPDATE',
		entityType,
		entityId: after?.id ?? before?.id ?? null,
		before,
		after,
		summary,
		metadata
	});
}

export async function logDelete({ actorUserId, entityType, entity, summary, metadata }) {
	if (!entity) return;
	await writeAuditLog({
		actorUserId,
		action: 'DELETE',
		entityType,
		entityId: entity.id,
		before: entity,
		summary,
		metadata
	});
}
