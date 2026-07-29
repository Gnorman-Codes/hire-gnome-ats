#!/usr/bin/env node

require('./load-env.cjs');

const { mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = resolve(__dirname, '..');
const envPath = join(projectRoot, '.env');
const defaultBackupDir = process.env.DB_BACKUP_DIR || join(projectRoot, '.backups');

function parseEnvFile(filePath) {
	let raw = '';
	try {
		raw = readFileSync(filePath, 'utf8');
	} catch {
		return {};
	}
	const values = {};

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

		values[key] = value;
	}

	return values;
}

function parseDatabaseUrl(databaseUrl) {
	const parsed = new URL(databaseUrl);
	return {
		host: parsed.hostname || 'localhost',
		port: Number(parsed.port || '3306'),
		user: decodeURIComponent(parsed.username || 'root'),
		password: decodeURIComponent(parsed.password || ''),
		database: (parsed.pathname || '/ats').replace(/^\//, ''),
		socket: String(parsed.searchParams.get('socket') || '').trim()
	};
}

function buildMysqlConnectionArgs(config) {
	const args = [
		`--user=${config.user}`
	];

	if (config.socket) {
		args.push(`--socket=${config.socket}`);
	} else {
		args.push(`--host=${config.host}`);
		args.push(`--port=${config.port}`);
	}

	return args;
}

function parseArgs() {
	const args = process.argv.slice(2);
	const outputIndex = args.indexOf('--output');
	const outputDirectory = outputIndex >= 0 && args[outputIndex + 1]
		? args[outputIndex + 1]
		: defaultBackupDir;
	return { outputDirectory };
}

function timestampLabel() {
	const now = new Date();
	return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
}

function ensureDirectoryExists(directory) {
	mkdirSync(directory, { recursive: true });
	return directory;
}

function commandErrorMessage(commandResult) {
	if (commandResult.error) {
		return commandResult.error.message;
	}
	if (commandResult.status === 0) {
		return '';
	}
	return commandResult.stderr?.toString() || `Command exited with code ${commandResult.status}.`;
}

function backup() {
	const env = {
		...parseEnvFile(envPath),
		...process.env
	};
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL is required in the environment or .env for backup.');
	}

	let config;
	try {
		config = parseDatabaseUrl(env.DATABASE_URL);
	} catch {
		throw new Error('DATABASE_URL is not a valid mysql URL.');
	}
	const { outputDirectory } = parseArgs();
	const outputDir = ensureDirectoryExists(outputDirectory);
	const outputPath = join(outputDir, `ats-backup-${timestampLabel()}.sql`);
	const args = [
		...buildMysqlConnectionArgs(config),
		`--databases`,
		config.database,
		`--result-file`,
		outputPath,
		'--single-transaction',
		'--routines',
		'--triggers'
	];
	const command = spawnSync('mysqldump', args, {
		env: {
			...process.env,
			MYSQL_PWD: config.password || ''
		},
		stdio: ['ignore', 'ignore', 'pipe']
	});

	const commandError = commandErrorMessage(command);
	if (commandError) {
		throw new Error(`mysqldump failed: ${commandError}`);
	}

	console.log(`Backup written to: ${outputPath}`);
}

try {
	backup();
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}
