import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AccessControlError } from '@/lib/access-control';
import { prisma } from '@/lib/prisma';
import { consumeRequestThrottle } from '@/lib/request-throttle';
import { ValidationError } from '@/lib/request-validation';
import {
	hashIntegrationApiToken, integrationApiTokenPattern, isEligibleIntegrationApiUser
} from './api-credential.mjs';

export function apiResponse(data, status = 200, headers = {}) {
	return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export class ApiError extends Error {
	constructor(status, code, message, headers = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.headers = headers;
	}
}

export async function authorizeApi(req) {
	const match = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') || '');
	if (!match || !integrationApiTokenPattern.test(match[1])) {
		throw new ApiError(401, 'invalid_token', 'Provide a valid Hire Gnome API token.', { 'WWW-Authenticate': 'Bearer' });
	}
	const credential = await prisma.integrationApiCredential.findUnique({
		where: { tokenHash: hashIntegrationApiToken(match[1]) },
		select: {
			recordId: true, revokedAt: true, role: true, divisionId: true, writesEnabled: true,
			user: {
				select: {
					id: true, role: true, isActive: true, serviceKey: true, divisionId: true, passwordChangeRequired: true,
					division: { select: { accessMode: true } }
				}
			}
		}
	});
	if (!credential || credential.revokedAt) {
		throw new ApiError(401, 'invalid_token', 'Provide a valid Hire Gnome API token.', { 'WWW-Authenticate': 'Bearer' });
	}
	const actor = credential.user;
	if (!isEligibleIntegrationApiUser(actor) || actor.role !== credential.role || actor.divisionId !== credential.divisionId) {
		throw new ApiError(403, 'credential_scope_changed', 'The API credential is no longer authorized for its assigned user and division.');
	}
	const write = !['GET', 'HEAD'].includes(req.method);
	if (write && !credential.writesEnabled) {
		throw new ApiError(403, 'read_only', 'This credential is read-only.');
	}
	const throttle = await consumeRequestThrottle({
		req, routeKey: write ? 'api.v1.write' : 'api.v1.read', scopeKey: credential.recordId,
		maxRequests: write ? 120 : 600, windowSeconds: 60
	});
	if (!throttle.allowed) {
		throw new ApiError(429, 'rate_limit', 'Request limit reached. Retry after the indicated interval.', {
			'Retry-After': String(throttle.retryAfterSeconds)
		});
	}
	return { actor, credentialId: credential.recordId };
}

export function apiEndpoint(handler) {
	return async (req, context) => {
		try {
			return await handler(req, await authorizeApi(req), await context?.params);
		} catch (error) {
			if (error instanceof ApiError) {
				return apiResponse({ error: { code: error.code, message: error.message } }, error.status, error.headers);
			}
			if (error instanceof ZodError) {
				const fields = error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
				return apiResponse({ error: { code: 'validation', message: 'Invalid request data.', fields } }, 400);
			}
			if (error instanceof ValidationError || error instanceof AccessControlError) {
				const code = { 403: 'forbidden', 404: 'not_found', 409: 'conflict' }[error.status] || 'validation';
				return apiResponse({ error: { code, message: error.message } }, error.status);
			}
			if (['P2002', 'P2034'].includes(error.code)) {
				return apiResponse({ error: { code: 'conflict', message: 'The write conflicted with another record or request.' } }, 409);
			}
			if (['P2003', 'P2025'].includes(error.code)) {
				return apiResponse({ error: { code: 'conflict', message: 'A related record is no longer available.' } }, 409);
			}
			return apiResponse({ error: { code: 'internal_error', message: 'Unable to complete the request.' } }, 500);
		}
	};
}
