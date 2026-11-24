import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
	AccessControlError,
	addScopeToWhere,
	canManageDivisions,
	getActingUser,
	getEntityScope,
	getUserScope
} from '@/lib/access-control';
import {
	LOOKUP_RATE_LIMIT_MAX_REQUESTS,
	LOOKUP_RATE_LIMIT_WINDOW_SECONDS
} from '@/lib/security-constants';
import { QUALIFIED_CANDIDATE_STATUSES, SUBMISSION_CANDIDATE_STATUSES } from '@/lib/candidate-status';
import { consumeRequestThrottle } from '@/lib/request-throttle';
import { logError, requestLogContext } from '@/lib/logger';

import { withApiLogging } from '@/lib/api-logging';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_QUERY_LENGTH = 120;
const DEFAULT_PAGE = 1;
const LOOKUP_MIN_QUERY_CHARS = {
	users: 2,
	clients: 2,
	contacts: 2,
	candidates: 2,
	'job-orders': 2
};

function getLookupMinQueryChars(entity) {
	return LOOKUP_MIN_QUERY_CHARS[entity] || 0;
}

function parsePositiveInt(value) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

function parseLimit(value) {
	const parsed = parsePositiveInt(value);
	if (!parsed) return DEFAULT_LIMIT;
	return Math.min(parsed, MAX_LIMIT);
}

function parsePage(value) {
	const parsed = parsePositiveInt(value);
	if (!parsed) return DEFAULT_PAGE;
	return parsed;
}

function parseBoolean(value) {
	if (value == null) return false;
	const normalized = String(value).trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseQuery(value) {
	return String(value || '').trim();
}

function toPageOffset(page, limit) {
	const normalizedPage = Math.max(DEFAULT_PAGE, page || DEFAULT_PAGE);
	const normalizedLimit = Math.max(1, limit || DEFAULT_LIMIT);
	return { skip: (normalizedPage - 1) * normalizedLimit, limit: normalizedLimit };
}

function buildContains(field, query) {
	return {
		[field]: {
			contains: query
		}
	};
}

function uniqueItems(items) {
	const seen = new Set();
	const result = [];

	for (const item of items) {
		if (!item || item.value == null) continue;
		const key = String(item.value);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(item);
	}

	return result;
}

function applyWindow(rows, limit) {
	const safeRows = Array.isArray(rows) ? rows : [];
	const safeLimit = Math.max(1, Number(limit) || DEFAULT_LIMIT);
	const hasMore = safeRows.length > safeLimit;
	return {
		rows: hasMore ? safeRows.slice(0, safeLimit) : safeRows,
		hasMore
	};
}

function isMissingLookupFieldError(error, fieldName) {
	if (!error || error.code !== 'P2022') return false;
	const message = `${error.message || ''}`;
	return fieldName ? message.includes(fieldName) : true;
}

async function lookupUsers({ actingUser, query, limit, skip = 0, selectedId, searchParams }) {
	const divisionId = parsePositiveInt(searchParams.get('divisionId'));
	const includeInactive = parseBoolean(searchParams.get('includeInactive'));
	const filters = [];
	if (!includeInactive) {
		filters.push({ isActive: true });
	}
	if (divisionId) {
		filters.push({ divisionId });
	}
	if (query) {
		filters.push({
			OR: [
				buildContains('firstName', query),
				buildContains('lastName', query),
				buildContains('email', query)
			]
		});
	}

	const baseWhere =
		filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { AND: filters };
	const scopeWhere = getUserScope(actingUser);
	const where = addScopeToWhere(baseWhere, scopeWhere);
	const rowsRaw = await prisma.user.findMany({
		where,
		orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
		skip,
		take: limit + 1,
		select: {
			id: true,
			firstName: true,
			lastName: true,
			email: true,
			divisionId: true,
			role: true,
			isActive: true
		}
	});
	const { rows, hasMore } = applyWindow(rowsRaw, limit);

	let selectedRow = null;
	if (selectedId) {
		selectedRow = await prisma.user.findFirst({
			where: addScopeToWhere({ id: selectedId }, scopeWhere),
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				divisionId: true,
				role: true,
				isActive: true
			}
		});
	}

	return {
		items: uniqueItems([
		selectedRow
			? {
					value: String(selectedRow.id),
					label: `${selectedRow.firstName} ${selectedRow.lastName}`,
					email: selectedRow.email,
					divisionId: selectedRow.divisionId,
					role: selectedRow.role,
					isActive: selectedRow.isActive
				}
			: null,
		...rows.map((row) => ({
			value: String(row.id),
			label: `${row.firstName} ${row.lastName}`,
			email: row.email,
			divisionId: row.divisionId,
			role: row.role,
			isActive: row.isActive
		}))
		]),
		hasMore
	};
}

async function lookupDivisions({ actingUser, query, limit, skip = 0, selectedId }) {
	const where = canManageDivisions(actingUser)
		? query
			? buildContains('name', query)
			: undefined
		: actingUser.divisionId
			? {
					AND: [{ id: actingUser.divisionId }, ...(query ? [buildContains('name', query)] : [])]
				}
			: { id: -1 };
	const rowsRaw = await prisma.division.findMany({
		where,
		orderBy: [{ name: 'asc' }],
		skip,
		take: limit + 1,
		select: { id: true, name: true, accessMode: true }
	});
	const { rows, hasMore } = applyWindow(rowsRaw, limit);

	let selectedRow = null;
	if (selectedId) {
		selectedRow = await prisma.division.findFirst({
			where: canManageDivisions(actingUser)
				? { id: selectedId }
				: actingUser.divisionId
					? { id: selectedId, AND: [{ id: actingUser.divisionId }] }
					: { id: -1 },
			select: { id: true, name: true, accessMode: true }
		});
	}

	return {
		items: uniqueItems([
		selectedRow
			? {
					value: String(selectedRow.id),
					label: selectedRow.name,
					accessMode: selectedRow.accessMode
				}
			: null,
		...rows.map((row) => ({
			value: String(row.id),
			label: row.name,
			accessMode: row.accessMode
		}))
		]),
		hasMore
	};
}

async function lookupClients({ actingUser, query, limit, skip = 0, selectedId, searchParams }) {
	const scopeWhere = getEntityScope(actingUser);
	const divisionId = parsePositiveInt(searchParams.get('divisionId'));
	const filters = [];
	if (divisionId) {
		filters.push({ divisionId });
	}
	if (query) {
		filters.push({
			OR: [
				buildContains('name', query),
				buildContains('industry', query),
				buildContains('city', query),
				buildContains('state', query),
				buildContains('zipCode', query)
			]
		});
	}

	const baseWhere =
		filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { AND: filters };
	const where = addScopeToWhere(baseWhere, scopeWhere);
	const rowsRaw = await prisma.client.findMany({
		where,
		orderBy: [{ name: 'asc' }],
		skip,
		take: limit + 1,
		select: {
			id: true,
			name: true,
			divisionId: true,
			ownerId: true,
			status: true
		}
	});
	const { rows, hasMore } = applyWindow(rowsRaw, limit);

	let selectedRow = null;
	if (selectedId) {
		selectedRow = await prisma.client.findFirst({
			where: addScopeToWhere({ id: selectedId }, scopeWhere),
			select: {
				id: true,
				name: true,
				divisionId: true,
				ownerId: true,
				status: true
			}
		});
	}

	return {
		items: uniqueItems([
		selectedRow
			? {
					value: String(selectedRow.id),
					label: selectedRow.name,
					divisionId: selectedRow.divisionId,
					ownerId: selectedRow.ownerId,
					status: selectedRow.status
				}
			: null,
		...rows.map((row) => ({
			value: String(row.id),
			label: row.name,
			divisionId: row.divisionId,
			ownerId: row.ownerId,
			status: row.status
		}))
		]),
		hasMore
	};
}

async function lookupContacts({ actingUser, query, limit, skip = 0, selectedId, searchParams }) {
	const scopeWhere = getEntityScope(actingUser);
	const clientId = parsePositiveInt(searchParams.get('clientId'));
	const divisionId = parsePositiveInt(searchParams.get('divisionId'));
	const filters = [];
	if (clientId) {
		filters.push({ clientId });
	}
	if (divisionId) {
		filters.push({ divisionId });
	}
	if (query) {
		filters.push({
			OR: [
				buildContains('firstName', query),
				buildContains('lastName', query),
				buildContains('email', query),
				buildContains('title', query)
			]
		});
	}

	const baseWhere =
		filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { AND: filters };
	const where = addScopeToWhere(baseWhere, scopeWhere);
	let rowsRaw;
	let selectedRow = null;
	let includeDivisionId = true;

	try {
		rowsRaw = await prisma.contact.findMany({
			where,
			orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
			skip,
			take: limit + 1,
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				clientId: true,
				divisionId: true
			}
		});
	} catch (error) {
		if (!isMissingLookupFieldError(error, 'divisionId')) throw error;
		includeDivisionId = false;
		const fallbackFilters = filters.filter((filter) => !Object.prototype.hasOwnProperty.call(filter || {}, 'divisionId'));
		const fallbackBaseWhere =
			fallbackFilters.length === 0
				? undefined
				: fallbackFilters.length === 1
					? fallbackFilters[0]
					: { AND: fallbackFilters };
		rowsRaw = await prisma.contact.findMany({
			where: addScopeToWhere(fallbackBaseWhere, scopeWhere),
			orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
			skip,
			take: limit + 1,
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				clientId: true
			}
		});
	}
	const { rows, hasMore } = applyWindow(rowsRaw, limit);

	if (selectedId) {
		try {
			selectedRow = await prisma.contact.findFirst({
				where: addScopeToWhere({ id: selectedId }, scopeWhere),
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					clientId: true,
					divisionId: true
				}
			});
		} catch (error) {
			if (!isMissingLookupFieldError(error, 'divisionId')) throw error;
			includeDivisionId = false;
			selectedRow = await prisma.contact.findFirst({
				where: addScopeToWhere({ id: selectedId }, scopeWhere),
				select: {
					id: true,
					firstName: true,
					lastName: true,
					email: true,
					clientId: true
				}
			});
		}
	}

	return {
		items: uniqueItems([
		selectedRow
			? {
					value: String(selectedRow.id),
					label: `${selectedRow.firstName} ${selectedRow.lastName}`,
					email: selectedRow.email,
					clientId: selectedRow.clientId,
					divisionId: includeDivisionId ? selectedRow.divisionId : null
				}
			: null,
		...rows.map((row) => ({
			value: String(row.id),
			label: `${row.firstName} ${row.lastName}`,
			email: row.email,
			clientId: row.clientId,
			divisionId: includeDivisionId ? row.divisionId : null
		}))
		]),
		hasMore
	};
}

async function lookupCandidates({ actingUser, query, limit, skip = 0, selectedId, searchParams }) {
	const scopeWhere = getEntityScope(actingUser);
	const divisionId = parsePositiveInt(searchParams.get('divisionId'));
	const qualifiedOnly = parseBoolean(searchParams.get('qualifiedOnly'));
	const submissionEligibleOnly = parseBoolean(searchParams.get('submissionEligibleOnly'));
	const excludeSubmittedJobOrderId = parsePositiveInt(searchParams.get('excludeSubmittedJobOrderId'));
	const filters = [];
	if (divisionId) {
		filters.push({ divisionId });
	}
	if (qualifiedOnly) {
		filters.push({ status: { in: QUALIFIED_CANDIDATE_STATUSES } });
	} else if (submissionEligibleOnly) {
		filters.push({ status: { in: SUBMISSION_CANDIDATE_STATUSES } });
	}
	if (excludeSubmittedJobOrderId) {
		filters.push({
			submissions: {
				none: {
					jobOrderId: excludeSubmittedJobOrderId
				}
			}
		});
	}
	if (query) {
		filters.push({
			OR: [
				buildContains('firstName', query),
				buildContains('lastName', query),
				buildContains('email', query),
				buildContains('currentJobTitle', query),
				buildContains('currentEmployer', query)
			]
		});
	}

	const baseWhere =
		filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { AND: filters };
	const where = addScopeToWhere(baseWhere, scopeWhere);
	const rowsRaw = await prisma.candidate.findMany({
		where,
		orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
		skip,
		take: limit + 1,
		select: {
			id: true,
			firstName: true,
			lastName: true,
			email: true,
			status: true,
			divisionId: true
		}
	});
	const { rows, hasMore } = applyWindow(rowsRaw, limit);

	let selectedRow = null;
	if (selectedId) {
		selectedRow = await prisma.candidate.findFirst({
			where: addScopeToWhere({ id: selectedId }, scopeWhere),
			select: {
				id: true,
				firstName: true,
				lastName: true,
				email: true,
				status: true,
				divisionId: true
			}
		});
	}

	return {
		items: uniqueItems([
		selectedRow
			? {
					value: String(selectedRow.id),
					label: `${selectedRow.firstName} ${selectedRow.lastName}`,
					email: selectedRow.email,
					status: selectedRow.status,
					divisionId: selectedRow.divisionId
				}
			: null,
		...rows.map((row) => ({
			value: String(row.id),
			label: `${row.firstName} ${row.lastName}`,
			email: row.email,
			status: row.status,
			divisionId: row.divisionId
		}))
		]),
		hasMore
	};
}

async function lookupJobOrders({ actingUser, query, limit, skip = 0, selectedId, searchParams }) {
	const scopeWhere = getEntityScope(actingUser);
	const divisionId = parsePositiveInt(searchParams.get('divisionId'));
	const activeOnly = parseBoolean(searchParams.get('activeOnly'));
	const filters = [];
	if (divisionId) {
		filters.push({ divisionId });
	}
	if (activeOnly) {
		filters.push({
			status: {
				in: ['open', 'active']
			}
		});
	}
	if (query) {
		filters.push({
			OR: [
				buildContains('title', query),
				buildContains('location', query),
				{
					client: {
						name: {
							contains: query
						}
					}
				}
			]
		});
	}

	const baseWhere =
		filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { AND: filters };
	const where = addScopeToWhere(baseWhere, scopeWhere);
	const rowsRaw = await prisma.jobOrder.findMany({
		where,
		orderBy: [{ title: 'asc' }],
		skip,
		take: limit + 1,
		select: {
			id: true,
			title: true,
			status: true,
			divisionId: true,
			client: {
				select: {
					id: true,
					name: true
				}
			}
		}
	});
	const { rows, hasMore } = applyWindow(rowsRaw, limit);

	let selectedRow = null;
	if (selectedId) {
		selectedRow = await prisma.jobOrder.findFirst({
			where: addScopeToWhere({ id: selectedId }, scopeWhere),
			select: {
				id: true,
				title: true,
				status: true,
				divisionId: true,
				client: {
					select: {
						id: true,
						name: true
					}
				}
			}
		});
	}

	return {
		items: uniqueItems([
		selectedRow
			? {
					value: String(selectedRow.id),
					label: selectedRow.title,
					status: selectedRow.status,
					divisionId: selectedRow.divisionId,
					clientId: selectedRow.client?.id ?? null,
					clientName: selectedRow.client?.name || ''
				}
			: null,
		...rows.map((row) => ({
			value: String(row.id),
			label: row.title,
			status: row.status,
			divisionId: row.divisionId,
			clientId: row.client?.id ?? null,
			clientName: row.client?.name || ''
		}))
		]),
		hasMore
	};
}

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function getLookups_entityHandler(req, { params }) {
	try {
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser) {
			throw new AccessControlError('Authentication required.', 401);
		}

		const { entity } = await params;
		const throttle = await consumeRequestThrottle({
			req,
			routeKey: `lookups.${String(entity || '').trim() || 'default'}`,
			maxRequests: LOOKUP_RATE_LIMIT_MAX_REQUESTS,
			windowSeconds: LOOKUP_RATE_LIMIT_WINDOW_SECONDS
		});
		if (!throttle.allowed) {
			return NextResponse.json(
				{ error: 'Too many lookup requests from this network. Please try again shortly.' },
				{
					status: 429,
					headers: {
						'Retry-After': String(throttle.retryAfterSeconds || 60)
					}
				}
			);
		}

		const query = parseQuery(req.nextUrl.searchParams.get('q'));
		if (query.length > MAX_QUERY_LENGTH) {
			return NextResponse.json({ error: 'Search query is too long.' }, { status: 400 });
		}
		const page = parsePage(req.nextUrl.searchParams.get('page'));
		const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
		const { skip } = toPageOffset(page, limit);
		const selectedId = parsePositiveInt(req.nextUrl.searchParams.get('id'));
		const minQueryChars = getLookupMinQueryChars(entity);

		if (query.length > 0 && !selectedId && minQueryChars > 0 && query.length < minQueryChars) {
			return NextResponse.json({ items: [] });
		}

		let items = [];
		let hasMore = false;

		if (entity === 'users') {
			const result = await lookupUsers({
				actingUser,
				query,
				limit,
				skip,
				selectedId,
				searchParams: req.nextUrl.searchParams
			});
			items = result.items;
			hasMore = result.hasMore;
		} else if (entity === 'divisions') {
			const result = await lookupDivisions({
				actingUser,
				query,
				limit,
				skip,
				selectedId
			});
			items = result.items;
			hasMore = result.hasMore;
		} else if (entity === 'clients') {
			const result = await lookupClients({
				actingUser,
				query,
				limit,
				skip,
				selectedId,
				searchParams: req.nextUrl.searchParams
			});
			items = result.items;
			hasMore = result.hasMore;
		} else if (entity === 'contacts') {
			const result = await lookupContacts({
				actingUser,
				query,
				limit,
				skip,
				selectedId,
				searchParams: req.nextUrl.searchParams
			});
			items = result.items;
			hasMore = result.hasMore;
		} else if (entity === 'candidates') {
			const result = await lookupCandidates({
				actingUser,
				query,
				limit,
				skip,
				selectedId,
				searchParams: req.nextUrl.searchParams
			});
			items = result.items;
			hasMore = result.hasMore;
		} else if (entity === 'job-orders') {
			const result = await lookupJobOrders({
				actingUser,
				query,
				limit,
				skip,
				selectedId,
				searchParams: req.nextUrl.searchParams
			});
			items = result.items;
			hasMore = result.hasMore;
		} else {
			return NextResponse.json({ error: 'Lookup entity not supported.' }, { status: 404 });
		}

		return NextResponse.json({
			items,
			pagination: {
				page,
				limit,
				hasMore
			}
		});
	} catch (error) {
		const response = handleError(error, 'Failed to load lookup options.');
		if (response.status >= 500) {
			logError('lookups.entity.failed', requestLogContext(req, { error }));
		}
		return response;
	}
}

export const GET = withApiLogging('lookups.entity.get', getLookups_entityHandler);
