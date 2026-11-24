import { writeAuditLog } from '@/lib/audit-log';
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addScopeToWhere, getEntityScope } from '@/lib/access-control';
import { authorizeCompanyIntegration, integrationError, integrationHeaders } from '@/lib/company-integration-auth';
import { integrationSubject } from '@/lib/company-integration-users';
import { prisma } from '@/lib/prisma';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';

const recordId = z.string().trim().min(1).max(100);
const sourceRef = z.string().regex(/^[0-9a-f-]{36}:(company|opportunity):\d+$/i);
const targetFields = { sourceRef, companyRef: recordId, contactRef: recordId.nullable() };
const noteFields = {
	kind: z.enum(['Call', 'Email', 'Meeting', 'Note']),
	summary: z.string().trim().min(1).max(2000),
	opportunity: z.string().trim().max(160).nullable(),
	createdAt: z.string().datetime()
};
const activity = z.object({ ...targetFields, ...noteFields, sendCompany: z.boolean() });
const mutation = z.discriminatedUnion('operation', [
	z.object({ ...targetFields, ...noteFields, operation: z.literal('upsert') }),
	z.object({ ...targetFields, operation: z.literal('delete') })
]);
const targetKey = ({ sourceRef, companyRef, contactRef }) => JSON.stringify([sourceRef, companyRef, contactRef]);
const nativeNoteFields = {
	companyRef: recordId,
	contactRef: recordId.nullable(),
	viewerRef: recordId.nullable(),
	noteId: z.number().int().positive().max(2147483647),
	updatedAt: z.string().datetime()
};
const nativeNoteMutation = z.discriminatedUnion('operation', [
	z.object({ ...nativeNoteFields, operation: z.literal('delete') }),
	z.object({ ...nativeNoteFields, operation: z.literal('edit'),
		content: z.string().min(1).refine((content) => content.trim() && Buffer.byteLength(content, 'utf8') <= 65535) })
]);
const inputSchema = z.union([
	z.object({ activities: z.array(activity).min(1).max(25) })
		.refine(({ activities }) => new Set(activities.map(({ sourceRef }) => sourceRef)).size === activities.length),
	z.object({ mutations: z.array(mutation).min(1).max(25) })
		.refine(({ mutations }) => new Set(mutations.map(targetKey)).size === mutations.length),
	z.object({ reads: z.array(z.object(targetFields)).min(1).max(25) })
		.refine(({ reads }) => new Set(reads.map(targetKey)).size === reads.length),
	z.object({ nativeNote: nativeNoteMutation })
]);
const notesQuery = z.object({
	companyRef: recordId,
	contactRef: recordId.nullable(),
	before: z.coerce.number().int().positive().max(2147483647).optional()
});
const notesPageSize = 50;

async function nativeNoteTarget(db, companyRef, contactRef, scope) {
	const company = await db.client.findFirst({
		where: addScopeToWhere({ recordId: companyRef }, scope), select: { id: true }
	});
	if (!company) return null;
	if (!contactRef) return { notes: db.clientNote, parent: { clientId: company.id }, prefix: 'CLN-CG-', entityType: 'CLIENT_NOTE' };
	const contact = await db.contact.findFirst({
		where: addScopeToWhere({ recordId: contactRef, clientId: company.id }, scope), select: { id: true }
	});
	return contact ? { notes: db.contactNote, parent: { contactId: contact.id }, prefix: 'CTN-CG-', entityType: 'CONTACT_NOTE' } : null;
}

async function changeNativeNote(user, entry) {
	const result = await prisma.$transaction(async (tx) => {
		const viewer = await integrationSubject(tx, user, entry.viewerRef);
		if (!viewer) return { error: 'Hire Gnome user is unavailable.', status: 403 };
		const scope = addScopeToWhere(getEntityScope(viewer), getEntityScope(user));
		const target = await nativeNoteTarget(tx, entry.companyRef, entry.contactRef, scope);
		if (!target) return { error: 'Hire Gnome note is unavailable.', status: 404 };
		const { notes, parent, prefix, entityType } = target;
		const where = { id: entry.noteId, ...parent };
		const before = await notes.findFirst({ where: { ...where, NOT: { recordId: { startsWith: prefix } } } });
		if (!before) return { error: 'Hire Gnome note is unavailable.', status: 404 };
		if (before.updatedAt.toISOString() !== entry.updatedAt) {
			return { error: 'This note changed in Hire Gnome. Review the latest version and try again.', status: 409 };
		}
		const remove = entry.operation === 'delete';
		let after = null;
		if (remove) await notes.delete({ where });
		else after = await notes.update({ where, data: { content: entry.content } });
		await writeAuditLog({
			actorUserId: viewer.id, action: remove ? 'DELETE' : 'UPDATE', entityType,
			entityId: before.id, before, after, metadata: { ...parent, source: 'Closer Gnome' }
		}, tx);
		return { id: before.id };
	}, { isolationLevel: 'Serializable' });
	if (result.error) return integrationError(result.error, result.status);
	return NextResponse.json({ results: [result] }, { headers: integrationHeaders });
}

export async function GET(request) {
	const user = await authorizeCompanyIntegration(request);
	if (user instanceof Response) return user;
	const params = request.nextUrl.searchParams;
	const parsed = notesQuery.safeParse({
		companyRef: params.get('companyRef'),
		contactRef: params.get('contactRef'),
		before: params.get('before') ?? undefined
	});
	if (!parsed.success) return integrationError('Invalid notes lookup.', 400);

	const { companyRef, contactRef, before } = parsed.data;
	const viewer = await integrationSubject(prisma, user, params.get('viewerRef'));
	if (!viewer) return integrationError('Hire Gnome user is unavailable.', 403);
	const scope = addScopeToWhere(getEntityScope(viewer), getEntityScope(user));
	const target = await nativeNoteTarget(prisma, companyRef, contactRef, scope);
	if (!target) return integrationError('Company or contact is unavailable.', 404);
	const notes = await target.notes.findMany({
		take: notesPageSize + 1,
		orderBy: { id: 'desc' },
		where: { ...target.parent, ...(before ? { id: { lt: before } } : {}),
			NOT: { recordId: { startsWith: target.prefix } } },
		select: { id: true, content: true, createdAt: true, updatedAt: true, ...(contactRef ? { noteType: true } : {}) }
	});

	const page = notes.slice(0, notesPageSize);
	return NextResponse.json({
		notes: page,
		canEditNotes: user.writesEnabled,
		nextBefore: notes.length > notesPageSize ? page.at(-1).id : null
	}, { headers: integrationHeaders });
}

function noteRecordId(prefix, destination, sourceRef) {
	const hash = createHash('sha256').update(JSON.stringify([destination, sourceRef])).digest('hex');
	return `${prefix}-CG-${hash}`;
}

function activityNote(entry, userId) {
	const heading = [`Closer Gnome · ${entry.kind}`, entry.opportunity && `Opportunity: ${entry.opportunity}`]
		.filter(Boolean).join('\n');
	return {
		content: `${heading}\n\n${entry.summary}`,
		createdAt: new Date(entry.createdAt),
		createdByUserId: userId
	};
}

async function mutateNote(tx, entry, company, contact, userId) {
	const notes = contact ? tx.contactNote : tx.clientNote;
	const recordId = noteRecordId(contact ? 'CTN' : 'CLN', contact?.recordId ?? company.recordId, entry.sourceRef);
	const where = { recordId, ...(contact ? { contactId: contact.id } : { clientId: company.id }) };
	if (entry.operation === 'delete') {
		await notes.deleteMany({ where });
	} else {
		const note = activityNote(entry, userId);
		const updated = await notes.updateMany({ where, data: { content: note.content } });
		if (!updated.count) await notes.create({ data: { ...where, ...note } });
	}
	await tx.syncedActivityNoteChange.deleteMany({ where: { recordId } });
}

export async function POST(request) {
	const user = await authorizeCompanyIntegration(request);
	if (user instanceof Response) return user;
	if (!user.writesEnabled) {
		return integrationError('Activity sync is disabled on this Hire Gnome install.', 403);
	}

	try {
		const parsed = inputSchema.safeParse(await parseJsonBody(request));
		if (!parsed.success) return integrationError('Invalid activity sync details.', 400);
		const { activities, mutations, reads, nativeNote } = parsed.data;
		if (nativeNote) return await changeNativeNote(user, nativeNote);
		const entries = activities ?? mutations ?? reads;
		const scope = getEntityScope(user);
		const results = await prisma.$transaction(async (tx) => {
			const companies = await tx.client.findMany({
				where: addScopeToWhere({ recordId: { in: entries.map((item) => item.companyRef) } }, scope),
				select: { id: true, recordId: true }
			});
			const contacts = await tx.contact.findMany({
				where: addScopeToWhere({
					recordId: { in: entries.flatMap((item) => item.contactRef ? [item.contactRef] : []) },
					clientId: { in: companies.map((company) => company.id) }
				}, scope),
				select: { id: true, recordId: true, clientId: true }
			});
			if (reads) {
				const destinations = [];
				for (const entry of reads) {
					const company = companies.find(({ recordId }) => recordId === entry.companyRef);
					if (!company) continue;
					const contact = contacts.find(({ recordId, clientId }) => recordId === entry.contactRef && clientId === company.id);
					if (entry.contactRef && !contact) continue;
					destinations.push({ entry, recordId: noteRecordId(contact ? 'CTN' : 'CLN',
						contact?.recordId ?? company.recordId, entry.sourceRef) });
				}
				const changes = await tx.syncedActivityNoteChange.findMany({
					where: { recordId: { in: destinations.map(({ recordId }) => recordId) } }
				});
				return destinations.flatMap(({ entry, recordId }) => {
					const change = changes.find((row) => row.recordId === recordId);
					return change ? [{ ...entry, summary: change.summary, changedAt: change.changedAt }] : [];
				});
			}
			const companyNotes = [];
			const contactNotes = [];
			const acknowledgments = [];
			for (const entry of entries) {
				const company = companies.find(({ recordId }) => recordId === entry.companyRef);
				if (!company) continue;
				const contact = contacts.find(({ recordId, clientId }) =>
					recordId === entry.contactRef && clientId === company.id);
				if (mutations) {
					if (entry.contactRef && !contact) continue;
					await mutateNote(tx, entry, company, contact, user.id);
					acknowledgments.push({ sourceRef: entry.sourceRef, companyRef: company.recordId, contactRef: contact?.recordId ?? null });
					continue;
				}
				const note = activityNote(entry, user.id);
				if (entry.sendCompany) {
					companyNotes.push({
						...note, clientId: company.id, recordId: noteRecordId('CLN', company.recordId, entry.sourceRef)
					});
				}
				if (contact) {
					contactNotes.push({
						...note, contactId: contact.id, recordId: noteRecordId('CTN', contact.recordId, entry.sourceRef)
					});
				}
				acknowledgments.push({
					sourceRef: entry.sourceRef,
					companyRef: entry.sendCompany ? company.recordId : null,
					contactRef: contact?.recordId ?? null
				});
			}
			if (activities) {
				const deleted = await tx.syncedActivityNoteChange.findMany({
					where: { recordId: { in: [...companyNotes, ...contactNotes].map((note) => note.recordId) }, summary: null },
					select: { recordId: true }
				});
				const deletedIds = new Set(deleted.map(({ recordId }) => recordId));
				const clientCopies = companyNotes.filter((note) => !deletedIds.has(note.recordId));
				const contactCopies = contactNotes.filter((note) => !deletedIds.has(note.recordId));
				if (clientCopies.length) await tx.clientNote.createMany({ data: clientCopies, skipDuplicates: true });
				if (contactCopies.length) await tx.contactNote.createMany({ data: contactCopies, skipDuplicates: true });
			}
			return acknowledgments;
		}, { isolationLevel: 'Serializable' });
		return NextResponse.json({ results }, { headers: integrationHeaders });
	} catch (failure) {
		if (failure instanceof ValidationError) return integrationError(failure.message, 400);
		if (failure.code === 'P2034') return integrationError('Another activity sync is in progress. Retry shortly.', 409);
		console.error('Activity sync failed.', failure.code || failure.name);
		return integrationError('Hire Gnome could not sync activity.', 500);
	}
}
