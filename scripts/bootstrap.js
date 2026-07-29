#!/usr/bin/env node

require('./load-env.cjs');

const { existsSync, copyFileSync, readFileSync } = require('node:fs');
const { execSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const envExamplePath = path.join(projectRoot, '.env.example');
const skipMigrate = process.argv.includes('--skip-migrate');
const skipAdminProvision = process.argv.includes('--skip-admin-provision');

function parseEnvFile(filePath) {
	const raw = readFileSync(filePath, 'utf8');
	const entries = {};

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex < 0) {
			continue;
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		let value = trimmed.slice(separatorIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}

		entries[key] = value;
	}

	return entries;
}

function checkRequiredEnv(envFile) {
	const missing = [];
	const required = [
		'DATABASE_URL',
		'AUTH_SESSION_SECRET',
		'AUTH_APP_BASE_URL'
	];

	for (const key of required) {
		if (!envFile[key]) {
			missing.push(key);
		}
	}

	return missing;
}

function validateDatabaseUrl(databaseUrl) {
	try {
		const parsed = new URL(databaseUrl);
		return Boolean(parsed.pathname && parsed.hostname);
	} catch {
		return false;
	}
}

function runPrismaMigrate() {
	console.log('Running Prisma migrations with: npx prisma migrate deploy');
	execSync('npx prisma migrate deploy', {
		stdio: 'inherit',
		cwd: projectRoot
	});
}

function runDefaultAdminProvision(envFile) {
	console.log('Provisioning default admin (if enabled) with: node scripts/provision-default-admin.js');
	execSync('node scripts/provision-default-admin.js', {
		stdio: 'inherit',
		cwd: projectRoot,
		env: {
			...envFile,
			...process.env
		}
	});
}

function runHealthSmokeCheck() {
	console.log('Running health checks with: npx prisma migrate status');
	execSync('npx prisma migrate status', {
		stdio: 'inherit',
		cwd: projectRoot
	});
}

function run() {
	console.log('ATS Bootstrap');
	console.log(`Project root: ${projectRoot}`);

	const hasEnvFile = existsSync(envPath);
	const injectedConfig = {
		...(hasEnvFile ? parseEnvFile(envPath) : {}),
		...process.env
	};

	if (!hasEnvFile && checkRequiredEnv(injectedConfig).length > 0) {
		console.log('No .env file found. Copying from .env.example...');
		copyFileSync(envExamplePath, envPath);
		console.log('Created .env from .env.example. Please update credentials before proceeding.');
	}

	const config = existsSync(envPath)
		? {
			...parseEnvFile(envPath),
			...process.env
		}
		: injectedConfig;
	const missing = checkRequiredEnv(config);
	if (missing.length > 0) {
		console.log('Missing required env entries:', missing.join(', '));
		console.log('Set them in the environment or .env file and re-run bootstrap.');
		process.exitCode = 1;
		return;
	}
	if (!validateDatabaseUrl(config.DATABASE_URL)) {
		console.log('DATABASE_URL is invalid or missing host/database.');
		process.exitCode = 1;
		return;
	}

	if (skipMigrate) {
		console.log('Skipping migrations due to --skip-migrate.');
	} else {
		try {
			runPrismaMigrate();
		} catch (error) {
			console.log('Migrations failed. DB may still be reachable but migrations were not applied.');
			process.exitCode = 1;
			return;
		}
	}

	try {
		runHealthSmokeCheck();
	} catch (error) {
		console.log('Prisma migrate status reported an issue. Resolve DB connectivity or migration state and rerun.');
		process.exitCode = 1;
		return;
	}

	if (skipAdminProvision) {
		console.log('Skipping default admin provisioning due to --skip-admin-provision.');
		console.log('Bootstrap complete. Start the app with npm run dev.');
		return;
	}

	try {
		runDefaultAdminProvision(config);
		console.log('Bootstrap complete. Start the app with npm run dev.');
	} catch (error) {
		console.log('Default admin provisioning failed.');
		process.exitCode = 1;
	}
}

run();
