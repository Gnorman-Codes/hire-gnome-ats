#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ACTIONS = {
	up: ['--profile', 'proxy', 'up', '-d', '--build'],
	down: ['down'],
	logs: ['logs', '-f', 'app'],
	backup: ['exec', 'app', 'npm', 'run', 'db:backup:scheduled'],
	pull: ['pull'],
	status: ['ps']
};

function readArgument(name, fallback = '') {
	const index = process.argv.indexOf(`--${name}`);
	if (index < 0 || !process.argv[index + 1]) return fallback;
	return String(process.argv[index + 1]).trim();
}

function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		stdio: 'inherit',
		env: process.env,
		...options
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${command} exited with code ${result.status}.`);
	}
}

function shellDisplay(command, args) {
	return [command, ...args]
		.map((value) => (/^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : JSON.stringify(value)))
		.join(' ');
}

function run() {
	const action = String(process.argv[2] || '').trim().toLowerCase();
	if (!ACTIONS[action]) {
		throw new Error(`Action must be one of: ${Object.keys(ACTIONS).join(', ')}.`);
	}

	const configPath = path.resolve(readArgument('config', 'hosted-instance.json'));
	const envPath = path.resolve(readArgument('env-output', '.env.hosted'));
	const composePath = path.resolve('docker-compose.hosted.yml');
	runCommand(process.execPath, [
		path.resolve('scripts/configure-hosted-instance.js'),
		'--file',
		configPath,
		'--output',
		envPath
	]);

	const composeArgs = [
		'compose',
		'--env-file',
		envPath,
		'-f',
		composePath,
		...ACTIONS[action]
	];
	if (process.argv.includes('--dry-run')) {
		console.log(`Docker command: ${shellDisplay('docker', composeArgs)}`);
		console.log('Dry run only; Docker was not invoked.');
		return;
	}

	runCommand('docker', composeArgs);
}

try {
	run();
} catch (error) {
	console.error(error?.message || error);
	console.error('Usage: npm run hosted:up -- --config hosted-instance.json');
	process.exitCode = 1;
}
