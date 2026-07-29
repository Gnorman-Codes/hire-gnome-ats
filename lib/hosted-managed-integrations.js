const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export const HOSTED_MANAGED_SETTING_KEYS = new Set([
	'googleMapsApiKey',
	'openAiApiKey',
	'smtpHost',
	'smtpPort',
	'smtpSecure',
	'smtpUser',
	'smtpPass',
	'smtpFromName',
	'smtpFromEmail',
	'objectStorageProvider',
	'objectStorageRegion',
	'objectStorageBucket',
	'objectStorageEndpoint',
	'objectStorageForcePathStyle',
	'objectStorageAccessKeyId',
	'objectStorageSecretAccessKey'
]);

const HOSTED_MANAGED_RESPONSE_KEYS = new Set([
	...HOSTED_MANAGED_SETTING_KEYS,
	'emailTestMode',
	'emailTestRecipient',
	'openAiResumeModel'
]);

export function hostedManagedIntegrationsEnabled() {
	return TRUE_VALUES.has(
		String(process.env.HOSTED_MANAGED_INTEGRATIONS || '').trim().toLowerCase()
	);
}

export function serializeClientVisibleAdminSettings(settings) {
	if (!hostedManagedIntegrationsEnabled()) {
		return {
			...settings,
			managedIntegrations: false
		};
	}

	const visibleSettings = Object.fromEntries(
		Object.entries(settings || {}).filter(([key]) => !HOSTED_MANAGED_RESPONSE_KEYS.has(key))
	);

	return {
		...visibleSettings,
		managedIntegrations: true
	};
}

export function getAttemptedHostedManagedSettingKeys(provided = {}) {
	if (!hostedManagedIntegrationsEnabled()) return [];

	return Object.entries(provided)
		.filter(([key, wasProvided]) => wasProvided && HOSTED_MANAGED_SETTING_KEYS.has(key))
		.map(([key]) => key);
}
