import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getEntityScope, getUserScope } from '@/lib/access-control';
import { writeAuditLog } from '@/lib/audit-log';
import { isCandidateEligibleForSubmission } from '@/lib/candidate-status';
import { validateAndNormalizeCustomFieldValues } from '@/lib/custom-fields';
import { assignableIntegrationUsers } from '@/lib/company-integration-users';
import { prisma } from '@/lib/prisma';
import { parseJsonBody } from '@/lib/request-validation';
import { withInferredCityStateFromZip } from '@/lib/zip-code-lookup';
import { apiEmail, apiRecordId, candidateUpsertSchema, resources } from './api-v1-contract';
import { ApiError, apiResponse } from './api-v1-http';

const identity = { select: { recordId: true } };
const listQuery = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).refine((value) => value <= 2147483647).optional(),
	email: apiEmail.optional(),
	updatedSince: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional()
}).strict();

function resourceFor(name) {
	if (!Object.hasOwn(resources, name)) throw new ApiError(404, 'not_found', 'API resource not found.');
	return resources[name];
}

function recordNotFound() {
	return new ApiError(404, 'not_found', 'Record not found.');
}

function selection(resource, { internal = false } = {}) {
	return {
		id: true,
		recordId: true,
		createdAt: true,
		updatedAt: true,
		...Object.fromEntries(resource.fields.map((field) => [field, true])),
		...Object.fromEntries(Object.values(resource.relations).map((relation) => [relation, identity])),
		...(resource.model === 'submission' ? { candidateId: true, jobOrderId: true } : {}),
		...(internal ? resource.model === 'submission' ? {
			createdByUserId: true,
			offer: { select: { id: true } }
		} : {
			ownerId: true, divisionId: true,
			...(['contact', 'jobOrder'].includes(resource.model) ? { clientId: true } : {}),
			...(resource.model === 'jobOrder' ? { contactId: true, closedAt: true } : {})
		} : {}),
		...(resource.model === 'jobOrder' ? { closedAt: true } : {})
	};
}

function present(row, resource) {
	return {
		recordId: row.recordId,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...Object.fromEntries(resource.fields.map((field) => [field, row[field] ?? null])),
		...Object.fromEntries(Object.entries(resource.relations).map(([field, relation]) => [field, row[relation]?.recordId ?? null])),
		...(resource.model === 'jobOrder' ? { closedAt: row.closedAt } : {})
	};
}

function scopeWhere(resource, actor) {
	const scope = getEntityScope(actor);
	return resource.model === 'submission' ? { candidate: scope, jobOrder: scope } : scope;
}

async function unarchivedRows(db, resource, rows) {
	if (!rows.length) return rows;
	const fieldsByType = resource.model === 'submission'
		? { SUBMISSION: 'id', CANDIDATE: 'candidateId', JOB_ORDER: 'jobOrderId' }
		: { [resource.entityType]: 'id' };
	const fields = Object.entries(fieldsByType);
	const archived = await db.archivedEntity.findMany({
		where: {
			OR: fields.map(([entityType, field]) => ({ entityType, entityId: { in: rows.map((row) => row[field]) } }))
		},
		select: { entityType: true, entityId: true }
	});
	const archivedKeys = new Set(archived.map(({ entityType, entityId }) => `${entityType}:${entityId}`));
	return rows.filter((row) => fields.every(([type, field]) => !archivedKeys.has(`${type}:${row[field]}`)));
}

async function scopedRecord(db, resource, actor, where) {
	const row = await db[resource.model].findFirst({
		where: { AND: [where, scopeWhere(resource, actor)] },
		select: selection(resource, { internal: true })
	});
	const [visible] = await unarchivedRows(db, resource, row ? [row] : []);
	return visible ?? null;
}

function parseList(req, allowEmail = false) {
	const params = req.nextUrl.searchParams;
	if (new Set(params.keys()).size !== [...params.keys()].length) {
		throw new ApiError(400, 'validation', 'Query parameters cannot be repeated.');
	}
	const query = listQuery.parse(Object.fromEntries(params));
	if (query.email && !allowEmail) throw new ApiError(400, 'validation', 'The email filter is only supported for candidates.');
	return query;
}

function listResult(rows, limit, serialize) {
	const page = rows.slice(0, limit);
	return apiResponse({
		data: page.map(serialize),
		page: { nextCursor: rows.length > limit ? String(page.at(-1).id) : null }
	});
}

export async function listRecords(req, { actor }, { resource: name }) {
	const resource = resourceFor(name);
	const { cursor, limit, updatedSince, email } = parseList(req, name === 'candidates');
	const rows = [];
	const scope = scopeWhere(resource, actor);
	const batchSize = limit + 1;
	let after = cursor;
	while (rows.length < batchSize) {
		const batch = await prisma[resource.model].findMany({
			where: {
				AND: [scope, {
					id: after ? { gt: after } : undefined,
					updatedAt: updatedSince ? { gte: updatedSince } : undefined,
					email
				}]
			},
			select: selection(resource),
			take: batchSize,
			orderBy: { id: 'asc' }
		});
		rows.push(...await unarchivedRows(prisma, resource, batch));
		if (batch.length < batchSize) break;
		after = batch.at(-1).id;
	}
	return listResult(rows, limit, (row) => present(row, resource));
}

export async function listOwners(req, { actor }) {
	const { cursor, limit, updatedSince } = parseList(req);
	const rows = await prisma.user.findMany({
		where: {
			AND: [getUserScope(actor), {
				isActive: true, serviceKey: null,
				id: cursor ? { gt: cursor } : undefined, updatedAt: updatedSince ? { gte: updatedSince } : undefined
			}]
		},
		select: { id: true, recordId: true, firstName: true, lastName: true },
		take: limit + 1,
		orderBy: { id: 'asc' }
	});
	return listResult(rows, limit, ({ id, ...row }) => row);
}

export async function readRecord(_req, { actor }, { resource: name, recordId }) {
	const resource = resourceFor(name);
	const row = await scopedRecord(prisma, resource, actor, { recordId: apiRecordId.parse(recordId) });
	if (!row) throw recordNotFound();
	return apiResponse({ data: present(row, resource) });
}

async function assignedUserId(db, actor, ref) {
	const user = await db.user.findFirst({
		where: { ...assignableIntegrationUsers(actor), recordId: ref }, select: { id: true }
	});
	if (!user) throw new ApiError(400, 'invalid_assignment', 'The specified user cannot be assigned by this credential.');
	return user.id;
}

async function linkedRecord(db, name, actor, recordId) {
	const row = await scopedRecord(db, resources[name], actor, { recordId });
	if (!row) throw new ApiError(404, 'related_record_not_found', 'The related record is unavailable.');
	return row;
}

async function ownedRecordFields(db, resource, actor, existing, input, data) {
	if (input.ownerRecordId !== undefined) {
		data.ownerId = await assignedUserId(db, actor, input.ownerRecordId);
	} else if (!existing) {
		data.ownerId = actor.id;
	}
	if (!existing) data.divisionId = actor.divisionId;

	if (resource.model === 'contact' || resource.model === 'jobOrder') {
		const clientRef = input.clientRecordId ?? existing?.client?.recordId;
		const client = await linkedRecord(db, 'clients', actor, clientRef);
		if (resource.model === 'contact' && existing && client.id !== existing.clientId &&
			await db.jobOrder.findFirst({ where: { contactId: existing.id }, select: { id: true } })) {
			throw new ApiError(409, 'contact_in_use', 'A contact assigned to a job order cannot move to a different client.');
		}
		if (!existing || input.clientRecordId !== undefined) data.clientId = client.id;
		if (resource.model === 'jobOrder') {
			const contactRef = input.contactRecordId ?? existing?.contact?.recordId;
			if (contactRef) {
				const contact = await linkedRecord(db, 'contacts', actor, contactRef);
				if (contact.clientId !== client.id) {
					throw new ApiError(400, 'invalid_relationship', 'The hiring contact must belong to the selected client.');
				}
				if (!existing || input.contactRecordId !== undefined) data.contactId = contact.id;
			}
			const min = input.salaryMin === undefined ? existing?.salaryMin : input.salaryMin;
			const max = input.salaryMax === undefined ? existing?.salaryMax : input.salaryMax;
			if ((input.salaryMin !== undefined || input.salaryMax !== undefined) && min != null && max != null && min > max) {
				throw new ApiError(400, 'validation', 'Salary minimum must be at or below the maximum.');
			}
			if (input.status && input.status !== existing?.status) data.closedAt = input.status === 'closed' ? new Date() : null;
		}
	}
}

function auditSnapshot(row, resource) {
	const { createdAt, updatedAt, ...fields } = present(row, resource);
	return fields;
}

async function writeRecord(db, resource, context, existing, input, submissionLinks) {
	const { actor, credentialId } = context;
	const data = Object.fromEntries(resource.fields.filter((field) => input[field] !== undefined)
		.map((field) => [field, input[field]]));
	if (resource.model === 'submission') {
		if (existing?.offer) throw new ApiError(409, 'placement_locked', 'Converted submissions are locked.');
		if (!existing) {
			const { candidate, job } = submissionLinks;
			if (!isCandidateEligibleForSubmission(candidate.status)) {
				throw new ApiError(400, 'candidate_not_eligible', 'Candidate must be In Review or beyond before submitting.');
			}
			const priority = await db.submission.aggregate({
				where: { jobOrderId: job.id }, _max: { submissionPriority: true }
			});
			Object.assign(data, {
				candidateId: candidate.id, jobOrderId: job.id, isClientVisible: false,
				submissionPriority: (priority._max.submissionPriority || 0) + 1,
				createdByUserId: input.submittedByRecordId ? await assignedUserId(db, actor, input.submittedByRecordId) : actor.id
			});
		}
	} else {
		await ownedRecordFields(db, resource, actor, existing, input, data);
	}
	if (data.zipCode) {
		const inferred = await withInferredCityStateFromZip(db, {
			zipCode: data.zipCode,
			city: Object.hasOwn(data, 'city') ? data.city : existing?.city,
			state: Object.hasOwn(data, 'state') ? data.state : existing?.state
		});
		Object.assign(data, inferred);
	}
	if (!existing || input.customFields !== undefined) {
		const { customFields, errors } = await validateAndNormalizeCustomFieldValues({
			prisma: db, moduleKey: resource.moduleKey, customFieldsInput: { ...existing?.customFields, ...input.customFields }
		});
		if (errors.length) throw new ApiError(400, 'validation', errors.join(' '));
		if (customFields !== null || existing?.customFields != null) data.customFields = customFields ?? Prisma.DbNull;
	}
	const statusChanged = resource.model === 'candidate' && input.status !== undefined && input.status !== existing?.status;
	if (existing && statusChanged && !input.stageChangeReason) {
		throw new ApiError(400, 'validation', 'Provide stageChangeReason when changing candidate status.');
	}
	if (existing && Object.entries(data).every(([key, value]) => JSON.stringify(existing[key]) === JSON.stringify(value))) {
		return existing;
	}
	const select = selection(resource, { internal: true });
	const row = existing
		? await db[resource.model].update({ where: { id: existing.id, updatedAt: existing.updatedAt }, data, select })
		: await db[resource.model].create({ data, select });
	if (resource.model === 'candidate' && (statusChanged || !existing)) {
		await db.candidateStatusChange.create({
			data: {
				candidateId: row.id, fromStatus: existing?.status ?? null, toStatus: row.status,
				reason: input.stageChangeReason, changedByUserId: actor.id
			}
		});
	}
	await writeAuditLog({
		actorUserId: actor.id,
		entityType: resource.entityType,
		entityId: row.id,
		action: existing ? 'UPDATE' : 'CREATE',
		before: existing ? auditSnapshot(existing, resource) : null,
		after: auditSnapshot(row, resource),
		metadata: { source: 'api_v1', credentialId }
	}, db);
	return row;
}

async function withWriteRetry(write, { naturalKey = false } = {}) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await prisma.$transaction(write, { isolationLevel: 'Serializable' });
		} catch (error) {
			if (attempt >= 2 || (error.code !== 'P2034' && !(naturalKey && error.code === 'P2002'))) throw error;
		}
	}
}

export async function createRecord(req, context, { resource: name }) {
	const resource = resourceFor(name);
	const input = resource.schema.parse(await parseJsonBody(req));
	const { data, status } = await withWriteRetry(async (db) => {
		if (name === 'submissions') {
			const candidate = await linkedRecord(db, 'candidates', context.actor, input.candidateRecordId);
			const job = await linkedRecord(db, 'job-orders', context.actor, input.jobOrderRecordId);
			const pair = { candidateId: candidate.id, jobOrderId: job.id };
			const previous = await db.submission.findUnique({
				where: { candidateId_jobOrderId: pair }, select: { id: true }
			});
			if (previous) {
				const scoped = await scopedRecord(db, resource, context.actor, { id: previous.id });
				if (!scoped) throw new ApiError(409, 'conflict', 'The candidate and job already have a submission.');
				return { data: scoped, status: 200 };
			}
			return { data: await writeRecord(db, resource, context, null, input, { candidate, job }), status: 201 };
		}
		return { data: await writeRecord(db, resource, context, null, input), status: 201 };
	}, { naturalKey: name === 'submissions' });
	return apiResponse({ data: present(data, resource) }, status);
}

export async function updateRecord(req, context, { resource: name, recordId }) {
	const resource = resourceFor(name);
	const schema = name === 'submissions'
		? resource.schema.pick({ status: true, notes: true, customFields: true })
		: resource.schema.partial();
	const input = schema.refine((value) => Object.keys(value).length > 0, 'Supply at least one field.').parse(await parseJsonBody(req));
	const id = apiRecordId.parse(recordId);
	const data = await withWriteRetry(async (db) => {
		const existing = await scopedRecord(db, resource, context.actor, { recordId: id });
		if (!existing) throw recordNotFound();
		return writeRecord(db, resource, context, existing, input);
	});
	return apiResponse({ data: present(data, resource) });
}

export async function upsertCandidate(req, context) {
	const resource = resources.candidates;
	const input = candidateUpsertSchema.parse(await parseJsonBody(req));
	const { data, status } = await withWriteRetry(async (db) => {
		const existing = await scopedRecord(db, resource, context.actor, { email: input.email });
		if (existing) return { data: await writeRecord(db, resource, context, existing, input), status: 200 };
		if (await db.candidate.findUnique({ where: { email: input.email }, select: { id: true } })) {
			throw new ApiError(409, 'conflict', 'Unable to create a candidate with this email.');
		}
		return { data: await writeRecord(db, resource, context, null, resource.schema.parse(input)), status: 201 };
	}, { naturalKey: true });
	return apiResponse({ data: present(data, resource) }, status);
}
