import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureDefaultUnassignedDivision } from '@/lib/default-division';
import { clientSchema, contactSchema } from '@/lib/validators';
import { withInferredCityStateFromZip } from '@/lib/zip-code-lookup';
import { createRecordId } from '@/lib/record-id';
import { validateAndNormalizeCustomFieldValues } from '@/lib/custom-fields';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';
import { addScopeToWhere, getEntityScope } from '@/lib/access-control';
import { prisma } from '@/lib/prisma';
import { assignableIntegrationUsers, integrationDivisionFields, integrationSubject } from '@/lib/company-integration-users';

import { closerServiceKey, authorizeCompanyIntegration as authorize, integrationError as error, integrationHeaders as headers } from '@/lib/company-integration-auth';
const ownershipFields = {
 division: { select: integrationDivisionFields }, ownerUser: { select: { recordId: true } }
};
const companyFields = {
 ...ownershipFields,
 id: true, recordId: true, name: true, industry: true, status: true,
 city: true, state: true, zipCode: true, website: true, address: true, phone: true
};
const contactFields = {
 ...ownershipFields,
 id: true, recordId: true, firstName: true, lastName: true, title: true, email: true, phone: true
};

export async function GET(request) {
	const user = await authorize(request);
	if (user instanceof Response) return user;
	const params = request.nextUrl.searchParams;
	const viewer = await integrationSubject(prisma, user, params.get('viewerRef'));
	if (!viewer) return error('Hire Gnome user is unavailable.', 403);
	const scope = addScopeToWhere(getEntityScope(viewer), getEntityScope(user));
	const recordId = params.get('recordId')?.trim() || '';
	const query = params.get('q')?.trim() || '';
	const postalCode = params.get('postalCode');
	if (postalCode !== null) {
		if (!/^\d{5}$/.test(postalCode)) return error('Enter a five-digit ZIP code.', 400);
		const { city, state } = await withInferredCityStateFromZip(prisma, { zipCode: postalCode });
		return NextResponse.json({ city: city || '', state: state || '' }, { headers });
	}
	if (recordId.length > 100 || query.length > 100) {
		return NextResponse.json({ error: 'Search is too long.' }, { status: 400, headers });
	}

	if (recordId) {
		const company = await prisma.client.findFirst({
			where: addScopeToWhere({ recordId }, scope),
			select: companyFields
		});
		if (!company) {
			return NextResponse.json({ error: 'Company is unavailable.' }, { status: 404, headers });
		}
		const contacts = await prisma.contact.findMany({
			where: addScopeToWhere({ clientId: company.id }, scope),
			select: contactFields,
			orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
			take: 100
		});
		return NextResponse.json({ company, contacts }, { headers });
	}

	const pageSize = 25;
	const requestedPage = Number(params.get('page'));
	const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100_000) : 1;
	const companies = await prisma.client.findMany({
		where: addScopeToWhere(query ? { name: { contains: query } } : undefined, scope),
		select: companyFields,
		orderBy: [{ name: 'asc' }, { id: 'asc' }],
		skip: (page - 1) * pageSize,
		take: pageSize + 1
	});
	return NextResponse.json({ companies: companies.slice(0, pageSize), hasMore: companies.length > pageSize, page }, { headers });
}

const contactInput = z.object({
	ref: z.string().uuid(), hireRef: z.string().trim().min(1).max(100).nullable(),
	firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
	title: z.string().max(120), email: z.string().trim().max(254), phone: z.string().trim().max(60)
});
const handoffInput = z.object({
	ref: z.string().uuid(), hireRef: z.string().trim().min(1).max(100).nullable(),
	ownerRef: z.string().trim().min(1).max(100).optional(),
	viewerRef: z.string().trim().min(1).max(100).optional(),
	name: z.string().trim().min(1).max(160), industry: z.string().max(120),
	city: z.string().max(100), state: z.string().max(100), zipCode: z.string().max(25), website: z.string().max(400), address: z.string().max(191).optional(), phone: z.string().max(60).optional(),
	contacts: z.array(contactInput).max(25)
}).refine(({ contacts }) => new Set(contacts.map((contact) => contact.ref)).size === contacts.length,
	'Each selected contact must be unique.');

class HandoffError extends Error {
	constructor(message, status = 409) {
		super(message);
		this.status = status;
	}
}

function handoffRecordId(prefix, ref) {
	return `${prefix}-CG-${ref.toLowerCase()}`;
}

async function customFields(tx, moduleKey) {
	const result = await validateAndNormalizeCustomFieldValues({ prisma: tx, moduleKey });
	if (result.errors.length) throw new HandoffError(result.errors.join(' '), 422);
	return result.customFields ?? undefined;
}

async function audit(tx, user, entityType, entityId, action) {
 await tx.auditLog.create({ data: {
  recordId: createRecordId('AUD'), actorUserId: user.id, entityType, entityId, action,
  summary: 'Closer Gnome company handoff'
 } });
}

export async function POST(request) {
	const actor = await authorize(request);
	if (actor instanceof Response) return actor;
	if (!actor.writesEnabled) {
		return error('Company handoff is disabled on this Hire Gnome install.', 403);
	}
	try {
		const parsed = handoffInput.safeParse(await parseJsonBody(request));
		if (!parsed.success) return error('Invalid company or contact handoff details.', 400);
		const input = parsed.data;
		const result = await prisma.$transaction(async (tx) => {
			const user = await integrationSubject(tx, actor, input.viewerRef);
			if (!user || (user.role !== 'ADMINISTRATOR' && !user.divisionId)) {
				throw new HandoffError('The Hire Gnome user needs access to a division to hand off companies.', 403);
			}
			const scope = addScopeToWhere(getEntityScope(user), getEntityScope(actor));
			const owner = input.ownerRef ? await tx.user.findFirst({
				where: { AND: [assignableIntegrationUsers(user), assignableIntegrationUsers(actor)], recordId: input.ownerRef },
				select: { id: true, divisionId: true }
			}) : user;
			if (!owner) throw new HandoffError('The mapped opportunity owner is unavailable in Hire Gnome.', 403);
			const ownerId = !input.ownerRef && user.serviceKey === closerServiceKey ? null : owner.id;
			const generatedRef = handoffRecordId('CLI', input.ref);
			const recordId = input.hireRef || generatedRef;
			let company = await tx.client.findFirst({
				where: addScopeToWhere({ recordId }, scope),
				select: { ...companyFields, divisionId: true }
			});
			if (!company) {
				if (input.hireRef) throw new HandoffError('The linked Hire Gnome company is unavailable.');
				const sameName = await tx.client.findFirst({ where: addScopeToWhere({ name: input.name }, scope), select: { id: true } });
				if (sameName) throw new HandoffError('This company already exists in Hire Gnome. Link it using Find in Hire Gnome before sending.');
				const client = clientSchema.safeParse({
					name: input.name, status: 'Active', industry: input.industry || undefined,
					city: input.city || undefined, state: input.state || undefined, zipCode: input.zipCode,
					website: input.website || undefined, address: input.address || undefined, phone: input.phone || undefined
				});
				if (!client.success) throw new HandoffError(client.error.issues[0].message, 422);
				const divisionId = owner.divisionId ?? user.divisionId ?? (await ensureDefaultUnassignedDivision(tx)).id;
				company = await tx.client.create({
					data: {
						...await withInferredCityStateFromZip(tx, client.data), recordId: generatedRef, divisionId, ownerId,
						customFields: await customFields(tx, 'clients')
					},
					select: { ...companyFields, divisionId: true }
				});
				await audit(tx, user, 'CLIENT', company.id, 'CREATE');
			} else if (!['Active', 'Active + Verified'].includes(company.status)) {
				company = await tx.client.update({
					where: { id: company.id }, data: { status: 'Active' }, select: { ...companyFields, divisionId: true }
				});
				await audit(tx, user, 'CLIENT', company.id, 'UPDATE');
			}

			const contacts = [];
			const contactIds = new Set();
			for (const person of input.contacts) {
				const generatedContactRef = handoffRecordId('CON', person.ref);
				let contact = await tx.contact.findFirst({
					where: addScopeToWhere({ clientId: company.id, recordId: person.hireRef || generatedContactRef }, scope),
					select: contactFields
				});
				if (!contact && person.hireRef) throw new HandoffError('A linked Hire Gnome contact is unavailable.');
				if (!contact && person.email) {
					const matches = await tx.contact.findMany({
						where: addScopeToWhere({ clientId: company.id, email: person.email }, scope), take: 2, select: contactFields
					});
					if (matches.length > 1) throw new HandoffError('More than one Hire Gnome contact matches the selected email.');
					contact = matches[0];
				}
				if (!contact) {
					const contactData = contactSchema.omit({ ownerId: true }).safeParse({
						firstName: person.firstName, lastName: person.lastName, title: person.title || undefined,
						email: person.email, phone: person.phone, source: 'Other', clientId: company.id
					});
					if (!contactData.success) {
						throw new HandoffError(`Add a valid email and phone for ${person.firstName} ${person.lastName}, or leave them out of the handoff.`, 422);
					}
					if (!company.divisionId) throw new HandoffError('Assign the Hire Gnome company to a division before sending new contacts.', 422);
					if (user.role !== 'ADMINISTRATOR' && user.divisionId !== company.divisionId) {
						throw new HandoffError('The integration user must belong to the company division to send new contacts.', 403);
					}
					if (owner.divisionId && owner.divisionId !== company.divisionId) {
						throw new HandoffError('The mapped opportunity owner belongs to a different Hire Gnome division.', 409);
					}
					contact = await tx.contact.create({
						data: {
							...contactData.data, recordId: generatedContactRef, divisionId: company.divisionId, ownerId,
							customFields: await customFields(tx, 'contacts')
						},
						select: contactFields
					});
					await audit(tx, user, 'CONTACT', contact.id, 'CREATE');
				}
				if (contactIds.has(contact.id)) throw new HandoffError('Two selected contacts match the same Hire Gnome contact.');
				contactIds.add(contact.id);
				contacts.push({ ...contact, sourceRef: person.ref });
			}
			const { divisionId, ...client } = company;
			return { company: client, contacts };
		}, { isolationLevel: 'Serializable' });
		return NextResponse.json(result, { headers });
	} catch (failure) {
		if (failure instanceof ValidationError || failure instanceof HandoffError) return error(failure.message, failure.status ?? 400);
		if (failure.code === 'P2002' || failure.code === 'P2034') return error('A concurrent handoff changed the records. Retry the handoff.', 409);
		console.error('Company handoff failed.', failure.code || failure.name);
		return error('Hire Gnome could not complete the handoff.', 500);
	}
}
