import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActingUser } from '@/lib/access-control';
import { logCreate, logUpdate } from '@/lib/audit-log';
import { deleteObject, uploadObjectBuffer } from '@/lib/object-storage';
import { isValidEmailAddress } from '@/lib/email-validation';
import { DEMO_MODE } from '@/lib/demo-config';
import {
	clearSystemSettingsCache,
	getSystemSettingRecord,
	serializeAdminSystemSettings,
	serializeSystemBranding,
	DEFAULT_SITE_NAME,
	DEFAULT_API_ERROR_LOG_RETENTION_DAYS
} from '@/lib/system-settings';
import { DEFAULT_THEME_KEY, normalizeThemeKey } from '@/lib/theme-options';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import {
	getAttemptedHostedManagedSettingKeys,
	serializeClientVisibleAdminSettings
} from '@/lib/hosted-managed-integrations';

import { withApiLogging } from '@/lib/api-logging';
export const dynamic = 'force-dynamic';

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_FILE_FIELD = 'logoFile';
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const OBJECT_STORAGE_PROVIDERS = new Set(['s3', 'local']);

function asTrimmedString(value) {
	if (value == null) return '';
	return String(value).trim();
}

function toBoolean(value) {
	if (value == null || value === '') return false;
	return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toNullablePort(value) {
	const parsed = Number.parseInt(asTrimmedString(value), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

function toNullablePositiveInteger(value) {
	const parsed = Number.parseInt(asTrimmedString(value), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

function hasOwnProperty(value, key) {
	return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeObjectStorageProvider(value) {
	const normalized = asTrimmedString(value).toLowerCase();
	if (OBJECT_STORAGE_PROVIDERS.has(normalized)) return normalized;
	return '';
}

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

function validateSiteName(siteName) {
	if (!siteName) return 'Site name is required.';
	if (siteName.length > 80) return 'Site name must be 80 characters or less.';
	return '';
}

function validateApiErrorLogRetentionDays(value) {
	if (!Number.isInteger(value)) return 'API error log retention must be a positive number of days.';
	if (value < 1) return 'API error log retention must be at least 1 day.';
	if (value > 3650) return 'API error log retention must be 3650 days or less.';
	return '';
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

function buildSystemLogoStorageKey(fileName) {
	const extension = normalizeLogoExtension(fileName) || '.png';
	return `branding/logo-${Date.now()}-${randomUUID()}${extension}`;
}

async function parseBody(req) {
	const contentType = req.headers.get('content-type') || '';
	if (contentType.includes('multipart/form-data')) {
		const formData = await req.formData();
		const logoFile = normalizeLogoFile(formData.get(LOGO_FILE_FIELD));
		return {
			siteName: asTrimmedString(formData.get('siteName')),
			themeKey: asTrimmedString(formData.get('themeKey')),
			careerSiteEnabled: formData.has('careerSiteEnabled')
				? toBoolean(formData.get('careerSiteEnabled'))
				: undefined,
			clientPortalEnabled: formData.has('clientPortalEnabled')
				? toBoolean(formData.get('clientPortalEnabled'))
				: undefined,
			careerHeroTitle: formData.has('careerHeroTitle')
				? asTrimmedString(formData.get('careerHeroTitle'))
				: undefined,
			careerHeroBody: formData.has('careerHeroBody')
				? asTrimmedString(formData.get('careerHeroBody'))
				: undefined,
			apiErrorLogRetentionDays: formData.has('apiErrorLogRetentionDays')
				? asTrimmedString(formData.get('apiErrorLogRetentionDays'))
				: undefined,
			removeLogo: toBoolean(formData.get('removeLogo')),
			logoFile,
			googleMapsApiKey: formData.has('googleMapsApiKey')
				? asTrimmedString(formData.get('googleMapsApiKey'))
				: undefined,
			openAiApiKey: formData.has('openAiApiKey')
				? asTrimmedString(formData.get('openAiApiKey'))
				: undefined,
			smtpHost: formData.has('smtpHost') ? asTrimmedString(formData.get('smtpHost')) : undefined,
			smtpPort: formData.has('smtpPort') ? asTrimmedString(formData.get('smtpPort')) : undefined,
			smtpSecure: formData.has('smtpSecure') ? toBoolean(formData.get('smtpSecure')) : undefined,
			smtpUser: formData.has('smtpUser') ? asTrimmedString(formData.get('smtpUser')) : undefined,
			smtpPass: formData.has('smtpPass') ? asTrimmedString(formData.get('smtpPass')) : undefined,
			smtpFromName: formData.has('smtpFromName')
				? asTrimmedString(formData.get('smtpFromName'))
				: undefined,
			smtpFromEmail: formData.has('smtpFromEmail')
				? asTrimmedString(formData.get('smtpFromEmail'))
				: undefined,
			bullhornUsername: formData.has('bullhornUsername')
				? asTrimmedString(formData.get('bullhornUsername'))
				: undefined,
			bullhornPassword: formData.has('bullhornPassword')
				? asTrimmedString(formData.get('bullhornPassword'))
				: undefined,
			bullhornClientId: formData.has('bullhornClientId')
				? asTrimmedString(formData.get('bullhornClientId'))
				: undefined,
			bullhornClientSecret: formData.has('bullhornClientSecret')
				? asTrimmedString(formData.get('bullhornClientSecret'))
				: undefined,
			objectStorageProvider: formData.has('objectStorageProvider')
				? asTrimmedString(formData.get('objectStorageProvider'))
				: undefined,
			objectStorageRegion: formData.has('objectStorageRegion')
				? asTrimmedString(formData.get('objectStorageRegion'))
				: undefined,
			objectStorageBucket: formData.has('objectStorageBucket')
				? asTrimmedString(formData.get('objectStorageBucket'))
				: undefined,
			objectStorageEndpoint: formData.has('objectStorageEndpoint')
				? asTrimmedString(formData.get('objectStorageEndpoint'))
				: undefined,
			objectStorageForcePathStyle: formData.has('objectStorageForcePathStyle')
				? toBoolean(formData.get('objectStorageForcePathStyle'))
				: undefined,
			objectStorageAccessKeyId: formData.has('objectStorageAccessKeyId')
				? asTrimmedString(formData.get('objectStorageAccessKeyId'))
				: undefined,
			objectStorageSecretAccessKey: formData.has('objectStorageSecretAccessKey')
				? asTrimmedString(formData.get('objectStorageSecretAccessKey'))
				: undefined,
			provided: {
				siteName: formData.has('siteName'),
				themeKey: formData.has('themeKey'),
				careerSiteEnabled: formData.has('careerSiteEnabled'),
				clientPortalEnabled: formData.has('clientPortalEnabled'),
				careerHeroTitle: formData.has('careerHeroTitle'),
				careerHeroBody: formData.has('careerHeroBody'),
				apiErrorLogRetentionDays: formData.has('apiErrorLogRetentionDays'),
				removeLogo: formData.has('removeLogo'),
				logoFile: Boolean(logoFile),
				googleMapsApiKey: formData.has('googleMapsApiKey'),
				openAiApiKey: formData.has('openAiApiKey'),
				smtpHost: formData.has('smtpHost'),
				smtpPort: formData.has('smtpPort'),
				smtpSecure: formData.has('smtpSecure'),
				smtpUser: formData.has('smtpUser'),
				smtpPass: formData.has('smtpPass'),
				smtpFromName: formData.has('smtpFromName'),
				smtpFromEmail: formData.has('smtpFromEmail'),
				bullhornUsername: formData.has('bullhornUsername'),
				bullhornPassword: formData.has('bullhornPassword'),
				bullhornClientId: formData.has('bullhornClientId'),
				bullhornClientSecret: formData.has('bullhornClientSecret'),
				objectStorageProvider: formData.has('objectStorageProvider'),
				objectStorageRegion: formData.has('objectStorageRegion'),
				objectStorageBucket: formData.has('objectStorageBucket'),
				objectStorageEndpoint: formData.has('objectStorageEndpoint'),
				objectStorageForcePathStyle: formData.has('objectStorageForcePathStyle'),
				objectStorageAccessKeyId: formData.has('objectStorageAccessKeyId'),
				objectStorageSecretAccessKey: formData.has('objectStorageSecretAccessKey')
			}
		};
	}

	const body = await req.json().catch(() => ({}));
	return {
		siteName: asTrimmedString(body?.siteName),
		themeKey: asTrimmedString(body?.themeKey),
		careerSiteEnabled: hasOwnProperty(body, 'careerSiteEnabled')
			? Boolean(body?.careerSiteEnabled)
			: undefined,
		clientPortalEnabled: hasOwnProperty(body, 'clientPortalEnabled')
			? Boolean(body?.clientPortalEnabled)
			: undefined,
		careerHeroTitle: hasOwnProperty(body, 'careerHeroTitle')
			? asTrimmedString(body?.careerHeroTitle)
			: undefined,
		careerHeroBody: hasOwnProperty(body, 'careerHeroBody')
			? asTrimmedString(body?.careerHeroBody)
			: undefined,
		apiErrorLogRetentionDays: hasOwnProperty(body, 'apiErrorLogRetentionDays')
			? asTrimmedString(body?.apiErrorLogRetentionDays)
			: undefined,
		removeLogo: toBoolean(body?.removeLogo),
		logoFile: null,
		googleMapsApiKey: hasOwnProperty(body, 'googleMapsApiKey')
			? asTrimmedString(body?.googleMapsApiKey)
			: undefined,
		openAiApiKey: hasOwnProperty(body, 'openAiApiKey')
			? asTrimmedString(body?.openAiApiKey)
			: undefined,
		smtpHost: hasOwnProperty(body, 'smtpHost') ? asTrimmedString(body?.smtpHost) : undefined,
		smtpPort: hasOwnProperty(body, 'smtpPort') ? asTrimmedString(body?.smtpPort) : undefined,
		smtpSecure: hasOwnProperty(body, 'smtpSecure') ? Boolean(body?.smtpSecure) : undefined,
		smtpUser: hasOwnProperty(body, 'smtpUser') ? asTrimmedString(body?.smtpUser) : undefined,
		smtpPass: hasOwnProperty(body, 'smtpPass') ? asTrimmedString(body?.smtpPass) : undefined,
		smtpFromName: hasOwnProperty(body, 'smtpFromName')
			? asTrimmedString(body?.smtpFromName)
			: undefined,
		smtpFromEmail: hasOwnProperty(body, 'smtpFromEmail')
			? asTrimmedString(body?.smtpFromEmail)
			: undefined,
		bullhornUsername: hasOwnProperty(body, 'bullhornUsername')
			? asTrimmedString(body?.bullhornUsername)
			: undefined,
		bullhornPassword: hasOwnProperty(body, 'bullhornPassword')
			? asTrimmedString(body?.bullhornPassword)
			: undefined,
		bullhornClientId: hasOwnProperty(body, 'bullhornClientId')
			? asTrimmedString(body?.bullhornClientId)
			: undefined,
		bullhornClientSecret: hasOwnProperty(body, 'bullhornClientSecret')
			? asTrimmedString(body?.bullhornClientSecret)
			: undefined,
		objectStorageProvider: hasOwnProperty(body, 'objectStorageProvider')
			? asTrimmedString(body?.objectStorageProvider)
			: undefined,
		objectStorageRegion: hasOwnProperty(body, 'objectStorageRegion')
			? asTrimmedString(body?.objectStorageRegion)
			: undefined,
		objectStorageBucket: hasOwnProperty(body, 'objectStorageBucket')
			? asTrimmedString(body?.objectStorageBucket)
			: undefined,
		objectStorageEndpoint: hasOwnProperty(body, 'objectStorageEndpoint')
			? asTrimmedString(body?.objectStorageEndpoint)
			: undefined,
		objectStorageForcePathStyle: hasOwnProperty(body, 'objectStorageForcePathStyle')
			? Boolean(body?.objectStorageForcePathStyle)
			: undefined,
		objectStorageAccessKeyId: hasOwnProperty(body, 'objectStorageAccessKeyId')
			? asTrimmedString(body?.objectStorageAccessKeyId)
			: undefined,
		objectStorageSecretAccessKey: hasOwnProperty(body, 'objectStorageSecretAccessKey')
			? asTrimmedString(body?.objectStorageSecretAccessKey)
			: undefined,
		provided: {
			siteName: hasOwnProperty(body, 'siteName'),
			themeKey: hasOwnProperty(body, 'themeKey'),
			careerSiteEnabled: hasOwnProperty(body, 'careerSiteEnabled'),
			clientPortalEnabled: hasOwnProperty(body, 'clientPortalEnabled'),
			careerHeroTitle: hasOwnProperty(body, 'careerHeroTitle'),
			careerHeroBody: hasOwnProperty(body, 'careerHeroBody'),
			apiErrorLogRetentionDays: hasOwnProperty(body, 'apiErrorLogRetentionDays'),
			removeLogo: hasOwnProperty(body, 'removeLogo'),
			logoFile: false,
			googleMapsApiKey: hasOwnProperty(body, 'googleMapsApiKey'),
			openAiApiKey: hasOwnProperty(body, 'openAiApiKey'),
			smtpHost: hasOwnProperty(body, 'smtpHost'),
			smtpPort: hasOwnProperty(body, 'smtpPort'),
			smtpSecure: hasOwnProperty(body, 'smtpSecure'),
			smtpUser: hasOwnProperty(body, 'smtpUser'),
			smtpPass: hasOwnProperty(body, 'smtpPass'),
			smtpFromName: hasOwnProperty(body, 'smtpFromName'),
			smtpFromEmail: hasOwnProperty(body, 'smtpFromEmail'),
			bullhornUsername: hasOwnProperty(body, 'bullhornUsername'),
			bullhornPassword: hasOwnProperty(body, 'bullhornPassword'),
			bullhornClientId: hasOwnProperty(body, 'bullhornClientId'),
			bullhornClientSecret: hasOwnProperty(body, 'bullhornClientSecret'),
			objectStorageProvider: hasOwnProperty(body, 'objectStorageProvider'),
			objectStorageRegion: hasOwnProperty(body, 'objectStorageRegion'),
			objectStorageBucket: hasOwnProperty(body, 'objectStorageBucket'),
			objectStorageEndpoint: hasOwnProperty(body, 'objectStorageEndpoint'),
			objectStorageForcePathStyle: hasOwnProperty(body, 'objectStorageForcePathStyle'),
			objectStorageAccessKeyId: hasOwnProperty(body, 'objectStorageAccessKeyId'),
			objectStorageSecretAccessKey: hasOwnProperty(body, 'objectStorageSecretAccessKey')
		}
	};
}

async function getSystem_settingsHandler(req) {
	const setting = await getSystemSettingRecord();
	const branding = serializeSystemBranding(setting);
	const actingUser = await getActingUser(req, { allowFallback: false });
	if (actingUser?.role !== 'ADMINISTRATOR') {
		return NextResponse.json({
			...branding,
			demoMode: DEMO_MODE
		}, {
			headers: { 'Cache-Control': 'no-store' }
		});
	}

	return NextResponse.json({
		...branding,
		...serializeClientVisibleAdminSettings(serializeAdminSystemSettings(setting)),
		demoMode: DEMO_MODE
	}, {
		headers: { 'Cache-Control': 'no-store' }
	});
}

async function patchSystem_settingsHandler(req) {
	const mutationThrottleResponse = await enforceMutationThrottle(req, 'system_settings.patch');
	if (mutationThrottleResponse) {
		return mutationThrottleResponse;
	}

	const actingUser = await getActingUser(req, { allowFallback: false });
	if (!actingUser) {
		return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
	}
	if (actingUser.role !== 'ADMINISTRATOR') {
		return NextResponse.json({ error: 'Only administrators can update system settings.' }, { status: 403 });
	}

	const existing = await getSystemSettingRecord();
	const input = await parseBody(req);
	const attemptedHostedManagedSettingKeys = getAttemptedHostedManagedSettingKeys(input.provided);
	if (attemptedHostedManagedSettingKeys.length > 0) {
		return NextResponse.json(
			{ error: 'Integration settings are managed by your hosting provider.' },
			{ status: 403 }
		);
	}
	if (DEMO_MODE) {
		const allowedDemoSettingKeys = new Set([
			'siteName',
			'themeKey',
			'careerSiteEnabled',
			'clientPortalEnabled',
			'careerHeroTitle',
			'careerHeroBody',
			'removeLogo',
			'logoFile'
		]);
		const attemptedSettingKeys = Object.entries(input.provided || {})
			.filter(([key, provided]) => provided && !allowedDemoSettingKeys.has(key))
			.map(([key]) => key);
		if (attemptedSettingKeys.length > 0) {
			return NextResponse.json(
				{ error: 'Demo mode only allows changing branding settings.' },
				{ status: 403 }
			);
		}

		const logoValidationError = validateLogoFile(input.logoFile);
		if (logoValidationError) {
			return NextResponse.json({ error: logoValidationError }, { status: 400 });
		}

		let uploadedLogo = null;
		if (input.logoFile) {
			const logoBuffer = Buffer.from(await input.logoFile.arrayBuffer());
			uploadedLogo = await uploadObjectBuffer({
				key: buildSystemLogoStorageKey(input.logoFile.name),
				body: logoBuffer,
				contentType: input.logoFile.type || 'application/octet-stream'
			});
		}

		const nextSiteName = input.siteName || existing?.siteName || DEFAULT_SITE_NAME;
		const nextThemeKey = normalizeThemeKey(input.themeKey || existing?.themeKey || DEFAULT_THEME_KEY);
		const siteNameError = validateSiteName(nextSiteName);
		if (siteNameError) {
			return NextResponse.json({ error: siteNameError }, { status: 400 });
		}

		const shouldClearLogo = input.removeLogo && !uploadedLogo;
		const saved = existing
			? await prisma.systemSetting.update({
					where: { id: existing.id },
					data: {
						siteName: nextSiteName,
						themeKey: nextThemeKey,
						careerSiteEnabled:
							input.careerSiteEnabled === undefined
								? Boolean(existing?.careerSiteEnabled)
								: Boolean(input.careerSiteEnabled),
						clientPortalEnabled:
							input.clientPortalEnabled === undefined
								? typeof existing?.clientPortalEnabled === 'boolean'
									? existing.clientPortalEnabled
									: true
								: Boolean(input.clientPortalEnabled),
						careerHeroTitle:
							input.careerHeroTitle === undefined
								? existing?.careerHeroTitle || null
								: input.careerHeroTitle || null,
						careerHeroBody:
							input.careerHeroBody === undefined
								? existing?.careerHeroBody || null
								: input.careerHeroBody || null,
						logoStorageProvider: uploadedLogo
							? uploadedLogo.storageProvider
							: shouldClearLogo
								? null
								: existing?.logoStorageProvider || null,
						logoStorageBucket: uploadedLogo
							? uploadedLogo.storageBucket
							: shouldClearLogo
								? null
								: existing?.logoStorageBucket || null,
						logoStorageKey: uploadedLogo
							? uploadedLogo.storageKey
							: shouldClearLogo
								? null
								: existing?.logoStorageKey || null,
						logoContentType: uploadedLogo
							? input.logoFile?.type || null
							: shouldClearLogo
								? null
								: existing?.logoContentType || null,
						logoFileName: uploadedLogo
							? input.logoFile?.name || null
							: shouldClearLogo
								? null
								: existing?.logoFileName || null
					}
				})
			: await prisma.systemSetting.create({
					data: {
						siteName: nextSiteName,
						themeKey: nextThemeKey,
						careerSiteEnabled: Boolean(input.careerSiteEnabled),
						clientPortalEnabled:
							input.clientPortalEnabled === undefined ? true : Boolean(input.clientPortalEnabled),
						careerHeroTitle: input.careerHeroTitle || null,
						careerHeroBody: input.careerHeroBody || null,
						logoStorageProvider: uploadedLogo?.storageProvider || null,
						logoStorageBucket: uploadedLogo?.storageBucket || null,
						logoStorageKey: uploadedLogo?.storageKey || null,
						logoContentType: uploadedLogo ? input.logoFile?.type || null : null,
						logoFileName: uploadedLogo ? input.logoFile?.name || null : null
					}
				});

		await Promise.allSettled([
			existing
				? logUpdate({
						actorUserId: actingUser.id,
						entityType: 'SYSTEM_SETTING',
						before: existing,
						after: saved
					})
				: logCreate({
						actorUserId: actingUser.id,
						entityType: 'SYSTEM_SETTING',
						entity: saved
					}),
			(existing?.logoStorageKey && (uploadedLogo || shouldClearLogo))
				? deleteObject({
						key: existing.logoStorageKey,
						storageProvider: existing.logoStorageProvider,
						storageBucket: existing.logoStorageBucket
					})
				: Promise.resolve()
		]);

		clearSystemSettingsCache();

		return NextResponse.json({
			ok: true,
			message: 'Branding updated.',
			...serializeSystemBranding(saved),
			...serializeClientVisibleAdminSettings(serializeAdminSystemSettings(saved))
		});
	}

	const logoValidationError = validateLogoFile(input.logoFile);
	if (logoValidationError) {
		return NextResponse.json({ error: logoValidationError }, { status: 400 });
	}
	if (input.smtpFromEmail !== undefined && input.smtpFromEmail && !isValidEmailAddress(input.smtpFromEmail)) {
		return NextResponse.json({ error: 'SMTP from email must be a valid email address.' }, { status: 400 });
	}

	const parsedSmtpPort = toNullablePort(input.smtpPort);
	if (input.smtpPort !== undefined && input.smtpPort !== '' && parsedSmtpPort == null) {
		return NextResponse.json({ error: 'SMTP port must be a positive number.' }, { status: 400 });
	}
	const normalizedObjectStorageProvider =
		input.objectStorageProvider === undefined
			? asTrimmedString(existing?.objectStorageProvider || 's3').toLowerCase() || 's3'
			: normalizeObjectStorageProvider(input.objectStorageProvider);
	if (input.objectStorageProvider !== undefined && !normalizedObjectStorageProvider) {
		return NextResponse.json(
			{ error: 'Object storage provider must be either "s3" or "local".' },
			{ status: 400 }
		);
	}

	const nextSiteName = input.siteName || existing?.siteName || DEFAULT_SITE_NAME;
	const nextThemeKey = normalizeThemeKey(input.themeKey || existing?.themeKey || DEFAULT_THEME_KEY);
	const siteNameError = validateSiteName(nextSiteName);
	if (siteNameError) {
		return NextResponse.json({ error: siteNameError }, { status: 400 });
	}
	const parsedApiErrorLogRetentionDays =
		input.apiErrorLogRetentionDays === undefined
			? Number.isInteger(existing?.apiErrorLogRetentionDays) && existing.apiErrorLogRetentionDays > 0
				? existing.apiErrorLogRetentionDays
				: DEFAULT_API_ERROR_LOG_RETENTION_DAYS
			: toNullablePositiveInteger(input.apiErrorLogRetentionDays);
	if (parsedApiErrorLogRetentionDays == null) {
		return NextResponse.json(
			{ error: 'API error log retention must be a positive number of days.' },
			{ status: 400 }
		);
	}
	const apiErrorLogRetentionDaysError = validateApiErrorLogRetentionDays(parsedApiErrorLogRetentionDays);
	if (apiErrorLogRetentionDaysError) {
		return NextResponse.json({ error: apiErrorLogRetentionDaysError }, { status: 400 });
	}

	let uploadedLogo = null;
	if (input.logoFile) {
		const logoBuffer = Buffer.from(await input.logoFile.arrayBuffer());
		uploadedLogo = await uploadObjectBuffer({
			key: buildSystemLogoStorageKey(input.logoFile.name),
			body: logoBuffer,
			contentType: input.logoFile.type || 'application/octet-stream'
		});
	}

	const shouldClearLogo = input.removeLogo && !uploadedLogo;
	const nextData = {
		siteName: nextSiteName,
		themeKey: nextThemeKey,
		careerSiteEnabled: input.careerSiteEnabled === undefined
			? Boolean(existing?.careerSiteEnabled)
			: Boolean(input.careerSiteEnabled),
		clientPortalEnabled: input.clientPortalEnabled === undefined
			? typeof existing?.clientPortalEnabled === 'boolean'
				? existing.clientPortalEnabled
				: true
			: Boolean(input.clientPortalEnabled),
		careerHeroTitle: input.careerHeroTitle === undefined
			? existing?.careerHeroTitle || null
			: input.careerHeroTitle || null,
		careerHeroBody: input.careerHeroBody === undefined
			? existing?.careerHeroBody || null
			: input.careerHeroBody || null,
		apiErrorLogRetentionDays: parsedApiErrorLogRetentionDays,
		logoStorageProvider: uploadedLogo
			? uploadedLogo.storageProvider
			: shouldClearLogo
				? null
				: existing?.logoStorageProvider || null,
		logoStorageBucket: uploadedLogo
			? uploadedLogo.storageBucket
			: shouldClearLogo
				? null
				: existing?.logoStorageBucket || null,
		logoStorageKey: uploadedLogo
			? uploadedLogo.storageKey
			: shouldClearLogo
				? null
				: existing?.logoStorageKey || null,
			logoContentType: uploadedLogo
				? input.logoFile?.type || null
				: shouldClearLogo
					? null
					: existing?.logoContentType || null,
			logoFileName: uploadedLogo
				? input.logoFile?.name || null
				: shouldClearLogo
					? null
					: existing?.logoFileName || null,
			googleMapsApiKey: input.googleMapsApiKey === undefined
				? existing?.googleMapsApiKey || null
				: input.googleMapsApiKey || null,
		openAiApiKey: input.openAiApiKey === undefined
			? existing?.openAiApiKey || null
			: input.openAiApiKey || null,
		smtpHost: input.smtpHost === undefined
			? existing?.smtpHost || null
			: input.smtpHost || null,
		smtpPort: input.smtpPort === undefined
			? existing?.smtpPort ?? null
			: parsedSmtpPort,
		smtpSecure: input.smtpSecure === undefined
			? Boolean(existing?.smtpSecure)
			: Boolean(input.smtpSecure),
		smtpUser: input.smtpUser === undefined
			? existing?.smtpUser || null
			: input.smtpUser || null,
		smtpPass: input.smtpPass === undefined
			? existing?.smtpPass || null
			: input.smtpPass || null,
		smtpFromName: input.smtpFromName === undefined
			? existing?.smtpFromName || null
			: input.smtpFromName || null,
		smtpFromEmail: input.smtpFromEmail === undefined
			? existing?.smtpFromEmail || null
			: input.smtpFromEmail || null,
		bullhornUsername: input.bullhornUsername === undefined
			? existing?.bullhornUsername || null
			: input.bullhornUsername || null,
		bullhornPassword: input.bullhornPassword === undefined
			? existing?.bullhornPassword || null
			: input.bullhornPassword || null,
		bullhornClientId: input.bullhornClientId === undefined
			? existing?.bullhornClientId || null
			: input.bullhornClientId || null,
		bullhornClientSecret: input.bullhornClientSecret === undefined
			? existing?.bullhornClientSecret || null
			: input.bullhornClientSecret || null,
		objectStorageProvider:
			input.objectStorageProvider === undefined
				? existing?.objectStorageProvider || 's3'
				: normalizedObjectStorageProvider,
		objectStorageRegion: input.objectStorageRegion === undefined
			? existing?.objectStorageRegion || 'us-east-1'
			: input.objectStorageRegion || 'us-east-1',
		objectStorageBucket: input.objectStorageBucket === undefined
			? existing?.objectStorageBucket || null
			: input.objectStorageBucket || null,
		objectStorageEndpoint: input.objectStorageEndpoint === undefined
			? existing?.objectStorageEndpoint || null
			: input.objectStorageEndpoint || null,
		objectStorageForcePathStyle:
			input.objectStorageForcePathStyle === undefined
				? typeof existing?.objectStorageForcePathStyle === 'boolean'
					? existing.objectStorageForcePathStyle
					: true
				: Boolean(input.objectStorageForcePathStyle),
		objectStorageAccessKeyId: input.objectStorageAccessKeyId === undefined
			? existing?.objectStorageAccessKeyId || null
			: input.objectStorageAccessKeyId || null,
		objectStorageSecretAccessKey: input.objectStorageSecretAccessKey === undefined
			? existing?.objectStorageSecretAccessKey || null
			: input.objectStorageSecretAccessKey || null
	};

	const saved = existing
		? await prisma.systemSetting.update({
				where: { id: existing.id },
				data: nextData
			})
		: await prisma.systemSetting.create({
				data: nextData
			});

	await Promise.allSettled([
		existing
			? logUpdate({
					actorUserId: actingUser.id,
					entityType: 'SYSTEM_SETTING',
					before: existing,
					after: saved
				})
			: logCreate({
					actorUserId: actingUser.id,
					entityType: 'SYSTEM_SETTING',
					entity: saved
				}),
		(existing?.logoStorageKey && (uploadedLogo || shouldClearLogo))
			? deleteObject({
					key: existing.logoStorageKey,
					storageProvider: existing.logoStorageProvider,
					storageBucket: existing.logoStorageBucket
				})
			: Promise.resolve()
	]);

	clearSystemSettingsCache();

	return NextResponse.json({
		ok: true,
		message: 'System settings updated.',
		...serializeSystemBranding(saved),
		...serializeClientVisibleAdminSettings(serializeAdminSystemSettings(saved))
	});
}

export const GET = withApiLogging('system_settings.get', getSystem_settingsHandler);
export const PATCH = withApiLogging('system_settings.patch', patchSystem_settingsHandler);
