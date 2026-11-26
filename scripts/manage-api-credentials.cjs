#!/usr/bin/env node
require('./load-env.cjs');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
	const { isEligibleIntegrationApiUser, newIntegrationApiCredential } = await import('../lib/integrations/api-credential.mjs');
	const [command, id, label, mode, ...extra] = process.argv.slice(2);
	if (command === 'create' && id && label?.trim() && label.length <= 191 && ['read', 'read-write'].includes(mode) && !extra.length) {
		const user = await prisma.user.findUnique({ where: { recordId: id }, include: { division: true } });
		if (!isEligibleIntegrationApiUser(user)) {
			throw new Error('Choose an active director or recruiter assigned to a division with no pending password change.');
		}
		const { token, data } = newIntegrationApiCredential({ user, label: label.trim(), writesEnabled: mode === 'read-write' });
		const record = await prisma.integrationApiCredential.create({
			data,
			select: { recordId: true }
		});
		// The secret is displayed only at creation.
		process.stdout.write(`${JSON.stringify({ ...record, token })}\n`);
		return;
	}
	if (command === 'list' && !id) {
		const keys = await prisma.integrationApiCredential.findMany({
			select: {
				recordId: true, label: true, writesEnabled: true, createdAt: true, revokedAt: true,
				user: { select: { recordId: true } }
			},
			orderBy: { id: 'asc' }
		});
		console.log(JSON.stringify(keys, null, 2));
		return;
	}
	if (command === 'revoke' && id && !label) {
		const result = await prisma.integrationApiCredential.updateMany({
			where: { recordId: id, revokedAt: null }, data: { revokedAt: new Date() }
		});
		console.log(result.count ? 'Credential revoked.' : 'No active credential matched.');
		return;
	}
	throw new Error('Usage: node scripts/manage-api-credentials.cjs create <userRecordId> <label> <read|read-write> | list | revoke <keyRecordId>');
}

main().catch((error) => {
	console.error(error.code ? 'Could not manage API credentials. Check the database and migrations.' : error.message);
	process.exitCode = 1;
}).finally(() => prisma.$disconnect());
