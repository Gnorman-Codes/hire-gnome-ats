import { buildCandidateTimeline } from '@/lib/activity-timeline';
import { formatCandidateStatusLabel, isCandidateQualifiedForPipeline } from '@/lib/candidate-status';
import { formatSelectValueLabel } from '@/lib/select-value-label';

function toDate(value) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function sortByLatest(items, getDateValue) {
	return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
		const leftTime = toDate(getDateValue(left))?.getTime() || 0;
		const rightTime = toDate(getDateValue(right))?.getTime() || 0;
		return rightTime - leftTime;
	});
}

function summarizeTimelineItem(item) {
	if (!item) return '';
	const title = String(item.title || '').trim();
	const detail = String(item.detail || '').trim();
	if (title && detail) return `${title}: ${detail}`;
	return title || detail;
}

function buildTimelineContext(item) {
	const summary = summarizeTimelineItem(item);
	return summary ? `Latest timeline event: ${summary}.` : 'No timeline events yet.';
}

function latestOpenActivity(candidate) {
	const openActivities = (Array.isArray(candidate?.activities) ? candidate.activities : []).filter(
		(activity) => String(activity?.status || '').trim().toLowerCase() !== 'completed'
	);
	if (openActivities.length === 0) return null;

	return [...openActivities].sort((left, right) => {
		const leftDue = toDate(left?.dueAt)?.getTime();
		const rightDue = toDate(right?.dueAt)?.getTime();
		if (leftDue && rightDue && leftDue !== rightDue) return leftDue - rightDue;
		if (leftDue && !rightDue) return -1;
		if (!leftDue && rightDue) return 1;

		const leftCreated = toDate(left?.createdAt)?.getTime() || 0;
		const rightCreated = toDate(right?.createdAt)?.getTime() || 0;
		return rightCreated - leftCreated;
	})[0];
}

function latestEmailNote(candidate) {
	return sortByLatest(
		(Array.isArray(candidate?.notes) ? candidate.notes : []).filter(
			(note) => String(note?.noteType || '').trim().toLowerCase() === 'email'
		),
		(note) => note?.createdAt
	)[0] || null;
}

function latestResumeAttachment(candidate) {
	return sortByLatest(
		(Array.isArray(candidate?.attachments) ? candidate.attachments : []).filter((attachment) => attachment?.isResume),
		(attachment) => attachment?.createdAt
	)[0] || null;
}

function hasPendingInterview(candidate) {
	return (Array.isArray(candidate?.interviews) ? candidate.interviews : []).some(
		(interview) => String(interview?.status || '').trim().toLowerCase() === 'scheduled'
	);
}

function hasCompletedInterview(candidate) {
	return (Array.isArray(candidate?.interviews) ? candidate.interviews : []).some(
		(interview) => String(interview?.status || '').trim().toLowerCase() === 'completed'
	);
}

function latestActivePlacement(candidate) {
	return sortByLatest(
		(Array.isArray(candidate?.offers) ? candidate.offers : []).filter((offer) => {
			const status = String(offer?.status || '').trim().toLowerCase();
			return status && !['accepted', 'declined', 'withdrawn'].includes(status);
		}),
		(offer) => offer?.updatedAt || offer?.createdAt || offer?.offeredOn
	)[0] || null;
}

function openActivityTitle(activity) {
	const normalizedType = String(activity?.type || '').trim().toLowerCase();
	if (normalizedType === 'call') return 'Complete Candidate Follow-Up';
	if (normalizedType === 'email') return 'Reply To Candidate';
	if (normalizedType === 'meeting') return 'Prepare For Meeting';
	return 'Complete Pending Follow-Up';
}

export function deriveCandidateSuggestedNextStep(candidate, options = {}) {
	if (!candidate) return null;

	const {
		aiAvailable = false,
		completenessScore = 0,
		jobMatchCount = 0,
		topGaps = []
	} = options;

	const timelineItems = buildCandidateTimeline(candidate);
	const latestTimelineItem = timelineItems[0] || null;
	const timelineContext = buildTimelineContext(latestTimelineItem);
	const status = String(candidate.status || '').trim().toLowerCase();
	const statusLabel = formatCandidateStatusLabel(status);
	const submissions = Array.isArray(candidate.submissions) ? candidate.submissions : [];
	const offers = Array.isArray(candidate.offers) ? candidate.offers : [];
	const openActivity = latestOpenActivity(candidate);
	const recentEmailNote = latestEmailNote(candidate);
	const resumeAttachment = latestResumeAttachment(candidate);
	const qualifiedForPipeline = isCandidateQualifiedForPipeline(status);
	const activePlacement = latestActivePlacement(candidate);

	if (status === 'hired') {
		return {
			title: 'Review Recent Placement Activity',
			description: `Candidate is already marked Hired. ${timelineContext}`,
			actionKey: 'status-history',
			actionLabel: 'Open Timeline'
		};
	}

	if (status === 'rejected') {
		return {
			title: 'Review Final Candidate Activity',
			description: `Candidate is marked Rejected. ${timelineContext}`,
			actionKey: 'status-history',
			actionLabel: 'Open Timeline'
		};
	}

	if (activePlacement) {
		return {
			title: 'Follow Up On Offer',
			description: `A placement is already in ${formatSelectValueLabel(activePlacement.status)} status. ${timelineContext}`,
			actionKey: 'status-history',
			actionLabel: 'Open Timeline'
		};
	}

	if (
		recentEmailNote &&
		(!latestTimelineItem || String(latestTimelineItem.category || '').trim().toLowerCase() === 'note')
	) {
		return {
			title: 'Email Candidate',
			description: `Recent email activity appears on the timeline and there is no open follow-up logged yet. ${timelineContext}`,
			actionKey: aiAvailable ? 'email-draft' : 'activities',
			actionLabel: aiAvailable ? 'Draft Email' : 'Open Activities'
		};
	}

	if (hasCompletedInterview(candidate) && offers.length === 0) {
		return {
			title: 'Advance To Placement',
			description: `Interview activity is complete and there is no placement record yet. ${timelineContext}`,
			actionKey: 'add-placement',
			actionLabel: 'Add Placement'
		};
	}

	if (qualifiedForPipeline && !hasPendingInterview(candidate) && !hasCompletedInterview(candidate) && submissions.length > 0) {
		return {
			title: 'Schedule Interview',
			description: `Candidate has already been submitted, but no interview activity is on the timeline yet. ${timelineContext}`,
			actionKey: 'add-interview',
			actionLabel: 'Add Interview'
		};
	}

	if (qualifiedForPipeline && submissions.length === 0) {
		return {
			title: 'Submit To Job Order',
			description:
				jobMatchCount > 0
					? `Candidate is ${statusLabel} with ${jobMatchCount} active job match${jobMatchCount === 1 ? '' : 'es'} and no submissions yet.`
					: `Candidate is ${statusLabel} and has no submissions yet. ${timelineContext}`,
			actionKey: 'add-submission',
			actionLabel: 'Add Submission'
		};
	}

	if (!qualifiedForPipeline) {
		if (resumeAttachment) {
				return {
					title: 'Review Resume',
				description: `Candidate is still ${statusLabel}. Review the latest resume before advancing them further. ${timelineContext}`,
				actionKey: 'files',
				actionLabel: 'Open Files'
			};
		}

		const gapText = topGaps.length > 0 ? ` Top gaps: ${topGaps.slice(0, 2).join(', ')}.` : '';
		return {
			title: 'Review Profile',
			description: `Candidate is still ${statusLabel} and the profile is ${completenessScore}% complete.${gapText}`,
			actionKey: 'details',
			actionLabel: 'Review Profile'
		};
	}

	if (openActivity) {
		const activityTypeLabel = formatSelectValueLabel(openActivity.type || 'activity');
		const activitySubject = String(openActivity.subject || '').trim();
		return {
			title: openActivityTitle(openActivity),
			description: `${activityTypeLabel}${activitySubject ? ` activity "${activitySubject}"` : ' activity'} is still open. ${timelineContext}`,
			actionKey: 'activities',
			actionLabel: 'Open Activities'
		};
	}

	if (hasPendingInterview(candidate)) {
		return {
			title: 'Prep Candidate For Interview',
			description: `An interview is already scheduled. Confirm the candidate is prepared and aligned on logistics. ${timelineContext}`,
			actionKey: aiAvailable ? 'email-draft' : 'activities',
			actionLabel: aiAvailable ? 'Draft Email' : 'Open Activities'
		};
	}

	return {
		title: aiAvailable ? 'Email Candidate' : 'Review Recent Activity',
		description: timelineContext,
		actionKey: aiAvailable ? 'email-draft' : 'status-history',
		actionLabel: aiAvailable ? 'Draft Email' : 'Open Timeline'
	};
}
