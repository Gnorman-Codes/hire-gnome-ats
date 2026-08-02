import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AccessControlError, addScopeToWhere, getActingUser } from '@/lib/access-control';
import { getCandidateJobOrderScope } from '@/lib/related-record-scope';
import { logCreate, logUpdate } from '@/lib/audit-log';
import { parseRouteId, ValidationError } from '@/lib/request-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
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
	submission: {
		select: {
			id: true,
			status: true,
			createdAt: true
		}
	},
	commissionSplits: {
		orderBy: [{ role: 'asc' }, { id: 'asc' }],
		include: { user: { select: placementUserSelect } }
	}
};

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status || 400 });
	}

	if (error.code === 'P2003') {
		return NextResponse.json({ error: 'Candidate or job order not found.' }, { status: 400 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function getSubmissionScopeWhere(id, actingUser) {
	return addScopeToWhere({ id }, getCandidateJobOrderScope(actingUser));
}

async function findScopedSubmission(id, actingUser) {
	return prisma.submission.findFirst({
		where: getSubmissionScopeWhere(id, actingUser),
		select: {
			id: true,
			status: true,
			notes: true,
			candidateId: true,
			jobOrderId: true,
			jobOrder: {
				select: {
					employmentType: true,
					client: {
						select: {
							id: true,
							ownerId: true,
							ownerUser: { select: placementUserSelect }
						}
					},
					contact: {
						select: {
							id: true,
							ownerId: true,
							ownerUser: { select: placementUserSelect }
						}
					}
				}
			},
			candidate: {
				select: {
					id: true,
					ownerId: true,
					ownerUser: { select: placementUserSelect }
				}
			},
			offer: {
				select: {
					id: true
				}
			}
		}
	});
}

async function findScopedOfferBySubmission(id, actingUser) {
	return prisma.offer.findFirst({
		where: addScopeToWhere({ submissionId: id }, getCandidateJobOrderScope(actingUser)),
		include: offerInclude
	});
}

async function postSubmissions_id_convert_to_offerHandler(req, { params }) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'submissions.id.convert_to_offer.post');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req, { allowFallback: false });
		const submission = await findScopedSubmission(id, actingUser);

		if (!submission) {
			return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
		}

		if (submission.offer?.id) {
			const existingOffer = await findScopedOfferBySubmission(id, actingUser);
			if (existingOffer) {
				return NextResponse.json({ converted: false, offer: existingOffer, placement: existingOffer });
			}
		}

		const trimmedSubmissionNotes = submission.notes?.trim() || '';
		const conversionNotes = trimmedSubmissionNotes
			? `Converted from submission #${submission.id}.\n\nSubmission notes:\n${trimmedSubmissionNotes}`
			: `Converted from submission #${submission.id}.`;
		const employmentTypeValue = String(submission.jobOrder?.employmentType || '').toLowerCase();
		const inferredPlacementType = employmentTypeValue.includes('permanent') ? 'perm' : 'temp';
		const inferredCompensationType = inferredPlacementType === 'perm' ? 'salary' : 'hourly';
		const commissionSplits = toPlacementCommissionSplitCreateData(
			buildDefaultPlacementCommissionSplits(
				getPlacementCommissionOwners({
					candidate: submission.candidate,
					jobOrder: submission.jobOrder
				})
			)
		);

		let createdOffer;
			try {
				createdOffer = await prisma.offer.create({
				data: {
					candidateId: submission.candidateId,
					jobOrderId: submission.jobOrderId,
					status: 'planned',
					placementType: inferredPlacementType,
					compensationType: inferredCompensationType,
					offeredOn: new Date(),
					expectedJoinDate: new Date(),
					notes: conversionNotes,
					submissionId: submission.id,
					commissionSplits: commissionSplits.length
						? {
								create: commissionSplits
							}
						: undefined
				},
				include: offerInclude
				});
				await logCreate({
					actorUserId: actingUser?.id,
					entityType: 'PLACEMENT',
					entity: createdOffer,
					metadata: { source: 'submission-conversion', submissionId: submission.id }
				});
			} catch (error) {
			if (error.code === 'P2002') {
				const existingOffer = await findScopedOfferBySubmission(id, actingUser);
				if (existingOffer) {
					return NextResponse.json({ converted: false, offer: existingOffer, placement: existingOffer });
				}
			}
			throw error;
		}

			if (submission.status !== 'placed') {
				const updatedSubmission = await prisma.submission.update({
					where: { id: submission.id },
					data: { status: 'placed' }
				});
				await logUpdate({
					actorUserId: actingUser?.id,
					entityType: 'SUBMISSION',
					before: submission,
					after: updatedSubmission,
					metadata: { source: 'placement-conversion', placementId: createdOffer.id }
				});
			}

		return NextResponse.json({ converted: true, offer: createdOffer, placement: createdOffer }, { status: 201 });
	} catch (error) {
		return handleError(error, 'Failed to convert submission to placement.');
	}
}

export const POST = withApiLogging('submissions.id.convert_to_offer.post', postSubmissions_id_convert_to_offerHandler);
