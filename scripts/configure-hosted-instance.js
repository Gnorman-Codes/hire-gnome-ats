#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ALLOWED_USER_ROLES = new Set(['ADMINISTRATOR', 'DIRECTOR', 'RECRUITER']);

function readArgument(name, fallback = '') {
	const index = process.argv.indexOf(`--${name}`);
	if (index < 0 || !process.argv[index + 1]) return fallback;
	return String(process.argv[index + 1]).trim();
}

function cleanString(value) {
	return String(value ?? '').trim();
}

function requireString(value, label) {
	const normalized = cleanString(value);
	if (!normalized) throw new Error(`${label} is required.`);
	return normalized;
}

function normalizeBoolean(value, fallback = false) {
	if (typeof value === 'boolean') return value;
	return fallback;
}

function validateDomain(value) {
	const domain = requireString(value, 'instance.domain').toLowerCase();
	if (!/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) {
		throw new Error('instance.domain must be a hostname such as ats.customer.example.');
	}
	return domain;
}

function validateConfig(config) {
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('Hosted configuration must be a JSON object.');
	}
	if (config.version !== 1) {
		throw new Error('Hosted configuration version must be 1.');
	}

	const domain = validateDomain(config.instance?.domain);
	requireString(config.instance?.siteName, 'instance.siteName');
	const databaseName = requireString(config.database?.name, 'database.name');
	const databaseUser = requireString(config.database?.user, 'database.user');
	const databasePassword = requireString(config.database?.password, 'database.password');
	requireString(config.database?.rootPassword, 'database.rootPassword');
	if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
		throw new Error('database.name may contain only letters, numbers, and underscores.');
	}
	if (!/^[A-Za-z0-9_]+$/.test(databaseUser)) {
		throw new Error('database.user may contain only letters, numbers, and underscores.');
	}

	requireString(config.secrets?.authSession, 'secrets.authSession');
	requireString(config.secrets?.clientPortal, 'secrets.clientPortal');
	requireString(config.secrets?.rateLimit, 'secrets.rateLimit');

	const adminEnabled = config.admin?.provisioningEnabled !== false;
	if (adminEnabled) {
		requireString(config.admin?.firstName, 'admin.firstName');
		requireString(config.admin?.lastName, 'admin.lastName');
		const adminEmail = requireString(config.admin?.email, 'admin.email');
		if (!adminEmail.includes('@')) throw new Error('admin.email must be a valid email address.');
		const adminPassword = requireString(config.admin?.password, 'admin.password');
		if (adminPassword.length < 8) throw new Error('admin.password must be at least 8 characters.');
	}

	const users = config.users ?? [];
	if (!Array.isArray(users)) throw new Error('users must be a JSON array.');
	const emails = new Set();
	for (const [index, user] of users.entries()) {
		const email = requireString(user?.email, `users[${index}].email`).toLowerCase();
		if (!email.includes('@')) throw new Error(`users[${index}].email must be a valid email address.`);
		requireString(user?.firstName, `users[${index}].firstName`);
		requireString(user?.lastName, `users[${index}].lastName`);
		const password = requireString(user?.password, `users[${index}].password`);
		if (password.length < 8) throw new Error(`users[${index}].password must be at least 8 characters.`);
		const role = cleanString(user?.role || 'RECRUITER').toUpperCase();
		if (!ALLOWED_USER_ROLES.has(role)) {
			throw new Error(`users[${index}].role must be ADMINISTRATOR, DIRECTOR, or RECRUITER.`);
		}
		requireString(user?.division || 'Unassigned', `users[${index}].division`);
		if (emails.has(email)) throw new Error(`Duplicate user email: ${email}`);
		emails.add(email);
	}

	if (normalizeBoolean(config.billing?.enabled, false)) {
		requireString(config.billing?.stripeSecretKey, 'billing.stripeSecretKey');
		requireString(config.billing?.customerId, 'billing.customerId');
		requireString(config.billing?.subscriptionId, 'billing.subscriptionId');
		requireString(config.billing?.seatPriceId, 'billing.seatPriceId');
	}

	return {
		domain,
		databaseName,
		databaseUser,
		databasePassword,
		adminEnabled
	};
}

function escapeEnvValue(value) {
	const normalized = String(value ?? '');
	if (/^[A-Za-z0-9_./:@+-]*$/.test(normalized)) return normalized;
	return `"${normalized.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function relativeHostPath(filePath) {
	const relative = path.relative(process.cwd(), filePath) || path.basename(filePath);
	return relative.startsWith('.') ? relative : `./${relative}`;
}

function buildEnvironment(config, resolved, configPath, outputPath) {
	const billing = config.billing || {};
	const monitoring = config.monitoring || {};
	const operations = config.operations || {};
	const openAi = config.integrations?.openai || {};
	const postmark = config.integrations?.postmark || {};
	const encodedUser = encodeURIComponent(resolved.databaseUser);
	const encodedPassword = encodeURIComponent(resolved.databasePassword);
	const encodedDatabase = encodeURIComponent(resolved.databaseName);

	return {
		APP_DOMAIN: resolved.domain,
		APP_PORT: cleanString(config.instance?.localPort || '3000'),
		HIRE_GNOME_IMAGE: cleanString(config.instance?.image || 'hire-gnome-ats:local'),
		HIRE_GNOME_ENV_FILE: relativeHostPath(outputPath),
		HOSTED_CONFIG_HOST_FILE: relativeHostPath(configPath),
		HOSTED_CONFIG_GID: String(process.getgid?.() ?? 0),
		MYSQL_DATABASE: resolved.databaseName,
		MYSQL_USER: resolved.databaseUser,
		MYSQL_PASSWORD: resolved.databasePassword,
		MYSQL_ROOT_PASSWORD: config.database.rootPassword,
		DATABASE_URL: `mysql://${encodedUser}:${encodedPassword}@mysql:3306/${encodedDatabase}`,
		AUTH_APP_BASE_URL: `https://${resolved.domain}`,
		AUTH_SESSION_SECRET: config.secrets.authSession,
		CLIENT_PORTAL_SECRET: config.secrets.clientPortal,
		RATE_LIMIT_SECRET: config.secrets.rateLimit,
		BOOTSTRAP_ADMIN_ENABLED: String(resolved.adminEnabled),
		BOOTSTRAP_ADMIN_FIRST_NAME: cleanString(config.admin?.firstName),
		BOOTSTRAP_ADMIN_LAST_NAME: cleanString(config.admin?.lastName),
		BOOTSTRAP_ADMIN_EMAIL: cleanString(config.admin?.email).toLowerCase(),
		BOOTSTRAP_ADMIN_PASSWORD: cleanString(config.admin?.password),
		BOOTSTRAP_SITE_NAME: config.instance.siteName,
		BOOTSTRAP_THEME_KEY: cleanString(config.instance?.theme || 'classic_blue'),
		SKIP_SYSTEM_SETTINGS_DB_DURING_BUILD: 'true',
		HOSTED_MANAGED_INTEGRATIONS: 'true',
		OPENAI_RESUME_MODEL: cleanString(openAi.model || 'gpt-4o-mini'),
		EMAIL_TEST_MODE: String(operations.emailTestMode !== false),
		EMAIL_TEST_RECIPIENT: cleanString(operations.emailTestRecipient || config.admin?.email).toLowerCase(),
		POSTMARK_INBOUND_WEBHOOK_SECRET: cleanString(postmark.inboundWebhookSecret),
		DB_BACKUP_RETENTION_DAYS: cleanString(operations.backupRetentionDays || '14'),
		DB_BACKUP_INTERVAL_SECONDS: cleanString(operations.backupIntervalSeconds || '86400'),
		ERROR_ALERT_WEBHOOK_URL: cleanString(monitoring.errorAlertWebhookUrl),
		HEALTH_ALERT_WEBHOOK_URL: cleanString(monitoring.healthAlertWebhookUrl),
		PAPERTRAIL_HOST: cleanString(monitoring.papertrailHost),
		PAPERTRAIL_PORT: cleanString(monitoring.papertrailPort),
		BILLING_ENABLED: String(billing.enabled === true),
		BILLING_PROVIDER: 'stripe',
		BILLING_STRIPE_SECRET_KEY: cleanString(billing.stripeSecretKey),
		BILLING_STRIPE_CUSTOMER_ID: cleanString(billing.customerId),
		BILLING_STRIPE_SUBSCRIPTION_ID: cleanString(billing.subscriptionId),
		BILLING_BASE_PRICE_ID: cleanString(billing.basePriceId),
		BILLING_SEAT_PRICE_ID: cleanString(billing.seatPriceId),
		BILLING_STRIPE_SEAT_SUBSCRIPTION_ITEM_ID: cleanString(billing.seatSubscriptionItemId),
		BILLING_STRIPE_BASE_SUBSCRIPTION_ITEM_ID: cleanString(billing.baseSubscriptionItemId),
		BILLING_STRIPE_PRORATION_BEHAVIOR: cleanString(billing.prorationBehavior || 'create_prorations'),
		BILLING_CURRENCY: cleanString(billing.currency || 'usd')
	};
}

function run() {
	const configPath = path.resolve(readArgument('file', 'hosted-instance.json'));
	const outputPath = path.resolve(readArgument('output', '.env.hosted'));
	const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	const resolved = validateConfig(config);
	const environment = buildEnvironment(config, resolved, configPath, outputPath);
	const content = [
		'# Generated from the hosted instance JSON. Do not edit this file directly.',
		...Object.entries(environment).map(([key, value]) => `${key}=${escapeEnvValue(value)}`),
		''
	].join('\n');

	fs.writeFileSync(outputPath, content, { encoding: 'utf8', mode: 0o600 });
	fs.chmodSync(outputPath, 0o600);
	fs.chmodSync(configPath, 0o640);
	console.log(`Validated hosted configuration: ${configPath}`);
	console.log(`Generated runtime environment: ${outputPath}`);
	console.log(`Customer URL: https://${resolved.domain}`);
	console.log(`Configured first-run users: ${(config.users || []).length + (resolved.adminEnabled ? 1 : 0)}`);
}

try {
	run();
} catch (error) {
	console.error(error?.message || error);
	console.error('Usage: npm run hosted:configure -- --file hosted-instance.json');
	process.exitCode = 1;
}
