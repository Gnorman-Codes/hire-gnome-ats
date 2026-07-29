import { NextResponse } from 'next/server';
import { getActingUser, getAuthenticatedUser } from '@/lib/access-control';
import { withApiLogging } from '@/lib/api-logging';
import { ACTING_USER_COOKIE_NAME } from '@/lib/security-constants';
import { clearSessionCookie } from '@/lib/session-auth';
function serializeUser(user) {
	if (!user) return null;
	return {
		id: user.id,
		firstName: user.firstName,
		lastName: user.lastName,
		email: user.email,
		role: user.role,
		passwordChangeRequired: Boolean(user.passwordChangeRequired),
		divisionId: user.divisionId,
		division: user.division
			? {
				id: user.division.id,
				name: user.division.name,
				accessMode: user.division.accessMode
			}
			: null
	};
}

async function getSession_acting_userHandler(req) {
	const authenticatedUser = await getAuthenticatedUser(req, { allowFallback: true });
	if (!authenticatedUser) {
		const response = NextResponse.json({ error: 'Session is invalid or expired.' }, { status: 401 });
		clearSessionCookie(response);
		response.cookies.set(ACTING_USER_COOKIE_NAME, '', {
			httpOnly: false,
			secure: process.env.NODE_ENV === 'production',
			sameSite: 'lax',
			path: '/',
			maxAge: 0
		});
		return response;
	}

	const actingUser = await getActingUser(req, { allowFallback: true });

	return NextResponse.json({
		user: serializeUser(actingUser || authenticatedUser),
		authenticatedUser: serializeUser(authenticatedUser),
		canImpersonate: authenticatedUser?.role === 'ADMINISTRATOR'
	});
}

export const GET = withApiLogging('session.acting_user.get', getSession_acting_userHandler);
