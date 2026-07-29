import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { userSchema } from '@/lib/validators';
import { normalizeUserData } from '@/lib/normalizers';
import {
	AccessControlError,
	addScopeToWhere,
	getAuthenticatedUser,
	getActingUser,
	getUserScope,
	hasAdministrator,
	resolveDivisionForUserWrite
} from '@/lib/access-control';
import { logCreate } from '@/lib/audit-log';
import { syncBillingSeats } from '@/lib/billing-seats';
import { hashPassword, isAcceptablePassword } from '@/lib/password-auth';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';

import { withApiLogging } from '@/lib/api-logging';
const userSelect = {
	id: true,
	recordId: true,
	firstName: true,
	lastName: true,
	email: true,
	role: true,
	divisionId: true,
	isActive: true,
	createdAt: true,
	updatedAt: true,
	division: {
		select: {
			id: true,
			name: true,
			accessMode: true
		}
	},
	_count: {
		select: {
			ownedCandidates: true,
			ownedClients: true,
			ownedContacts: true,
			ownedJobOrders: true
		}
	}
};

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status || 400 });
	}

	if (error.code === 'P2002') {
		return NextResponse.json({ error: 'User email already exists.' }, { status: 409 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function getUsersHandler(req) {
	try {
		const hasAdmin = await hasAdministrator();
		const authenticatedUser = await getAuthenticatedUser(req, { allowFallback: false });
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!authenticatedUser || !actingUser) {
			throw new AccessControlError('Authentication required.', 401);
		}
		const activeParam = req.nextUrl.searchParams.get('active');
		const forSwitchParam = req.nextUrl.searchParams.get('forSwitch');
		const bypassScope =
			(forSwitchParam === 'true' || forSwitchParam === '1') &&
			authenticatedUser?.role === 'ADMINISTRATOR';
		const activeFilter =
			activeParam == null
				? undefined
				: { isActive: activeParam === 'true' || activeParam === '1' };
		const where = !hasAdmin || bypassScope
			? activeFilter
			: addScopeToWhere(activeFilter, getUserScope(actingUser));

		const users = await prisma.user.findMany({
			where,
			orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
			select: userSelect
		});

		return NextResponse.json(users);
	} catch (error) {
		return handleError(error, 'Failed to load users.');
	}
}

async function postUsersHandler(req) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'users.post');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const hasAdmin = await hasAdministrator();
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser) {
			throw new AccessControlError('Authentication required.', 401);
		}
		if (hasAdmin && actingUser?.role === 'RECRUITER') {
			throw new AccessControlError('Recruiters cannot create users.', 403);
		}

		const body = await parseJsonBody(req);
		const parsed = userSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}
		if (!isAcceptablePassword(parsed.data.password)) {
			return NextResponse.json({ error: 'Password is required and must be at least 8 characters.' }, { status: 400 });
		}

		if (hasAdmin && actingUser?.role === 'DIRECTOR' && parsed.data.role !== 'RECRUITER') {
			throw new AccessControlError('Directors can only create recruiter users.', 403);
		}

		const divisionAccess = await resolveDivisionForUserWrite({
			actingUser,
			role: parsed.data.role,
			divisionIdInput: parsed.data.divisionId
		});
		const passwordHash = await hashPassword(parsed.data.password);

		const user = await prisma.user.create({
			data: {
				...normalizeUserData(parsed.data),
				passwordHash,
				passwordChangeRequired: true,
				...divisionAccess
			},
			select: userSelect
		});
		await logCreate({
			actorUserId: actingUser?.id,
			entityType: 'USER',
			entity: user
		});
		await syncBillingSeats({
			triggeredByUserId: actingUser?.id || null,
			reason: 'user_created'
		}).catch(() => null);

		return NextResponse.json(user, { status: 201 });
	} catch (error) {
		return handleError(error, 'Failed to create user.');
	}
}

export const GET = withApiLogging('users.get', getUsersHandler);
export const POST = withApiLogging('users.post', postUsersHandler);
