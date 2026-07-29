import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { userSchema } from '@/lib/validators';
import { normalizeUserData } from '@/lib/normalizers';
import {
	AccessControlError,
	addScopeToWhere,
	getActingUser,
	getUserScope,
	hasAdministrator,
	resolveDivisionForUserWrite
} from '@/lib/access-control';
import { logUpdate } from '@/lib/audit-log';
import { syncBillingSeats } from '@/lib/billing-seats';
import { hashPassword } from '@/lib/password-auth';
import { parseRouteId, parseJsonBody, ValidationError } from '@/lib/request-validation';
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

	if (error.code === 'P2025') {
		return NextResponse.json({ error: 'User not found.' }, { status: 404 });
	}

	if (error.code === 'P2002') {
		return NextResponse.json({ error: 'User email already exists.' }, { status: 409 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function findScopedUser(id, actingUser, enforceScope = true) {
	if (!enforceScope) {
		return prisma.user.findUnique({
			where: { id },
			select: userSelect
		});
	}

	return prisma.user.findFirst({
		where: addScopeToWhere({ id }, getUserScope(actingUser)),
		select: userSelect
	});
}

async function getUsers_idHandler(req, { params }) {
	const awaitedParams = await params;
	const id = parseRouteId(awaitedParams);

	const hasAdmin = await hasAdministrator();
	const actingUser = await getActingUser(req, { allowFallback: false });
	if (!actingUser) {
		return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
	}
	const user = await findScopedUser(id, actingUser, hasAdmin);
	if (!user) {
		return NextResponse.json({ error: 'User not found.' }, { status: 404 });
	}

	return NextResponse.json(user);
}

async function patchUsers_idHandler(req, { params }) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'users.id.patch');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);

		const hasAdmin = await hasAdministrator();
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser) {
			throw new AccessControlError('Authentication required.', 401);
		}
		if (hasAdmin && actingUser?.role === 'RECRUITER') {
			throw new AccessControlError('Recruiters cannot edit users.', 403);
		}

		const existingUser = await findScopedUser(id, actingUser, hasAdmin);
		if (!existingUser) {
			return NextResponse.json({ error: 'User not found.' }, { status: 404 });
		}

		const body = await parseJsonBody(req);
		const parsed = userSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}

		if (hasAdmin && actingUser?.role === 'DIRECTOR') {
			if (existingUser.role === 'ADMINISTRATOR') {
				throw new AccessControlError('Directors cannot edit administrator users.', 403);
			}

			if (id !== actingUser.id && parsed.data.role !== 'RECRUITER') {
				throw new AccessControlError('Directors can only set recruiter role for other users.', 403);
			}

			if (id === actingUser.id && parsed.data.role === 'ADMINISTRATOR') {
				throw new AccessControlError('Directors cannot self-promote to administrator.', 403);
			}
		}

		const divisionAccess = await resolveDivisionForUserWrite({
			actingUser,
			role: parsed.data.role,
			divisionIdInput: parsed.data.divisionId
		});
		const nextPassword = String(parsed.data.password || '').trim();
		const passwordHash = nextPassword ? await hashPassword(nextPassword) : undefined;

		const user = await prisma.user.update({
			where: { id },
			data: {
				...normalizeUserData(parsed.data),
				...(passwordHash
					? {
						passwordHash,
						passwordChangeRequired: true,
						sessionVersion: {
							increment: 1
						}
					}
					: {}),
				...divisionAccess
			},
			select: userSelect
		});
		await logUpdate({
			actorUserId: actingUser?.id,
			entityType: 'USER',
			before: existingUser,
			after: user
		});
		if (Boolean(existingUser.isActive) !== Boolean(user.isActive)) {
			await syncBillingSeats({
				triggeredByUserId: actingUser?.id || null,
				reason: 'user_activation_changed'
			}).catch(() => null);
		}

		return NextResponse.json(user);
	} catch (error) {
		return handleError(error, 'Failed to update user.');
	}
}

export const GET = withApiLogging('users.id.get', getUsers_idHandler);
export const PATCH = withApiLogging('users.id.patch', patchUsers_idHandler);
