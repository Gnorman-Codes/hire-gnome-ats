#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function readArgument(name, fallback = '') {
	const index = process.argv.indexOf(`--${name}`);
	if (index < 0 || !process.argv[index + 1]) return fallback;
	return String(process.argv[index + 1]).trim();
}

function requireArgument(name) {
	const value = readArgument(name);
	if (!value) throw new Error(`Missing required --${name} argument.`);
	return value;
}

function randomSecret(bytes = 32) {
	return crypto.randomBytes(bytes).toString('hex');
}

function run() {
	const filePath = path.resolve(readArgument('file', 'hosted-instance.json'));
	if (fs.existsSync(filePath) && !process.argv.includes('--force')) {
		throw new Error(`${filePath} already exists. Use --force to replace it.`);
	}

	const domain = requireArgument('domain').toLowerCase();
	const adminEmail = requireArgument('admin-email').toLowerCase();
	const siteName = readArgument('site-name', 'Hire Gnome ATS');
	const adminPassword = randomSecret(12);
	const config = {
		version: 1,
		instance: {
			domain,
			siteName,
			theme: 'classic_blue',
			image: 'hire-gnome-ats:local',
			localPort: 3000
		},
		database: {
			name: 'ats',
			user: 'ats',
			password: randomSecret(24),
			rootPassword: randomSecret(24)
		},
		secrets: {
			authSession: randomSecret(),
			clientPortal: randomSecret(),
			rateLimit: randomSecret()
		},
		admin: {
			provisioningEnabled: true,
			firstName: readArgument('admin-first-name', 'Customer'),
			lastName: readArgument('admin-last-name', 'Administrator'),
			email: adminEmail,
			password: adminPassword
		},
		users: [],
		integrations: {},
		billing: {
			enabled: false
		},
		monitoring: {},
		operations: {
			emailTestMode: true,
			emailTestRecipient: adminEmail,
			backupRetentionDays: 14,
			backupIntervalSeconds: 86400
		}
	};

	fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600
	});
	fs.chmodSync(filePath, 0o600);
	console.log(`Created hosted configuration: ${filePath}`);
	console.log(`Administrator login: ${adminEmail}`);
	console.log(`Initial administrator password: ${adminPassword}`);
	console.log('Store the password securely and have the administrator change it after first login.');
}

try {
	run();
} catch (error) {
	console.error(error?.message || error);
	console.error(
		'Usage: npm run hosted:init -- --domain ats.customer.example --admin-email admin@customer.example --site-name "Customer ATS"'
	);
	process.exitCode = 1;
}
