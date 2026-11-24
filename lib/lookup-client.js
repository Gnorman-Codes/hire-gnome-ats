const LOOKUP_CACHE_TTL_MS = 12_000;
const LOOKUP_CACHE_MAX_ENTRIES = 128;
const IN_FLIGHT_TTL_MS = 10_000;
const lookupCache = new Map();
const lookupInFlight = new Map();

function buildLookupCacheKey(entity, options) {
	return `${entity}|${JSON.stringify(options || {})}`;
}

function pruneLookupCache() {
	while (lookupCache.size > LOOKUP_CACHE_MAX_ENTRIES) {
		const firstKey = lookupCache.keys().next().value;
		lookupCache.delete(firstKey);
	}
}

function pruneInFlightCache() {
	const now = Date.now();
	for (const [key, entry] of lookupInFlight.entries()) {
		if (!entry || entry.expiresAt < now) {
			lookupInFlight.delete(key);
		}
	}
}

function buildLookupInflightKey(namespace, entity, options) {
	return `inflight|${namespace}|${buildLookupCacheKey(entity, options)}`;
}

function getLookupInFlight(namespace, entity, options) {
	pruneInFlightCache();
	const key = buildLookupInflightKey(namespace, entity, options);
	const hit = lookupInFlight.get(key);
	if (!hit) return null;
	if (hit.expiresAt < Date.now()) {
		lookupInFlight.delete(key);
		return null;
	}
	return hit.promise;
}

function setLookupInFlight(namespace, entity, options, promise) {
	const key = buildLookupInflightKey(namespace, entity, options);
	lookupInFlight.set(key, {
		promise,
		expiresAt: Date.now() + IN_FLIGHT_TTL_MS
	});
	return promise;
}

function clearLookupInFlight(namespace, entity, options) {
	const key = buildLookupInflightKey(namespace, entity, options);
	lookupInFlight.delete(key);
}

function getLookupCache(entity, options) {
	const key = buildLookupCacheKey(entity, options);
	const hit = lookupCache.get(key);
	if (!hit) return null;
	if (hit.expiresAt < Date.now()) {
		lookupCache.delete(key);
		return null;
	}
	return hit.value;
}

function setLookupCache(entity, options, value) {
	const key = buildLookupCacheKey(entity, options);
	lookupCache.set(key, {
		value,
		expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS
	});
	pruneLookupCache();
}

function normalizeLookupPagePayload(payload, options = {}) {
	const fallbackPage = Number(options?.page) > 0 ? Number(options.page) : 1;
	const fallbackLimit = Number(options?.limit) > 0 ? Number(options.limit) : 20;
	const pagination = payload?.pagination || {};
	const page = Number(pagination.page) > 0 ? Number(pagination.page) : fallbackPage;
	const limit = Number(pagination.limit) > 0 ? Number(pagination.limit) : fallbackLimit;

	return {
		items: Array.isArray(payload?.items) ? payload.items : [],
		pagination: {
			page,
			limit,
			hasMore: Boolean(pagination.hasMore)
		}
	};
}

function toLookupSearchParams({ query = '', id, limit = 20, page, params = {} } = {}) {
	const searchParams = new URLSearchParams();
	const trimmedQuery = String(query || '').trim();

	if (trimmedQuery) {
		searchParams.set('q', trimmedQuery);
	}

	const parsedId = Number(id);
	if (Number.isInteger(parsedId) && parsedId > 0) {
		searchParams.set('id', String(parsedId));
	}

	const parsedLimit = Number(limit);
	if (Number.isInteger(parsedLimit) && parsedLimit > 0) {
		searchParams.set('limit', String(parsedLimit));
	}

	const parsedPage = Number(page);
	if (Number.isInteger(parsedPage) && parsedPage > 0) {
		searchParams.set('page', String(parsedPage));
	}

	Object.entries(params || {}).forEach(([key, value]) => {
		if (value == null || value === '') return;
		searchParams.set(key, String(value));
	});

	return searchParams;
}

export async function fetchLookupOptionsPage(entity, options = {}) {
	const searchParams = toLookupSearchParams(options);
	const cacheKeyOptions = { entity, ...options };
	const cached = getLookupCache('optionsPage', cacheKeyOptions);
	if (cached) return cached;

	const inFlight = getLookupInFlight('optionsPage', entity, cacheKeyOptions);
	if (inFlight) return inFlight;

	const queryString = searchParams.toString();
	const url = `/api/lookups/${entity}${queryString ? `?${queryString}` : ''}`;
	const fetchPromise = (async () => {
		try {
			const response = await fetch(url, { cache: 'no-store' });
			if (!response.ok) {
				return {
					items: [],
					pagination: {
						page: Number(options?.page) > 0 ? Number(options.page) : 1,
						limit: Number(options?.limit) > 0 ? Number(options.limit) : 20,
						hasMore: false
					}
				};
			}
			const payload = await response.json().catch(() => ({}));
			const resolved = normalizeLookupPagePayload(payload, options);
			setLookupCache('optionsPage', cacheKeyOptions, resolved);
			return resolved;
		} catch {
			return {
				items: [],
				pagination: {
					page: Number(options?.page) > 0 ? Number(options.page) : 1,
					limit: Number(options?.limit) > 0 ? Number(options.limit) : 20,
					hasMore: false
				}
			};
		} finally {
			clearLookupInFlight('optionsPage', entity, cacheKeyOptions);
		}
	})();

	setLookupInFlight('optionsPage', entity, cacheKeyOptions, fetchPromise);
	return fetchPromise;
}

export async function fetchLookupOptions(entity, options = {}) {
	const cacheKeyOptions = { entity, ...options };
	const cached = getLookupCache('options', cacheKeyOptions);
	if (cached) return cached;

	const inFlight = getLookupInFlight('options', entity, cacheKeyOptions);
	if (inFlight) return inFlight;
	const fetchPromise = (async () => {
		try {
			const pageResult = await fetchLookupOptionsPage(entity, options);
			const resolved = Array.isArray(pageResult?.items) ? pageResult.items : [];
			setLookupCache('options', cacheKeyOptions, resolved);
			return resolved;
		} catch {
			return [];
		} finally {
			clearLookupInFlight('options', entity, cacheKeyOptions);
		}
	})();

	setLookupInFlight('options', entity, cacheKeyOptions, fetchPromise);
	return fetchPromise;
}

export async function fetchLookupOptionById(entity, id, options = {}) {
	const cacheKeyOptions = { entity, id, ...options };
	const cached = getLookupCache('optionById', cacheKeyOptions);
	if (cached) return cached;

	const inFlight = getLookupInFlight('optionById', entity, cacheKeyOptions);
	if (inFlight) return inFlight;

	const fetchPromise = (async () => {
		const rows = await fetchLookupOptions(entity, {
			...options,
			id,
			limit: 1
		});
		const resolved = rows.find((row) => String(row.value) === String(id)) || null;
		setLookupCache('optionById', cacheKeyOptions, resolved);
		return resolved;
	})();

	setLookupInFlight('optionById', entity, cacheKeyOptions, fetchPromise);
	try {
		return await fetchPromise;
	} finally {
		clearLookupInFlight('optionById', entity, cacheKeyOptions);
	}

}
