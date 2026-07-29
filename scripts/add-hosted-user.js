#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_ROLES = new Set(['ADMINISTRATOR', 'DIRECTOR', 'RECRUITER']);

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

function normalizeRole(value) {
	const normalized = String(value || 'RECRUITER').trim().toUpperCase();
	const aliases = {
		ADMIN: 'ADMINISTRATOR',
		ADMINISTRATOR: 'ADMINISTRATOR',
		DIRECTOR: 'DIRECTOR',
		RECRUITER: 'RECRUITER'
	};
	return aliases[normalized] || normalized;
}

function readDocument(filePath) {
	if (!fs.existsSync(filePath)) {
		throw new Error(`${filePath} does not exist. Create it with npm run hosted:init first.`);
	}
	const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	if (Array.isArray(payload)) {
		return {
			payload,
			users: payload,
			legacyArray: true
		};
	}
	if (!payload || typeof payload !== 'object') {
		throw new Error(`${filePath} must contain a hosted configuration object.`);
	}
	if (!Array.isArray(payload.users)) payload.users = [];
	return {
		payload,
		users: payload.users,
		legacyArray: false
	};
}

function writeDocument(filePath, document) {
	fs.writeFileSync(filePath, `${JSON.stringify(document.payload, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600
	});
	fs.chmodSync(filePath, 0o600);
}

function run() {
	const filePath = path.resolve(readArgument('file', 'hosted-instance.json'));
	const document = readDocument(filePath);
	if (process.argv.includes('--clear')) {
		document.users.splice(0, document.users.length);
		writeDocument(filePath, document);
		console.log(`Cleared bootstrap credentials from ${filePath}. Database users were not changed.`);
		return;
	}

	const firstName = requireArgument('first-name');
	const lastName = requireArgument('last-name');
	const email = requireArgument('email').toLowerCase();
	const division = readArgument('division', 'Unassigned');
	const role = normalizeRole(readArgument('role', 'RECRUITER'));
	const suppliedPassword = readArgument('password');
	const password = suppliedPassword || crypto.randomBytes(12).toString('hex');

	if (!email.includes('@')) throw new Error('--email must be a valid email address.');
	if (!ALLOWED_ROLES.has(role)) {
		throw new Error('--role must be ADMINISTRATOR, DIRECTOR, or RECRUITER.');
	}
	if (password.length < 8) throw new Error('--password must be at least 8 characters.');

	if (document.users.some((user) => String(user?.email || '').trim().toLowerCase() === email)) {
		throw new Error(`${email} already exists in ${filePath}.`);
	}

	document.users.push({
		firstName,
		lastName,
		email,
		password,
		role,
		division,
		isActive: true
	});
	writeDocument(filePath, document);

	console.log(`Added ${email} to ${filePath}`);
	console.log(`Role: ${role}`);
	console.log(`Division: ${division}`);
	console.log(`Initial password: ${password}`);
	console.log('Store the password securely and have the user change it after first login.');
}

try {
	run();
} catch (error) {
	console.error(error?.message || error);
	console.error(
		'Usage: npm run hosted:user -- --first-name Jane --last-name Doe --email jane@example.com --role RECRUITER --division Main'
	);
	console.error('Clear after provisioning: npm run hosted:user -- --clear');
	process.exitCode = 1;
}
