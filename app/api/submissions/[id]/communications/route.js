import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccessControlError, addScopeToWhere, getActingUser } from '@/lib/access-control';
import { withApiLogging } from '@/lib/api-logging';
import { DEMO_MODE } from '@/lib/demo-config';
import { sendEmailMessage } from '@/lib/email-delivery';
import { isValidEmailAddress } from '@/lib/email-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { prisma } from '@/lib/prisma';
import { getCandidateJobOrderScope } from '@/lib/related-record-scope';
import { parseJsonBody, parseRouteId, ValidationError } from '@/lib/request-validation';
import { submissionCommunicationSelect } from '@/lib/submission-communications';
import { getDemoSubmissionSinkDirectory, captureDemoSubmissionEmail } from '@/lib/demo-submission-mail';
import { getIntegrationSettings } from '@/lib/system-settings';

const requestId = z.string().regex(/^[a-f0-9]{32}$/);
const messageBody = z.string().trim().min(1).max(12_000);
const email = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
const communicationSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('email'),
		requestId,
		contactId: z.number().int().positive(),
		recipientEmail: email,
		replyTo: email,
		testMode: z.boolean(),
		subject: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value), 'Use a single-line subject.'),
		body: messageBody
	}),
	z.object({
		kind: z.literal('feedback'),
		requestId,
		contactName: z.string().trim().max(191),
		body: messageBody
	})
]);

function displayName(person) {
	return [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim().slice(0, 191);
}

function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

async function loadScope(req, id) {
	const actingUser = await getActingUser(req, { allowFallback: false });
	if (!actingUser) throw new AccessControlError('Authentication required.', 401);
	const submission = await prisma.submission.findFirst({
		where: addScopeToWhere({ id }, getCandidateJobOrderScope(actingUser)),
		select: {
			id: true,
			candidate: { select: { firstName: true, lastName: true } },
			jobOrder: {
				select: {
					title: true,
					clientId: true,
					contact: { select: { id: true, clientId: true, firstName: true, lastName: true, email: true } }
				}
			}
		}
	});
	if (!submission) throw new AccessControlError('Submission not found.', 404);
	const archived = await prisma.archivedEntity.findUnique({
		where: { entityType_entityId: { entityType: 'SUBMISSION', entityId: id } },
		select: { id: true }
	});
	if (archived) throw new AccessControlError('Restore this submission before adding communications.', 409);
	return { submission, actingUser };
}

async function getEmailReview(submission, actingUser) {
	const contact = submission.jobOrder.contact;
	const recipientEmail = normalizeEmail(contact?.email);
	const replyTo = normalizeEmail(actingUser.email);
	const config = DEMO_MODE ? null : await getIntegrationSettings();
	const testMode = DEMO_MODE || config.emailTestMode === true;
	let unavailable = '';
	if (!contact || contact.clientId !== submission.jobOrder.clientId || !isValidEmailAddress(recipientEmail)) {
		unavailable = 'Assign a hiring manager with a valid email address on the job order.';
	} else if (!isValidEmailAddress(replyTo)) {
		unavailable = 'Your Hire Gnome account needs a valid reply-to email address.';
	} else if (DEMO_MODE && !getDemoSubmissionSinkDirectory()) {
		unavailable = 'The submission mail sink is unavailable on this demo.';
	} else if (config && (!config.smtpHost || !config.smtpPort || !isValidEmailAddress(config.smtpFromEmail) ||
		Boolean(config.smtpUser) !== Boolean(config.smtpPass))) {
		unavailable = 'Ask an administrator to configure outgoing email in System Settings.';
	} else if (config && testMode && !isValidEmailAddress(config.emailTestRecipient)) {
		unavailable = 'Ask an administrator to configure an email test recipient.';
	}

	const candidateName = displayName(submission.candidate);
	const title = submission.jobOrder.title;
	return {
		contactId: contact?.id ?? null,
		contactName: displayName(contact),
		recipientEmail,
		replyTo,
		testMode,
		demoSink: DEMO_MODE,
		unavailable,
		subject: `Candidate submission: ${candidateName} for ${title}`.replace(/[\r\n]+/g, ' ').slice(0, 200),
		body: `Hi ${contact?.firstName || 'there'},\n\nI'd like to submit ${candidateName} for the ${title} role. Please reply with your feedback or let me know if you'd like to set up an interview.\n\nThanks,\n${displayName(actingUser)}`
	};
}

function communicationResponse(row, created = false) {
	const { actorUserId, replyTo, ...communication } = row;
	const result = { communication };
	if (row.deliveryStatus === 'failed') {
		return NextResponse.json({ ...result, error: 'The email was not sent. Check your outgoing email settings before trying again.', retryable: true }, { status: 422 });
	}
	if (row.deliveryStatus === 'sending' || row.deliveryStatus === 'unconfirmed') {
		return NextResponse.json({
			...result,
			error: 'Delivery has not been confirmed. Check the timeline or with your mail administrator before sending again.'
		}, { status: 409 });
	}
	return NextResponse.json(result, { status: created ? 201 : 200 });
}

function handleError(error) {
	if (error instanceof AccessControlError || error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	return NextResponse.json({ error: 'Unable to confirm the result. Reopen the timeline before trying again.' }, { status: 500 });
}

async function getReview(req, { params }) {
	try {
		const id = parseRouteId(await params);
		const { submission, actingUser } = await loadScope(req, id);
		return NextResponse.json(await getEmailReview(submission, actingUser), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		return handleError(error);
	}
}

async function postCommunication(req, { params }) {
	try {
		const throttle = await enforceMutationThrottle(req, 'submissions.communications.post');
		if (throttle) return throttle;
		const id = parseRouteId(await params);
		const { submission, actingUser } = await loadScope(req, id);
		const parsed = communicationSchema.safeParse(await parseJsonBody(req));
		if (!parsed.success) throw new ValidationError('Check the recipient, subject, and message or feedback before continuing.');
		const input = parsed.data;
		const isEmail = input.kind === 'email';
		const where = { submissionId_requestId: { submissionId: id, requestId: input.requestId } };
		const select = { ...submissionCommunicationSelect, actorUserId: true, replyTo: true };

		function replay(existing) {
			if (existing.actorUserId !== actingUser.id || existing.kind !== input.kind || existing.body !== input.body ||
				(isEmail && (existing.subject !== input.subject || existing.recipientEmail !== input.recipientEmail ||
					existing.replyTo !== input.replyTo)) || (!isEmail && (existing.contactName || '') !== input.contactName)) {
				throw new AccessControlError('This request was already used. Reopen the composer before making changes.', 409);
			}
			return communicationResponse(existing);
		}
		const existing = await prisma.submissionCommunication.findUnique({ where, select });
		if (existing) return replay(existing);

		let review;
		if (isEmail) {
			review = await getEmailReview(submission, actingUser);
			if (review.unavailable) throw new AccessControlError(review.unavailable, 422);
			if (review.contactId !== input.contactId || review.recipientEmail !== input.recipientEmail ||
				review.replyTo !== input.replyTo || review.testMode !== input.testMode) {
				throw new AccessControlError('The recipient or email settings changed. Close and reopen the review before sending.', 409);
			}
		}

		let row;
		try {
			row = await prisma.submissionCommunication.create({
				data: {
					submissionId: id,
					requestId: input.requestId,
					kind: input.kind,
					deliveryStatus: isEmail ? 'sending' : null,
					contactName: (isEmail ? review.contactName : input.contactName) || null,
					recipientEmail: review?.recipientEmail,
					replyTo: review?.replyTo,
					subject: input.subject,
					body: input.body,
					actorUserId: actingUser.id,
					actorName: displayName(actingUser)
				},
				select
			});
		} catch (error) {
			if (error.code !== 'P2002') throw error;
			const concurrent = await prisma.submissionCommunication.findUnique({ where, select });
			if (!concurrent) throw error;
			return replay(concurrent);
		}
		if (!isEmail) return communicationResponse(row, true);

		// Reserve the request before SMTP so a repeated request can never deliver it again.
		const message = {
			subject: input.subject,
			text: input.body
		};
		const delivery = DEMO_MODE
			? await captureDemoSubmissionEmail({ ...message, communicationId: row.id })
			: await sendEmailMessage({
				...message,
				to: review.recipientEmail,
				replyTo: review.replyTo,
				expectedTestMode: review.testMode
			});
		const updated = await prisma.submissionCommunication.update({
			where: { id: row.id },
			data: {
				deliveryStatus: delivery.sent
					? (DEMO_MODE ? 'demo_captured' : delivery.testMode ? 'test_sent' : 'sent')
					: (delivery.deliveryUncertain ? 'unconfirmed' : 'failed'),
				sentAt: delivery.sent ? new Date() : null
			},
			select
		});
		return communicationResponse(updated, true);
	} catch (error) {
		return handleError(error);
	}
}

export const GET = withApiLogging('submissions.communications.get', getReview);
export const POST = withApiLogging('submissions.communications.post', postCommunication);
