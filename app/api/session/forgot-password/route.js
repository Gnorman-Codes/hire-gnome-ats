import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendEmailMessage } from '@/lib/email-delivery';
import { isValidEmailAddress } from '@/lib/email-validation';
import { getSystemBranding } from '@/lib/system-settings';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import {
	AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
	AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS
} from '@/lib/security-constants';
import {
	buildPasswordResetUrl,
	generatePasswordResetToken,
	getPasswordResetExpiresAt,
	getPasswordResetTtlMinutes,
	hashPasswordResetToken
} from '@/lib/password-reset';
import { logError, requestLogContext } from '@/lib/logger';

import { withApiLogging } from '@/lib/api-logging';
const forgotPasswordSchema = z.object({
	email: z
		.string()
		.trim()
		.min(1, 'Email is required.')
		.email('Enter a valid email address.')
		.refine((value) => isValidEmailAddress(value), {
			message: 'Enter a valid email address.'
		})
});

const GENERIC_FORGOT_PASSWORD_MESSAGE =
	'If an active user exists for that email, we sent a password reset link.';

function escapeHtml(value) {
	return String(value || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function buildResetEmailContent({ firstName, resetUrl, expiresInMinutes, siteName }) {
	const safeName = String(firstName || '').trim() || 'there';
	const safeNameHtml = escapeHtml(safeName);
	const safeResetUrlHtml = escapeHtml(resetUrl);
	const safeSiteName = String(siteName || '').trim() || 'Hire Gnome';
	const safeSiteNameHtml = escapeHtml(safeSiteName);
	const subject = `Reset your ${safeSiteName} password`;
	const text = [
		`Hi ${safeName},`,
		'',
		`We received a request to reset your ${safeSiteName} password.`,
		`Use this link to set a new password: ${resetUrl}`,
		`This link expires in ${expiresInMinutes} minutes.`,
		'',
		'If you did not request this, you can ignore this email.'
	].join('\n');
	const html = `
		<p>Hi ${safeNameHtml},</p>
		<p>We received a request to reset your ${safeSiteNameHtml} password.</p>
		<p><a href="${safeResetUrlHtml}">Reset your password</a></p>
		<p>This link expires in ${expiresInMinutes} minutes.</p>
		<p>If you did not request this, you can ignore this email.</p>
	`.trim();

	return { subject, text, html };
}

async function postForgotPassword(req) {
	const mutationThrottleResponse = await enforceMutationThrottle(req, 'session.forgot_password.post', {
		maxRequests: AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
		windowSeconds: AUTH_FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS,
		message: GENERIC_FORGOT_PASSWORD_MESSAGE
	});
	if (mutationThrottleResponse) {
		return mutationThrottleResponse;
	}

	const body = await req.json().catch(() => ({}));
	const parsed = forgotPasswordSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
	}

	const email = parsed.data.email.trim().toLowerCase();
	const user = await prisma.user.findUnique({
		where: { email },
		select: {
			id: true,
			firstName: true,
			email: true,
			isActive: true,
			serviceKey: true
		}
	});

	if (!user || !user.isActive || user.serviceKey) {
		return NextResponse.json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
	}

	const token = generatePasswordResetToken();
	const tokenHash = hashPasswordResetToken(token);
	const now = new Date();
	const expiresAt = getPasswordResetExpiresAt(now);
	const expiresInMinutes = getPasswordResetTtlMinutes();

	await prisma.$transaction(async (tx) => {
		await tx.passwordResetToken.updateMany({
			where: {
				userId: user.id,
				usedAt: null
			},
			data: {
				usedAt: now
			}
		});

		await tx.passwordResetToken.create({
			data: {
				userId: user.id,
				tokenHash,
				expiresAt
			}
		});
	});

	const resetUrl = buildPasswordResetUrl({ req, token });
	const branding = await getSystemBranding();
	const message = buildResetEmailContent({
		firstName: user.firstName,
		resetUrl,
		expiresInMinutes,
		siteName: branding.siteName
	});

	const emailResult = await sendEmailMessage({
		to: user.email,
		subject: message.subject,
		text: message.text,
		html: message.html
	});

	if (!emailResult.sent) {
		logError(
			'auth.forgot_password.email_failed',
			requestLogContext(req, {
				userId: user.id,
				reason: emailResult.reason || 'Unknown error'
			})
		);
	}

	return NextResponse.json({
		message: GENERIC_FORGOT_PASSWORD_MESSAGE
	});
}

export const POST = withApiLogging('session.forgot_password.post', postForgotPassword);
