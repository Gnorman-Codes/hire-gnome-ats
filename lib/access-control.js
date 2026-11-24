import { prisma } from '@/lib/prisma';
import { ACTING_USER_COOKIE_NAME } from '@/lib/security-constants';
import { getAuthenticatedSession } from '@/lib/session-auth';

const NO_RESULTS_SCOPE = { id: -1 };

export class AccessControlError extends Error {
	constructor(message, status = 403) {
		super(message);
		this.name = 'AccessControlError';
		this.status = status;
	}
}

function toNullablePositiveInt(value) {
	if (value === '' || value == null) return null;
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0) return null;
	return number;
}

function isObjectEmpty(value) {
	return value && typeof value === 'object' && Object.keys(value).length === 0;
}

async function getUserById(id) {
	return prisma.user.findUnique({
		where: { id },
		include: {
			division: {
				select: {
					id: true,
					name: true,
					accessMode: true
				}
			}
		}
	});
}

function extractActingUserId(req) {
	const headerValue = req.headers.get('x-acting-user-id');
	const cookieValue = req.cookies.get(ACTING_USER_COOKIE_NAME)?.value;
	const queryValue = req.nextUrl.searchParams.get('actingUserId');
	return toNullablePositiveInt(headerValue || cookieValue || queryValue);
}

export async function getActingUser(req, { allowFallback = true } = {}) {
	const authenticatedUser = await getAuthenticatedUser(req, { allowFallback });
	if (!authenticatedUser) {
		return null;
	}

	if (authenticatedUser.role !== 'ADMINISTRATOR') {
		return authenticatedUser;
	}

	const requestedId = extractActingUserId(req);
	if (!requestedId || requestedId === authenticatedUser.id) {
		return authenticatedUser;
	}

	const requestedUser = await getUserById(requestedId);
	if (requestedUser?.isActive && !requestedUser.serviceKey) {
		return requestedUser;
	}

	return authenticatedUser;
}

export async function getAuthenticatedUser(req, { allowFallback = true } = {}) {
	const authenticatedSession = getAuthenticatedSession(req);
	if (!authenticatedSession?.userId) {
		return allowFallback ? null : null;
	}

	const authenticatedUser = await getUserById(authenticatedSession.userId);
	if (!authenticatedUser?.isActive || authenticatedUser.serviceKey) {
		return allowFallback ? null : null;
	}
	if ((authenticatedUser.sessionVersion || 1) !== (authenticatedSession.sessionVersion || 1)) {
		return allowFallback ? null : null;
	}

	return authenticatedUser;
}

export function getEntityScope(actingUser) {
	if (!actingUser) return NO_RESULTS_SCOPE;
	if (actingUser.role === 'ADMINISTRATOR') return {};
	if (!actingUser.divisionId || !actingUser.division) return NO_RESULTS_SCOPE;

	if (actingUser.role === 'DIRECTOR') {
		return { divisionId: actingUser.divisionId };
	}

	if (actingUser.division.accessMode === 'OWNER_ONLY') {
		return {
			divisionId: actingUser.divisionId,
			ownerId: actingUser.id
		};
	}

	return { divisionId: actingUser.divisionId };
}

export function addScopeToWhere(baseWhere, scopeWhere) {
	if (!scopeWhere || isObjectEmpty(scopeWhere)) {
		return baseWhere || undefined;
	}

	if (!baseWhere || isObjectEmpty(baseWhere)) {
		return scopeWhere;
	}

	return {
		AND: [scopeWhere, baseWhere]
	};
}

export async function ensureScopedEntityAccess(model, id, actingUser) {
	const scopeWhere = getEntityScope(actingUser);
	const record = await prisma[model].findFirst({
		where: addScopeToWhere({ id }, scopeWhere),
		select: { id: true }
	});

	if (!record) {
		throw new AccessControlError('Record not found or unavailable for your role.', 404);
	}
}

async function requireDivisionById(divisionId) {
	if (!divisionId) return null;

	const division = await prisma.division.findUnique({
		where: { id: divisionId },
		select: {
			id: true,
			name: true,
			accessMode: true
		}
	});

	if (!division) {
		throw new AccessControlError('Division not found.', 400);
	}

	return division;
}

async function requireOwnerById(ownerId) {
	if (!ownerId) return null;

	const ownerUser = await prisma.user.findUnique({
		where: { id: ownerId },
		select: {
			id: true,
			isActive: true,
			role: true,
			divisionId: true
		}
	});

	if (!ownerUser || !ownerUser.isActive) {
		throw new AccessControlError('Selected owner must be an active user.', 400);
	}

	return ownerUser;
}

export function getUserScope(actingUser) {
	if (!actingUser) {
		return NO_RESULTS_SCOPE;
	}

	if (actingUser.role === 'ADMINISTRATOR') {
		return {};
	}

	if (actingUser.role === 'DIRECTOR') {
		if (!actingUser.divisionId) {
			return NO_RESULTS_SCOPE;
		}
		return { divisionId: actingUser.divisionId };
	}

	return { id: actingUser.id };
}

export async function resolveOwnershipForWrite({ actingUser, ownerIdInput, divisionIdInput }) {
	if (!actingUser) {
		throw new AccessControlError('Select an active user before creating or editing records.', 403);
	}

	let ownerId = toNullablePositiveInt(ownerIdInput);
	let divisionId = toNullablePositiveInt(divisionIdInput);
	const ownerUser = await requireOwnerById(ownerId);

	if (actingUser.role !== 'ADMINISTRATOR') {
		if (!actingUser.divisionId || !actingUser.division) {
			throw new AccessControlError('Your user account is not assigned to a division.', 403);
		}

		if (divisionId && divisionId !== actingUser.divisionId) {
			throw new AccessControlError('You can only work within your own division.', 403);
		}

		if (ownerUser && ownerUser.divisionId !== actingUser.divisionId) {
			throw new AccessControlError('Owner must belong to your division.', 403);
		}

		if (actingUser.role === 'RECRUITER' && ownerId && ownerId !== actingUser.id) {
			throw new AccessControlError('Recruiters can only assign records to themselves.', 403);
		}

		divisionId = actingUser.divisionId;
	}

	if (!divisionId && ownerUser?.divisionId) {
		divisionId = ownerUser.divisionId;
	}

	if (!divisionId && actingUser.divisionId) {
		divisionId = actingUser.divisionId;
	}

	if (actingUser.role === 'ADMINISTRATOR' && !divisionId) {
		return {
			ownerId,
			divisionId: null
		};
	}

	const division = await requireDivisionById(divisionId);
	if (!division) {
		throw new AccessControlError(
			'Division is required. Assign an owner in a division or provide a division value.',
			400
		);
	}

	if (ownerUser && division && ownerUser.divisionId !== division.id) {
		throw new AccessControlError('Owner and division must match.', 400);
	}

	if (division?.accessMode === 'OWNER_ONLY') {
		if (!ownerId && actingUser.role === 'RECRUITER') {
			ownerId = actingUser.id;
		}

		if (!ownerId) {
			throw new AccessControlError('Owner is required when division access mode is Owner Only.', 400);
		}
	}

	return {
		ownerId,
		divisionId: division ? division.id : null
	};
}

export async function resolveDivisionForUserWrite({ actingUser, role, divisionIdInput }) {
	const divisionId = toNullablePositiveInt(divisionIdInput);
	const effectiveRole = role || 'RECRUITER';

	if (effectiveRole === 'ADMINISTRATOR') {
		if (!divisionId) {
			return { divisionId: null };
		}

		await requireDivisionById(divisionId);
		return { divisionId };
	}

	if (!divisionId) {
		throw new AccessControlError('Division is required for directors and recruiters.', 400);
	}

	await requireDivisionById(divisionId);

	if (!actingUser || actingUser.role === 'ADMINISTRATOR') {
		return { divisionId };
	}

	if (!actingUser.divisionId || actingUser.divisionId !== divisionId) {
		throw new AccessControlError('You can only assign users to your division.', 403);
	}

	return { divisionId };
}

export function canManageDivisions(actingUser) {
	if (!actingUser) return false;
	return actingUser.role === 'ADMINISTRATOR';
}

export async function hasAdministrator() {
	const adminCount = await prisma.user.count({
		where: { role: 'ADMINISTRATOR', serviceKey: null }
	});

	return adminCount > 0;
}
