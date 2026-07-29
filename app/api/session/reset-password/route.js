import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashPassword, isAcceptablePassword } from '@/lib/password-auth';
import { hashPasswordResetToken } from '@/lib/password-reset';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import {
	AUTH_RESET_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
	AUTH_RESET_PASSWORD_RATE_LIMIT_WINDOW_SECONDS
} from '@/lib/security-constants';

import { withApiLogging } from '@/lib/api-logging';
const resetPasswordSchema = z
	.object({
		token: z.string().trim().min(1, 'Reset token is required.'),
		password: z.string().trim().min(1, 'Password is required.'),
		confirmPassword: z.string().trim().min(1, 'Confirm password is required.')
	})
	.superRefine((value, context) => {
		if (!isAcceptablePassword(value.password)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['password'],
				message: 'Password must be at least 8 characters.'
			});
		}
		if (value.password !== value.confirmPassword) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['confirmPassword'],
				message: 'Passwords do not match.'
			});
		}
	});

const INVALID_TOKEN_MESSAGE = 'This reset link is invalid or has expired. Request a new one.';

async function postResetPassword(req) {
	const mutationThrottleResponse = await enforceMutationThrottle(req, 'session.reset_password.post', {
		maxRequests: AUTH_RESET_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
		windowSeconds: AUTH_RESET_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
		message: 'Too many reset attempts from this network. Please try again shortly.'
	});
	if (mutationThrottleResponse) {
		return mutationThrottleResponse;
	}

	const body = await req.json().catch(() => ({}));
	const parsed = resetPasswordSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
	}

	const tokenHash = hashPasswordResetToken(parsed.data.token);
	if (!tokenHash) {
		return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
	}

	const now = new Date();
	const resetToken = await prisma.passwordResetToken.findUnique({
		where: { tokenHash },
		select: {
			id: true,
			userId: true,
			usedAt: true,
			expiresAt: true,
			user: {
				select: {
					id: true,
					isActive: true,
					sessionVersion: true
				}
			}
		}
	});

	if (
		!resetToken ||
		resetToken.usedAt ||
		resetToken.expiresAt <= now ||
		!resetToken.user ||
		!resetToken.user.isActive
	) {
		return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
	}

	const passwordHash = await hashPassword(parsed.data.password);

	try {
		await prisma.$transaction(async (tx) => {
			const claim = await tx.passwordResetToken.updateMany({
				where: {
					id: resetToken.id,
					usedAt: null,
					expiresAt: {
						gt: now
					}
				},
				data: {
					usedAt: now
				}
			});

			if (claim.count !== 1) {
				throw new Error('RESET_TOKEN_ALREADY_USED');
			}

			await tx.user.update({
				where: { id: resetToken.userId },
				data: {
					passwordHash,
					passwordChangeRequired: false,
					sessionVersion: {
						increment: 1
					},
					failedLoginAttempts: 0,
					lockoutUntil: null
				}
			});

			await tx.passwordResetToken.updateMany({
				where: {
					userId: resetToken.userId,
					usedAt: null
				},
				data: {
					usedAt: now
				}
			});
		});
	} catch (error) {
		if (error instanceof Error && error.message === 'RESET_TOKEN_ALREADY_USED') {
			return NextResponse.json({ error: INVALID_TOKEN_MESSAGE }, { status: 400 });
		}
		throw error;
	}

	return NextResponse.json({
		success: true,
		message: 'Password reset successful. You can now sign in with your new password.'
	});
}

export const POST = withApiLogging('session.reset_password.post', postResetPassword);
