import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import {
	REQUEST_THROTTLE_GLOBAL_CLEANUP_INTERVAL_SECONDS,
	REQUEST_THROTTLE_GLOBAL_CLEANUP_SECONDS
} from '@/lib/security-constants';

function toPositiveInt(value, fallback) {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function getClientIp(req) {
	const forwarded = String(req?.headers?.get('x-forwarded-for') || '')
		.split(',')
		.map((value) => value.trim())
		.find(Boolean);
	const realIp = String(req?.headers?.get('x-real-ip') || '').trim();
	const cfIp = String(req?.headers?.get('cf-connecting-ip') || '').trim();
	const source = forwarded || realIp || cfIp || '';
	return source || 'unknown';
}

function hashIp(ipAddress) {
	const secret = String(process.env.RATE_LIMIT_SECRET || process.env.AUTH_SESSION_SECRET || 'ats-rate-limit-secret').trim();
	return crypto.createHash('sha256').update(`${secret}:${ipAddress}`).digest('hex');
}

let lastGlobalCleanupAtMs = 0;

function getNowMs() {
	return Date.now();
}

function getGlobalCleanupIntervalMs() {
	return Math.max(REQUEST_THROTTLE_GLOBAL_CLEANUP_INTERVAL_SECONDS * 1000, 60 * 1000);
}

function getGlobalCleanupThresholdMs(windowSeconds) {
	const requestWindow = Math.max(toPositiveInt(windowSeconds, 60), 60);
	const configured = Math.max(toPositiveInt(REQUEST_THROTTLE_GLOBAL_CLEANUP_SECONDS, 60 * 60), 60);
	const keepSeconds = Math.max(requestWindow * 4, configured);
	return getNowMs() - keepSeconds * 1000;
}

async function runGlobalThrottleCleanup(windowSeconds) {
	const nowMs = getNowMs();
	if (nowMs - lastGlobalCleanupAtMs < getGlobalCleanupIntervalMs()) {
		return;
	}

	try {
		await prisma.requestThrottleEvent.deleteMany({
			where: {
				createdAt: {
					lt: new Date(getGlobalCleanupThresholdMs(windowSeconds))
				}
			}
		});
	} catch {
		// Cleanup is best-effort to avoid impacting authentication and API flows.
	} finally {
		lastGlobalCleanupAtMs = nowMs;
	}
}

export async function consumeRequestThrottle({
	req,
	routeKey,
	maxRequests,
	windowSeconds,
	scopeKey
}) {
	const normalizedRouteKey = String(routeKey || '').trim().toLowerCase();
	if (!normalizedRouteKey) {
		return {
			allowed: true,
			retryAfterSeconds: 0
		};
	}

	const max = toPositiveInt(maxRequests, 1);
	const windowSizeSeconds = toPositiveInt(windowSeconds, 60);
	const now = new Date();
	const windowStart = new Date(now.getTime() - windowSizeSeconds * 1000);
	const staleThreshold = new Date(now.getTime() - Math.max(windowSizeSeconds * 4, 60 * 60) * 1000);
	const ipHash = hashIp(scopeKey || getClientIp(req));

	const result = await prisma.$transaction(async (tx) => {
		await runGlobalThrottleCleanup(windowSizeSeconds);

		await tx.requestThrottleEvent.deleteMany({
			where: {
				routeKey: normalizedRouteKey,
				createdAt: {
					lt: staleThreshold
				}
			}
		});

		const recentCount = await tx.requestThrottleEvent.count({
			where: {
				routeKey: normalizedRouteKey,
				ipHash,
				createdAt: {
					gte: windowStart
				}
			}
		});

		if (recentCount >= max) {
			const oldestRecent = await tx.requestThrottleEvent.findFirst({
				where: {
					routeKey: normalizedRouteKey,
					ipHash,
					createdAt: {
						gte: windowStart
					}
				},
				orderBy: {
					createdAt: 'asc'
				},
				select: {
					createdAt: true
				}
			});

			const retryAfterSeconds = oldestRecent?.createdAt
				? Math.max(1, Math.ceil((oldestRecent.createdAt.getTime() + windowSizeSeconds * 1000 - now.getTime()) / 1000))
				: windowSizeSeconds;

			return {
				allowed: false,
				retryAfterSeconds
			};
		}

		await tx.requestThrottleEvent.create({
			data: {
				routeKey: normalizedRouteKey,
				ipHash
			}
		});

		return {
			allowed: true,
			retryAfterSeconds: 0
		};
	});

	return result;
}
