import crypto from 'node:crypto';
import {
	AUTH_SESSION_COOKIE_NAME,
	AUTH_SESSION_MAX_AGE_SECONDS
} from '@/lib/security-constants';

const SESSION_TOKEN_VERSION = 'v1';

function getSessionSecret() {
	return process.env.AUTH_SESSION_SECRET || 'dev-auth-session-secret-change-me';
}

function toNullablePositiveInt(value) {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

function signPayload(payloadBase64Url) {
	return crypto.createHmac('sha256', getSessionSecret()).update(payloadBase64Url).digest('base64url');
}

function parseSessionToken(token) {
	const rawToken = String(token || '').trim();
	if (!rawToken) return null;

	const parts = rawToken.split('.');
	if (parts.length !== 2) return null;
	const payloadBase64Url = parts[0];
	const signatureBase64Url = parts[1];
	if (!payloadBase64Url || !signatureBase64Url) return null;

	const expectedSignature = signPayload(payloadBase64Url);
	const providedSignature = Buffer.from(signatureBase64Url, 'utf8');
	const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

	if (providedSignature.length !== expectedSignatureBuffer.length) {
		return null;
	}
	if (!crypto.timingSafeEqual(providedSignature, expectedSignatureBuffer)) {
		return null;
	}

	let payload;
	try {
		payload = JSON.parse(Buffer.from(payloadBase64Url, 'base64url').toString('utf8'));
	} catch {
		return null;
	}

	if (!payload || payload.v !== SESSION_TOKEN_VERSION) {
		return null;
	}

	const nowEpochSeconds = Math.floor(Date.now() / 1000);
	const userId = toNullablePositiveInt(payload.uid);
	const expiresAtEpochSeconds = toNullablePositiveInt(payload.exp);
	const sessionVersion = toNullablePositiveInt(payload.sv) || 1;
	if (!userId || !expiresAtEpochSeconds || expiresAtEpochSeconds <= nowEpochSeconds) {
		return null;
	}

	return {
		userId,
		sessionVersion,
		passwordChangeRequired: Boolean(payload.pc),
		issuedAtEpochSeconds: toNullablePositiveInt(payload.iat),
		expiresAtEpochSeconds
	};
}

function cookieOptions(maxAgeSeconds = AUTH_SESSION_MAX_AGE_SECONDS) {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: maxAgeSeconds
	};
}

export function createSessionToken({
	userId,
	sessionVersion = 1,
	passwordChangeRequired = false,
	maxAgeSeconds = AUTH_SESSION_MAX_AGE_SECONDS
}) {
	const normalizedUserId = toNullablePositiveInt(userId);
	const normalizedSessionVersion = toNullablePositiveInt(sessionVersion) || 1;
	if (!normalizedUserId) {
		throw new Error('Cannot create session token without a valid user id.');
	}

	const nowEpochSeconds = Math.floor(Date.now() / 1000);
	const payload = {
		v: SESSION_TOKEN_VERSION,
		uid: normalizedUserId,
		sv: normalizedSessionVersion,
		pc: Boolean(passwordChangeRequired),
		iat: nowEpochSeconds,
		exp: nowEpochSeconds + maxAgeSeconds
	};
	const payloadBase64Url = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
	const signatureBase64Url = signPayload(payloadBase64Url);
	return `${payloadBase64Url}.${signatureBase64Url}`;
}

export function verifySessionToken(token) {
	return parseSessionToken(token);
}

export function getSessionTokenFromRequest(req) {
	return req.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value || '';
}

export function getAuthenticatedSession(req) {
	const token = getSessionTokenFromRequest(req);
	return parseSessionToken(token);
}

export function getAuthenticatedUserId(req) {
	return getAuthenticatedSession(req)?.userId || null;
}

export function applySessionCookie(response, token, maxAgeSeconds = AUTH_SESSION_MAX_AGE_SECONDS) {
	response.cookies.set(AUTH_SESSION_COOKIE_NAME, token, cookieOptions(maxAgeSeconds));
}

export function clearSessionCookie(response) {
	response.cookies.set(AUTH_SESSION_COOKIE_NAME, '', cookieOptions(0));
}
