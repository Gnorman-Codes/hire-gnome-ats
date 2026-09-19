/* eslint-disable no-console */
require('./load-env.cjs');

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
const LOGIN_PASSWORD = String(process.env.AUTH_DEFAULT_PASSWORD || 'Welcome123!').trim();
const TEST_EMAIL_DOMAIN = 'demoats.com';
const RECORD_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomRecordIdToken(length = 8) {
	let token = '';
	for (let index = 0; index < length; index += 1) {
		token += RECORD_ID_ALPHABET[Math.floor(Math.random() * RECORD_ID_ALPHABET.length)];
	}
	return token;
}

function createRecordId(prefix) {
	return `${String(prefix || 'REC').toUpperCase()}-${randomRecordIdToken()}`;
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function parseSetCookieHeaders(headers) {
	const raw = headers.get('set-cookie');
	if (!raw) return [];
	return raw
		.split(/,(?=\s*[^=;,\s]+=)/g)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => entry.split(';')[0])
		.filter(Boolean);
}

async function loginAndGetCookie(email) {
	const res = await fetch(`${BASE_URL}/api/session/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password: LOGIN_PASSWORD })
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error(`Login failed for ${email}: ${body.error || res.statusText}`);
	}
	const cookieParts = parseSetCookieHeaders(res.headers);
	assert(cookieParts.length > 0, `No auth cookie returned for ${email}`);
	const cookie = cookieParts.join('; ');
	if (!body.user?.passwordChangeRequired) return cookie;

	// Fresh users must complete the same first-login flow as real users.
	// Check the gate before changing the password; never bypass it in the app.
	const blocked = await apiGet('/api/clients', cookie);
	assert(
		blocked.res.status === 403 && blocked.body.code === 'PASSWORD_CHANGE_REQUIRED',
		`Temporary-password session should be blocked, got ${blocked.res.status}: ${JSON.stringify(blocked.body)}`
	);
	const newPassword = `${LOGIN_PASSWORD}-Changed!`;
	const changeResponse = await fetch(`${BASE_URL}/api/session/change-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie },
		body: JSON.stringify({
			currentPassword: LOGIN_PASSWORD,
			newPassword,
			confirmPassword: newPassword
		})
	});
	const changeBody = await changeResponse.json().catch(() => ({}));
	assert(
		changeResponse.ok,
		`First-login password change failed: ${changeResponse.status}: ${JSON.stringify(changeBody)}`
	);
	const refreshedCookies = parseSetCookieHeaders(changeResponse.headers);
	assert(refreshedCookies.length > 0, 'Password change did not return a refreshed session cookie.');
	return refreshedCookies.join('; ');
}

async function apiGet(path, cookie) {
	const res = await fetch(`${BASE_URL}${path}`, {
		headers: {
			cookie
		}
	});
	const body = await res.json().catch(() => ({}));
	return { res, body };
}

async function bulkUpload(cookie, file, fileName) {
	const formData = new FormData();
	formData.append('files', file, fileName);
	const res = await fetch(`${BASE_URL}/api/candidates/bulk-upload`, {
		method: 'POST',
		headers: { cookie },
		body: formData
	});
	const body = await res.json().catch(() => ({}));
	return { res, body };
}

async function ensureBaseUrlReachable() {
	try {
		const res = await fetch(`${BASE_URL}/api/health`);
		if (!res.ok) {
			throw new Error(`Health endpoint returned ${res.status}.`);
		}
	} catch (error) {
		throw new Error(
			`Could not reach app at ${BASE_URL}. Start the app first (for example: "npm run start" or "npm run dev"), then rerun ci:smoke. ${error?.message || error}`
		);
	}
}

async function run() {
	const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
	const state = {
		divisionIds: [],
		userIds: [],
		clientIds: []
	};

	await ensureBaseUrlReachable();

	try {
		const scopeDivision = await prisma.division.create({
			data: {
				recordId: createRecordId('DIV'),
				name: `Perm Scope ${suffix}`,
				accessMode: 'OWNER_ONLY'
			}
		});
		const otherDivision = await prisma.division.create({
			data: {
				recordId: createRecordId('DIV'),
				name: `Perm Other ${suffix}`,
				accessMode: 'OWNER_ONLY'
			}
		});
		state.divisionIds.push(scopeDivision.id, otherDivision.id);

		const director = await prisma.user.create({
			data: {
				recordId: createRecordId('USR'),
				firstName: 'Perm',
				lastName: 'Director',
				email: `perm.director.${suffix}@${TEST_EMAIL_DOMAIN}`,
				role: 'DIRECTOR',
				divisionId: scopeDivision.id,
				isActive: true
			}
		});
		const recruiterA = await prisma.user.create({
			data: {
				recordId: createRecordId('USR'),
				firstName: 'Perm',
				lastName: 'RecruiterA',
				email: `perm.recruiter.a.${suffix}@${TEST_EMAIL_DOMAIN}`,
				role: 'RECRUITER',
				divisionId: scopeDivision.id,
				isActive: true
			}
		});
		const recruiterB = await prisma.user.create({
			data: {
				recordId: createRecordId('USR'),
				firstName: 'Perm',
				lastName: 'RecruiterB',
				email: `perm.recruiter.b.${suffix}@${TEST_EMAIL_DOMAIN}`,
				role: 'RECRUITER',
				divisionId: scopeDivision.id,
				isActive: true
			}
		});
		const recruiterOther = await prisma.user.create({
			data: {
				recordId: createRecordId('USR'),
				firstName: 'Perm',
				lastName: 'RecruiterOther',
				email: `perm.recruiter.other.${suffix}@${TEST_EMAIL_DOMAIN}`,
				role: 'RECRUITER',
				divisionId: otherDivision.id,
				isActive: true
			}
		});
		state.userIds.push(director.id, recruiterA.id, recruiterB.id, recruiterOther.id);

		const clientA = await prisma.client.create({
			data: {
				recordId: createRecordId('CLI'),
				name: `Perm Client A ${suffix}`,
				status: 'Prospect',
				ownerId: recruiterA.id,
				divisionId: scopeDivision.id
			}
		});
		const clientB = await prisma.client.create({
			data: {
				recordId: createRecordId('CLI'),
				name: `Perm Client B ${suffix}`,
				status: 'Prospect',
				ownerId: recruiterB.id,
				divisionId: scopeDivision.id
			}
		});
		const clientOther = await prisma.client.create({
			data: {
				recordId: createRecordId('CLI'),
				name: `Perm Client Other ${suffix}`,
				status: 'Prospect',
				ownerId: recruiterOther.id,
				divisionId: otherDivision.id
			}
		});
		state.clientIds.push(clientA.id, clientB.id, clientOther.id);

		const directorCookie = await loginAndGetCookie(director.email);
		const recruiterACookie = await loginAndGetCookie(recruiterA.email);

		const rootResponse = await fetch(`${BASE_URL}/`, { headers: { cookie: directorCookie } });
		assert(rootResponse.ok, `Authenticated root page should load, got ${rootResponse.status}.`);
		const cacheControl = String(rootResponse.headers.get('cache-control') || '');
		assert(
			/no-store/i.test(cacheControl),
			`Authenticated root page must not be shared-cached, got Cache-Control: ${cacheControl || '(missing)'}.`
		);
		assert(
			!rootResponse.headers.has('x-nextjs-cache') && !rootResponse.headers.has('x-nextjs-prerender'),
			'Authenticated root page must not be served from the Next.js full-route cache.'
		);

		const imageUpload = await bulkUpload(
			directorCookie,
			new Blob(['not a resume'], { type: 'image/png' }),
			'not-a-resume.png'
		);
		assert(imageUpload.res.status === 201, `Bulk upload should report a per-file result, got ${imageUpload.res.status}.`);
		assert(
			imageUpload.body.results?.[0]?.status === 'failed' &&
				/Unsupported file type/.test(imageUpload.body.results[0].message || ''),
			'Bulk upload must reject non-resume attachments at the API boundary.'
		);

		const oversizedResume = await bulkUpload(
			directorCookie,
			new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'application/pdf' }),
			'oversized-resume.pdf'
		);
		assert(
			oversizedResume.body.results?.[0]?.status === 'failed' &&
				/8 MB limit/.test(oversizedResume.body.results[0].message || ''),
			'Bulk upload must reject resumes over the parser limit before attempting extraction.'
		);

		const directorList = await apiGet('/api/clients', directorCookie);
		assert(directorList.res.ok, `Director should be able to list clients, got ${directorList.res.status}: ${JSON.stringify(directorList.body)}`);
		const directorVisibleIds = new Set(
			(Array.isArray(directorList.body) ? directorList.body : []).map((row) => row.id)
		);
		assert(directorVisibleIds.has(clientA.id), 'Director missing client A in own division.');
		assert(directorVisibleIds.has(clientB.id), 'Director missing client B in own division.');
		assert(!directorVisibleIds.has(clientOther.id), 'Director can see client from another division.');

		const recruiterAList = await apiGet('/api/clients', recruiterACookie);
		assert(recruiterAList.res.ok, `Recruiter should be able to list clients, got ${recruiterAList.res.status}: ${JSON.stringify(recruiterAList.body)}`);
		const recruiterVisibleIds = new Set(
			(Array.isArray(recruiterAList.body) ? recruiterAList.body : []).map((row) => row.id)
		);
		assert(recruiterVisibleIds.has(clientA.id), 'Recruiter A missing own client.');
		assert(!recruiterVisibleIds.has(clientB.id), 'Recruiter A can see peer-owned client in owner-only division.');
		assert(!recruiterVisibleIds.has(clientOther.id), 'Recruiter A can see another division client.');

		const recruiterAForbiddenDetail = await apiGet(`/api/clients/${clientB.id}`, recruiterACookie);
		assert(
			recruiterAForbiddenDetail.res.status === 404,
			`Recruiter A should get 404 for peer client detail, got ${recruiterAForbiddenDetail.res.status}.`
		);

		const directorForbiddenDetail = await apiGet(`/api/clients/${clientOther.id}`, directorCookie);
		assert(
			directorForbiddenDetail.res.status === 404,
			`Director should get 404 for out-of-division client detail, got ${directorForbiddenDetail.res.status}.`
		);

		console.log('Permissions, cache policy, and bulk-upload boundary smoke checks passed.');
		console.log('Verified first-login password enforcement and session refresh.');
		console.log(`Verified against ${BASE_URL}`);
	} finally {
		if (state.clientIds.length > 0) {
			await prisma.client.deleteMany({ where: { id: { in: state.clientIds } } });
		}
		if (state.userIds.length > 0) {
			await prisma.user.deleteMany({ where: { id: { in: state.userIds } } });
		}
		if (state.divisionIds.length > 0) {
			await prisma.division.deleteMany({ where: { id: { in: state.divisionIds } } });
		}
		await prisma.$disconnect();
	}
}

run().catch(async (error) => {
	console.error('Permissions API smoke checks failed.');
	console.error(error?.message || error);
	await prisma.$disconnect();
	process.exit(1);
});
