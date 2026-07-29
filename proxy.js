import { NextResponse } from 'next/server';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/security-constants';

const encoder = new TextEncoder();
const REQUEST_ID_HEADER = 'x-request-id';

function toBase64Url(bytes) {
	let binary = '';
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
	const base64 = String(value || '')
		.replace(/-/g, '+')
		.replace(/_/g, '/')
		.padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
	return atob(base64);
}

function safeParseTokenPayload(payloadSegment) {
	try {
		const decoded = fromBase64Url(payloadSegment);
		return JSON.parse(decoded);
	} catch {
		return null;
	}
}

function timingSafeEqualString(a, b) {
	const left = String(a || '');
	const right = String(b || '');
	if (left.length !== right.length) return false;

	let diff = 0;
	for (let index = 0; index < left.length; index += 1) {
		diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}
	return diff === 0;
}

async function verifySessionToken(token) {
	const rawToken = String(token || '').trim();
	if (!rawToken) return null;

	const parts = rawToken.split('.');
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	const payloadSegment = parts[0];
	const signatureSegment = parts[1];
	const payload = safeParseTokenPayload(payloadSegment);
	if (!payload || payload.v !== 'v1') return null;

	const userId = Number(payload.uid);
	const expiresAtEpochSeconds = Number(payload.exp);
	const nowEpochSeconds = Math.floor(Date.now() / 1000);
	if (!Number.isInteger(userId) || userId <= 0) return null;
	if (!Number.isInteger(expiresAtEpochSeconds) || expiresAtEpochSeconds <= nowEpochSeconds) return null;

	const sessionSecret = process.env.AUTH_SESSION_SECRET || 'dev-auth-session-secret-change-me';
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(sessionSecret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signatureBytes = new Uint8Array(
		await crypto.subtle.sign('HMAC', key, encoder.encode(payloadSegment))
	);
	const expectedSignatureSegment = toBase64Url(signatureBytes);
	if (!timingSafeEqualString(signatureSegment, expectedSignatureSegment)) return null;
	return {
		passwordChangeRequired: Boolean(payload.pc)
	};
}

function isStaticAsset(pathname) {
	if (pathname.startsWith('/_next/')) return true;
	if (pathname === '/favicon.ico') return true;
	if (pathname === '/robots.txt') return true;
	if (pathname === '/sitemap.xml') return true;
	return /\.[a-zA-Z0-9]+$/.test(pathname);
}

function isPublicPagePath(pathname) {
	return (
		pathname === '/login' ||
		pathname === '/setup' ||
		pathname === '/forgot-password' ||
		pathname === '/reset-password' ||
		pathname.startsWith('/client-review/') ||
		pathname.startsWith('/careers')
	);
}

function isPublicApiPath(pathname) {
	return (
		pathname === '/api/onboarding/status' ||
		pathname === '/api/onboarding/setup' ||
		pathname === '/api/health' ||
		pathname === '/api/inbound/postmark' ||
		pathname.startsWith('/api/client-review/') ||
		pathname === '/api/session/login' ||
		pathname === '/api/session/logout' ||
		pathname === '/api/session/acting-user' ||
		pathname === '/api/session/forgot-password' ||
		pathname === '/api/session/reset-password' ||
		pathname === '/api/system-settings' ||
		pathname === '/api/system-settings/logo' ||
		pathname.startsWith('/api/careers/')
	);
}

function createRequestId() {
	try {
		return crypto.randomUUID();
	} catch {
		const random = Math.random().toString(36).slice(2, 10);
		return `req_${Date.now().toString(36)}_${random}`;
	}
}

function resolveRequestId(req) {
	const incoming = String(req.headers.get(REQUEST_ID_HEADER) || '').trim();
	return incoming || createRequestId();
}

function buildForwardHeaders(req, requestId) {
	const headers = new Headers(req.headers);
	headers.set(REQUEST_ID_HEADER, requestId);
	return headers;
}

function withResponseRequestId(response, requestId) {
	response.headers.set(REQUEST_ID_HEADER, requestId);
	return response;
}

function nextWithRequestId(forwardHeaders, requestId) {
	return withResponseRequestId(
		NextResponse.next({
			request: {
				headers: forwardHeaders
			}
		}),
		requestId
	);
}

function jsonWithRequestId(body, init, requestId) {
	return withResponseRequestId(NextResponse.json(body, init), requestId);
}

function redirectWithRequestId(url, requestId) {
	return withResponseRequestId(NextResponse.redirect(url), requestId);
}

export async function proxy(req) {
	const { pathname, search } = req.nextUrl;
	if (isStaticAsset(pathname)) {
		return NextResponse.next();
	}

	const requestId = resolveRequestId(req);
	const forwardHeaders = buildForwardHeaders(req, requestId);

	const token = req.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value || '';
	const authenticatedSession = await verifySessionToken(token);
	const isAuthenticated = Boolean(authenticatedSession);
	const passwordChangeRequired = Boolean(authenticatedSession?.passwordChangeRequired);

	if (pathname.startsWith('/api/')) {
		if (isPublicApiPath(pathname)) {
			return nextWithRequestId(forwardHeaders, requestId);
		}
		if (!isAuthenticated) {
			return jsonWithRequestId({ error: 'Authentication required.' }, { status: 401 }, requestId);
		}
		if (
			passwordChangeRequired
			&& pathname !== '/api/session/change-password'
			&& pathname !== '/api/session/logout'
		) {
			return jsonWithRequestId(
				{
					error: 'You must change your temporary password before continuing.',
					code: 'PASSWORD_CHANGE_REQUIRED'
				},
				{ status: 403 },
				requestId
			);
		}
		return nextWithRequestId(forwardHeaders, requestId);
	}

	if (pathname === '/login') {
		if (isAuthenticated) {
			return redirectWithRequestId(
				new URL(passwordChangeRequired ? '/account/password' : '/', req.url),
				requestId
			);
		}
		return nextWithRequestId(forwardHeaders, requestId);
	}

	if (isPublicPagePath(pathname)) {
		return nextWithRequestId(forwardHeaders, requestId);
	}

	if (!isAuthenticated) {
		const loginUrl = new URL('/login', req.url);
		const nextValue = `${pathname}${search || ''}`;
		if (nextValue && nextValue !== '/login') {
			loginUrl.searchParams.set('next', nextValue);
		}
		return redirectWithRequestId(loginUrl, requestId);
	}

	if (passwordChangeRequired && pathname !== '/account/password') {
		return redirectWithRequestId(new URL('/account/password', req.url), requestId);
	}

	return nextWithRequestId(forwardHeaders, requestId);
}

export const config = {
	matcher: '/:path*'
};
