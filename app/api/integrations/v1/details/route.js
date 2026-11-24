import { NextResponse } from 'next/server';
import { z } from 'zod';
import { addScopeToWhere, getEntityScope } from '@/lib/access-control';
import { authorizeCompanyIntegration, integrationError, integrationHeaders } from '@/lib/company-integration-auth';
import { integrationDivisionFields } from '@/lib/company-integration-users';
import { prisma } from '@/lib/prisma';
import { createRecordId } from '@/lib/record-id';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';

const text = (max) => z.string().trim().max(max);
const present = (max) => text(max).min(1);
const companyFields = {
	name: present(160), industry: text(120), address: text(191), city: text(100), state: text(100),
	zipCode: present(25), website: z.union([z.literal(''), text(191).url().regex(/^https?:\/\//i)]), phone: text(60)
};
const contactFields = {
	firstName: present(100), lastName: present(100), title: text(120),
	email: text(191).email(), phone: present(60)
};
const recordRef = z.string().trim().min(1).max(100);
const requestSchema = z.object({
	records: z.array(z.object({
		companyRef: recordRef, contactRef: recordRef.optional(),
		changes: z.record(z.object({ before: z.string().max(400), after: z.string().max(400) })).optional()
	})).min(1).max(25)
});
const selectFields = (fields) => Object.fromEntries(Object.keys(fields).map((key) => [key, true]));
const ownershipFields = { division: { select: integrationDivisionFields }, ownerUser: { select: { recordId: true } } };
const companySelect = { id: true, recordId: true, ...ownershipFields, ...selectFields(companyFields) };
const contactSelect = { id: true, recordId: true, clientId: true, ...ownershipFields, ...selectFields(contactFields) };
const valueOf = (value) => String(value ?? '').trim();

export async function POST(request) {
	const user = await authorizeCompanyIntegration(request);
	if (user instanceof Response) return user;
	const writesEnabled = user.writesEnabled;
	const scope = getEntityScope(user);
	try {
		const parsed = requestSchema.safeParse(await parseJsonBody(request));
		if (!parsed.success) return integrationError('Invalid record sync request.', 400);
		const { records } = parsed.data;
		const results = await prisma.$transaction(async (tx) => {
			const companies = await tx.client.findMany({
				where: addScopeToWhere({ recordId: { in: records.map((item) => item.companyRef) } }, scope),
				select: companySelect
			});
			const contacts = await tx.contact.findMany({
				where: addScopeToWhere({
					recordId: { in: records.flatMap((item) => item.contactRef ? [item.contactRef] : []) },
					clientId: { in: companies.map((item) => item.id) }
				}, scope),
				select: contactSelect
			});
			const output = [];
			for (const request of records) {
				const { companyRef, contactRef, changes } = request;
				const company = companies.find((row) => row.recordId === companyRef);
				if (!company) continue;
				const row = contactRef ? contacts.find((item) =>
					item.recordId === contactRef && item.clientId === company.id) : company;
				if (!row) continue;

				const fields = contactRef ? contactFields : companyFields;
				const values = Object.fromEntries(Object.keys(fields).map((key) => [key, valueOf(row[key])]));
				const rejected = [];
				const data = {};
				if (writesEnabled) {
					for (const [key, change] of Object.entries(changes ?? {})) {
						if (!Object.hasOwn(fields, key)) continue;
						const input = fields[key].safeParse(change.after);
						if (!input.success) {
							rejected.push(key);
							continue;
						}
						if (values[key] === change.before && values[key] !== input.data) {
							data[key] = input.data || null;
						}
					}
				}
				if (Object.keys(data).length) {
					if (contactRef) await tx.contact.update({ where: { id: row.id }, data });
					else await tx.client.update({ where: { id: row.id }, data });
					await tx.auditLog.create({ data: {
						recordId: createRecordId('AUD'), actorUserId: user.id,
						entityId: row.id, entityType: contactRef ? 'CONTACT' : 'CLIENT', action: 'UPDATE',
						summary: 'Closer Gnome details sync', changedFields: Object.keys(data)
					} });
					for (const key of Object.keys(data)) row[key] = values[key] = valueOf(data[key]);
				}
				output.push({ companyRef, contactRef: contactRef ?? null, values, rejected, scope: { division: row.division, ownerUser: row.ownerUser } });
			}
			return output;
		}, { isolationLevel: 'Serializable' });
		return NextResponse.json({ records: results, writesEnabled }, { headers: integrationHeaders });
	} catch (failure) {
		if (failure instanceof ValidationError) return integrationError(failure.message, 400);
		if (failure.code === 'P2034') return integrationError('Details changed during sync. Retry shortly.', 409);
		console.error('Details sync failed.', failure.code || failure.name);
		return integrationError('Hire Gnome could not sync record details.', 500);
	}
}
