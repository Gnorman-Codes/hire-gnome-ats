function normalizeBaseUrl(value) {
	const trimmed = String(value || '').trim();
	if (!trimmed) return '';
	try {
		const url = new URL(trimmed);
		return url.origin;
	} catch {
		return '';
	}
}

export function getPublicAppBaseUrl(fallback = 'http://localhost:3000') {
	const configured = normalizeBaseUrl(
		process.env.AUTH_APP_BASE_URL ||
		process.env.APP_BASE_URL ||
		process.env.NEXT_PUBLIC_APP_URL
	);
	if (configured) return configured;
	return fallback;
}
