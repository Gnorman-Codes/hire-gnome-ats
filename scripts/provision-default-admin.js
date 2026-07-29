#!/usr/bin/env node

require('./load-env.cjs');

const crypto = require('node:crypto');
const fs = require('node:fs');
const { promisify } = require('node:util');
const { PrismaClient } = require('@prisma/client');

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_HASH_VERSION = 's1';
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 64;
const MIN_PASSWORD_LENGTH = 8;
const RECORD_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECORD_ID_RANDOM_LENGTH = 8;
const UNASSIGNED_DIVISION_NAME = 'Unassigned';
const DEFAULT_SITE_NAME = 'Hire Gnome ATS';
const DEFAULT_THEME_KEY = 'classic_blue';
const ALLOWED_USER_ROLES = new Set(['ADMINISTRATOR', 'DIRECTOR', 'RECRUITER']);

function parseBoolean(value, fallback = false) {
	const normalized = String(value || '').trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function cleanString(value) {
	return String(value || '').trim();
}

function randomRecordToken() {
	let token = '';
	for (let i = 0; i < RECORD_ID_RANDOM_LENGTH; i += 1) {
		token += RECORD_ID_ALPHABET[crypto.randomInt(0, RECORD_ID_ALPHABET.length)];
	}
	return token;
}

function createRecordId(prefix) {
	return `${prefix}-${randomRecordToken()}`;
}

function isAcceptablePassword(value) {
	return cleanString(value).length >= MIN_PASSWORD_LENGTH;
}

async function hashPassword(value) {
	const password = cleanString(value);
	if (!isAcceptablePassword(password)) {
		throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
	}

	const salt = crypto.randomBytes(SALT_BYTES);
	const derivedKey = await scryptAsync(password, salt, DERIVED_KEY_BYTES);
	return `${PASSWORD_HASH_VERSION}$${salt.toString('base64url')}$${Buffer.from(derivedKey).toString('base64url')}`;
}

function resolveConfig(hostedConfig = null) {
	const hostedAdmin = hostedConfig?.admin || {};
	const hostedInstance = hostedConfig?.instance || {};
	const email = cleanString(process.env.BOOTSTRAP_ADMIN_EMAIL || hostedAdmin.email || '').toLowerCase();
	const password = cleanString(process.env.BOOTSTRAP_ADMIN_PASSWORD || hostedAdmin.password || '');
	const firstName = cleanString(process.env.BOOTSTRAP_ADMIN_FIRST_NAME || hostedAdmin.firstName || 'System');
	const lastName = cleanString(process.env.BOOTSTRAP_ADMIN_LAST_NAME || hostedAdmin.lastName || 'Administrator');
	const siteName = cleanString(process.env.BOOTSTRAP_SITE_NAME || hostedInstance.siteName || DEFAULT_SITE_NAME);
	const themeKey = cleanString(process.env.BOOTSTRAP_THEME_KEY || hostedInstance.theme || DEFAULT_THEME_KEY);
	const enabledDefault =
		typeof hostedAdmin.provisioningEnabled === 'boolean'
			? hostedAdmin.provisioningEnabled
			: Boolean(email && password);
	const enabled = parseBoolean(process.env.BOOTSTRAP_ADMIN_ENABLED, enabledDefault);

	return {
		enabled,
		email,
		password,
		firstName,
		lastName,
		siteName,
		themeKey
	};
}

function loadHostedConfig() {
	const filePath = cleanString(process.env.HOSTED_CONFIG_FILE);
	if (!filePath) return null;

	let raw;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(`HOSTED_CONFIG_FILE was not found: ${filePath}`);
		}
		throw error;
	}

	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		throw new Error(`HOSTED_CONFIG_FILE must contain valid JSON: ${filePath}`);
	}
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		throw new Error('HOSTED_CONFIG_FILE must contain a JSON object.');
	}
	if (Object.keys(payload).length === 0) return null;
	if (payload.version !== 1) {
		throw new Error('HOSTED_CONFIG_FILE version must be 1.');
	}
	return payload;
}

function normalizeBootstrapUser(input, index) {
	const email = cleanString(input?.email).toLowerCase();
	const password = cleanString(input?.password);
	const firstName = cleanString(input?.firstName);
	const lastName = cleanString(input?.lastName);
	const role = cleanString(input?.role || 'RECRUITER').toUpperCase();
	const divisionName = cleanString(input?.division || UNASSIGNED_DIVISION_NAME);

	if (!firstName || !lastName) {
		throw new Error(`Bootstrap user ${index + 1} requires firstName and lastName.`);
	}
	if (!email || !email.includes('@')) {
		throw new Error(`Bootstrap user ${index + 1} requires a valid email.`);
	}
	if (!isAcceptablePassword(password)) {
		throw new Error(`Bootstrap user ${email} password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
	}
	if (!ALLOWED_USER_ROLES.has(role)) {
		throw new Error(`Bootstrap user ${email} role must be ADMINISTRATOR, DIRECTOR, or RECRUITER.`);
	}
	if (!divisionName) {
		throw new Error(`Bootstrap user ${email} requires a division.`);
	}

	return {
		firstName,
		lastName,
		email,
		password,
		role,
		divisionName,
		isActive: input?.isActive !== false
	};
}

function loadBootstrapUsers(hostedConfig = null) {
	const payloads = [];
	if (hostedConfig && Object.prototype.hasOwnProperty.call(hostedConfig, 'users')) {
		if (!Array.isArray(hostedConfig.users)) {
			throw new Error('HOSTED_CONFIG_FILE users must be a JSON array.');
		}
		payloads.push(...hostedConfig.users);
	}

	const users = payloads.map(normalizeBootstrapUser);
	const emails = new Set();
	for (const user of users) {
		if (emails.has(user.email)) {
			throw new Error(`HOSTED_CONFIG_FILE contains duplicate user email: ${user.email}`);
		}
		emails.add(user.email);
	}
	return users;
}

function hasOwn(source, key) {
	return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function nullableString(value) {
	if (value == null) return null;
	return cleanString(value) || null;
}

function nullablePositiveInteger(value, label) {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer or null.`);
	}
	return parsed;
}

function assignPresent(target, source, sourceKey, targetKey = sourceKey, transform = nullableString) {
	if (!hasOwn(source, sourceKey)) return;
	target[targetKey] = transform(source[sourceKey]);
}

async function reconcileHostedSettings(prisma, hostedConfig) {
	if (!hostedConfig) return [];
	const setting = await prisma.systemSetting.findFirst({
		orderBy: { id: 'asc' },
		select: { id: true }
	});
	if (!setting) throw new Error('System settings must exist before hosted configuration is reconciled.');

	const data = {};
	const instance = hostedConfig.instance || {};
	if (hasOwn(instance, 'siteName')) {
		const siteName = cleanString(instance.siteName);
		if (!siteName) throw new Error('instance.siteName cannot be empty.');
		data.siteName = siteName;
		data.siteTitle = siteName;
	}
	if (hasOwn(instance, 'theme')) {
		const themeKey = cleanString(instance.theme);
		if (!themeKey) throw new Error('instance.theme cannot be empty or null.');
		data.themeKey = themeKey;
	}
	if (hasOwn(instance, 'careerSiteEnabled')) data.careerSiteEnabled = Boolean(instance.careerSiteEnabled);
	if (hasOwn(instance, 'clientPortalEnabled')) data.clientPortalEnabled = Boolean(instance.clientPortalEnabled);
	assignPresent(data, instance, 'careerHeroTitle', 'careerHeroTitle');
	assignPresent(data, instance, 'careerHeroBody', 'careerHeroBody');

	const integrations = hostedConfig.integrations || {};
	const smtp = integrations.smtp;
	if (smtp) {
		assignPresent(data, smtp, 'host', 'smtpHost');
		if (hasOwn(smtp, 'port')) data.smtpPort = nullablePositiveInteger(smtp.port, 'integrations.smtp.port');
		if (hasOwn(smtp, 'secure')) data.smtpSecure = Boolean(smtp.secure);
		assignPresent(data, smtp, 'user', 'smtpUser');
		assignPresent(data, smtp, 'password', 'smtpPass');
		assignPresent(data, smtp, 'fromName', 'smtpFromName');
		assignPresent(data, smtp, 'fromEmail', 'smtpFromEmail');
	}

	const s3 = integrations.s3;
	if (s3) {
		assignPresent(data, s3, 'provider', 'objectStorageProvider');
		assignPresent(data, s3, 'region', 'objectStorageRegion');
		assignPresent(data, s3, 'bucket', 'objectStorageBucket');
		assignPresent(data, s3, 'endpoint', 'objectStorageEndpoint');
		if (hasOwn(s3, 'forcePathStyle')) data.objectStorageForcePathStyle = Boolean(s3.forcePathStyle);
		assignPresent(data, s3, 'accessKeyId', 'objectStorageAccessKeyId');
		assignPresent(data, s3, 'secretAccessKey', 'objectStorageSecretAccessKey');
	}

	const openAi = integrations.openai;
	if (openAi) assignPresent(data, openAi, 'apiKey', 'openAiApiKey');
	const googleMaps = integrations.googleMaps;
	if (googleMaps) assignPresent(data, googleMaps, 'apiKey', 'googleMapsApiKey');

	if (Object.keys(data).length === 0) return [];
	await prisma.systemSetting.update({
		where: { id: setting.id },
		data
	});
	return Object.keys(data);
}

async function ensureSystemSettings(prisma, config) {
	const existingSystemSetting = await prisma.systemSetting.findFirst({
		select: { id: true }
	});
	if (existingSystemSetting) return false;

	await prisma.systemSetting.create({
		data: {
			recordId: createRecordId('SYS'),
			siteName: config.siteName,
			siteTitle: config.siteName,
			themeKey: config.themeKey
		}
	});
	return true;
}

async function provisionAdditionalUsers(prisma, users) {
	let created = 0;
	let skipped = 0;

	for (const input of users) {
		const existing = await prisma.user.findUnique({
			where: { email: input.email },
			select: { id: true }
		});
		if (existing) {
			console.log(`[bootstrap-users] Existing user ${input.email}. Skipping.`);
			skipped += 1;
			continue;
		}

		const division = await prisma.division.upsert({
			where: { name: input.divisionName },
			update: {},
			create: {
				recordId: createRecordId('DIV'),
				name: input.divisionName,
				accessMode: 'COLLABORATIVE'
			}
		});
		const passwordHash = await hashPassword(input.password);
		await prisma.user.create({
			data: {
				recordId: createRecordId('USR'),
				firstName: input.firstName,
				lastName: input.lastName,
				email: input.email,
				passwordHash,
				passwordChangeRequired: true,
				role: input.role,
				divisionId: division.id,
				isActive: input.isActive
			}
		});
		console.log(`[bootstrap-users] Created ${input.role} user ${input.email} in division "${division.name}".`);
		created += 1;
	}

	return { created, skipped };
}

async function main() {
	const hostedConfig = loadHostedConfig();
	const config = resolveConfig(hostedConfig);
	const additionalUsers = loadBootstrapUsers(hostedConfig);
	if (!config.enabled && additionalUsers.length === 0 && !hostedConfig) {
		console.log('[bootstrap-admin] Skipped. Set BOOTSTRAP_ADMIN_ENABLED=true to enable provisioning.');
		return;
	}
	if (config.enabled && !config.email) {
		throw new Error('BOOTSTRAP_ADMIN_EMAIL is required when BOOTSTRAP_ADMIN_ENABLED=true.');
	}
	if (config.enabled && !isAcceptablePassword(config.password)) {
		throw new Error(`BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
	}

	const prisma = new PrismaClient();
	try {
		const existingUsers = await prisma.user.count();
		if (existingUsers > 0) {
			if (await ensureSystemSettings(prisma, config)) {
				console.log('[bootstrap-admin] Created missing default system settings.');
			}
			console.log('[bootstrap-admin] Existing users found. Skipping administrator creation.');
		} else {
			if (!config.enabled) {
				throw new Error('BOOTSTRAP_ADMIN_ENABLED=true is required when provisioning an empty database.');
			}
			const passwordHash = await hashPassword(config.password);
			const result = await prisma.$transaction(async (tx) => {
				const division = await tx.division.upsert({
					where: { name: UNASSIGNED_DIVISION_NAME },
					update: {},
					create: {
						recordId: createRecordId('DIV'),
						name: UNASSIGNED_DIVISION_NAME,
						accessMode: 'COLLABORATIVE'
					}
				});

				const systemSetting = await tx.systemSetting.create({
					data: {
						recordId: createRecordId('SYS'),
						siteName: config.siteName,
						siteTitle: config.siteName,
						themeKey: config.themeKey
					}
				});

				const user = await tx.user.create({
					data: {
						recordId: createRecordId('USR'),
						firstName: config.firstName,
						lastName: config.lastName,
						email: config.email,
						passwordHash,
						passwordChangeRequired: true,
						role: 'ADMINISTRATOR',
						divisionId: division.id,
						isActive: true
					},
					select: {
						id: true,
						email: true,
						firstName: true,
						lastName: true
					}
				});

				return { user, division, systemSetting };
			});

			console.log(
				`[bootstrap-admin] Created default admin ${result.user.email} for "${result.systemSetting.siteName}" in division "${result.division.name}".`
			);
		}

		const additionalResult = await provisionAdditionalUsers(prisma, additionalUsers);
		if (additionalUsers.length > 0) {
			console.log(
				`[bootstrap-users] Complete. Created ${additionalResult.created}; skipped ${additionalResult.skipped}.`
			);
		}
		const reconciledSettings = await reconcileHostedSettings(prisma, hostedConfig);
		if (reconciledSettings.length > 0) {
			console.log(`[hosted-config] Reconciled settings: ${reconciledSettings.join(', ')}.`);
		}
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((error) => {
	console.error('[bootstrap-admin] Failed.');
	console.error(error?.message || error);
	process.exitCode = 1;
});
