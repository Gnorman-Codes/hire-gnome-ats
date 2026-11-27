'use client';

import { Download, LoaderCircle, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import LoadingIndicator from '@/app/components/loading-indicator';
import { ActivityTrendCounts, ActivityTrendLegend } from '@/app/components/activity-trend-counts';
import { useToast } from '@/app/components/toast-provider';
import ReportPipelinePanel from '@/app/components/reports/report-pipeline-panel';
import ReportOwnerPerformancePanel from '@/app/components/reports/report-owner-performance-panel';
import ReportDetailModal from '@/app/components/reports/report-detail-modal';

function toDateInputValue(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function defaultFilters() {
	const today = new Date();
	const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6, 0, 0, 0, 0);
	return {
		startDate: toDateInputValue(start),
		endDate: toDateInputValue(new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0)),
		divisionId: '',
		ownerId: ''
	};
}

function buildQuery(filters) {
	const params = new URLSearchParams();
	if (filters.startDate) params.set('startDate', filters.startDate);
	if (filters.endDate) params.set('endDate', filters.endDate);
	if (filters.divisionId) params.set('divisionId', filters.divisionId);
	if (filters.ownerId) params.set('ownerId', filters.ownerId);
	return params.toString();
}

function buildDetailQuery(filters, selection) {
	const params = new URLSearchParams();
	if (filters.startDate) params.set('startDate', filters.startDate);
	if (filters.endDate) params.set('endDate', filters.endDate);
	if (filters.divisionId) params.set('divisionId', filters.divisionId);
	if (filters.ownerId) params.set('ownerId', filters.ownerId);
	params.set('group', selection.group);
	params.set('key', selection.key);
	if (selection.value) params.set('value', selection.value);
	return params.toString();
}

function sumSeries(series) {
	return (Array.isArray(series) ? series : []).reduce((total, item) => total + Number(item?.count || 0), 0);
}

function emptyReportState() {
	return {
		appliedFilters: defaultFilters(),
		scope: {
			role: 'RECRUITER',
			canFilterDivision: false,
			canFilterOwner: false,
			lockedToOwnData: false
		},
		filterOptions: {
			divisions: [],
			owners: []
		},
		summary: {
			candidatesAdded: 0,
			jobOrdersOpened: 0,
			submissionsCreated: 0,
			interviewsScheduled: 0,
			placementsClosed: 0,
			openJobOrders: 0
		},
		pipeline: {
			candidates: [],
			jobOrders: [],
			submissions: [],
			placements: [],
			interviewTypes: []
		},
		trend: [],
		ownerPerformance: []
	};
}

function emptyDetailState() {
	return {
		title: '',
		rows: []
	};
}

function kpiCards(summary) {
	return [
		{ key: 'candidatesAdded', label: 'New Candidates', value: summary.candidatesAdded },
		{ key: 'jobOrdersOpened', label: 'New Job Orders', value: summary.jobOrdersOpened },
		{ key: 'submissionsCreated', label: 'New Submissions', value: summary.submissionsCreated },
		{ key: 'interviewsScheduled', label: 'New Interviews', value: summary.interviewsScheduled },
		{ key: 'placementsClosed', label: 'Placements', value: summary.placementsClosed },
		{ key: 'openJobOrders', label: 'Open Job Orders', value: summary.openJobOrders }
	];
}

export default function ReportsPage() {
	const toast = useToast();
	const [filters, setFilters] = useState(defaultFilters);
	const [report, setReport] = useState(emptyReportState);
	const [detail, setDetail] = useState(emptyDetailState);
	const [detailSelection, setDetailSelection] = useState(null);
	const [loading, setLoading] = useState(true);
	const [applying, setApplying] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailModalOpen, setDetailModalOpen] = useState(false);

	const summaryCards = useMemo(() => kpiCards(report.summary), [report.summary]);
	const trendRows = useMemo(() => {
		return Array.isArray(report.trend) ? report.trend : [];
	}, [report.trend]);
	const trendMax = useMemo(() => {
		return Math.max(1, ...(trendRows.map((item) => Number(item?.total || 0))));
	}, [trendRows]);

	async function loadDetail(nextSelection, nextFilters = filters) {
		setDetailLoading(true);
		setDetailSelection(nextSelection);
		setDetailModalOpen(true);
		try {
			const query = buildDetailQuery(nextFilters, nextSelection);
			const res = await fetch(`/api/reports/operational/details?${query}`, {
				cache: 'no-store'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data?.error || 'Failed to load report detail.');
			}
			setDetail({
				title: data?.title || nextSelection.label || 'Report Detail',
				rows: Array.isArray(data?.rows) ? data.rows : []
			});
		} catch (error) {
			toast.error(error.message || 'Failed to load report detail.');
		} finally {
			setDetailLoading(false);
		}
	}

	useEffect(() => {
		if (!detailModalOpen) return undefined;

		function onKeyDown(event) {
			if (event.key === 'Escape') {
				setDetailModalOpen(false);
			}
		}

		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [detailModalOpen]);

	async function load(nextFilters, { initial = false } = {}) {
		if (initial) {
			setLoading(true);
		} else {
			setApplying(true);
		}

		try {
			const query = buildQuery(nextFilters);
			const res = await fetch(`/api/reports/operational${query ? `?${query}` : ''}`, {
				cache: 'no-store'
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data?.error || 'Failed to load operational report.');
			}

			setReport({
				...emptyReportState(),
				...data
			});
			setFilters({
				startDate: data?.appliedFilters?.startDate || nextFilters.startDate,
				endDate: data?.appliedFilters?.endDate || nextFilters.endDate,
				divisionId: data?.appliedFilters?.divisionId ? String(data.appliedFilters.divisionId) : '',
				ownerId: data?.appliedFilters?.ownerId ? String(data.appliedFilters.ownerId) : ''
			});
		} catch (error) {
			toast.error(error.message || 'Failed to load operational report.');
		} finally {
			if (initial) {
				setLoading(false);
			} else {
				setApplying(false);
			}
		}
	}

	useEffect(() => {
		load(defaultFilters(), { initial: true });
	}, []);

	function onApply(event) {
		event.preventDefault();
		load(filters);
	}

	function onReset() {
		const next = defaultFilters();
		setFilters(next);
		load(next);
	}

	function onSelectDetail(selection) {
		loadDetail(selection, filters);
	}

	function onSelectOwnerDetail(owner, key, label) {
		loadDetail(
			{
				group: 'ownerPerformance',
				key,
				value: owner.ownerId ? String(owner.ownerId) : 'unassigned',
				label: `${owner.ownerName} - ${label}`
			},
			filters
		);
	}

	async function onExportExcel() {
		setExporting(true);
		try {
			const query = buildQuery(filters);
			const res = await fetch(`/api/reports/operational/export${query ? `?${query}` : ''}`, {
				cache: 'no-store'
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data?.error || 'Failed to export report.');
			}

			const blob = await res.blob();
			const objectUrl = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			const disposition = res.headers.get('content-disposition') || '';
			const fileNameMatch = disposition.match(/filename="?([^"]+)"?/i);
			link.href = objectUrl;
			link.download = fileNameMatch?.[1] || 'operational-report.xlsx';
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.URL.revokeObjectURL(objectUrl);
		} catch (error) {
			toast.error(error.message || 'Failed to export report.');
		} finally {
			setExporting(false);
		}
	}

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<h2>Operational Reporting</h2>
				</div>
			</header>

			<article className="panel panel-spacious">
				<div className="panel-header-row">
					<h3>Report Filters</h3>
					<div className="report-filter-actions">
						<button
							type="button"
							className="btn-secondary btn-link-icon"
							onClick={onReset}
							disabled={loading || applying}
							aria-label="Reset report filters"
							title="Reset report filters"
						>
							<RotateCcw aria-hidden="true" className="btn-refresh-icon-svg" />
						</button>
						<button
							type="button"
							className="btn-secondary btn-link-icon"
							onClick={onExportExcel}
							disabled={loading || applying || exporting || detailLoading}
							aria-label={exporting ? 'Exporting report' : 'Export report to Excel'}
							title={exporting ? 'Exporting report' : 'Export report to Excel'}
						>
							{exporting ? (
								<LoaderCircle aria-hidden="true" className="btn-refresh-icon-svg row-action-icon-spinner" />
							) : (
								<Download aria-hidden="true" className="btn-refresh-icon-svg" />
							)}
						</button>
						<button
							type="submit"
							form="operational-report-form"
							className="btn-link btn-link-icon"
							disabled={loading || applying || detailLoading}
							aria-label={applying ? 'Running report' : 'Run report'}
							title={applying ? 'Running report' : 'Run report'}
						>
							{applying ? (
								<LoaderCircle aria-hidden="true" className="btn-refresh-icon-svg row-action-icon-spinner" />
							) : (
								<Play aria-hidden="true" className="btn-refresh-icon-svg" />
							)}
						</button>
					</div>
				</div>
				<form id="operational-report-form" className="report-filter-form" onSubmit={onApply}>
					<div className="report-filter-grid">
						<label>
							<span>Start Date</span>
							<input
								type="date"
								value={filters.startDate}
								onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
								required
							/>
						</label>
						<label>
							<span>End Date</span>
							<input
								type="date"
								value={filters.endDate}
								onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
								required
							/>
						</label>
						<label>
							<span>Division</span>
							<select
								value={filters.divisionId}
								onChange={(event) =>
									setFilters((current) => ({
										...current,
										divisionId: event.target.value,
										ownerId: ''
									}))
								}
								disabled={!report.scope.canFilterDivision || loading || applying}
							>
								<option value="">All Divisions</option>
								{report.filterOptions.divisions.map((division) => (
									<option key={division.id} value={division.id}>
										{division.name}
									</option>
								))}
							</select>
						</label>
						<label>
							<span>Owner</span>
							<select
								value={filters.ownerId}
								onChange={(event) => setFilters((current) => ({ ...current, ownerId: event.target.value }))}
								disabled={!report.scope.canFilterOwner || loading || applying}
							>
								<option value="">{report.scope.lockedToOwnData ? 'Your Data Only' : 'All Owners'}</option>
								{report.filterOptions.owners.map((owner) => (
									<option key={owner.id} value={owner.id}>
										{owner.name}
									</option>
								))}
							</select>
						</label>
					</div>
				</form>
				<div className="report-scope-row">
					{report.scope.lockedToOwnData ? <span className="chip">Recruiter reporting is locked to your data</span> : null}
					{applying ? <span className="chip">Refreshing report...</span> : null}
				</div>
			</article>

			{loading ? (
				<article className="panel panel-spacious">
					<LoadingIndicator className="list-loading-indicator" label="Loading operational reporting" />
				</article>
			) : (
				<>
					<article className="panel panel-spacious">
						<h3>Summary</h3>
						<div className="report-summary-grid">
							{summaryCards.map((card) => (
								<button
									key={card.key}
									type="button"
									className="metric-card report-detail-button report-summary-card"
									onClick={() => onSelectDetail({ group: 'summary', key: card.key, value: '', label: card.label })}
								>
									<p className="metric-label">{card.label}</p>
									<p className="metric-value">{card.value}</p>
								</button>
							))}
						</div>
					</article>

					<article className="panel panel-spacious">
						<h3>Daily Activity Trend</h3>
						{trendRows.length > 0 ? <ActivityTrendLegend /> : null}
						{trendRows.length === 0 ? <p className="panel-subtext">No records yet.</p> : null}
						{trendRows.length > 0 ? (
							<div className="report-trend-list">
								{trendRows.map((item) => (
									<div key={item.dateKey} className="report-trend-row">
										<div className="report-trend-date">
											<strong>{item.label}</strong>
											<p>{item.total} total</p>
										</div>
										<div className="report-trend-bar-track" aria-hidden="true">
											<div
												className="report-trend-bar-fill"
												style={{ width: `${Math.max(6, (Number(item.total || 0) / trendMax) * 100)}%` }}
											/>
										</div>
									<ActivityTrendCounts counts={item} />
									</div>
								))}
							</div>
						) : null}
					</article>

					<div className="module-grid report-pipeline-grid">
						<ReportPipelinePanel
							title="Candidate Pipeline"
							detailKey="candidates"
							series={report.pipeline.candidates}
							total={sumSeries(report.pipeline.candidates)}
							onSelectDetail={onSelectDetail}
						/>
						<ReportPipelinePanel
							title="Job Order Pipeline"
							detailKey="jobOrders"
							series={report.pipeline.jobOrders}
							total={sumSeries(report.pipeline.jobOrders)}
							onSelectDetail={onSelectDetail}
						/>
						<ReportPipelinePanel
							title="Submission Pipeline"
							detailKey="submissions"
							series={report.pipeline.submissions}
							total={sumSeries(report.pipeline.submissions)}
							onSelectDetail={onSelectDetail}
						/>
						<ReportPipelinePanel
							title="Placement Pipeline"
							detailKey="placements"
							series={report.pipeline.placements}
							total={sumSeries(report.pipeline.placements)}
							onSelectDetail={onSelectDetail}
						/>
					</div>

					<div className="module-grid report-detail-grid">
						<article className="panel panel-spacious">
							<div className="panel-header-row">
								<h3>Interview Mix</h3>
								<button
									type="button"
									className="btn-secondary report-detail-button"
									onClick={() =>
										onSelectDetail({
											group: 'pipeline',
											key: 'interviewTypes',
											value: 'all',
											label: 'All Interviews'
										})
									}
								>
									View All
								</button>
							</div>
							<div className="report-series-grid">
								{report.pipeline.interviewTypes.map((item) => (
									<button
										key={item.value}
										type="button"
										className="report-series-card report-detail-button"
										onClick={() =>
											onSelectDetail({
												group: 'pipeline',
												key: 'interviewTypes',
												value: item.value,
												label: `Interview Mix - ${item.label}`
											})
										}
									>
										<p className="metric-label">{item.label}</p>
										<p className="report-series-value">{item.count}</p>
									</button>
								))}
							</div>
						</article>
					</div>

					<ReportOwnerPerformancePanel owners={report.ownerPerformance} onSelectOwnerDetail={onSelectOwnerDetail} />

				</>
			)}
			<ReportDetailModal open={detailModalOpen} detail={detail} detailLoading={detailLoading} onClose={() => setDetailModalOpen(false)} />
		</section>
	);
}
