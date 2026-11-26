import 'server-only';

function parseBooleanEnv(name, fallback = false) {
	const normalized = String(process.env[name] || '').trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function parseStringEnv(name, fallback = '') {
	const value = String(process.env[name] || '').trim();
	return value || fallback;
}

export const DEMO_MODE = parseBooleanEnv('DEMO_MODE', false);
export const DEMO_API_KEYS_ENABLED = parseBooleanEnv('DEMO_API_KEYS_ENABLED', false);

export const DEMO_ADMIN_EMAIL = parseStringEnv('DEMO_ADMIN_EMAIL', 'admin@demoats.com');
export const DEMO_RECRUITER_EMAIL = parseStringEnv('DEMO_RECRUITER_EMAIL', 'recruiter@demoats.com');
export const DEMO_LOGIN_PASSWORD = parseStringEnv(
	'DEMO_LOGIN_PASSWORD',
	parseStringEnv('AUTH_DEFAULT_PASSWORD', 'Welcome123!')
);

export function getDemoLoginAccounts() {
	if (!DEMO_MODE) return [];
	return [
		{ label: 'Admin', email: DEMO_ADMIN_EMAIL, password: DEMO_LOGIN_PASSWORD },
		{ label: 'Recruiter', email: DEMO_RECRUITER_EMAIL, password: DEMO_LOGIN_PASSWORD }
	];
}
