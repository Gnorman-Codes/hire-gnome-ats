import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submissionSchema } from '@/lib/validators';
import { AccessControlError, getActingUser } from '@/lib/access-control';
import { getCandidateJobOrderScope, validateScopedCandidateAndJobOrder } from '@/lib/related-record-scope';
import { logCreate } from '@/lib/audit-log';
import { formatCandidateStatusLabel, isCandidateEligibleForSubmission } from '@/lib/candidate-status';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { validateAndNormalizeCustomFieldValues } from '@/lib/custom-fields';

import { withApiLogging } from '@/lib/api-logging';
const submissionInclude = {
	candidate: true,
	jobOrder: {
		include: { client: true }
	},
	createdByUser: {
		select: { id: true, firstName: true, lastName: true, email: true, isActive: true }
	},
	offer: {
		select: { id: true, status: true, updatedAt: true }
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

async function getSubmissionsHandler(req) {
	try {
		const actingUser = await getActingUser(req);
		const submissions = await prisma.submission.findMany({
			where: getCandidateJobOrderScope(actingUser),
			include: submissionInclude,
			orderBy: { createdAt: 'desc' }
		});

		return NextResponse.json(submissions);
	} catch (error) {
		return handleError(error, 'Failed to load submissions.');
	}
}

async function postSubmissionsHandler(req) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'submissions.post');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const actingUser = await getActingUser(req, { allowFallback: false });
		const body = await parseJsonBody(req);
		const parsed = submissionSchema.safeParse(body);

		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}

		const scopedRelations = await validateScopedCandidateAndJobOrder({
			actingUser,
			candidateId: parsed.data.candidateId,
			jobOrderId: parsed.data.jobOrderId
		});
		if (!isCandidateEligibleForSubmission(scopedRelations.candidate.status)) {
			throw new AccessControlError(
				`Candidate must be In Review or beyond before submitting. Current status: ${formatCandidateStatusLabel(
					scopedRelations.candidate.status
				)}.`,
				400
			);
		}
		const customFieldValidation = await validateAndNormalizeCustomFieldValues({
			prisma,
			moduleKey: 'submissions',
			customFieldsInput: parsed.data.customFields
		});
		if (customFieldValidation.errors.length > 0) {
			return NextResponse.json(
				{ error: customFieldValidation.errors.join(' ') },
				{ status: 400 }
			);
		}

		const submission = await prisma.$transaction(async (tx) => {
			const aggregate = await tx.submission.aggregate({
				where: { jobOrderId: parsed.data.jobOrderId },
				_max: { submissionPriority: true }
			});
			const nextPriority = Number(aggregate._max.submissionPriority || 0) + 1;
			return tx.submission.create({
				data: {
					candidateId: parsed.data.candidateId,
					jobOrderId: parsed.data.jobOrderId,
					status: parsed.data.status,
					submissionPriority: nextPriority,
					isClientVisible: parsed.data.isClientVisible ?? true,
					notes: parsed.data.notes || null,
					customFields: customFieldValidation.customFields,
					createdByUserId: actingUser.id
				},
				include: submissionInclude
			});
		});
		await logCreate({
			actorUserId: actingUser?.id,
			entityType: 'SUBMISSION',
			entity: submission
		});

		return NextResponse.json(submission, { status: 201 });
	} catch (error) {
		return handleError(error, 'Failed to create submission.');
	}
}

export const GET = withApiLogging('submissions.get', getSubmissionsHandler);
export const POST = withApiLogging('submissions.post', postSubmissionsHandler);
