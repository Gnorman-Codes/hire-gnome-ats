import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/access-control';
import { authorizeCompanyIntegration, companyIntegrationConfig, integrationError, integrationHeaders } from '@/lib/company-integration-auth';
import { prisma } from '@/lib/prisma';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';
import { clearSessionCookie, getSessionTokenFromRequest } from '@/lib/session-auth';

const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const exchangeSchema = z.object({ code: proof, verifier: proof, redirectUri: z.string().max(2048) });
const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
const challengeFor = (value) => createHash('sha256').update(value).digest('base64url');

function redirect(url) {
	return new NextResponse(null, {
		status: 303, headers: { ...integrationHeaders, 'Referrer-Policy': 'no-referrer', Location: String(url) }
	});
}

export async function GET(request) {
	const config = await companyIntegrationConfig();
	const redirectUri = config.configured && config.ssoRedirectUri;
	if (!redirectUri) return integrationError('Closer Gnome sign-in is disabled.', 404);

	const params = request.nextUrl.searchParams;
	const state = proof.safeParse(params.get('state'));
	const challenge = proof.safeParse(params.get('challenge'));
	if (!state.success || !challenge.success || params.get('redirectUri') !== redirectUri) {
		return integrationError('Invalid Closer Gnome sign-in request.', 400);
	}

	const user = await getAuthenticatedUser(request, { allowFallback: false });
	if (!user) {
		const login = new URLSearchParams({ next: '/api/integrations/v1/sso?' + params.toString() });
		const response = redirect(`/login?${login}`);
		if (getSessionTokenFromRequest(request)) clearSessionCookie(response);
		return response;
	}

	const callback = new URL(redirectUri);
	callback.searchParams.set('state', state.data);
	if (user.passwordChangeRequired) {
		callback.searchParams.set('error', 'password_change_required');
		return redirect(callback);
	}

	try {
		const code = randomBytes(32).toString('base64url');
		const now = new Date();
		await prisma.closerSsoCode.deleteMany({ where: { expiresAt: { lte: now } } });
		await prisma.closerSsoCode.create({ data: {
			tokenHash: tokenHash(code), challenge: challenge.data, redirectUri, userId: user.id,
			sessionVersion: user.sessionVersion || 1, expiresAt: new Date(now.getTime() + 90_000)
		} });
		callback.searchParams.set('code', code);
		return redirect(callback);
	} catch (error) {
		console.error('Could not issue Closer Gnome sign-in code.', error.code || error.name);
		callback.searchParams.set('error', 'unavailable');
		return redirect(callback);
	}
}

export async function POST(request) {
	const integration = await authorizeCompanyIntegration(request);
	if (integration instanceof Response) return integration;
	const redirectUri = integration.ssoRedirectUri;
	if (!redirectUri) return integrationError('Closer Gnome sign-in is disabled.', 404);

	try {
		const parsed = exchangeSchema.safeParse(await parseJsonBody(request));
		if (!parsed.success || parsed.data.redirectUri !== redirectUri) {
			return integrationError('Invalid Closer Gnome code exchange.', 400);
		}
		const { code, verifier } = parsed.data;
		const hash = tokenHash(code);
		const now = new Date();
		const identity = await prisma.$transaction(async (tx) => {
			const entry = await tx.closerSsoCode.findUnique({
				where: { tokenHash: hash },
				include: { user: { select: { recordId: true, isActive: true, passwordChangeRequired: true, sessionVersion: true } } }
			});
			if (!entry || entry.expiresAt <= now || entry.redirectUri !== redirectUri ||
				entry.challenge !== challengeFor(verifier)) return null;
			const redeemed = await tx.closerSsoCode.deleteMany({ where: { tokenHash: hash, expiresAt: { gt: now } } });
			if (!redeemed.count || !entry.user.isActive || entry.user.passwordChangeRequired ||
				entry.user.sessionVersion !== entry.sessionVersion) return null;
			return { recordId: entry.user.recordId };
		});
		if (!identity) return integrationError('The sign-in code is invalid or expired.', 401);
		return NextResponse.json(identity, { headers: integrationHeaders });
	} catch (error) {
		if (error instanceof ValidationError) return integrationError(error.message, 400);
		if (error.code === 'P2034') return integrationError('The sign-in code is invalid or expired.', 401);
		console.error('Could not redeem Closer Gnome sign-in code.', error.code || error.name);
		return integrationError('Hire Gnome sign-in is unavailable.', 500);
	}
}
