import { prisma } from './prisma.js';
import { DEFAULT_THEME_KEY, normalizeThemeKey } from './theme-options.js';
import { getIntegrationOperationFlags } from './integration-operations.js';

export const DEFAULT_SITE_NAME = 'Hire Gnome ATS';
export const DEFAULT_SITE_LOGO_URL = '/branding/hire-gnome.png';
export const DEFAULT_OPENAI_RESUME_MODEL = 'gpt-4o-mini';
export const DEFAULT_API_ERROR_LOG_RETENTION_DAYS = 90;
export const DEFAULT_CAREER_HERO_TITLE = 'Find your next placement opportunity.';
export const DEFAULT_CAREER_HERO_BODY =
	'Explore active roles across healthcare, technology, and professional services. Apply directly through the listing in under two minutes.';

const INTEGRATION_SETTINGS_CACHE_TTL_MS = 30_000;
const NEXT_PHASE_PRODUCTION_BUILD = 'phase-production-build';

let integrationSettingsCache = null;
let integrationSettingsCacheAt = 0;
let integrationSettingsPromise = null;

function asTrimmedString(value) {
	if (typeof value !== 'string') return '';
	return value.trim();
}

function toBoolean(value, fallback = false) {
	if (typeof value !== 'string') return fallback;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function toNullablePort(value) {
	const parsed = Number.parseInt(String(value ?? '').trim(), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

function toBooleanFlag(value, fallback = false) {
	return typeof value === 'boolean' ? value : fallback;
}

export function serializeSystemBranding(setting) {
	const siteName = String(setting?.siteName || '').trim() || DEFAULT_SITE_NAME;
	const hasCustomLogo = Boolean(setting?.logoStorageKey);
	const aiAvailable = Boolean(asTrimmedString(setting?.openAiApiKey));
	const logoVersion = setting?.updatedAt ? new Date(setting.updatedAt).getTime() : Date.now();
	const logoUrl = hasCustomLogo
		? `/api/system-settings/logo?v=${logoVersion}`
		: DEFAULT_SITE_LOGO_URL;

	return {
		siteName,
		siteTitle: siteName,
		logoUrl,
		themeKey: normalizeThemeKey(setting?.themeKey || DEFAULT_THEME_KEY),
		careerSiteEnabled: toBooleanFlag(setting?.careerSiteEnabled, false),
		clientPortalEnabled: toBooleanFlag(setting?.clientPortalEnabled, true),
		careerHeroTitle: asTrimmedString(setting?.careerHeroTitle) || DEFAULT_CAREER_HERO_TITLE,
		careerHeroBody: asTrimmedString(setting?.careerHeroBody) || DEFAULT_CAREER_HERO_BODY,
		aiAvailable,
		hasCustomLogo,
		updatedAt: setting?.updatedAt || null
	};
}

export function serializeAdminSystemSettings(setting) {
	const siteName = asTrimmedString(setting?.siteName) || DEFAULT_SITE_NAME;
	const aiAvailable = Boolean(asTrimmedString(setting?.openAiApiKey));
	const integrationFlags = getIntegrationOperationFlags();
	const bullhornUsername = asTrimmedString(setting?.bullhornUsername);
	const bullhornPassword = asTrimmedString(setting?.bullhornPassword);
	const bullhornClientId = asTrimmedString(setting?.bullhornClientId);
	const bullhornClientSecret = asTrimmedString(setting?.bullhornClientSecret);
	return {
		careerSiteEnabled: toBooleanFlag(setting?.careerSiteEnabled, false),
		clientPortalEnabled: toBooleanFlag(setting?.clientPortalEnabled, true),
		careerHeroTitle: asTrimmedString(setting?.careerHeroTitle) || DEFAULT_CAREER_HERO_TITLE,
		careerHeroBody: asTrimmedString(setting?.careerHeroBody) || DEFAULT_CAREER_HERO_BODY,
		aiAvailable,
		apiErrorLogRetentionDays:
			Number.isInteger(setting?.apiErrorLogRetentionDays) && setting.apiErrorLogRetentionDays > 0
				? setting.apiErrorLogRetentionDays
				: DEFAULT_API_ERROR_LOG_RETENTION_DAYS,
		googleMapsApiKey: asTrimmedString(setting?.googleMapsApiKey),
		openAiApiKey: asTrimmedString(setting?.openAiApiKey),
		smtpHost: asTrimmedString(setting?.smtpHost),
		smtpPort: toNullablePort(setting?.smtpPort),
		smtpSecure: Boolean(setting?.smtpSecure),
		smtpUser: asTrimmedString(setting?.smtpUser),
		smtpPass: asTrimmedString(setting?.smtpPass),
		smtpFromName: asTrimmedString(setting?.smtpFromName) || siteName,
		smtpFromEmail: asTrimmedString(setting?.smtpFromEmail),
		bullhornUsername,
		bullhornPassword,
		bullhornClientId,
		bullhornClientSecret,
		bullhornCredentialsConfigured: Boolean(
			bullhornUsername
			&& bullhornPassword
			&& bullhornClientId
			&& bullhornClientSecret
		),
		objectStorageProvider: asTrimmedString(setting?.objectStorageProvider) || 's3',
		objectStorageRegion: asTrimmedString(setting?.objectStorageRegion) || 'us-east-1',
		objectStorageBucket: asTrimmedString(setting?.objectStorageBucket),
		objectStorageEndpoint: asTrimmedString(setting?.objectStorageEndpoint),
		objectStorageForcePathStyle:
			typeof setting?.objectStorageForcePathStyle === 'boolean'
				? setting.objectStorageForcePathStyle
				: true,
		objectStorageAccessKeyId: asTrimmedString(setting?.objectStorageAccessKeyId),
		objectStorageSecretAccessKey: asTrimmedString(setting?.objectStorageSecretAccessKey),
		emailTestMode: toBoolean(process.env.EMAIL_TEST_MODE, false),
		emailTestRecipient: asTrimmedString(process.env.EMAIL_TEST_RECIPIENT).toLowerCase(),
		openAiResumeModel: asTrimmedString(process.env.OPENAI_RESUME_MODEL) || DEFAULT_OPENAI_RESUME_MODEL,
		bullhornOperationsEnabled: integrationFlags.bullhornOperationsEnabled,
		zohoRecruitOperationsEnabled: integrationFlags.zohoRecruitOperationsEnabled
	};
}

function normalizeIntegrationSettings(setting) {
	const siteName = asTrimmedString(setting?.siteName) || DEFAULT_SITE_NAME;

	return {
		careerSiteEnabled: toBooleanFlag(setting?.careerSiteEnabled, false),
		clientPortalEnabled: toBooleanFlag(setting?.clientPortalEnabled, true),
		apiErrorLogRetentionDays:
			Number.isInteger(setting?.apiErrorLogRetentionDays) && setting.apiErrorLogRetentionDays > 0
				? setting.apiErrorLogRetentionDays
				: DEFAULT_API_ERROR_LOG_RETENTION_DAYS,
		googleMapsApiKey: asTrimmedString(setting?.googleMapsApiKey),
		openAiApiKey: asTrimmedString(setting?.openAiApiKey),
		openAiResumeModel: asTrimmedString(process.env.OPENAI_RESUME_MODEL) || DEFAULT_OPENAI_RESUME_MODEL,
		smtpHost: asTrimmedString(setting?.smtpHost),
		smtpPort: toNullablePort(setting?.smtpPort),
		smtpSecure: Boolean(setting?.smtpSecure),
		smtpUser: asTrimmedString(setting?.smtpUser),
		smtpPass: asTrimmedString(setting?.smtpPass),
		smtpFromName: asTrimmedString(setting?.smtpFromName) || siteName,
		smtpFromEmail: asTrimmedString(setting?.smtpFromEmail),
		bullhornUsername: asTrimmedString(setting?.bullhornUsername),
		bullhornPassword: asTrimmedString(setting?.bullhornPassword),
		bullhornClientId: asTrimmedString(setting?.bullhornClientId),
		bullhornClientSecret: asTrimmedString(setting?.bullhornClientSecret),
		objectStorageProvider: asTrimmedString(setting?.objectStorageProvider) || 's3',
		objectStorageRegion: asTrimmedString(setting?.objectStorageRegion) || 'us-east-1',
		objectStorageBucket: asTrimmedString(setting?.objectStorageBucket),
		objectStorageEndpoint: asTrimmedString(setting?.objectStorageEndpoint),
		objectStorageForcePathStyle:
			typeof setting?.objectStorageForcePathStyle === 'boolean'
				? setting.objectStorageForcePathStyle
				: true,
		objectStorageAccessKeyId: asTrimmedString(setting?.objectStorageAccessKeyId),
		objectStorageSecretAccessKey: asTrimmedString(setting?.objectStorageSecretAccessKey),
		emailTestMode: toBoolean(process.env.EMAIL_TEST_MODE, false),
		emailTestRecipient: asTrimmedString(process.env.EMAIL_TEST_RECIPIENT).toLowerCase()
	};
}

function shouldSkipSystemSettingsDbRead() {
	if (process.env.SKIP_SYSTEM_SETTINGS_DB_DURING_BUILD === 'false') {
		return false;
	}

	return process.env.NEXT_PHASE === NEXT_PHASE_PRODUCTION_BUILD;
}

export async function getSystemSettingRecord() {
	if (shouldSkipSystemSettingsDbRead()) {
		return null;
	}

	try {
		return await prisma.systemSetting.findFirst({
			orderBy: {
				id: 'asc'
			}
		});
	} catch {
		return null;
	}
}

export async function getSystemBranding() {
	const setting = await getSystemSettingRecord();
	return serializeSystemBranding(setting);
}

export function clearSystemSettingsCache() {
	integrationSettingsCache = null;
	integrationSettingsCacheAt = 0;
	integrationSettingsPromise = null;
}

export async function getIntegrationSettings({ forceRefresh = false } = {}) {
	const now = Date.now();
	if (!forceRefresh && integrationSettingsCache && now - integrationSettingsCacheAt < INTEGRATION_SETTINGS_CACHE_TTL_MS) {
		return integrationSettingsCache;
	}

	if (!forceRefresh && integrationSettingsPromise) {
		return integrationSettingsPromise;
	}

	integrationSettingsPromise = (async () => {
		const setting = await getSystemSettingRecord();
		const normalized = normalizeIntegrationSettings(setting);
		integrationSettingsCache = normalized;
		integrationSettingsCacheAt = Date.now();
		return normalized;
	})().finally(() => {
		integrationSettingsPromise = null;
	});

	return integrationSettingsPromise;
}
