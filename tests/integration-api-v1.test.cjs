const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { PrismaClient } = require('@prisma/client');

const databaseUrl = process.env.HIRE_GNOME_API_TEST_DATABASE_URL;
const appUrl = process.env.HIRE_GNOME_API_TEST_URL;

test('Phase 1 API workflow respects scope, survives duplicate requests, and records status history', {
	skip: !databaseUrl || !appUrl
}, async (t) => {
	const database = new URL(databaseUrl);
	const app = new URL(appUrl);
	assert.equal(database.protocol, 'mysql:');
	assert.equal(app.protocol, 'http:');
	for (const url of [database, app]) assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
	assert.match(database.pathname, /^\/hg_api_qa_[a-z0-9_]+$/i);
	const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
	t.after(() => prisma.$disconnect());
	const tag = randomUUID();

	async function createUser(name, role, divisionId, passwordHash) {
		return prisma.user.create({
			data: { recordId: `USR-${name}-${tag}`, firstName: name, lastName: 'Test', email: `${name}.${tag}@example.test`, divisionId, role, passwordHash }
		});
	}

	function credentialCommand(...args) {
		return execFileSync(process.execPath, ['scripts/manage-api-credentials.cjs', ...args], {
			encoding: 'utf8', env: { ...process.env, DATABASE_URL: databaseUrl }
		});
	}

	function issue(user, mode = 'read-write') {
		return JSON.parse(credentialCommand('create', user.recordId, `API test ${tag}`, mode));
	}

	const division = await prisma.division.create({ data: { recordId: `DIV-${tag}`, name: tag, accessMode: 'OWNER_ONLY' } });
	const director = await createUser('Director', 'DIRECTOR', division.id);
	const { hashPassword } = await import('../lib/password-auth.js');
	const password = randomUUID();
	const passwordHash = await hashPassword(password);
	const recruiter = await createUser('Recruiter', 'RECRUITER', division.id, passwordHash);
	const peer = await createUser('Peer', 'RECRUITER', division.id);
	const admin = await createUser('Admin', 'ADMINISTRATOR', division.id, passwordHash);
	const reader = issue(director, 'read');
	const outsider = issue(peer);

	async function login(user) {
		const res = await fetch(new URL('/api/session/login', app), {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: user.email, password })
		});
		assert.equal(res.status, 200, 'Fixture account sign-in failed');
		return res.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
	}

	async function manage(method, cookie, expected, body) {
		const res = await fetch(new URL('/api/admin/api-keys', app), {
			method, headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body)
		});
		assert.equal(res.status, expected, `${method} API key settings`);
		return res;
	}

	const adminCookie = await login(admin);
	const recruiterCookie = await login(recruiter);
	const keyInput = { label: `Workflow ${tag}`, userRecordId: director.recordId, writesEnabled: true };
	await manage('GET', null, 401);
	await manage('GET', recruiterCookie, 403);
	await manage('POST', recruiterCookie, 403, keyInput);
	await manage('POST', adminCookie, 400, { ...keyInput, userRecordId: admin.recordId });
	const issuedResponse = await manage('POST', adminCookie, 201, keyInput);
	assert.equal(issuedResponse.headers.get('cache-control'), 'no-store');
	const { key, token } = await issuedResponse.json();
	const writer = { ...key, token };
	assert.match(token, /^hg1_[0-9a-f]{64}$/);
	const settings = await (await manage('GET', adminCookie, 200)).text();
	assert.equal(settings.includes(token), false);
	assert.equal(settings.includes('tokenHash'), false);
	assert.equal(JSON.parse(settings).keys.find((entry) => entry.recordId === key.recordId).status, 'active');
	assert.equal(JSON.parse(settings).users.some((entry) => entry.recordId === admin.recordId), false);

	async function call(path, { method = 'GET', key = writer, body, expected = 200 } = {}) {
		const headers = { 'Content-Type': 'application/json' };
		if (key) headers.Authorization = `Bearer ${key.token}`;
		const res = await fetch(new URL(`/api/v1/${path}`, app), { method, headers, body: JSON.stringify(body) });
		const payload = await res.json();
		assert.ok([expected].flat().includes(res.status), `${method} ${path} returned ${res.status}: ${JSON.stringify(payload)}`);
		return { status: res.status, ...payload };
	}

	async function retryPair(path, body) {
		const options = { method: 'POST', body, expected: [200, 201] };
		const results = await Promise.all([call(path, options), call(path, options)]);
		assert.deepEqual(results.map(({ status }) => status).sort(), [200, 201]);
		assert.equal(results[0].data.recordId, results[1].data.recordId);
		return results[0].data;
	}

	const ownerRecordId = recruiter.recordId;
	const clientBody = { name: `API client ${tag}`, zipCode: '10001', ownerRecordId };
	await call('clients', { key: null, expected: 401 });
	await call('clients', { method: 'POST', key: reader, body: clientBody, expected: 403 });
	const { data: client } = await call('clients', { method: 'POST', body: clientBody, expected: 201 });
	assert.equal(client.ownerRecordId, ownerRecordId);
	await call(`clients/${client.recordId}`, { key: outsider, expected: 404 });
	const clientRecordId = client.recordId;
	const { data: contact } = await call('contacts', { method: 'POST', expected: 201, body: {
		clientRecordId, ownerRecordId, firstName: 'Hiring', lastName: 'Manager',
		email: `manager.${tag}@example.test`, phone: '2125550123', source: 'Referral'
	} });
	const jobBody = { title: 'Identical title', clientRecordId, contactRecordId: contact.recordId, ownerRecordId, zipCode: '10001' };
	const { data: job } = await call('job-orders', { method: 'POST', body: jobBody, expected: 201 });
	const { data: secondJob } = await call('job-orders', { method: 'POST', body: jobBody, expected: 201 });
	assert.notEqual(job.recordId, secondJob.recordId);

	const email = `CANDIDATE.${tag}@example.test`;
	const candidate = await retryPair('candidates/upsert', {
		email, ownerRecordId, firstName: 'Jamie', lastName: 'Test', mobile: '2125550101',
		source: 'Referral', currentJobTitle: 'Engineer', currentEmployer: 'Example Inc', status: 'in_review'
	});
	assert.equal(candidate.email, email.toLowerCase());
	const pair = { candidateRecordId: candidate.recordId, jobOrderRecordId: job.recordId, status: 'submitted' };
	const submission = await retryPair('submissions', pair);
	const { data: secondSubmission } = await call('submissions', {
		method: 'POST', body: { ...pair, jobOrderRecordId: secondJob.recordId }, expected: 201
	});
	assert.notEqual(secondSubmission.recordId, submission.recordId);
	const path = `submissions/${submission.recordId}`;
	await call(path, { method: 'PATCH', body: { status: 'under_review', notes: 'Hiring manager is reviewing.' } });
	const { data: replay } = await call('submissions', { method: 'POST', body: pair });
	assert.equal(replay.status, 'under_review');
	assert.equal(replay.notes, 'Hiring manager is reviewing.');
	const saved = await prisma.submission.findUniqueOrThrow({ where: { recordId: submission.recordId } });
	const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'SUBMISSION', entityId: saved.id, action: 'UPDATE' } });
	assert.equal(audit.beforeData.status, 'submitted');
	assert.equal(audit.afterData.status, 'under_review');
	assert.equal(audit.metadata.credentialId, writer.recordId);

	const archivedJob = await prisma.jobOrder.findUniqueOrThrow({ where: { recordId: job.recordId } });
	await prisma.archivedEntity.create({ data: { recordId: `ARC-${tag}`, entityType: 'JOB_ORDER', entityId: archivedJob.id } });
	await call(path, { expected: 404 });
	assert.equal((await call('submissions?limit=1')).data[0].recordId, secondSubmission.recordId);
	assert.equal((await call('job-orders?limit=1')).data[0].recordId, secondJob.recordId);

	credentialCommand('revoke', reader.recordId);
	await call('clients', { key: reader, expected: 401 });
	await manage('DELETE', recruiterCookie, 403, { recordId: key.recordId });
	for (const attempt of [1, 2]) {
		const revoked = await (await manage('DELETE', adminCookie, 200, { recordId: key.recordId })).json();
		assert.equal(revoked.key.status, 'revoked', `Revoke attempt ${attempt}`);
	}
	await call('clients', { expected: 401 });

	const storedKey = await prisma.integrationApiCredential.findUniqueOrThrow({ where: { recordId: key.recordId } });
	const keyAudit = await prisma.auditLog.findMany({
		where: { entityType: 'INTEGRATION_API_CREDENTIAL', entityId: storedKey.id, actorUserId: admin.id },
		orderBy: { id: 'asc' }
	});
	assert.deepEqual(keyAudit.map(({ action }) => action), ['CREATE', 'UPDATE']);
});
