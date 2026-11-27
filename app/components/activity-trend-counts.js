const ACTIVITY_METRICS = [
	{ key: 'candidates', shortLabel: 'C', label: 'Candidates', chipType: 'candidates' },
	{ key: 'jobOrders', shortLabel: 'J', label: 'Job Orders', chipType: 'jobs' },
	{ key: 'submissions', shortLabel: 'S', label: 'Submissions', chipType: 'submissions' },
	{ key: 'interviews', shortLabel: 'I', label: 'Interviews', chipType: 'interviews' },
	{ key: 'placements', shortLabel: 'P', label: 'Placements', chipType: 'placements' }
];

export function ActivityTrendLegend() {
	return (
		<p className="activity-trend-legend">
			{ACTIVITY_METRICS.map(({ key, shortLabel, label }) => (
				<span key={key}><strong>{shortLabel}</strong> = {label}</span>
			))}
		</p>
	);
}

export function ActivityTrendCounts({ counts, compact = false }) {
	return (
		<div className={compact ? 'report-trend-chips dashboard-trend-mini-chips' : 'report-trend-chips'}>
			{ACTIVITY_METRICS.map(({ key, shortLabel, label, chipType }) => (
				<span key={key} className={`chip report-trend-chip report-owner-chip-${chipType}`}>
					<abbr title={label}>{shortLabel}</abbr>{' '}{counts[key]}
				</span>
			))}
		</div>
	);
}
