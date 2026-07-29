import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/access-control';
import { hashPassword, isAcceptablePassword, verifyPassword } from '@/lib/password-auth';
import { writeAuditLog } from '@/lib/audit-log';
import { ACTING_USER_COOKIE_NAME, AUTH_SESSION_MAX_AGE_SECONDS } from '@/lib/security-constants';
import { applySessionCookie, createSessionToken } from '@/lib/session-auth';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';

import { withApiLogging } from '@/lib/api-logging';
const changePasswordSchema = z.object({
	currentPassword: z.string().trim().min(1, 'Current password is required.'),
	newPassword: z.string().trim().min(1, 'New password is required.'),
	confirmPassword: z.string().trim().min(1, 'Confirm password is required.')
});

function bootstrapPassword() {
	const configured = String(process.env.AUTH_DEFAULT_PASSWORD || '').trim();
	if (configured.length >= 8) return configured;
	return 'Welcome123!';
}

async function postSession_change_passwordHandler(req) {
	const mutationThrottleResponse = await enforceMutationThrottle(req, 'session.change_password.post');
	if (mutationThrottleResponse) {
		return mutationThrottleResponse;
	}

	const authenticatedUser = await getAuthenticatedUser(req, { allowFallback: false });
	if (!authenticatedUser?.id) {
		return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
	}

	const body = await req.json().catch(() => ({}));
	const parsed = changePasswordSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
	}

	const currentPassword = parsed.data.currentPassword.trim();
	const newPassword = parsed.data.newPassword.trim();
	const confirmPassword = parsed.data.confirmPassword.trim();

	if (!isAcceptablePassword(newPassword)) {
		return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
	}

	if (newPassword !== confirmPassword) {
		return NextResponse.json({ error: 'New password and confirm password must match.' }, { status: 400 });
	}

	if (newPassword === currentPassword) {
		return NextResponse.json(
			{ error: 'New password must be different from your current password.' },
			{ status: 400 }
		);
	}

	const user = await prisma.user.findUnique({
		where: { id: authenticatedUser.id },
		select: {
			id: true,
			isActive: true,
			passwordHash: true,
			passwordChangeRequired: true,
			sessionVersion: true
		}
	});

	if (!user || !user.isActive) {
		return NextResponse.json({ error: 'Your account is not active.' }, { status: 403 });
	}

	let validCurrentPassword = false;
	if (user.passwordHash) {
		validCurrentPassword = await verifyPassword(currentPassword, user.passwordHash);
	} else {
		validCurrentPassword = currentPassword === bootstrapPassword();
	}

	if (!validCurrentPassword) {
		return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
	}

	const nextPasswordHash = await hashPassword(newPassword);
	const updatedUser = await prisma.user.update({
		where: { id: user.id },
		data: {
			passwordHash: nextPasswordHash,
			passwordChangeRequired: false,
			sessionVersion: {
				increment: 1
			}
		},
		select: {
			id: true,
			sessionVersion: true
		}
	});

	await writeAuditLog({
		actorUserId: user.id,
		action: 'UPDATE',
		entityType: 'USER',
		entityId: user.id,
		summary: 'Updated own password.',
		metadata: { field: 'passwordHash' }
	});

	const response = NextResponse.json({ ok: true, message: 'Password updated.' });
	const token = createSessionToken({
		userId: updatedUser.id,
		sessionVersion: updatedUser.sessionVersion || 1,
		passwordChangeRequired: false,
		maxAgeSeconds: AUTH_SESSION_MAX_AGE_SECONDS
	});
	applySessionCookie(response, token, AUTH_SESSION_MAX_AGE_SECONDS);
	response.cookies.set(ACTING_USER_COOKIE_NAME, String(updatedUser.id), {
		httpOnly: false,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: AUTH_SESSION_MAX_AGE_SECONDS
	});

	return response;
}

export const POST = withApiLogging('session.change_password.post', postSession_change_passwordHandler);
