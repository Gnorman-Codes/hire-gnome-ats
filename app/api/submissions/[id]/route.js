import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submissionSchema } from '@/lib/validators';
import { AccessControlError, addScopeToWhere, getActingUser } from '@/lib/access-control';
import { getCandidateJobOrderScope, validateScopedCandidateAndJobOrder } from '@/lib/related-record-scope';
import { writeAuditLog } from '@/lib/audit-log';
import { parseRouteId, parseJsonBody, ValidationError } from '@/lib/request-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { validateAndNormalizeCustomFieldValues } from '@/lib/custom-fields';
import { submissionCommunicationSelect } from '@/lib/submission-communications';

import { withApiLogging } from '@/lib/api-logging';
const submissionInclude = {
	candidate: {
		include: {
			candidateSkills: {
				include: {
					skill: {
						select: { id: true, name: true, category: true, isActive: true }
					}
				},
				orderBy: { createdAt: 'asc' }
			},
			candidateWorkExperiences: {
				orderBy: [{ endDate: 'desc' }, { startDate: 'desc' }, { createdAt: 'desc' }]
			}
		}
	},
	jobOrder: {
		include: {
			client: true,
			contact: true
		}
	},
	createdByUser: {
		select: { id: true, firstName: true, lastName: true, email: true, isActive: true }
	},
	aiWriteUpGeneratedByUser: {
		select: { id: true, firstName: true, lastName: true, email: true, isActive: true }
	},
	offer: {
		select: { id: true, status: true, placementType: true, createdAt: true, updatedAt: true }
	},
	communications: {
		orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
		select: submissionCommunicationSelect
	},
	clientFeedback: {
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			recordId: true,
			actionType: true,
			comment: true,
			communicationScore: true,
			technicalFitScore: true,
			cultureFitScore: true,
			overallRecommendationScore: true,
			statusApplied: true,
			clientNameSnapshot: true,
			clientEmailSnapshot: true,
			createdAt: true
		}
	}
};

async function withSubmissionHistory(submission) {
	const [updates, interviews] = await Promise.all([
		prisma.auditLog.findMany({
			where: { entityType: 'SUBMISSION', entityId: submission.id, action: 'UPDATE' },
			select: {
				id: true, beforeData: true, afterData: true, createdAt: true,
				actorUser: { select: { firstName: true, lastName: true } }
			}
		}),
		prisma.interview.findMany({
			where: { candidateId: submission.candidateId, jobOrderId: submission.jobOrderId },
			select: { id: true, status: true, subject: true, startsAt: true, createdAt: true }
		})
	]);
	const statusChanges = updates.flatMap(({ id, beforeData, afterData, createdAt, actorUser }) => {
		const fromStatus = beforeData?.status;
		const toStatus = afterData?.status;
		if (typeof fromStatus !== 'string' || typeof toStatus !== 'string' || fromStatus === toStatus) return [];
		return [{ id, fromStatus, toStatus, createdAt, actorUser }];
	});
	return { ...submission, statusChanges, interviews };
}

function toNullablePositiveInt(value) {
	if (value === '' || value == null) return null;
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0) return null;
	return number;
}

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status || 400 });
	}

	if (error.code === 'P2025') {
		return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
	}

	if (error.code === 'P2002') {
		return NextResponse.json(
			{ error: 'This candidate is already submitted to this job order.' },
			{ status: 409 }
		);
	}

	if (error.code === 'P2003') {
		return NextResponse.json({ error: 'Candidate or job order not found.' }, { status: 400 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function getSubmissions_idHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req);
		const submission = await prisma.submission.findFirst({
			where: addScopeToWhere({ id }, getCandidateJobOrderScope(actingUser)),
			include: submissionInclude
		});

		if (!submission) {
			return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
		}

		return NextResponse.json(await withSubmissionHistory(submission));
	} catch (error) {
		return handleError(error, 'Failed to load submission.');
	}
}

async function patchSubmissions_idHandler(req, { params }) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'submissions.id.patch');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const awaitedParams = await params;
		const id = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req, { allowFallback: false });
		const existing = await prisma.submission.findFirst({
			where: addScopeToWhere({ id }, getCandidateJobOrderScope(actingUser)),
			select: {
				id: true,
				status: true,
				isClientVisible: true,
				notes: true,
				aiWriteUp: true,
				aiWriteUpGeneratedAt: true,
				aiWriteUpGeneratedByUserId: true,
				aiWriteUpModelName: true,
				customFields: true,
				candidateId: true,
				jobOrderId: true,
				createdByUserId: true,
				createdAt: true,
				offer: {
					select: {
						id: true
					}
				}
			}
		});
		if (!existing) {
			return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
		}
		if (existing.offer?.id) {
			return NextResponse.json(
				{ error: 'Submission is locked after conversion to placement.' },
				{ status: 409 }
			);
		}

		const body = await parseJsonBody(req);
		const attemptedCandidateId = toNullablePositiveInt(body.candidateId);
		const attemptedJobOrderId = toNullablePositiveInt(body.jobOrderId);
		const attemptedAssignmentChange =
			(attemptedCandidateId != null && attemptedCandidateId !== existing.candidateId) ||
			(attemptedJobOrderId != null && attemptedJobOrderId !== existing.jobOrderId);
		if (attemptedAssignmentChange) {
			return NextResponse.json(
				{ error: 'Candidate and Job Order cannot be changed after submission is created.' },
				{ status: 400 }
			);
		}

		const parsed = submissionSchema.safeParse({
			...body,
			candidateId: existing.candidateId,
			jobOrderId: existing.jobOrderId
		});
		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}

		await validateScopedCandidateAndJobOrder({
			actingUser,
			candidateId: existing.candidateId,
			jobOrderId: existing.jobOrderId
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
			moduleKey: 'submissions',
			customFieldsInput: { ...existingCustomFields, ...incomingCustomFields }
		});
		if (customFieldValidation.errors.length > 0) {
			return NextResponse.json(
				{ error: customFieldValidation.errors.join(' ') },
				{ status: 400 }
			);
		}

		const submission = await prisma.$transaction(async (tx) => {
			const updated = await tx.submission.update({
				where: { id, status: existing.status },
				data: {
					candidateId: existing.candidateId,
					jobOrderId: existing.jobOrderId,
					status: parsed.data.status,
					isClientVisible:
						typeof parsed.data.isClientVisible === 'boolean'
							? parsed.data.isClientVisible
							: existing.isClientVisible,
					notes: parsed.data.notes || null,
					aiWriteUp: parsed.data.aiWriteUp || null,
					customFields: customFieldValidation.customFields
				},
				include: submissionInclude
			});
			await writeAuditLog({
				actorUserId: actingUser?.id,
				action: 'UPDATE',
				entityType: 'SUBMISSION',
				entityId: id,
				before: existing,
				after: updated
			}, tx);
			return updated;
		});

		return NextResponse.json(await withSubmissionHistory(submission));
	} catch (error) {
		return handleError(error, 'Failed to update submission.');
	}
}

export const GET = withApiLogging('submissions.id.get', getSubmissions_idHandler);
export const PATCH = withApiLogging('submissions.id.patch', patchSubmissions_idHandler);
