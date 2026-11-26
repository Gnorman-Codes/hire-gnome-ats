import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const integrationApiTokenPattern = /^hg1_[0-9a-f]{64}$/;

export function hashIntegrationApiToken(token) {
	return createHash('sha256').update(token).digest('hex');
}

export function newIntegrationApiCredential({ user, label, writesEnabled }) {
	const token = `hg1_${randomBytes(32).toString('hex')}`;
	return {
		token,
		data: {
			recordId: `KEY-${randomUUID()}`, label, writesEnabled,
			tokenHash: hashIntegrationApiToken(token), userId: user.id,
			divisionId: user.divisionId, role: user.role
		}
	};
}

export function isEligibleIntegrationApiUser(user) {
	return Boolean(user?.isActive && !user.serviceKey && !user.passwordChangeRequired &&
		user.divisionId && user.division && ['DIRECTOR', 'RECRUITER'].includes(user.role));
}
