'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import LoadingIndicator from '@/app/components/loading-indicator';
import { ActivityTrendCounts, ActivityTrendLegend } from '@/app/components/activity-trend-counts';

const DASHBOARD_SECTION_PAGE_SIZE = 4;

function formatDateTime(value) {
	if (!value) return '-';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '-';
	const datePart = date.toLocaleDateString(undefined, {
		month: 'numeric',
		day: 'numeric',
		year: 'numeric'
	});
	const timePart = date.toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit'
	});
	return `${datePart} @ ${timePart}`;
}

const EMPTY_OVERVIEW = {
	kpis: {
		interviewsToday: 0,
		submissionsAwaitingFeedback: 0,
		webResponsesToReview: 0,
		clientInterviewRequests: 0,
		openJobsWithoutSubmissions7d: 0,
		placementsThisMonth: 0
	},
	trend: [],
	sections: {
		needsAttention: [],
		upcomingInterviews: [],
		recentCandidates: [],
		recentJobOrders: []
	},
	detailLists: {
		interviewsToday: [],
		awaitingFeedback: [],
		webResponsesToReview: [],
		clientInterviewRequests: [],
		stalledJobs: [],
		placementsThisMonth: []
	},
	featureFlags: {
		clientPortalEnabled: true
	}
};

function toEntityLabel(entityType) {
	const normalized = String(entityType || '').trim().toLowerCase();
	if (normalized === 'candidate') return 'Candidate';
	if (normalized === 'client') return 'Client';
	if (normalized === 'contact') return 'Contact';
	if (normalized === 'joborder' || normalized === 'job_order') return 'Job Order';
	if (normalized === 'submission') return 'Submission';
	if (normalized === 'interview') return 'Interview';
	if (normalized === 'placement') return 'Placement';
	return 'Record';
}

function DashboardSection({ title, items, emptyMessage, onViewAll, currentPage, onPageChange }) {
	const totalPages = Math.max(1, Math.ceil(items.length / DASHBOARD_SECTION_PAGE_SIZE));
	const safePage = Math.min(Math.max(1, currentPage || 1), totalPages);
	const pagedItems = items.slice(
		(safePage - 1) * DASHBOARD_SECTION_PAGE_SIZE,
		safePage * DASHBOARD_SECTION_PAGE_SIZE
	);

	return (
		<article className="panel panel-spacious dashboard-section-panel">
			<div className="panel-header-row dashboard-section-head">
				<h3>{title}</h3>
				{items.length > 0 ? (
					<button type="button" className="btn-secondary btn-compact" onClick={onViewAll}>
						View All
					</button>
				) : null}
			</div>
			<div className="dashboard-section-body">
			{items.length === 0 ? (
				<div className="dashboard-empty-state dashboard-section-empty-state">
					<p className="panel-subtext">{emptyMessage}</p>
				</div>
			) : (
				<ul className="simple-list dashboard-split-list dashboard-focus-list">
					{pagedItems.map((item) => (
						<li key={item.id} className="dashboard-recent-item" data-entity-type={item.entityType || ''}>
							<div>
								<div className="dashboard-item-headline">
									<span className="dashboard-entity-chip">{toEntityLabel(item.entityType)}</span>
								</div>
								<strong>
									<Link href={item.href}>{item.title || '-'}</Link>
								</strong>
								<p>{item.subtitle || '-'}</p>
								{item.meta ? <p>{item.meta}</p> : null}
								{item.dateValue ? <p>{item.dateLabel || 'Updated'}: {formatDateTime(item.dateValue)}</p> : null}
							</div>
							<div className="simple-list-actions simple-list-indicators">
								<span className="chip dashboard-badge-chip" data-tone={item.badgeTone}>{item.badgeLabel || '-'}</span>
							</div>
						</li>
					))}
				</ul>
			)}
			</div>
			{items.length > DASHBOARD_SECTION_PAGE_SIZE ? (
				<div className="dashboard-section-pagination">
					<span className="dashboard-section-pagination-copy">
						Page {safePage} of {totalPages}
					</span>
					<div className="dashboard-section-pagination-actions">
						<button
							type="button"
							className="btn-secondary btn-compact"
							onClick={() => onPageChange(Math.max(1, safePage - 1))}
							disabled={safePage <= 1}
							aria-label={`Previous page for ${title}`}
						>
							<ChevronLeft aria-hidden="true" className="btn-refresh-icon-svg" />
						</button>
						<button
							type="button"
							className="btn-secondary btn-compact"
							onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
							disabled={safePage >= totalPages}
							aria-label={`Next page for ${title}`}
						>
							<ChevronRight aria-hidden="true" className="btn-refresh-icon-svg" />
						</button>
					</div>
				</div>
			) : null}
		</article>
	);
}

function DashboardDetailModal({ title, items, onClose }) {
	return (
		<div className="confirm-overlay" onClick={onClose}>
			<div
				className="confirm-dialog report-detail-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="dashboard-detail-modal-title"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="report-detail-modal-head">
					<h3 id="dashboard-detail-modal-title" className="confirm-title">
						{title}
					</h3>
					<button
						type="button"
						className="btn-secondary btn-link-icon report-detail-modal-close"
						onClick={onClose}
						aria-label="Close dashboard detail"
						title="Close"
					>
						<X aria-hidden="true" className="btn-refresh-icon-svg" />
					</button>
				</div>
				<div className="report-detail-modal-body">
					{items.length === 0 ? (
						<p className="panel-subtext">No records yet.</p>
					) : (
						<ul className="simple-list report-detail-list">
							{items.map((item) => (
								<li key={item.id} className="dashboard-recent-item" data-entity-type={item.entityType || ''}>
									<div>
										<div className="dashboard-item-headline">
											<span className="dashboard-entity-chip">{toEntityLabel(item.entityType)}</span>
										</div>
										<strong>
											<Link href={item.href}>{item.title || '-'}</Link>
										</strong>
										<p>{item.subtitle || '-'}</p>
										{item.meta ? <p className="simple-list-meta">{item.meta}</p> : null}
										{item.dateValue ? (
											<p className="simple-list-meta">{item.dateLabel || 'Updated'}: {formatDateTime(item.dateValue)}</p>
										) : null}
									</div>
									<div className="simple-list-actions simple-list-indicators">
										<span className="chip dashboard-badge-chip" data-tone={item.badgeTone}>{item.badgeLabel || '-'}</span>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

export default function HomePage() {
	const [overview, setOverview] = useState(EMPTY_OVERVIEW);
	const [loading, setLoading] = useState(true);
	const [detailModal, setDetailModal] = useState({ open: false, title: '', items: [] });
	const [sectionPages, setSectionPages] = useState({
		needsAttention: 1,
		upcomingInterviews: 1,
		recentCandidates: 1,
		recentJobOrders: 1
	});

	useEffect(() => {
		let active = true;

		async function load() {
			setLoading(true);

			try {
				const res = await fetch('/api/dashboard/overview');
				const data = await res.json().catch(() => ({}));

				if (!res.ok) {
					if (!active) return;
					setOverview(EMPTY_OVERVIEW);
					return;
				}

				if (!active) return;
				setOverview({
					kpis: data.kpis || EMPTY_OVERVIEW.kpis,
					trend: Array.isArray(data.trend) ? data.trend : [],
					sections: {
						needsAttention: Array.isArray(data.sections?.needsAttention) ? data.sections.needsAttention : [],
						upcomingInterviews: Array.isArray(data.sections?.upcomingInterviews)
							? data.sections.upcomingInterviews
							: [],
						recentCandidates: Array.isArray(data.sections?.recentCandidates)
							? data.sections.recentCandidates
							: [],
						recentJobOrders: Array.isArray(data.sections?.recentJobOrders) ? data.sections.recentJobOrders : []
					},
					detailLists: {
						interviewsToday: Array.isArray(data.detailLists?.interviewsToday) ? data.detailLists.interviewsToday : [],
						awaitingFeedback: Array.isArray(data.detailLists?.awaitingFeedback)
							? data.detailLists.awaitingFeedback
							: [],
						webResponsesToReview: Array.isArray(data.detailLists?.webResponsesToReview)
							? data.detailLists.webResponsesToReview
							: [],
						clientInterviewRequests: Array.isArray(data.detailLists?.clientInterviewRequests)
							? data.detailLists.clientInterviewRequests
							: [],
						stalledJobs: Array.isArray(data.detailLists?.stalledJobs) ? data.detailLists.stalledJobs : [],
						placementsThisMonth: Array.isArray(data.detailLists?.placementsThisMonth)
							? data.detailLists.placementsThisMonth
							: []
					},
					featureFlags: {
						clientPortalEnabled:
							typeof data.featureFlags?.clientPortalEnabled === 'boolean'
								? data.featureFlags.clientPortalEnabled
								: true
					}
				});
			} catch {
				if (!active) return;
				setOverview(EMPTY_OVERVIEW);
			} finally {
				if (active) setLoading(false);
			}
		}

		load();
		return () => {
			active = false;
		};
	}, []);

	const kpiCards = useMemo(
		() => [
			{
				key: 'interviewsToday',
				label: 'Interviews Today',
				value: overview.kpis.interviewsToday,
				detailTitle: 'Interviews Today',
				detailItems: overview.detailLists.interviewsToday
			},
			{
				key: 'submissionsAwaitingFeedback',
				label: 'Awaiting Feedback',
				value: overview.kpis.submissionsAwaitingFeedback,
				detailTitle: 'Awaiting Feedback',
				detailItems: overview.detailLists.awaitingFeedback
			},
			{
				key: 'webResponsesToReview',
				label: 'Web Responses',
				value: overview.kpis.webResponsesToReview,
				detailTitle: 'Web Responses To Review',
				detailItems: overview.detailLists.webResponsesToReview
			},
			{
				key: 'clientInterviewRequests',
				label: 'Interview Requests',
				value: overview.kpis.clientInterviewRequests,
				detailTitle: 'Client Interview Requests',
				detailItems: overview.detailLists.clientInterviewRequests
			},
			{
				key: 'openJobsWithoutSubmissions7d',
				label: 'Open Jobs Stalled 7d',
				value: overview.kpis.openJobsWithoutSubmissions7d,
				detailTitle: 'Open Jobs Stalled 7 Days',
				detailItems: overview.detailLists.stalledJobs
			},
			{
				key: 'placementsThisMonth',
				label: 'Placements This Month',
				value: overview.kpis.placementsThisMonth,
				detailTitle: 'Placements This Month',
				detailItems: overview.detailLists.placementsThisMonth
			}
		].filter((card) => {
			if (card.key === 'clientInterviewRequests') {
				return overview.featureFlags.clientPortalEnabled;
			}
			return true;
		}),
		[overview.kpis, overview.detailLists, overview.featureFlags.clientPortalEnabled]
	);

	function openDetail(title, items) {
		setDetailModal({ open: true, title, items: Array.isArray(items) ? items : [] });
	}

	function setSectionPage(sectionKey, nextPage) {
		setSectionPages((current) => ({ ...current, [sectionKey]: nextPage }));
	}

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<h2>Dashboard</h2>
				</div>
			</header>

			<article className="panel panel-spacious">
				<h3>Key Metrics</h3>
				<div
					className="metric-grid dashboard-metric-grid"
					data-count={kpiCards.length}
					data-remainder={kpiCards.length % 4}
				>
					{kpiCards.map((card) => (
						<button
							key={card.key}
							type="button"
							className="metric-card dashboard-metric-button"
							onClick={() => openDetail(card.detailTitle, card.detailItems)}
						>
							<p className="metric-label">{card.label}</p>
							<p className="metric-value">{card.value}</p>
							<span className="metric-link">View details</span>
						</button>
					))}
				</div>
			</article>

			<article className="panel panel-spacious dashboard-trend-panel">
				<h3>7-Day Activity</h3>
				{!loading && overview.trend.length > 0 ? <ActivityTrendLegend /> : null}
				{loading ? <LoadingIndicator className="list-loading-indicator" label="Loading dashboard activity" /> : null}
				{!loading && overview.trend.length === 0 ? (
					<div className="dashboard-empty-state">
						<p className="panel-subtext">No records yet.</p>
					</div>
				) : null}
				{!loading && overview.trend.length > 0 ? (
					<div className="dashboard-trend-strip">
						{overview.trend.map((item) => (
							<div key={item.dateKey} className="dashboard-trend-day">
								<p className="dashboard-trend-day-label">{item.label}</p>
								<p className="dashboard-trend-day-total">{item.total}</p>
								<ActivityTrendCounts counts={item} compact />
							</div>
						))}
					</div>
				) : null}
			</article>

			{loading ? (
				<article className="panel panel-spacious">
					<LoadingIndicator className="list-loading-indicator" label="Loading dashboard" />
				</article>
			) : (
				<div className="dashboard-section-grid">
					<DashboardSection
						title="Needs Attention"
						items={overview.sections.needsAttention}
						emptyMessage="No records need attention right now."
						onViewAll={() => openDetail('Needs Attention', overview.sections.needsAttention)}
						currentPage={sectionPages.needsAttention}
						onPageChange={(nextPage) => setSectionPage('needsAttention', nextPage)}
					/>
					<DashboardSection
						title="Upcoming Interviews"
						items={overview.sections.upcomingInterviews}
						emptyMessage="No records yet."
						onViewAll={() => openDetail('Upcoming Interviews', overview.sections.upcomingInterviews)}
						currentPage={sectionPages.upcomingInterviews}
						onPageChange={(nextPage) => setSectionPage('upcomingInterviews', nextPage)}
					/>
					<DashboardSection
						title="Recently Added Candidates"
						items={overview.sections.recentCandidates}
						emptyMessage="No records yet."
						onViewAll={() => openDetail('Recently Added Candidates', overview.sections.recentCandidates)}
						currentPage={sectionPages.recentCandidates}
						onPageChange={(nextPage) => setSectionPage('recentCandidates', nextPage)}
					/>
					<DashboardSection
						title="Recently Opened Job Orders"
						items={overview.sections.recentJobOrders}
						emptyMessage="No records yet."
						onViewAll={() => openDetail('Recently Opened Job Orders', overview.sections.recentJobOrders)}
						currentPage={sectionPages.recentJobOrders}
						onPageChange={(nextPage) => setSectionPage('recentJobOrders', nextPage)}
					/>
				</div>
			)}

			{detailModal.open ? (
				<DashboardDetailModal
					title={detailModal.title}
					items={detailModal.items}
					onClose={() => setDetailModal({ open: false, title: '', items: [] })}
				/>
			) : null}
		</section>
	);
}
