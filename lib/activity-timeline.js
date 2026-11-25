import { formatSelectValueLabel } from '@/lib/select-value-label';
import { submissionCreatedByLabel } from '@/lib/submission-origin';
import { formatDateTimeAt } from '@/lib/date-format';

function toTrimmedString(value) {
	return String(value || '').trim();
}

function buildDisplayName(user, fallback = 'Unknown User') {
	if (!user) return fallback;
	const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
	return fullName || user.email || fallback;
}

function toDate(value) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function truncateText(value, maxLength = 180) {
	const text = toTrimmedString(value).replace(/\s+/g, ' ');
	if (!text) return '';
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function sortTimelineItems(items) {
	return [...items].sort((left, right) => {
		const leftTime = toDate(left?.timestamp)?.getTime() || 0;
		const rightTime = toDate(right?.timestamp)?.getTime() || 0;
		if (leftTime !== rightTime) return rightTime - leftTime;
		return String(left?.id || '').localeCompare(String(right?.id || ''));
	});
}

function withTitleFallback(value, fallback) {
	const text = toTrimmedString(value);
	return text || fallback;
}

function formatMetaLine(label, value) {
	const text = toTrimmedString(value);
	return text ? `${label}: ${text}` : '';
}

const submissionEmailTitles = {
	sent: 'Submission email sent',
	demo_captured: 'Submission email captured in demo',
	test_sent: 'Submission email sent to test recipient',
	failed: 'Submission email failed',
	sending: 'Submission email delivery unconfirmed',
	unconfirmed: 'Submission email delivery unconfirmed'
};

export function buildCandidateTimeline(candidate) {
	if (!candidate) return [];

	const items = [
		{
			id: `candidate-created-${candidate.id}`,
			category: 'record',
			title: 'Candidate created',
			detail: candidate.recordId ? `Record ${candidate.recordId}` : '',
			meta: candidate.ownerUser ? formatMetaLine('Owner', buildDisplayName(candidate.ownerUser)) : '',
			timestamp: candidate.createdAt
		}
	];

	for (const statusChange of Array.isArray(candidate.statusChanges) ? candidate.statusChanges : []) {
		items.push({
			id: `candidate-status-${statusChange.id}`,
			category: 'status',
			title: `Status changed to ${formatSelectValueLabel(statusChange.toStatus)}`,
			detail: toTrimmedString(statusChange.reason),
			meta: formatMetaLine('By', buildDisplayName(statusChange.changedByUser)),
			timestamp: statusChange.createdAt
		});
	}

	for (const note of Array.isArray(candidate.notes) ? candidate.notes : []) {
		items.push({
			id: `candidate-note-${note.id}`,
			category: 'note',
			title: note.noteType === 'email' ? 'Email note added' : 'Note added',
			detail: truncateText(note.content),
			meta: formatMetaLine('By', buildDisplayName(note.createdByUser)),
			timestamp: note.createdAt
		});
	}

	for (const activity of Array.isArray(candidate.activities) ? candidate.activities : []) {
		items.push({
			id: `candidate-activity-${activity.id}`,
			category: 'activity',
			title: `${formatSelectValueLabel(activity.type)} logged`,
			detail: withTitleFallback(activity.subject, 'Activity'),
			meta: activity.status ? formatMetaLine('Status', formatSelectValueLabel(activity.status)) : '',
			timestamp: activity.dueAt || activity.createdAt
		});
	}

	for (const attachment of Array.isArray(candidate.attachments) ? candidate.attachments : []) {
		items.push({
			id: `candidate-file-${attachment.id}`,
			category: 'file',
			title: attachment.isResume ? 'Resume uploaded' : 'File uploaded',
			detail: withTitleFallback(attachment.fileName, 'Attachment'),
			meta: formatMetaLine('By', buildDisplayName(attachment.uploadedByUser)),
			timestamp: attachment.createdAt
		});
	}

	if (candidate.aiSummary?.updatedAt) {
		items.push({
			id: `candidate-ai-summary-${candidate.aiSummary.id}`,
			category: 'ai',
			title: 'AI summary generated',
			detail: truncateText(withTitleFallback(candidate.aiSummary.overview, 'Candidate summary refreshed')),
			meta: formatMetaLine('By', buildDisplayName(candidate.aiSummary.generatedByUser)),
			timestamp: candidate.aiSummary.updatedAt
		});
	}

	for (const submission of Array.isArray(candidate.submissions) ? candidate.submissions : []) {
		items.push({
			id: `candidate-submission-${submission.id}`,
			category: 'submission',
			title: 'Submitted to job order',
			detail: withTitleFallback(submission.jobOrder?.title, 'Job order'),
			meta: formatMetaLine('By', submissionCreatedByLabel(submission)),
			timestamp: submission.createdAt
		});
	}

	for (const interview of Array.isArray(candidate.interviews) ? candidate.interviews : []) {
		items.push({
			id: `candidate-interview-${interview.id}`,
			category: 'interview',
			title: `${formatSelectValueLabel(interview.interviewMode)} interview ${formatSelectValueLabel(interview.status)}`,
			detail: withTitleFallback(interview.subject || interview.jobOrder?.title, 'Interview'),
			meta: formatMetaLine('Interviewer', interview.interviewer),
			timestamp: interview.startsAt || interview.createdAt
		});
	}

	for (const offer of Array.isArray(candidate.offers) ? candidate.offers : []) {
		items.push({
			id: `candidate-placement-${offer.id}`,
			category: 'placement',
			title: `Placement ${formatSelectValueLabel(offer.status)}`,
			detail: withTitleFallback(offer.jobOrder?.title, 'Placement'),
			meta: formatMetaLine('Type', formatSelectValueLabel(offer.placementType)),
			timestamp: offer.createdAt || offer.offeredOn || offer.updatedAt
		});
	}

	return sortTimelineItems(items);
}

export function buildJobOrderTimeline(jobOrder, portalAccess = null) {
	if (!jobOrder) return [];

	const items = [
		{
			id: `job-order-created-${jobOrder.id}`,
			category: 'record',
			title: 'Job order created',
			detail: jobOrder.recordId ? `Record ${jobOrder.recordId}` : '',
			meta: jobOrder.ownerUser ? formatMetaLine('Owner', buildDisplayName(jobOrder.ownerUser)) : '',
			timestamp: jobOrder.createdAt
		}
	];

	if (jobOrder.openedAt) {
		items.push({
			id: `job-order-opened-${jobOrder.id}`,
			category: 'status',
			title: 'Job order opened',
			detail: withTitleFallback(jobOrder.title, 'Job order'),
			meta: '',
			timestamp: jobOrder.openedAt
		});
	}

	if (jobOrder.closedAt) {
		items.push({
			id: `job-order-closed-${jobOrder.id}`,
			category: 'status',
			title: 'Job order closed',
			detail: withTitleFallback(jobOrder.title, 'Job order'),
			meta: '',
			timestamp: jobOrder.closedAt
		});
	}

	if (jobOrder.publishedAt) {
		items.push({
			id: `job-order-published-${jobOrder.id}`,
			category: 'portal',
			title: 'Published to careers site',
			detail: withTitleFallback(jobOrder.title, 'Job order'),
			meta: '',
			timestamp: jobOrder.publishedAt
		});
	}

	for (const submission of Array.isArray(jobOrder.submissions) ? jobOrder.submissions : []) {
		const candidateName = `${submission.candidate?.firstName || ''} ${submission.candidate?.lastName || ''}`.trim() || 'Candidate';
		items.push({
			id: `job-order-submission-${submission.id}`,
			category: 'submission',
			title: 'Submission added',
			detail: candidateName,
			meta: formatMetaLine('By', submissionCreatedByLabel(submission)),
			timestamp: submission.createdAt
		});

		for (const feedback of Array.isArray(submission.clientFeedback) ? submission.clientFeedback : []) {
			items.push({
				id: `job-order-feedback-${feedback.id}`,
			category: 'feedback',
			title: `Client ${formatSelectValueLabel(feedback.actionType).toLowerCase()}`,
			detail: candidateName,
				meta: formatMetaLine('Client', feedback.clientNameSnapshot || 'Client Contact'),
				timestamp: feedback.createdAt
			});
		}
	}

	for (const interview of Array.isArray(jobOrder.interviews) ? jobOrder.interviews : []) {
		const candidateName = `${interview.candidate?.firstName || ''} ${interview.candidate?.lastName || ''}`.trim() || 'Candidate';
		items.push({
			id: `job-order-interview-${interview.id}`,
			category: 'interview',
			title: `${formatSelectValueLabel(interview.interviewMode)} interview ${formatSelectValueLabel(interview.status)}`,
			detail: candidateName,
			meta: formatMetaLine('Interviewer', interview.interviewer),
			timestamp: interview.startsAt || interview.createdAt
		});
	}

	for (const offer of Array.isArray(jobOrder.offers) ? jobOrder.offers : []) {
		const candidateName = `${offer.candidate?.firstName || ''} ${offer.candidate?.lastName || ''}`.trim() || 'Candidate';
		items.push({
			id: `job-order-placement-${offer.id}`,
			category: 'placement',
			title: `Placement ${formatSelectValueLabel(offer.status)}`,
			detail: candidateName,
			meta: formatMetaLine('Type', formatSelectValueLabel(offer.placementType)),
			timestamp: offer.createdAt || offer.offeredOn || offer.updatedAt
		});
	}

	if (portalAccess?.createdAt) {
		items.push({
			id: `job-order-portal-created-${portalAccess.id}`,
			category: 'portal',
			title: 'Client portal link created',
			detail: portalAccess.contact?.name || 'Client Contact',
			meta: '',
			timestamp: portalAccess.createdAt
		});
	}

	if (portalAccess?.analytics?.lastEmailedAt) {
		items.push({
			id: `job-order-portal-emailed-${portalAccess.id}`,
			category: 'portal',
			title: 'Client portal invite sent',
			detail: portalAccess.contact?.name || 'Client Contact',
			meta: formatMetaLine('Email', portalAccess.contact?.email || ''),
			timestamp: portalAccess.analytics.lastEmailedAt
		});
	}

	if (portalAccess?.analytics?.lastViewedAt) {
		items.push({
			id: `job-order-portal-viewed-${portalAccess.id}`,
			category: 'portal',
			title: 'Client portal viewed',
			detail: portalAccess.contact?.name || 'Client Contact',
			meta: '',
			timestamp: portalAccess.analytics.lastViewedAt
		});
	}

	return sortTimelineItems(items);
}

export function buildSubmissionTimeline(submission) {
	if (!submission) return [];

	const candidateName = `${submission.candidate?.firstName || ''} ${submission.candidate?.lastName || ''}`.trim() || 'Candidate';
	const items = [
		{
			id: `submission-created-${submission.id}`,
			category: 'submission',
			title: 'Submission created',
			detail: `${candidateName} -> ${withTitleFallback(submission.jobOrder?.title, 'Job order')}`,
			meta: formatMetaLine('By', buildDisplayName(submission.createdByUser, 'Unknown User')),
			timestamp: submission.createdAt
		}
	];

	for (const entry of submission.communications ?? []) {
		const isEmail = entry.kind === 'email';
		items.push({
			id: `submission-communication-${entry.id}`,
			category: isEmail ? 'email' : 'feedback',
			title: isEmail ? submissionEmailTitles[entry.deliveryStatus] : 'Client feedback logged',
			detail: isEmail ? entry.subject : truncateText(entry.body),
			meta: [
				isEmail ? formatMetaLine('To', entry.recipientEmail) : formatMetaLine('Client', entry.contactName),
				formatMetaLine(isEmail ? 'By' : 'Recorded by', entry.actorName)
			].filter(Boolean).join(' · '),
			content: entry.body,
			contentLabel: isEmail ? 'View Message' : 'View Feedback',
			timestamp: entry.sentAt || entry.createdAt
		});
	}

	for (const change of submission.statusChanges ?? []) {
		items.push({
			id: `submission-status-${change.id}`,
			category: 'status',
			title: `Status changed to ${formatSelectValueLabel(change.toStatus)}`,
			detail: `Previous status: ${formatSelectValueLabel(change.fromStatus)}`,
			meta: change.actorUser ? formatMetaLine('By', buildDisplayName(change.actorUser)) : '',
			timestamp: change.createdAt
		});
	}

	for (const interview of submission.interviews ?? []) {
		items.push({
			id: `submission-interview-${interview.id}`,
			category: 'interview',
			title: 'Interview added',
			detail: interview.subject,
			meta: [
				formatMetaLine('Status', formatSelectValueLabel(interview.status)),
				interview.startsAt ? formatMetaLine('Starts', formatDateTimeAt(interview.startsAt)) : ''
			].filter(Boolean).join(' · '),
			href: `/interviews/${interview.id}`,
			timestamp: interview.createdAt
		});
	}

	if (submission.aiWriteUpGeneratedAt) {
		items.push({
			id: `submission-writeup-${submission.id}`,
			category: 'ai',
			title: 'Client write-up generated',
			detail: truncateText(withTitleFallback(submission.aiWriteUp, 'Submission write-up refreshed')),
			meta: formatMetaLine('By', buildDisplayName(submission.aiWriteUpGeneratedByUser)),
			timestamp: submission.aiWriteUpGeneratedAt
		});
	}

	for (const feedback of Array.isArray(submission.clientFeedback) ? submission.clientFeedback : []) {
		items.push({
			id: `submission-feedback-${feedback.id}`,
			category: 'feedback',
			title: `Client ${formatSelectValueLabel(feedback.actionType).toLowerCase()}`,
			detail: truncateText(feedback.comment) || 'Feedback recorded through the client portal.',
			meta: [
				formatMetaLine('Client', feedback.clientNameSnapshot || 'Client Contact'),
				formatMetaLine('Status applied', formatSelectValueLabel(feedback.statusApplied, ''))
			].filter(Boolean).join(' · '),
			timestamp: feedback.createdAt
		});
	}

	if (submission.offer?.id) {
		items.push({
			id: `submission-placement-${submission.offer.id}`,
			category: 'placement',
			title: `Converted to placement`,
			detail: formatSelectValueLabel(submission.offer.status),
			meta: formatMetaLine('Type', formatSelectValueLabel(submission.offer.placementType)),
			timestamp: submission.offer.createdAt || submission.offer.updatedAt
		});
	}

	return sortTimelineItems(items);
}
