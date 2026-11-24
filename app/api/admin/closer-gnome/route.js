import { randomBytes, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/access-control';
import { writeAuditLog } from '@/lib/audit-log';
import { closerServiceKey, companyIntegrationConfig, integrationCallback, integrationError, integrationHeaders, integrationTokenHash } from '@/lib/company-integration-auth';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { prisma } from '@/lib/prisma';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';

const input = z.object({
	writesEnabled: z.boolean(),
	ssoRedirectUri: z.string().trim().max(2048),
	version: z.number().int().nonnegative(),
	generateToken: z.boolean()
}).strict();

async function administrator(req) {
	const user = await getAuthenticatedUser(req, { allowFallback: false });
	if (!user) return integrationError('Sign in to continue.', 401);
	if (user.role !== 'ADMINISTRATOR') return integrationError('Administrator access required.', 403);
	return user;
}

export async function GET(req) {
	const admin = await administrator(req);
	if (admin instanceof Response) return admin;
	const config = await companyIntegrationConfig();
	return NextResponse.json({
		source: config.source,
		usesServiceAccount: Boolean(config.usesServiceAccount),
		writesEnabled: config.source === 'none' || config.writesEnabled,
		ssoRedirectUri: config.ssoRedirectUri || '',
		version: config.version
	}, { headers: integrationHeaders });
}

export async function POST(req) {
	const admin = await administrator(req);
	if (admin instanceof Response) return admin;
	if (req.headers.get('content-type')?.split(';')[0] !== 'application/json') {
		return integrationError('Submit the integration settings as JSON.', 415);
	}
	const throttle = await enforceMutationThrottle(req, 'admin.closer-gnome.post');
	if (throttle) return throttle;
	try {
		const parsed = input.safeParse(await parseJsonBody(req));
		if (!parsed.success) return integrationError('Check the integration settings.', 400);
		const { writesEnabled, ssoRedirectUri, version, generateToken } = parsed.data;
		const callback = integrationCallback(ssoRedirectUri);
		if (ssoRedirectUri && !callback) return integrationError('Enter a valid HTTPS sign-in callback URL (HTTP is allowed for localhost).', 400);
		const token = generateToken ? randomBytes(32).toString('hex') : null;

		const result = await prisma.$transaction(async (tx) => {
			const current = await companyIntegrationConfig(tx);
			if (current.version !== version) return { error: 'Settings changed. Reload the page and try again.', status: 409 };
			if (!current.usesServiceAccount && !token) return { error: 'Generate a token to set up the connection.', status: 400 };
			const user = await tx.user.upsert({
				where: { serviceKey: closerServiceKey },
				create: {
					serviceKey: closerServiceKey, firstName: 'Closer', lastName: 'Gnome',
					email: `closer-gnome-${randomUUID()}@service.invalid`,
					role: 'ADMINISTRATOR', isActive: false
				},
				update: { role: 'ADMINISTRATOR', isActive: false, passwordHash: null },
				select: { id: true }
			});
			const userId = user.id;
			const next = {
				userId, writesEnabled, ssoRedirectUri: callback,
				tokenHash: token ? integrationTokenHash(token) : current.tokenHash, version: version + 1
			};
			await tx.closerConnection.upsert({ where: { id: 1 }, create: { id: 1, ...next }, update: next });
			if (token || current.ssoRedirectUri !== callback || current.userId !== userId) await tx.closerSsoCode.deleteMany({});
			await writeAuditLog({
				actorUserId: admin.id, entityType: 'CLOSER_CONNECTION', entityId: 1,
				action: current.source === 'admin' ? 'UPDATE' : 'CREATE',
				summary: token ? 'Issued a Closer Gnome integration token' : 'Updated Closer Gnome integration settings',
				after: { userId, writesEnabled, ssoRedirectUri: callback }
			}, tx);
			return { source: 'admin', usesServiceAccount: true, writesEnabled, ssoRedirectUri: callback || '', version: next.version, ...(token ? { token } : {}) };
		}, { isolationLevel: 'Serializable' });
		if (result.error) return integrationError(result.error, result.status);
		return NextResponse.json(result, { headers: integrationHeaders });
	} catch (error) {
		if (error instanceof ValidationError) return integrationError(error.message, 400);
		if (['P2002', 'P2034'].includes(error.code)) return integrationError('Settings changed. Reload the page and try again.', 409);
		console.error('Closer Gnome connection setup failed.', error.code || error.name);
		return integrationError('Could not save the connection settings.', 500);
	}
}
