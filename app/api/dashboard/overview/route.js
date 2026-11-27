import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
	AccessControlError,
	addScopeToWhere,
	getActingUser,
	getEntityScope
} from '@/lib/access-control';
import { getArchivedEntityIdSet } from '@/lib/archive-entities';
import { getCandidateJobOrderScope } from '@/lib/related-record-scope';
import { withApiLogging } from '@/lib/api-logging';
import { WEB_RESPONSE_NOTE_PREFIX } from '@/lib/submission-origin';
import { getSystemBranding } from '@/lib/system-settings';

const AWAITING_FEEDBACK_SUBMISSION_STATUSES = ['submitted', 'under_review', 'qualified'];
const ACTIVE_INTERVIEW_STATUSES = ['scheduled'];
const OPEN_JOB_ORDER_STATUSES = ['open', 'active', 'on_hold'];
const RECENT_PRIORITY_EXCLUDED_SUBMISSION_STATUSES = ['rejected', 'placed'];
const PORTAL_OPEN_STALE_DAYS = 2;
const PORTAL_RESPONSE_STALE_DAYS = 2;
const WEB_RESPONSE_REVIEW_STALE_DAYS = 1;

function andWhere(...clauses) {
	const filtered = clauses.filter(Boolean);
	if (filtered.length === 0) return undefined;
	if (filtered.length === 1) return filtered[0];
	return { AND: filtered };
}

function startOfDay(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date, days) {
	return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfMonth(date) {
	return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function startOfNextMonth(date) {
	return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
}

function toCandidateName(candidate) {
	return `${candidate?.firstName || '-'} ${candidate?.lastName || ''}`.trim();
}

function toOwnerName(user) {
	const label = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
	return label || 'Unassigned';
}

function toContactName(contact) {
	const label = `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim();
	return label || 'Client Contact';
}

function toDisplayLabel(value) {
	const normalized = String(value || '').trim();
	if (!normalized) return '-';
	return normalized
		.replace(/[_-]+/g, ' ')
		.split(' ')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function getStatusTone(status) {
	switch (status) {
		case 'active':
		case 'open':
		case 'scheduled':
		case 'qualified':
		case 'interview':
		case 'offered':
		case 'hired':
		case 'accepted':
			return 'positive';
		case 'in_review':
		case 'on_hold':
			return 'warning';
		case 'rejected':
		case 'declined':
		case 'withdrawn':
			return 'negative';
		default:
			return undefined;
	}
}

function toDayKey(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function daysSince(value, now) {
	const date = value instanceof Date ? value : value ? new Date(value) : null;
	if (!date || Number.isNaN(date.getTime())) return 0;
	return Math.max(1, Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)));
}

function dedupePriorityItems(items) {
	const seen = new Set();
	const deduped = [];
	for (const item of items) {
		const key = `${item.type}:${item.href}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(item);
	}
	return deduped;
}

function buildTrendSeed(startDate, totalDays) {
	return Array.from({ length: totalDays }).map((_, index) => {
		const currentDate = addDays(startDate, index);
		return {
			dateKey: toDayKey(currentDate),
			label: currentDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
			candidates: 0,
			jobOrders: 0,
			submissions: 0,
			interviews: 0,
			placements: 0,
			total: 0
		};
	});
}

function incrementTrendItem(itemsByKey, value, fieldName) {
	const date = value ? new Date(value) : null;
	if (!date || Number.isNaN(date.getTime())) return;
	const item = itemsByKey.get(toDayKey(date));
	if (!item) return;
	item[fieldName] += 1;
	item.total += 1;
}

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function getDashboard_overviewHandler(req) {
	try {
		const actingUser = await getActingUser(req);
		const scope = getEntityScope(actingUser);
		const relatedScope = getCandidateJobOrderScope(actingUser);
		const branding = await getSystemBranding();
		const clientPortalEnabled = Boolean(branding.clientPortalEnabled);
		const now = new Date();
		const todayStart = startOfDay(now);
		const tomorrowStart = addDays(todayStart, 1);
		const sevenDaysAgo = addDays(now, -7);
		const fiveDaysAgo = addDays(now, -5);
		const twoDaysAgo = addDays(now, -PORTAL_OPEN_STALE_DAYS);
		const oneDayAgo = addDays(now, -WEB_RESPONSE_REVIEW_STALE_DAYS);
		const inSevenDays = addDays(now, 7);
		const monthStart = startOfMonth(now);
		const nextMonthStart = startOfNextMonth(now);
		const trendStart = addDays(todayStart, -6);

		const [
			interviewsToday,
			awaitingFeedbackSubmissions,
			staleSubmissions,
			staleOpenJobOrders,
			openJobOrders,
			recentPrioritySubmissions,
			recentPriorityJobOrders,
			upcomingInterviews,
			recentCandidates,
			recentJobOrders,
			webResponseSubmissions,
			clientPortalAccesses,
			interviewRequestFeedback,
			recentPortalInterviews,
			candidateTrendRows,
			jobOrderTrendRows,
			submissionTrendRows,
			interviewTrendRows,
			placementTrendRows,
			placementsThisMonth,
			archivedCandidateIds,
			archivedSubmissionIds,
			archivedJobOrderIds,
			archivedInterviewIds,
			archivedPlacementIds
		] = await Promise.all([
			prisma.interview.findMany({
				where: andWhere(
					relatedScope,
					{ startsAt: { gte: todayStart, lt: tomorrowStart } },
					{ status: { notIn: ['cancelled'] } }
				),
				select: {
					id: true,
					subject: true,
					status: true,
					startsAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { startsAt: 'asc' }
			}),
			prisma.submission.findMany({
				where: andWhere(relatedScope, { status: { in: AWAITING_FEEDBACK_SUBMISSION_STATUSES } }),
				select: {
					id: true,
					status: true,
					createdAt: true,
					updatedAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { updatedAt: 'asc' }
			}),
			prisma.submission.findMany({
				where: andWhere(
					relatedScope,
					{ status: { in: AWAITING_FEEDBACK_SUBMISSION_STATUSES } },
					{ createdAt: { lt: fiveDaysAgo } }
				),
				select: {
					id: true,
					status: true,
					createdAt: true,
					updatedAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { createdAt: 'asc' },
				take: 8
			}),
			prisma.jobOrder.findMany({
				where: addScopeToWhere(
					{
						status: { in: OPEN_JOB_ORDER_STATUSES },
						submissions: {
							none: { createdAt: { gte: sevenDaysAgo } }
						}
					},
					scope
				),
				select: {
					id: true,
					title: true,
					status: true,
					updatedAt: true,
					openedAt: true,
					client: { select: { name: true } },
					ownerUser: { select: { firstName: true, lastName: true } }
				},
				orderBy: { updatedAt: 'asc' }
			}),
			prisma.jobOrder.findMany({
				where: addScopeToWhere({ status: { in: OPEN_JOB_ORDER_STATUSES } }, scope),
				select: {
					id: true,
					title: true,
					status: true,
					updatedAt: true,
					openedAt: true,
					client: { select: { name: true } },
					ownerUser: { select: { firstName: true, lastName: true } }
				},
				orderBy: { updatedAt: 'desc' },
				take: 8
			}),
			prisma.submission.findMany({
				where: andWhere(relatedScope, { status: { notIn: RECENT_PRIORITY_EXCLUDED_SUBMISSION_STATUSES } }),
				select: {
					id: true,
					status: true,
					createdAt: true,
					updatedAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { updatedAt: 'desc' },
				take: 8
			}),
			prisma.jobOrder.findMany({
				where: addScopeToWhere({ status: { in: OPEN_JOB_ORDER_STATUSES } }, scope),
				select: {
					id: true,
					title: true,
					status: true,
					updatedAt: true,
					openedAt: true,
					client: { select: { name: true } },
					ownerUser: { select: { firstName: true, lastName: true } }
				},
				orderBy: { updatedAt: 'desc' },
				take: 8
			}),
			prisma.interview.findMany({
				where: andWhere(
					relatedScope,
					{ status: { in: ACTIVE_INTERVIEW_STATUSES } },
					{ startsAt: { gte: now, lt: inSevenDays } }
				),
				select: {
					id: true,
					subject: true,
					status: true,
					startsAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { startsAt: 'asc' },
				take: 12
			}),
			prisma.candidate.findMany({
				where: addScopeToWhere({}, scope),
				select: {
					id: true,
					status: true,
					createdAt: true,
					updatedAt: true,
					firstName: true,
					lastName: true,
					currentJobTitle: true,
					currentEmployer: true,
					ownerUser: { select: { firstName: true, lastName: true } }
				},
				orderBy: { createdAt: 'desc' },
				take: 8
			}),
			prisma.jobOrder.findMany({
				where: addScopeToWhere({ status: { in: OPEN_JOB_ORDER_STATUSES } }, scope),
				select: {
					id: true,
					title: true,
					status: true,
					openedAt: true,
					updatedAt: true,
					client: { select: { name: true } },
					ownerUser: { select: { firstName: true, lastName: true } }
				},
				orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
				take: 8
			}),
			prisma.submission.findMany({
				where: andWhere(
					relatedScope,
					{ notes: { startsWith: WEB_RESPONSE_NOTE_PREFIX } },
					{ status: { in: ['submitted', 'under_review'] } },
					{ createdAt: { lt: oneDayAgo } }
				),
				select: {
					id: true,
					status: true,
					createdAt: true,
					updatedAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { createdAt: 'asc' },
				take: 12
			}),
			clientPortalEnabled
				? prisma.clientPortalAccess.findMany({
				where: {
					isRevoked: false,
					jobOrder: addScopeToWhere({}, scope),
					OR: [
						{ lastEmailedAt: { not: null, lt: twoDaysAgo } },
						{ lastViewedAt: { not: null, lt: addDays(now, -PORTAL_RESPONSE_STALE_DAYS) } }
					]
				},
				select: {
					id: true,
					lastViewedAt: true,
					lastActionAt: true,
					lastEmailedAt: true,
					contact: { select: { firstName: true, lastName: true } },
					jobOrder: {
						select: {
							id: true,
							title: true,
							client: { select: { name: true } }
						}
					}
				},
				orderBy: { updatedAt: 'desc' },
				take: 24
			})
				: Promise.resolve([]),
			clientPortalEnabled
				? prisma.clientSubmissionFeedback.findMany({
				where: {
					actionType: 'request_interview',
					createdAt: { lt: oneDayAgo },
					submission: relatedScope
				},
				select: {
					id: true,
					createdAt: true,
					clientNameSnapshot: true,
					submission: {
						select: {
							id: true,
							status: true,
							updatedAt: true,
							candidateId: true,
							jobOrderId: true,
							candidate: { select: { firstName: true, lastName: true } },
							jobOrder: { select: { title: true, client: { select: { name: true } } } }
						}
					}
				},
				orderBy: { createdAt: 'desc' },
				take: 24
			})
				: Promise.resolve([]),
			clientPortalEnabled
				? prisma.interview.findMany({
				where: andWhere(relatedScope, { status: { notIn: ['cancelled'] } }, { createdAt: { gte: sevenDaysAgo } }),
				select: {
					id: true,
					candidateId: true,
					jobOrderId: true,
					createdAt: true
				}
			})
				: Promise.resolve([]),
			prisma.candidate.findMany({
				where: addScopeToWhere({ createdAt: { gte: trendStart } }, scope),
				select: { id: true, createdAt: true }
			}),
			prisma.jobOrder.findMany({
				where: addScopeToWhere(
					{ OR: [{ openedAt: { gte: trendStart } }, { createdAt: { gte: trendStart } }] },
					scope
				),
				select: { id: true, openedAt: true, createdAt: true }
			}),
			prisma.submission.findMany({
				where: andWhere(relatedScope, { createdAt: { gte: trendStart } }),
				select: { id: true, createdAt: true }
			}),
			prisma.interview.findMany({
				where: andWhere(relatedScope, { createdAt: { gte: trendStart } }),
				select: { id: true, createdAt: true }
			}),
			prisma.offer.findMany({
				where: andWhere(relatedScope, { createdAt: { gte: trendStart } }),
				select: { id: true, createdAt: true }
			}),
			prisma.offer.findMany({
				where: andWhere(relatedScope, { offeredOn: { gte: monthStart, lt: nextMonthStart } }),
				select: {
					id: true,
					status: true,
					offeredOn: true,
					updatedAt: true,
					candidate: { select: { firstName: true, lastName: true } },
					jobOrder: { select: { title: true, client: { select: { name: true } } } }
				},
				orderBy: { offeredOn: 'desc' }
			}),
			getArchivedEntityIdSet('CANDIDATE'),
			getArchivedEntityIdSet('SUBMISSION'),
			getArchivedEntityIdSet('JOB_ORDER'),
			getArchivedEntityIdSet('INTERVIEW'),
			getArchivedEntityIdSet('PLACEMENT')
		]);

		const activeInterviewsToday = interviewsToday.filter((record) => !archivedInterviewIds.has(record.id));
		const activeAwaitingFeedbackSubmissions = awaitingFeedbackSubmissions.filter(
			(record) => !archivedSubmissionIds.has(record.id)
		);
		const activeStaleSubmissions = staleSubmissions.filter((record) => !archivedSubmissionIds.has(record.id));
		const activeStaleOpenJobOrders = staleOpenJobOrders.filter((record) => !archivedJobOrderIds.has(record.id));
		const activeOpenJobOrders = openJobOrders.filter((record) => !archivedJobOrderIds.has(record.id));
		const activeRecentPrioritySubmissions = recentPrioritySubmissions.filter(
			(record) => !archivedSubmissionIds.has(record.id)
		);
		const activeRecentPriorityJobOrders = recentPriorityJobOrders.filter(
			(record) => !archivedJobOrderIds.has(record.id)
		);
		const activeUpcomingInterviews = upcomingInterviews.filter((record) => !archivedInterviewIds.has(record.id));
		const activeRecentCandidates = recentCandidates.filter((record) => !archivedCandidateIds.has(record.id));
		const activeRecentJobOrders = recentJobOrders.filter((record) => !archivedJobOrderIds.has(record.id));
		const activeWebResponseSubmissions = webResponseSubmissions.filter((record) => !archivedSubmissionIds.has(record.id));
		const activeClientPortalAccesses = clientPortalEnabled
			? clientPortalAccesses.filter((record) => !archivedJobOrderIds.has(record.jobOrder?.id))
			: [];
		const activeInterviewRequestFeedback = clientPortalEnabled
			? interviewRequestFeedback.filter(
			(record) => record?.submission?.id && !archivedSubmissionIds.has(record.submission.id)
		)
			: [];
		const activeRecentPortalInterviews = clientPortalEnabled
			? recentPortalInterviews.filter((record) => !archivedInterviewIds.has(record.id))
			: [];
		const activeCandidateTrendRows = candidateTrendRows.filter((record) => !archivedCandidateIds.has(record.id));
		const activeJobOrderTrendRows = jobOrderTrendRows.filter((record) => !archivedJobOrderIds.has(record.id));
		const activeSubmissionTrendRows = submissionTrendRows.filter((record) => !archivedSubmissionIds.has(record.id));
		const activeInterviewTrendRows = interviewTrendRows.filter((record) => !archivedInterviewIds.has(record.id));
		const activePlacementTrendRows = placementTrendRows.filter((record) => !archivedPlacementIds.has(record.id));
		const activePlacementsThisMonth = placementsThisMonth.filter((record) => !archivedPlacementIds.has(record.id));

		const interviewRequestPriorityQueue = activeInterviewRequestFeedback
			.filter((record) => {
				if (['rejected', 'placed'].includes(String(record.submission?.status || '').toLowerCase())) {
					return false;
				}
				const feedbackTime = new Date(record.createdAt).getTime();
				return !activeRecentPortalInterviews.some(
					(interview) =>
						interview.candidateId === record.submission.candidateId &&
						interview.jobOrderId === record.submission.jobOrderId &&
						new Date(interview.createdAt).getTime() >= feedbackTime
				);
			})
			.map((record) => ({
				id: `client-interview-request-${record.id}`,
				type: 'submission',
				title: `${toCandidateName(record.submission.candidate)} | ${record.submission.jobOrder?.title || '-'}`,
				subtitle: `Status: ${toDisplayLabel(record.submission.status)}`,
				meta: `${record.submission.jobOrder?.client?.name || '-'} | ${record.clientNameSnapshot || 'Client Contact'}`,
				dateLabel: 'Requested',
				dateValue: record.createdAt,
				urgencyLabel: 'Client requested interview, not scheduled',
				badgeTone: 'negative',
				urgencyRank: 500000 + daysSince(record.createdAt, now),
				href: `/submissions/${record.submission.id}`
			}));

		const webResponsePriorityQueue = activeWebResponseSubmissions.map((record) => ({
			id: `web-response-${record.id}`,
			type: 'submission',
			title: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
			subtitle: `Status: ${toDisplayLabel(record.status)}`,
			meta: record.jobOrder?.client?.name || '-',
			dateLabel: 'Applied',
			dateValue: record.createdAt,
			urgencyLabel: 'Web response awaiting recruiter review',
			badgeTone: 'warning',
			urgencyRank: 400000 + daysSince(record.createdAt, now),
			href: `/submissions/${record.id}`
		}));

		const portalResponsePriorityQueue = activeClientPortalAccesses
			.filter((record) => record.lastViewedAt && (!record.lastActionAt || record.lastActionAt < record.lastViewedAt))
			.map((record) => ({
				id: `portal-viewed-${record.id}`,
				type: 'jobOrder',
				title: record.jobOrder?.title || `Job Order #${record.jobOrder?.id || record.id}`,
				subtitle: record.jobOrder?.client?.name || '-',
				meta: `Viewed by ${toContactName(record.contact)}`,
				dateLabel: 'Viewed',
				dateValue: record.lastViewedAt,
				urgencyLabel: 'Client portal viewed, no response yet',
				badgeTone: 'warning',
				urgencyRank: 300000 + daysSince(record.lastViewedAt, now),
				href: `/job-orders/${record.jobOrder.id}`
			}));

		const unopenedPortalPriorityQueue = activeClientPortalAccesses
			.filter((record) => record.lastEmailedAt && (!record.lastViewedAt || record.lastViewedAt < record.lastEmailedAt))
			.map((record) => ({
				id: `portal-unopened-${record.id}`,
				type: 'jobOrder',
				title: record.jobOrder?.title || `Job Order #${record.jobOrder?.id || record.id}`,
				subtitle: record.jobOrder?.client?.name || '-',
				meta: `Sent to ${toContactName(record.contact)}`,
				dateLabel: 'Sent',
				dateValue: record.lastEmailedAt,
				urgencyLabel: 'Portal link sent, not opened',
				badgeTone: 'warning',
				urgencyRank: 250000 + daysSince(record.lastEmailedAt, now),
				href: `/job-orders/${record.jobOrder.id}`
			}));

		const smartPriorityQueue = dedupePriorityItems([
			...interviewRequestPriorityQueue,
			...webResponsePriorityQueue,
			...portalResponsePriorityQueue,
			...unopenedPortalPriorityQueue,
			...activeStaleSubmissions.map((record) => {
				return {
					id: `submission-${record.id}`,
					type: 'submission',
					title: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
					subtitle: `Status: ${toDisplayLabel(record.status)}`,
					meta: record.jobOrder?.client?.name || '-',
					dateLabel: 'Submitted',
					dateValue: record.createdAt,
					urgencyLabel: 'Awaiting feedback for over 5 days',
					badgeTone: 'warning',
					urgencyRank: 200000 + daysSince(record.createdAt, now),
					href: `/submissions/${record.id}`
				};
			}),
			...activeStaleOpenJobOrders.map((record) => {
				return {
					id: `job-${record.id}`,
					type: 'jobOrder',
					title: record.title || `Job Order #${record.id}`,
					subtitle: record.client?.name || '-',
					meta: `Owner: ${toOwnerName(record.ownerUser)}`,
					dateLabel: 'Updated',
					dateValue: record.updatedAt,
					urgencyLabel: 'No new submissions in the last 7 days',
					badgeTone: 'warning',
					urgencyRank: 100000 + daysSince(record.updatedAt, now),
					href: `/job-orders/${record.id}`
				};
			})
		])
			.sort((a, b) => b.urgencyRank - a.urgencyRank)
			.slice(0, 8);

		const fallbackPriorityQueue = dedupePriorityItems([
			...activeAwaitingFeedbackSubmissions.map((record) => {
				const staleDays = daysSince(record.updatedAt || record.createdAt, now);
				return {
					id: `fallback-submission-${record.id}`,
					type: 'submission',
					title: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
					subtitle: `Status: ${toDisplayLabel(record.status)}`,
					meta: record.jobOrder?.client?.name || '-',
					dateLabel: 'Updated',
					dateValue: record.updatedAt || record.createdAt,
					urgencyLabel: staleDays >= 5 ? 'Awaiting feedback for over 5 days' : 'Awaiting feedback follow-up',
					badgeTone: 'warning',
					urgencyRank: 50000 + staleDays,
					href: `/submissions/${record.id}`
				};
			}),
			...activeOpenJobOrders.map((record) => ({
				id: `fallback-job-${record.id}`,
				type: 'jobOrder',
				title: record.title || `Job Order #${record.id}`,
				subtitle: record.client?.name || '-',
				meta: `Owner: ${toOwnerName(record.ownerUser)}`,
				dateLabel: 'Updated',
				dateValue: record.updatedAt,
				urgencyLabel: 'Review pipeline health',
				badgeTone: 'warning',
				urgencyRank: 1000,
				href: `/job-orders/${record.id}`
			}))
		])
			.sort((a, b) => b.urgencyRank - a.urgencyRank)
			.slice(0, 8);

		const recentPriorityQueue = dedupePriorityItems([
			...activeRecentPrioritySubmissions.map((record) => {
				const daysSinceUpdate = daysSince(record.updatedAt || record.createdAt, now);
				return {
					id: `recent-submission-${record.id}`,
					type: 'submission',
					title: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
					subtitle: `Status: ${toDisplayLabel(record.status)}`,
					meta: record.jobOrder?.client?.name || '-',
					dateLabel: 'Updated',
					dateValue: record.updatedAt || record.createdAt,
					urgencyLabel: 'Recent active submission',
					urgencyRank: 500 + (10 - Math.min(daysSinceUpdate, 10)),
					href: `/submissions/${record.id}`
				};
			}),
			...activeRecentPriorityJobOrders.map((record) => ({
				id: `recent-job-${record.id}`,
				type: 'jobOrder',
				title: record.title || `Job Order #${record.id}`,
				subtitle: record.client?.name || '-',
				meta: `Owner: ${toOwnerName(record.ownerUser)}`,
				dateLabel: 'Opened',
				dateValue: record.openedAt || record.updatedAt,
				urgencyLabel: 'Recent open job order',
				badgeTone: 'positive',
				urgencyRank: 400,
				href: `/job-orders/${record.id}`
			}))
		])
			.sort((a, b) => b.urgencyRank - a.urgencyRank)
			.slice(0, 8);

		const priorityQueue =
			smartPriorityQueue.length > 0
				? smartPriorityQueue
				: fallbackPriorityQueue.length > 0
					? fallbackPriorityQueue
					: recentPriorityQueue;

		const trendItems = buildTrendSeed(trendStart, 7);
		const trendItemsByKey = new Map(trendItems.map((item) => [item.dateKey, item]));
		for (const record of activeCandidateTrendRows) incrementTrendItem(trendItemsByKey, record.createdAt, 'candidates');
		for (const record of activeJobOrderTrendRows) {
			incrementTrendItem(trendItemsByKey, record.openedAt || record.createdAt, 'jobOrders');
		}
		for (const record of activeSubmissionTrendRows) incrementTrendItem(trendItemsByKey, record.createdAt, 'submissions');
		for (const record of activeInterviewTrendRows) incrementTrendItem(trendItemsByKey, record.createdAt, 'interviews');
		for (const record of activePlacementTrendRows) incrementTrendItem(trendItemsByKey, record.createdAt, 'placements');

		const detailLists = {
			interviewsToday: activeInterviewsToday.map((record) => ({
				id: `interview-${record.id}`,
				entityType: 'interview',
				title: record.subject || `Interview #${record.id}`,
				subtitle: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
				meta: record.jobOrder?.client?.name || '-',
				dateValue: record.startsAt,
				badgeLabel: toDisplayLabel(record.status),
				badgeTone: getStatusTone(record.status),
				href: `/interviews/${record.id}`
			})),
			awaitingFeedback: activeAwaitingFeedbackSubmissions.map((record) => ({
				id: `awaiting-${record.id}`,
				entityType: 'submission',
				title: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
				subtitle: record.jobOrder?.client?.name || '-',
				meta: `Status: ${toDisplayLabel(record.status)}`,
				dateLabel: 'Updated',
				dateValue: record.updatedAt || record.createdAt,
				badgeLabel: 'Awaiting feedback',
				badgeTone: 'warning',
				href: `/submissions/${record.id}`
			})),
			webResponsesToReview: webResponsePriorityQueue.map((item) => ({
				id: item.id,
				entityType: item.type,
				title: item.title,
				subtitle: item.subtitle,
				meta: item.meta,
				dateLabel: item.dateLabel,
				dateValue: item.dateValue,
				badgeLabel: item.urgencyLabel,
				badgeTone: item.badgeTone,
				href: item.href
			})),
			clientInterviewRequests: clientPortalEnabled ? interviewRequestPriorityQueue.map((item) => ({
				id: item.id,
				entityType: item.type,
				title: item.title,
				subtitle: item.subtitle,
				meta: item.meta,
				dateLabel: item.dateLabel,
				dateValue: item.dateValue,
				badgeLabel: item.urgencyLabel,
				badgeTone: item.badgeTone,
				href: item.href
			})) : [],
			stalledJobs: activeStaleOpenJobOrders.map((record) => ({
				id: `stalled-job-${record.id}`,
				entityType: 'jobOrder',
				title: record.title || `Job Order #${record.id}`,
				subtitle: record.client?.name || '-',
				meta: `Owner: ${toOwnerName(record.ownerUser)}`,
				dateLabel: 'Updated',
				dateValue: record.updatedAt,
				badgeLabel: 'No submissions in 7 days',
				badgeTone: 'warning',
				href: `/job-orders/${record.id}`
			})),
			placementsThisMonth: activePlacementsThisMonth.map((record) => ({
				id: `placement-month-${record.id}`,
				entityType: 'placement',
				title: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
				subtitle: record.jobOrder?.client?.name || '-',
				meta: `Status: ${toDisplayLabel(record.status)}`,
				dateLabel: 'Offered On',
				dateValue: record.offeredOn || record.updatedAt,
				badgeLabel: toDisplayLabel(record.status),
				badgeTone: getStatusTone(record.status),
				href: `/placements/${record.id}`
			}))
		};

		const sections = {
			needsAttention: priorityQueue.map((item) => ({
				id: item.id,
				entityType: item.type,
				title: item.title,
				subtitle: item.subtitle,
				meta: item.meta,
				dateLabel: item.dateLabel,
				dateValue: item.dateValue,
				badgeLabel: item.urgencyLabel,
				badgeTone: item.badgeTone,
				href: item.href
			})),
			upcomingInterviews: activeUpcomingInterviews.map((record) => ({
				id: `upcoming-interview-${record.id}`,
				entityType: 'interview',
				title: record.subject || `Interview #${record.id}`,
				subtitle: `${toCandidateName(record.candidate)} | ${record.jobOrder?.title || '-'}`,
				meta: record.jobOrder?.client?.name || '-',
				dateValue: record.startsAt,
				badgeLabel: toDisplayLabel(record.status),
				badgeTone: getStatusTone(record.status),
				href: `/interviews/${record.id}`
			})),
			recentCandidates: activeRecentCandidates.map((record) => ({
				id: `recent-candidate-${record.id}`,
				entityType: 'candidate',
				title: toCandidateName(record),
				subtitle: `${record.currentJobTitle || '-'} | ${record.currentEmployer || '-'}`,
				meta: `Owner: ${toOwnerName(record.ownerUser)}`,
				dateLabel: 'Added',
				dateValue: record.createdAt,
				badgeLabel: toDisplayLabel(record.status),
				badgeTone: getStatusTone(record.status),
				href: `/candidates/${record.id}`
			})),
			recentJobOrders: activeRecentJobOrders.map((record) => ({
				id: `recent-job-order-${record.id}`,
				entityType: 'jobOrder',
				title: record.title || `Job Order #${record.id}`,
				subtitle: record.client?.name || '-',
				meta: `Owner: ${toOwnerName(record.ownerUser)}`,
				dateLabel: 'Opened',
				dateValue: record.openedAt || record.updatedAt,
				badgeLabel: toDisplayLabel(record.status),
				badgeTone: getStatusTone(record.status),
				href: `/job-orders/${record.id}`
			}))
		};

		return NextResponse.json({
			kpis: {
				interviewsToday: activeInterviewsToday.length,
				submissionsAwaitingFeedback: activeAwaitingFeedbackSubmissions.length,
				webResponsesToReview: webResponsePriorityQueue.length,
				clientInterviewRequests: clientPortalEnabled ? interviewRequestPriorityQueue.length : 0,
				openJobsWithoutSubmissions7d: activeStaleOpenJobOrders.length,
				placementsThisMonth: activePlacementsThisMonth.length
			},
			trend: trendItems,
			sections,
			detailLists,
			featureFlags: {
				clientPortalEnabled
			}
		});
	} catch (error) {
		return handleError(error, 'Failed to load dashboard overview.');
	}
}

export const GET = withApiLogging('dashboard.overview.get', getDashboard_overviewHandler);
