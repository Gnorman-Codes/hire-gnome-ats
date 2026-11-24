import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const closerServiceKey = 'closer-gnome';

export const integrationHeaders = { 'Cache-Control': 'no-store' };

export function integrationError(message, status) {
	return NextResponse.json({ error: message }, { status, headers: integrationHeaders });
}

export function integrationTokenHash(token) {
	return createHash('sha256').update(token).digest('hex');
}

export function integrationCallback(value) {
	if (!value || value.length > 2048) return null;
	try {
		const url = new URL(value);
		const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
		if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
			url.username || url.password || url.search || url.hash || url.href.length > 2048) return null;
		return url.href;
	} catch {
		return null;
	}
}

export async function companyIntegrationConfig(db = prisma) {
	const saved = await db.closerConnection.findUnique({
		where: { id: 1 }, include: { user: { select: { serviceKey: true } } }
	});
	if (saved) {
		const { user, ...settings } = saved;
		return { ...settings, configured: Boolean(saved.userId), source: 'admin', usesServiceAccount: user?.serviceKey === closerServiceKey };
	}

	const token = process.env.COMPANY_INTEGRATION_TOKEN;
	const accountEmail = process.env.COMPANY_INTEGRATION_USER_EMAIL?.trim();
	const configured = Boolean(token?.length >= 32 && accountEmail);
	return {
		configured, source: configured ? 'environment' : 'none', accountEmail, version: 0,
		tokenHash: configured ? integrationTokenHash(token) : null,
		writesEnabled: process.env.COMPANY_INTEGRATION_WRITE_ENABLED === 'true',
		ssoRedirectUri: integrationCallback(process.env.COMPANY_INTEGRATION_SSO_REDIRECT_URI?.trim())
	};
}

export async function authorizeCompanyIntegration(request) {
	const config = await companyIntegrationConfig();
	if (!config.configured) return integrationError('Company integration is disabled.', 404);

	const authorization = request.headers.get('authorization') || '';
	const hash = integrationTokenHash(authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
	if (!timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(config.tokenHash, 'hex'))) {
		return integrationError('Invalid integration token.', 401);
	}

	const user = await prisma.user.findUnique({
		where: config.source === 'admin' ? { id: config.userId } : { email: config.accountEmail },
		select: {
			id: true, role: true, divisionId: true, isActive: true, serviceKey: true,
			division: { select: { accessMode: true } }
		}
	});
	const service = config.usesServiceAccount && user?.serviceKey === closerServiceKey && user.role === 'ADMINISTRATOR';
	if (!service && (!user?.isActive || user.serviceKey)) return integrationError('Integration user is unavailable.', 403);

	return { ...user, writesEnabled: config.writesEnabled, ssoRedirectUri: config.ssoRedirectUri };
}
