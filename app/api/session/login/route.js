import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
	ACTING_USER_COOKIE_NAME,
	AUTH_LOGIN_RATE_LIMIT_MAX_REQUESTS,
	AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
	AUTH_LOGIN_LOCKOUT_MINUTES,
	AUTH_LOGIN_MAX_ATTEMPTS,
	AUTH_SESSION_MAX_AGE_SECONDS
} from '@/lib/security-constants';
import { applySessionCookie, createSessionToken } from '@/lib/session-auth';
import { hashPassword, isAcceptablePassword, verifyPassword } from '@/lib/password-auth';
import { isValidEmailAddress } from '@/lib/email-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';

import { withApiLogging } from '@/lib/api-logging';
const loginSchema = z.object({
	email: z
		.string()
		.trim()
		.min(1, 'Email is required.')
		.email('Enter a valid email address.')
		.refine((value) => isValidEmailAddress(value), {
			message: 'Enter a valid email address.'
		}),
	password: z.string().trim().min(1, 'Password is required.')
});

function serializeUser(user) {
	return {
		id: user.id,
		firstName: user.firstName,
		lastName: user.lastName,
		email: user.email,
		role: user.role,
		passwordChangeRequired: Boolean(user.passwordChangeRequired),
		divisionId: user.divisionId,
		division: user.division
			? {
				id: user.division.id,
				name: user.division.name,
				accessMode: user.division.accessMode
			}
			: null
	};
}

function bootstrapPassword() {
	const configured = String(process.env.AUTH_DEFAULT_PASSWORD || '').trim();
	if (configured.length >= 8) return configured;
	return 'Welcome123!';
}

async function postLogin(req) {
	const mutationThrottleResponse = await enforceMutationThrottle(req, 'session.login.post', {
		maxRequests: AUTH_LOGIN_RATE_LIMIT_MAX_REQUESTS,
		windowSeconds: AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
		message: 'Too many login attempts from this network. Please try again shortly.'
	});
	if (mutationThrottleResponse) {
		return mutationThrottleResponse;
	}

	const body = await req.json().catch(() => ({}));
	const parsed = loginSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
	}

	const email = parsed.data.email.trim();
	const password = parsed.data.password.trim();
	const now = new Date();
	const user = await prisma.user.findUnique({
		where: { email },
		include: {
			division: {
				select: {
					id: true,
					name: true,
					accessMode: true
				}
			}
		}
	});

	if (!user || !user.isActive) {
		return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
	}
	if (user.lockoutUntil && user.lockoutUntil > now) {
		return NextResponse.json(
			{
				error: `Too many failed login attempts. Try again at ${user.lockoutUntil.toLocaleDateString()} @ ${user.lockoutUntil.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
			},
			{ status: 429 }
		);
	}

	let validPassword = false;
	let passwordChangeRequired = Boolean(user.passwordChangeRequired);
	if (user.passwordHash) {
		validPassword = await verifyPassword(password, user.passwordHash);
	} else {
		validPassword = password === bootstrapPassword();
		if (validPassword && isAcceptablePassword(password)) {
			const nextPasswordHash = await hashPassword(password);
			await prisma.user.update({
				where: { id: user.id },
				data: {
					passwordHash: nextPasswordHash,
					passwordChangeRequired: true
				}
			});
			passwordChangeRequired = true;
		}
	}

	if (!validPassword) {
		const nextFailedAttempts = (user.failedLoginAttempts || 0) + 1;
		const shouldLock = nextFailedAttempts >= AUTH_LOGIN_MAX_ATTEMPTS;
		const lockoutUntil = shouldLock
			? new Date(now.getTime() + AUTH_LOGIN_LOCKOUT_MINUTES * 60 * 1000)
			: null;
		await prisma.user.update({
			where: { id: user.id },
			data: {
				failedLoginAttempts: shouldLock ? 0 : nextFailedAttempts,
				lockoutUntil
			}
		});
		if (shouldLock && lockoutUntil) {
			return NextResponse.json(
				{
					error: `Too many failed login attempts. Try again at ${lockoutUntil.toLocaleDateString()} @ ${lockoutUntil.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
				},
				{ status: 429 }
			);
		}
		return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
	}
	if (user.failedLoginAttempts || user.lockoutUntil) {
		await prisma.user.update({
			where: { id: user.id },
			data: {
				failedLoginAttempts: 0,
				lockoutUntil: null
			}
		});
	}

	const response = NextResponse.json({
		user: {
			...serializeUser(user),
			passwordChangeRequired
		}
	});
	const token = createSessionToken({
		userId: user.id,
		sessionVersion: user.sessionVersion || 1,
		passwordChangeRequired,
		maxAgeSeconds: AUTH_SESSION_MAX_AGE_SECONDS
	});
	applySessionCookie(response, token, AUTH_SESSION_MAX_AGE_SECONDS);
	response.cookies.set(ACTING_USER_COOKIE_NAME, String(user.id), {
		httpOnly: false,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: AUTH_SESSION_MAX_AGE_SECONDS
	});
	return response;
}

export const POST = withApiLogging('session.login.post', postLogin);
