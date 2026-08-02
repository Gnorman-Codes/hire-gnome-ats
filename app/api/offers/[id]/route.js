import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { offerSchema } from '@/lib/validators';
import { normalizeOfferData } from '@/lib/normalizers';
import { AccessControlError, addScopeToWhere, getActingUser } from '@/lib/access-control';
import { getCandidateJobOrderScope, validateScopedCandidateAndJobOrder } from '@/lib/related-record-scope';
import { logUpdate } from '@/lib/audit-log';
import { parseRouteId, parseJsonBody, ValidationError } from '@/lib/request-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { validateAndNormalizeCustomFieldValues } from '@/lib/custom-fields';
import {
	buildDefaultPlacementCommissionSplits,
	getPlacementCommissionOwners
} from '@/lib/placement-commission';
import { toPlacementCommissionSplitCreateData } from '@/lib/placement-commission-server';

import { withApiLogging } from '@/lib/api-logging';
const placementUserSelect = { id: true, firstName: true, lastName: true };
const offerInclude = {
	candidate: {
		include: {
			ownerUser: { select: placementUserSelect }
		}
	},
	jobOrder: {
		include: {
			client: {
				include: {
					ownerUser: { select: placementUserSelect }
				}
			},
			contact: {
				include: {
					ownerUser: { select: placementUserSelect }
				}
			}
		}
	},
	submission: { select: { id: true, status: true, createdAt: true } },
	commissionSplits: {
		orderBy: [{ role: 'asc' }, { id: 'asc' }],
		include: { user: { select: placementUserSelect } }
	}
};

const ACCEPTED_PLACEMENT_MUTABLE_FIELDS = new Set([
	'commissionSplits'
]);

function toComparableValue(value) {
	if (value == null || value === '') return null;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function parsePlacementStartDate(value) {
	if (!value) return null;
	const raw = String(value).trim();
	if (!raw) return null;
	const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00`) : new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	return date;
}

function hasPlacementStarted(value) {
	const startDate = parsePlacementStartDate(value);
	if (!startDate) return false;
	return Date.now() >= startDate.getTime();
}

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status || 400 });
	}

	if (error.code === 'P2025') {
		return NextResponse.json({ error: 'Placement not found.' }, { status: 404 });
	}

	if (error.code === 'P2003') {
		return NextResponse.json({ error: 'Candidate or job order not found.' }, { status: 400 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function loadPlacementCommissionContext(candidateId, jobOrderId) {
	const [candidate, jobOrder] = await Promise.all([
		prisma.candidate.findUnique({
			where: { id: candidateId },
			select: { id: true, ownerId: true, ownerUser: { select: placementUserSelect } }
		}),
		prisma.jobOrder.findUnique({
			where: { id: jobOrderId },
			select: {
				id: true,
				client: {
					select: { id: true, ownerId: true, ownerUser: { select: placementUserSelect } }
				},
				contact: {
					select: { id: true, ownerId: true, ownerUser: { select: placementUserSelect } }
				}
			}
		})
	]);
	return { candidate, jobOrder };
}

function resolveCommissionSplits(inputSplits, ownerContext, fallbackSplits = []) {
	const nextSplits =
		Array.isArray(inputSplits) && inputSplits.length > 0
			? inputSplits
			: fallbackSplits.length > 0
				? fallbackSplits
				: buildDefaultPlacementCommissionSplits(getPlacementCommissionOwners(ownerContext));
	return toPlacementCommissionSplitCreateData(nextSplits);
}

async function getOffers_idHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req);
		const offer = await prisma.offer.findFirst({
			where: addScopeToWhere({ id }, getCandidateJobOrderScope(actingUser)),
			include: offerInclude
		});

		if (!offer) {
			return NextResponse.json({ error: 'Placement not found.' }, { status: 404 });
		}

		return NextResponse.json(offer);
	} catch (error) {
		return handleError(error, 'Failed to load placement.');
	}
}

async function patchOffers_idHandler(req, { params }) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'offers.id.patch');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req, { allowFallback: false });
			const existing = await prisma.offer.findFirst({
				where: addScopeToWhere({ id }, getCandidateJobOrderScope(actingUser)),
				select: {
					id: true,
					status: true,
					version: true,
					placementType: true,
					compensationType: true,
					currency: true,
					amount: true,
					payPeriod: true,
					regularRate: true,
					overtimeRate: true,
					dailyRate: true,
					annualSalary: true,
					hourlyRtBillRate: true,
					hourlyRtPayRate: true,
					hourlyOtBillRate: true,
					hourlyOtPayRate: true,
					dailyBillRate: true,
					dailyPayRate: true,
					yearlyCompensation: true,
					offeredOn: true,
					expectedJoinDate: true,
					endDate: true,
					withdrawnReason: true,
					notes: true,
					customFields: true,
					submissionId: true,
					candidateId: true,
					jobOrderId: true,
					createdAt: true,
					commissionSplits: {
						select: {
							recordId: true,
							userId: true,
							role: true,
							splitPercent: true,
							commissionPercent: true
						}
					}
				}
			});
		if (!existing) {
			return NextResponse.json({ error: 'Placement not found.' }, { status: 404 });
		}

		const body = await parseJsonBody(req);
		const parsed = offerSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}
		const existingStatus = String(existing.status || '').toLowerCase();
		const nextStatus = String(parsed.data.status || '').toLowerCase();
		const started = hasPlacementStarted(parsed.data.expectedJoinDate || existing.expectedJoinDate);
		if (nextStatus === 'withdrawn' && existingStatus !== 'withdrawn' && started) {
			return NextResponse.json(
				{ error: 'Placement has started. Use Cancel Placement instead of Withdraw Placement.' },
				{ status: 409 }
			);
		}
		if (nextStatus === 'declined' && existingStatus !== 'declined' && !started) {
			return NextResponse.json(
				{ error: 'Placement has not started. Use Withdraw Placement instead of Cancel Placement.' },
				{ status: 409 }
			);
		}

		if (
			parsed.data.candidateId !== existing.candidateId ||
			parsed.data.jobOrderId !== existing.jobOrderId
		) {
			return NextResponse.json(
				{ error: 'Candidate and Job Order cannot be changed after placement creation.' },
				{ status: 400 }
			);
		}

		await validateScopedCandidateAndJobOrder({
			actingUser,
			candidateId: parsed.data.candidateId,
			jobOrderId: parsed.data.jobOrderId
		});
		const existingCustomFields =
			existing?.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
				? existing.customFields
				: {};
		const incomingCustomFields =
			parsed.data.customFields &&
			typeof parsed.data.customFields === 'object' &&
			!Array.isArray(parsed.data.customFields)
				? parsed.data.customFields
				: {};
		const customFieldValidation = await validateAndNormalizeCustomFieldValues({
			prisma,
			moduleKey: 'placements',
			customFieldsInput: { ...existingCustomFields, ...incomingCustomFields }
		});
		if (customFieldValidation.errors.length > 0) {
			return NextResponse.json(
				{ error: customFieldValidation.errors.join(' ') },
				{ status: 400 }
			);
		}
		const nextData = normalizeOfferData({
			...parsed.data,
			customFields: customFieldValidation.customFields
		});
		const ownerContext = await loadPlacementCommissionContext(existing.candidateId, existing.jobOrderId);
		const commissionSplits = resolveCommissionSplits(
			parsed.data.commissionSplits,
			ownerContext,
			existing.commissionSplits
		);
		if (String(existing.status || '').toLowerCase() === 'accepted') {
			const changedCoreFields = Object.entries(nextData).filter(([key, value]) => {
				if (ACCEPTED_PLACEMENT_MUTABLE_FIELDS.has(key)) return false;
				return toComparableValue(existing[key]) !== toComparableValue(value);
			});
			if (changedCoreFields.length > 0) {
				return NextResponse.json(
					{ error: 'Accepted placements lock core placement details. Only commission tracking can be updated.' },
					{ status: 409 }
				);
			}
		}

		const offer = await prisma.offer.update({
			where: { id },
			data: {
				...nextData,
				commissionSplits: {
					deleteMany: {},
					create: commissionSplits
				}
			},
			include: offerInclude
		});
		await logUpdate({
			actorUserId: actingUser?.id,
			entityType: 'PLACEMENT',
			before: existing,
			after: offer
		});
		return NextResponse.json(offer);
	} catch (error) {
		return handleError(error, 'Failed to update placement.');
	}
}

export const GET = withApiLogging('offers.id.get', getOffers_idHandler);
export const PATCH = withApiLogging('offers.id.patch', patchOffers_idHandler);
