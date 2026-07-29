import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { applySessionCookie, createSessionToken } from '@/lib/session-auth';
import { hashPassword, isAcceptablePassword } from '@/lib/password-auth';
import { ACTING_USER_COOKIE_NAME, AUTH_SESSION_MAX_AGE_SECONDS } from '@/lib/security-constants';
import { isValidEmailAddress } from '@/lib/email-validation';
import { uploadObjectBuffer, deleteObject } from '@/lib/object-storage';
import { getOnboardingState } from '@/lib/onboarding';
import { clearSystemSettingsCache, DEFAULT_SITE_NAME } from '@/lib/system-settings';
import { DEFAULT_THEME_KEY, normalizeThemeKey } from '@/lib/theme-options';
import { ensureDefaultUnassignedDivision } from '@/lib/default-division';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';

import { withApiLogging } from '@/lib/api-logging';
export const dynamic = 'force-dynamic';

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const setupSchema = z.object({
	siteName: z.string().trim().min(1, 'Site name is required.').max(80, 'Site name must be 80 characters or less.'),
	themeKey: z.string().trim().optional(),
	firstName: z.string().trim().min(1, 'First name is required.').max(80, 'First name is too long.'),
	lastName: z.string().trim().min(1, 'Last name is required.').max(80, 'Last name is too long.'),
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

function normalizeLogoFile(input) {
	if (!input || typeof input === 'string') return null;
	if (typeof input.arrayBuffer !== 'function') return null;
	return input;
}

function normalizeLogoExtension(fileName) {
	const extension = path.extname(String(fileName || '').trim()).toLowerCase();
	if (!ALLOWED_LOGO_EXTENSIONS.has(extension)) return '';
	return extension;
}

function buildSystemLogoStorageKey(fileName) {
	const extension = normalizeLogoExtension(fileName) || '.png';
	return `branding/logo-${Date.now()}-${randomUUID()}${extension}`;
}

function validateLogoFile(file) {
	if (!file) return '';
	const extension = normalizeLogoExtension(file.name);
	if (!extension) {
		return 'Unsupported logo file type. Use PNG, JPG, WEBP, or SVG.';
	}
	if (file.size <= 0) return 'Logo file is empty.';
	if (file.size > LOGO_MAX_BYTES) return 'Logo file exceeds 5 MB limit.';
	return '';
}

async function parseBody(req) {
	const contentType = req.headers.get('content-type') || '';
	if (contentType.includes('multipart/form-data')) {
		const formData = await req.formData();
		return {
			siteName: String(formData.get('siteName') || '').trim(),
			themeKey: String(formData.get('themeKey') || '').trim(),
			firstName: String(formData.get('firstName') || '').trim(),
			lastName: String(formData.get('lastName') || '').trim(),
			email: String(formData.get('email') || '').trim().toLowerCase(),
			password: String(formData.get('password') || '').trim(),
			logoFile: normalizeLogoFile(formData.get('logoFile'))
		};
	}

	const body = await req.json().catch(() => ({}));
	return {
		siteName: String(body?.siteName || '').trim(),
		themeKey: String(body?.themeKey || '').trim(),
		firstName: String(body?.firstName || '').trim(),
		lastName: String(body?.lastName || '').trim(),
		email: String(body?.email || '').trim().toLowerCase(),
		password: String(body?.password || '').trim(),
		logoFile: null
	};
}

async function postOnboarding_setupHandler(req) {
	const mutationThrottleResponse = await enforceMutationThrottle(req, 'onboarding.setup.post');
	if (mutationThrottleResponse) {
		return mutationThrottleResponse;
	}

	const state = await getOnboardingState();
	if (!state.needsOnboarding) {
		return NextResponse.json({ error: 'Onboarding is already complete.' }, { status: 409 });
	}

	const input = await parseBody(req);
	const parsed = setupSchema.safeParse(input);
	if (!parsed.success) {
		return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
	}
	if (!isAcceptablePassword(parsed.data.password)) {
		return NextResponse.json(
			{ error: 'Password is required and must be at least 8 characters.' },
			{ status: 400 }
		);
	}

	const logoValidationError = validateLogoFile(input.logoFile);
	if (logoValidationError) {
		return NextResponse.json({ error: logoValidationError }, { status: 400 });
	}

	let uploadedLogo = null;
	try {
		if (input.logoFile) {
			const logoBuffer = Buffer.from(await input.logoFile.arrayBuffer());
			uploadedLogo = await uploadObjectBuffer({
				key: buildSystemLogoStorageKey(input.logoFile.name),
				body: logoBuffer,
				contentType: input.logoFile.type || 'application/octet-stream'
			});
		}

		const passwordHash = await hashPassword(parsed.data.password);
		const normalizedThemeKey = normalizeThemeKey(parsed.data.themeKey || DEFAULT_THEME_KEY);
		const normalizedSiteName = parsed.data.siteName || DEFAULT_SITE_NAME;

		const result = await prisma.$transaction(async (tx) => {
			const userCount = await tx.user.count();
			if (userCount > 0) {
				throw new Error('ONBOARDING_ALREADY_COMPLETE');
			}
			const defaultDivision = await ensureDefaultUnassignedDivision(tx);

			const user = await tx.user.create({
				data: {
					firstName: parsed.data.firstName,
					lastName: parsed.data.lastName,
					email: parsed.data.email,
					passwordHash,
					passwordChangeRequired: false,
					role: 'ADMINISTRATOR',
					divisionId: defaultDivision.id,
					isActive: true
				},
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					role: true,
					divisionId: true
				}
			});

			const systemSetting = await tx.systemSetting.create({
				data: {
					siteName: normalizedSiteName,
					siteTitle: normalizedSiteName,
					themeKey: normalizedThemeKey,
					careerSiteEnabled: false,
					logoStorageProvider: uploadedLogo?.storageProvider || null,
					logoStorageBucket: uploadedLogo?.storageBucket || null,
					logoStorageKey: uploadedLogo?.storageKey || null,
					logoContentType: input.logoFile?.type || null,
					logoFileName: input.logoFile?.name || null
				}
			});

			return { user, systemSetting };
		});

		clearSystemSettingsCache();

		const response = NextResponse.json({
			ok: true,
			message: 'Onboarding complete.',
			siteName: result.systemSetting.siteName,
			themeKey: result.systemSetting.themeKey,
			logoUrl: result.systemSetting.logoStorageKey
				? `/api/system-settings/logo?v=${new Date(result.systemSetting.updatedAt).getTime()}`
				: '/branding/hire-gnome.png',
			hasCustomLogo: Boolean(result.systemSetting.logoStorageKey),
			user: result.user
		});
		const token = createSessionToken({
			userId: result.user.id,
			sessionVersion: 1,
			passwordChangeRequired: false,
			maxAgeSeconds: AUTH_SESSION_MAX_AGE_SECONDS
		});
		applySessionCookie(response, token, AUTH_SESSION_MAX_AGE_SECONDS);
		response.cookies.set(ACTING_USER_COOKIE_NAME, String(result.user.id), {
			httpOnly: false,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			path: '/',
			maxAge: AUTH_SESSION_MAX_AGE_SECONDS
		});
		return response;
	} catch (error) {
		if (uploadedLogo?.storageKey) {
			await deleteObject({
				key: uploadedLogo.storageKey,
				storageProvider: uploadedLogo.storageProvider,
				storageBucket: uploadedLogo.storageBucket
			}).catch(() => null);
		}

		if (error?.message === 'ONBOARDING_ALREADY_COMPLETE') {
			return NextResponse.json({ error: 'Onboarding is already complete.' }, { status: 409 });
		}

		return NextResponse.json({ error: 'Failed to complete onboarding.' }, { status: 500 });
	}
}

export const POST = withApiLogging('onboarding.setup.post', postOnboarding_setupHandler);
