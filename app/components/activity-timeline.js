'use client';

import Link from 'next/link';
import { formatDateTimeAt } from '@/lib/date-format';

function formatTimelineTime(value) {
	return value ? formatDateTimeAt(value) : '';
}

function getCategoryLabel(category) {
	const normalized = String(category || '').trim().toLowerCase();
	if (normalized === 'record') return 'Record';
	if (normalized === 'status') return 'Status';
	if (normalized === 'note') return 'Note';
	if (normalized === 'activity') return 'Activity';
	if (normalized === 'file') return 'File';
	if (normalized === 'submission') return 'Submission';
	if (normalized === 'interview') return 'Interview';
	if (normalized === 'placement') return 'Placement';
	if (normalized === 'portal') return 'Portal';
	if (normalized === 'feedback') return 'Feedback';
	if (normalized === 'ai') return 'AI';
	return normalized ? normalized.replace(/\b\w/g, (match) => match.toUpperCase()) : 'Event';
}

export default function ActivityTimeline({ items, emptyText = 'No timeline events yet.' }) {
	if (!Array.isArray(items) || items.length === 0) {
		return <p className="panel-subtext">{emptyText}</p>;
	}

	return (
		<ul className="activity-timeline-list">
			{items.map((item) => (
				<li key={item.id} className="activity-timeline-item">
					<div className="activity-timeline-card">
						<div className="activity-timeline-head">
							<div className="activity-timeline-head-main">
								<span className={`chip activity-timeline-category activity-timeline-category-${item.category || 'record'}`}>
									{getCategoryLabel(item.category)}
								</span>
								<strong className="activity-timeline-title">
									{item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
								</strong>
							</div>
						</div>
						{item.detail ? <p className="activity-timeline-detail">{item.detail}</p> : null}
						{item.content ? (
							<details className="activity-timeline-message">
								<summary>{item.contentLabel}</summary>
								<p>{item.content}</p>
							</details>
						) : null}
						{item.meta || item.timestamp ? (
							<div className="activity-timeline-foot">
								{item.meta ? <p className="simple-list-meta activity-timeline-meta">{item.meta}</p> : <span />}
								{item.timestamp ? (
									<span className="simple-list-meta activity-timeline-time">
										<span className="meta-emphasis-time">{formatTimelineTime(item.timestamp)}</span>
									</span>
								) : null}
							</div>
						) : null}
					</div>
				</li>
			))}
		</ul>
	);
}
