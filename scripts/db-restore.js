#!/usr/bin/env node

require('./load-env.cjs');

const { createReadStream, existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const projectRoot = resolve(__dirname, '..');
const envPath = join(projectRoot, '.env');

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
	const inputIndex = args.indexOf('--input');
	const inputFile = inputIndex >= 0 && args[inputIndex + 1]
		? args[inputIndex + 1]
		: '';
	const dropFirst = args.includes('--drop-first');
	return {
		inputFile,
		dropFirst
	};
}

function runSqlCommand(config, sql) {
	const args = [
		...buildMysqlConnectionArgs(config),
		'--execute',
		sql
	];
	const command = spawnSync('mysql', args, {
		env: {
			...process.env,
			MYSQL_PWD: config.password || ''
		},
		stdio: ['ignore', 'ignore', 'pipe']
	});

	if (command.status === 0) return;
	const errorText = command.error
		? command.error.message
		: command.stderr?.toString() || `mysql exited with code ${command.status}`;
	throw new Error(`mysql command failed: ${errorText}`);
}

function restoreFromFile(config, inputPath) {
	return new Promise((resolvePromise, rejectPromise) => {
		const args = [
			...buildMysqlConnectionArgs(config),
			config.database
		];

		const mysqlProcess = spawn('mysql', args, {
			env: {
				...process.env,
				MYSQL_PWD: config.password || ''
			},
			stdio: ['pipe', 'ignore', 'pipe']
		});

		const sqlStream = createReadStream(inputPath);

		sqlStream.on('error', (error) => {
			mysqlProcess.kill('SIGTERM');
			rejectPromise(error);
		});

		mysqlProcess.stderr.on('data', () => {
			// Keep stderr drained to avoid process hang on large output.
		});

		mysqlProcess.on('error', (error) => {
			rejectPromise(error);
		});

		mysqlProcess.on('close', (code) => {
			if (code === 0) {
				resolvePromise();
				return;
			}
			rejectPromise(new Error(`mysql restore exited with code ${code}.`));
		});

		sqlStream.pipe(mysqlProcess.stdin);
	});
}

async function run() {
	const { inputFile, dropFirst } = parseArgs();
	if (!inputFile) {
		throw new Error('Missing required --input <backup.sql> argument.');
	}

	const inputPath = resolve(process.cwd(), inputFile);
	if (!existsSync(inputPath)) {
		throw new Error(`Backup file not found: ${inputPath}`);
	}

	const env = {
		...parseEnvFile(envPath),
		...process.env
	};
	if (!env.DATABASE_URL) {
		throw new Error('DATABASE_URL is required in the environment or .env for restore.');
	}

	let config;
	try {
		config = parseDatabaseUrl(env.DATABASE_URL);
	} catch {
		throw new Error('DATABASE_URL is not a valid mysql URL.');
	}

	if (dropFirst) {
		runSqlCommand(config, `DROP DATABASE IF EXISTS \`${config.database}\`; CREATE DATABASE \`${config.database}\`;`);
	}

	await restoreFromFile(config, inputPath);
	console.log(`Restore completed from: ${inputPath}`);
}

run().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
