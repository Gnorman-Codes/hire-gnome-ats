import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/access-control';
import { writeAuditLog } from '@/lib/audit-log';
import { DEMO_MODE } from '@/lib/demo-config';
import { isEligibleIntegrationApiUser, newIntegrationApiCredential } from '@/lib/integrations/api-credential.mjs';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { prisma } from '@/lib/prisma';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';

const recordId = z.string().trim().min(1).max(191);
const createInput = z.object({
	label: z.string().trim().min(1).max(191),
	userRecordId: recordId,
	writesEnabled: z.boolean()
}).strict();
const revokeInput = z.object({ recordId }).strict();

const userFields = {
	recordId: true, firstName: true, lastName: true, role: true, divisionId: true,
	isActive: true, passwordChangeRequired: true, serviceKey: true, division: { select: { name: true } }
};
const keyFields = {
	recordId: true, label: true, writesEnabled: true, createdAt: true, revokedAt: true, role: true,
	divisionId: true, user: { select: userFields }
};

function presentUser(user) {
	return {
		recordId: user.recordId, name: [user.firstName, user.lastName].filter(Boolean).join(' '),
		role: user.role, division: user.division?.name
	};
}

function presentKey(key) {
	const { role, divisionId, user, revokedAt, ...fields } = key;
	const validScope = isEligibleIntegrationApiUser(user) && user.role === role && user.divisionId === divisionId;
	return { ...fields, revokedAt, status: revokedAt ? 'revoked' : validScope ? 'active' : 'access_changed', user: presentUser(user) };
}

function json(body, status = 200) {
	return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req) {
	const admin = await getAuthenticatedUser(req, { allowFallback: false });
	if (!admin) return json({ error: 'Sign in to continue.' }, 401);
	if (admin.role !== 'ADMINISTRATOR') return json({ error: 'Administrator access required.' }, 403);
	if (DEMO_MODE) return json({ demoMode: true, keys: [], users: [] });
	const [keys, users] = await Promise.all([
		prisma.integrationApiCredential.findMany({ select: keyFields, orderBy: { id: 'desc' } }),
		prisma.user.findMany({
			where: { isActive: true, serviceKey: null, passwordChangeRequired: false, divisionId: { not: null }, role: { in: ['DIRECTOR', 'RECRUITER'] } },
			select: userFields,
			orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }]
		})
	]);
	return json({ keys: keys.map(presentKey), users: users.map(presentUser) });
}

async function mutate(req, schema, action) {
	const admin = await getAuthenticatedUser(req, { allowFallback: false });
	if (!admin) return json({ error: 'Sign in to continue.' }, 401);
	if (admin.role !== 'ADMINISTRATOR') return json({ error: 'Administrator access required.' }, 403);
	if (DEMO_MODE) return json({ error: 'API key management is disabled on the public demo.' }, 403);
	if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') {
		return json({ error: 'Submit the API key request as JSON.' }, 415);
	}
	const throttled = await enforceMutationThrottle(req, 'admin.api-keys.write');
	if (throttled) return throttled;
	try {
		const input = schema.safeParse(await parseJsonBody(req));
		if (!input.success) return json({ error: 'Check the API key details.' }, 400);
		return await action(admin, input.data);
	} catch (error) {
		if (error instanceof ValidationError) return json({ error: error.message }, 400);
		if (error.code === 'P2034') return json({ error: 'Access changed during the request. Refresh and try again.' }, 409);
		console.error('API key management failed.', error.code || error.name);
		return json({ error: 'Could not save the API key change.' }, 500);
	}
}

export function POST(req) {
	return mutate(req, createInput, async (admin, { label, userRecordId, writesEnabled }) => {
		const issued = await prisma.$transaction(async (tx) => {
			const user = await tx.user.findUnique({ where: { recordId: userRecordId }, include: { division: true } });
			if (!isEligibleIntegrationApiUser(user)) return null;
			const { token, data } = newIntegrationApiCredential({ user, label, writesEnabled });
			const key = await tx.integrationApiCredential.create({ data, select: { ...keyFields, id: true } });
			const { id, ...fields } = key;
			await writeAuditLog({
				actorUserId: admin.id, entityId: id, entityType: 'INTEGRATION_API_CREDENTIAL', action: 'CREATE',
				summary: 'Issued an integration API key', after: { recordId: key.recordId, label, userRecordId, writesEnabled }
			}, tx);
			return { key: presentKey(fields), token };
		}, { isolationLevel: 'Serializable' });
		return issued ? json(issued, 201) : json({ error: 'Select an active director or recruiter with a division and no pending password change.' }, 400);
	});
}

export function DELETE(req) {
	return mutate(req, revokeInput, async (admin, { recordId: id }) => {
		const key = await prisma.$transaction(async (tx) => {
			const revokedAt = new Date();
			const updated = await tx.integrationApiCredential.updateMany({ where: { recordId: id, revokedAt: null }, data: { revokedAt } });
			const key = await tx.integrationApiCredential.findUnique({ where: { recordId: id }, select: { ...keyFields, id: true } });
			if (!key) return null;
			if (updated.count) {
				await writeAuditLog({
					actorUserId: admin.id, entityId: key.id, entityType: 'INTEGRATION_API_CREDENTIAL', action: 'UPDATE',
					summary: 'Revoked an integration API key', before: { revokedAt: null }, after: { revokedAt }
				}, tx);
			}
			const { id: databaseId, ...fields } = key;
			return presentKey(fields);
		});
		return key ? json({ key }) : json({ error: 'API key not found.' }, 404);
	});
}
