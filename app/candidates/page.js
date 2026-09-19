'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, LayoutGrid, LayoutList, Plus, UploadCloud, X } from 'lucide-react';
import CandidateAdvancedSearchModal from '@/app/components/candidate-advanced-search-modal';
import EntityTable from '@/app/components/entity-table';
import SavedListViews from '@/app/components/saved-list-views';
import TableColumnPicker from '@/app/components/table-column-picker';
import KanbanBoard from '@/app/components/kanban-board';
import { useToast } from '@/app/components/toast-provider';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import useArchivedEntities from '@/app/hooks/use-archived-entities';
import {
	evaluateCandidateAdvancedCriteria,
	normalizeCandidateAdvancedCriteria,
	summarizeCandidateAdvancedCriterion
} from '@/lib/candidate-advanced-search';
import { formatDateTimeAt } from '@/lib/date-format';
import { sortByConfig } from '@/lib/list-sort';
import { buildPersonNameSearchText, formatPersonName } from '@/lib/person-name';
import { saveRecordNavigationContext, withRecordNavigationQuery } from '@/lib/record-navigation-context';
import { formatSelectValueLabel } from '@/lib/select-value-label';
import { CANDIDATE_STATUS_OPTIONS } from '@/lib/candidate-status';
import { getCandidateCompleteness } from '@/lib/candidate-completeness';
import { buildDefaultTableSortState, normalizeTableSortState } from '@/lib/table-sort';

const VIEW_MODE_STORAGE_KEY = 'candidates-list-view-mode';

function formatDateTime(value) {
	return formatDateTimeAt(value);
}

function formatLocation(city, state) {
	const parts = [city, state].map((value) => String(value || '').trim()).filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : '-';
}

function updateStatusDisplay(row, nextStatus, nextTimestamp) {
	const timestamp = nextTimestamp || row.lastActivityAt || row.updatedAt || new Date().toISOString();
	return {
		...row,
		status: nextStatus,
		statusLabel: formatSelectValueLabel(nextStatus),
		lastActivityAt: timestamp,
		lastActivityAtLabel: formatDateTime(timestamp)
	};
}

export default function CandidatesPage() {
	const router = useRouter();
	const { requestPrompt } = useConfirmDialog();
	const toast = useToast();
	const [rows, setRows] = useState([]);
	const [loading, setLoading] = useState(false);
	const [query, setQuery] = useState('');
	const [advancedCriteria, setAdvancedCriteria] = useState([]);
	const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
	const [viewMode, setViewMode] = useState('list');
	const [sortState, setSortState] = useState({ key: '', direction: 'asc' });
	const [movingRowIds, setMovingRowIds] = useState(new Set());
	const { archivedIdSet } = useArchivedEntities('CANDIDATE');

	const activeRows = useMemo(
		() => rows.filter((row) => !archivedIdSet.has(row.id)),
		[rows, archivedIdSet]
	);

	const ownerOptions = useMemo(() => {
		return [...new Set(activeRows.map((row) => row.ownerName).filter((value) => value && value !== '-'))].sort((a, b) =>
			String(a).localeCompare(String(b))
		);
	}, [activeRows]);

	const sourceOptions = useMemo(() => {
		return [...new Set(activeRows.map((row) => row.sourceLabel).filter((value) => value && value !== '-'))].sort((a, b) =>
			String(a).localeCompare(String(b))
		);
	}, [activeRows]);

	const divisionOptions = useMemo(() => {
		return [...new Set(activeRows.map((row) => row.divisionName).filter((value) => value && value !== '-'))].sort((a, b) =>
			String(a).localeCompare(String(b))
		);
	}, [activeRows]);

	const normalizedAdvancedCriteria = useMemo(
		() => normalizeCandidateAdvancedCriteria(advancedCriteria),
		[advancedCriteria]
	);

	const quickFilteredRows = useMemo(() => {
		const q = query.trim().toLowerCase();

		return activeRows.filter((row) => {
			const matchesQuery =
				!q ||
				`${row.nameSearchText} ${row.email} ${row.status} ${row.statusLabel} ${row.source ?? ''} ${row.currentEmployer ?? ''} ${row.ownerName ?? ''}`
					.toLowerCase()
					.includes(q);
			return matchesQuery;
		});
	}, [activeRows, query]);

	const filteredRows = useMemo(() => {
		return quickFilteredRows.filter((row) => evaluateCandidateAdvancedCriteria(row, normalizedAdvancedCriteria));
	}, [normalizedAdvancedCriteria, quickFilteredRows]);

	const advancedCriteriaSummary = useMemo(
		() => normalizedAdvancedCriteria.map((criterion) => summarizeCandidateAdvancedCriterion(criterion)).filter(Boolean),
		[normalizedAdvancedCriteria]
	);

	const kanbanRows = useMemo(() => {
		return [...filteredRows].sort((a, b) => {
			const aTime = new Date(a.lastActivityAt || a.updatedAt || a.createdAt || 0).getTime();
			const bTime = new Date(b.lastActivityAt || b.updatedAt || b.createdAt || 0).getTime();
			return bTime - aTime;
		});
	}, [filteredRows]);

	useEffect(() => {
		try {
			const stored = String(window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) || '').trim();
			if (stored === 'kanban' || stored === 'list') {
				setViewMode(stored);
			}
		} catch {
			// Ignore storage access errors.
		}
	}, []);

	async function load() {
		setLoading(true);
		try {
			const res = await fetch('/api/candidates');
			const data = await res.json();
			setRows(
				data.map((candidate) => {
					const structuredSkillNames = Array.isArray(candidate.candidateSkills)
						? candidate.candidateSkills
								.map((candidateSkill) => candidateSkill?.skill?.name)
								.filter(Boolean)
						: [];
					const freeformSkillSet = String(candidate.skillSet || '').trim();
					const skillsLabel = [...new Set([...structuredSkillNames, ...(freeformSkillSet ? [freeformSkillSet] : [])])].join(' • ');
					const lastActivityAt = candidate.lastActivityAt || candidate.updatedAt || candidate.createdAt || null;
					const completeness = getCandidateCompleteness({
						candidate,
						editForm: {
							firstName: candidate.firstName || '',
							lastName: candidate.lastName || '',
							email: candidate.email || '',
							mobile: candidate.mobile || candidate.phone || '',
							status: candidate.status || '',
							source: candidate.source || '',
							ownerId: candidate.ownerId == null ? '' : String(candidate.ownerId),
							currentJobTitle: candidate.currentJobTitle || '',
							currentEmployer: candidate.currentEmployer || '',
							address: candidate.address || '',
							city: candidate.city || '',
							state: candidate.state || '',
							zipCode: candidate.zipCode || '',
							website: candidate.website || '',
							linkedinUrl: candidate.linkedinUrl || '',
							summary: candidate.summary || '',
							skillIds: Array.isArray(candidate.candidateSkills)
								? candidate.candidateSkills
										.map((candidateSkill) => candidateSkill?.skill?.id)
										.filter(Boolean)
										.map((skillId) => String(skillId))
								: [],
							skillSet: candidate.skillSet || '',
							customFields: candidate.customFields || {}
						},
						customFieldDefinitions: []
					});
					return {
						...candidate,
						fullName: formatPersonName(candidate.firstName, candidate.lastName, { fallback: '-' }),
						displayName: formatPersonName(candidate.firstName, candidate.lastName, {
							format: 'last-first',
							fallback: '-'
						}),
						nameSearchText: buildPersonNameSearchText(candidate.firstName, candidate.lastName, {
							fallback: '-'
						}),
						statusLabel: formatSelectValueLabel(candidate.status),
						currentTitle: candidate.currentJobTitle || '-',
						currentEmployerLabel: candidate.currentEmployer || '-',
						emailLabel: candidate.email || '-',
						mobileLabel: candidate.mobile || candidate.phone || '-',
						sourceLabel: candidate.source || '-',
						skillsLabel,
						resumeSearchText: candidate.resumeSearchText || '',
						locationLabel: formatLocation(candidate.city, candidate.state),
						divisionName: candidate.division?.name || '-',
						lastActivityAt,
						lastActivityAtLabel: formatDateTime(lastActivityAt),
						completenessScore: completeness.scorePercent,
						completenessLabel: completeness.levelLabel,
						submissionCount: candidate._count?.submissions || 0,
						noteCount: candidate._count?.notes || 0,
						activityCount: candidate._count?.activities || 0,
						fileCount: candidate._count?.attachments || 0,
						ownerName: candidate.ownerUser
							? `${candidate.ownerUser.firstName} ${candidate.ownerUser.lastName}`.trim()
							: '-'
					};
				})
			);
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		load();
	}, []);

	function setNextViewMode(nextViewMode) {
		setViewMode(nextViewMode);
		try {
			window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, nextViewMode);
		} catch {
			// Ignore storage access errors.
		}
	}

	function persistNavigationContext() {
		const navigationRows = viewMode === 'kanban' ? kanbanRows : sortedListRows;
		saveRecordNavigationContext('candidate', {
			ids: navigationRows.map((row) => row.id),
			label: query.trim() || normalizedAdvancedCriteria.length > 0 ? 'Filtered Candidates' : 'Candidate List',
			listPath: '/candidates'
		});
	}

	function onOpen(row) {
		persistNavigationContext();
		router.push(withRecordNavigationQuery(`/candidates/${row.id}`));
	}

	function applySavedViewState(nextState = {}) {
		setQuery(String(nextState.query ?? ''));
		setAdvancedCriteria(normalizeCandidateAdvancedCriteria(nextState.advancedCriteria || []));
		setSortState(normalizeTableSortState(nextState.sortState));
		const nextViewMode = String(nextState.viewMode || 'list');
		setNextViewMode(nextViewMode === 'kanban' ? 'kanban' : 'list');
	}

	function removeAdvancedCriterion(indexToRemove) {
		setAdvancedCriteria((current) => current.filter((_, index) => index !== indexToRemove));
	}

	async function onMoveCandidate(rowId, nextStatus) {
		const target = rows.find((row) => String(row.id) === String(rowId));
		if (!target) return;
		if (String(target.status) === String(nextStatus)) return;

		const nextLabel = formatSelectValueLabel(nextStatus);
		const reason = await requestPrompt({
			title: 'Move Candidate',
			message: `Move ${target.fullName} to ${nextLabel}?\n\nEnter a reason for this stage change.`,
			inputLabel: 'Reason',
			confirmLabel: 'Move',
			cancelLabel: 'Cancel',
			required: true
		});
		if (!reason) return;

		const optimisticTimestamp = new Date().toISOString();
		setMovingRowIds((current) => {
			const next = new Set(current);
			next.add(String(rowId));
			return next;
		});
		setRows((current) =>
			current.map((row) =>
				String(row.id) === String(rowId) ? updateStatusDisplay(row, nextStatus, optimisticTimestamp) : row
			)
		);

		try {
			const res = await fetch(`/api/candidates/${rowId}/status`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: nextStatus, reason })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				setRows((current) =>
					current.map((row) => (String(row.id) === String(rowId) ? { ...target } : row))
				);
				toast.error(data.error || 'Failed to move candidate.');
				return;
			}

			const updatedTimestamp = data.updatedAt || optimisticTimestamp;
			setRows((current) =>
				current.map((row) =>
					String(row.id) === String(rowId)
						? updateStatusDisplay(row, data.status || nextStatus, updatedTimestamp)
						: row
				)
			);
			toast.success(`Moved ${target.fullName} to ${nextLabel}.`);
		} finally {
			setMovingRowIds((current) => {
				const next = new Set(current);
				next.delete(String(rowId));
				return next;
			});
		}
	}

	const columns = [
		{
			key: 'fullName',
			label: 'Name',
			getSortValue: (row) => row.displayName || row.fullName || '',
			render: (row) => row.displayName || row.fullName
		},
		{ key: 'currentTitle', label: 'Current Title' },
		{ key: 'currentEmployerLabel', label: 'Current Employer', defaultVisible: false },
		{ key: 'emailLabel', label: 'Email', defaultVisible: false },
		{ key: 'mobileLabel', label: 'Mobile', defaultVisible: false },
		{
			key: 'statusLabel',
			label: 'Status',
			getSortValue: (row) => row.status || ''
		},
		{
			key: 'completenessScore',
			label: 'Profile',
			getSortValue: (row) => Number(row.completenessScore || 0),
			render: (row) => {
				const score = Number(row.completenessScore || 0);
				const severityClass =
					score >= 85
						? ' candidate-completeness-list-chip-good'
						: score >= 65
							? ' candidate-completeness-list-chip-warn'
							: ' candidate-completeness-list-chip-poor';
				return (
				<span className={`chip candidate-completeness-list-chip${severityClass}`}>
					{Number(row.completenessScore || 0)}%
				</span>
				);
			}
		},
		{ key: 'ownerName', label: 'Owner' },
		{ key: 'sourceLabel', label: 'Source', defaultVisible: false },
		{ key: 'skillsLabel', label: 'Skills', defaultVisible: false },
		{ key: 'locationLabel', label: 'Location', defaultVisible: false },
		{ key: 'divisionName', label: 'Division', defaultVisible: false },
		{ key: 'submissionCount', label: 'Submissions', defaultVisible: false },
		{ key: 'noteCount', label: 'Notes', defaultVisible: false },
		{ key: 'activityCount', label: 'Activities', defaultVisible: false },
		{ key: 'fileCount', label: 'Files', defaultVisible: false },
		{
			key: 'lastActivityAtLabel',
			label: 'Last Activity Date',
			getSortValue: (row) => row.lastActivityAt || ''
		}
	];
	const defaultSortState = useMemo(() => buildDefaultTableSortState(columns), [columns]);
	const effectiveSortState = sortState.key ? sortState : defaultSortState;
	const sortedListRows = useMemo(() => {
		if (!effectiveSortState.key) return filteredRows;
		const sortColumn = columns.find((column) => column.key === effectiveSortState.key);
		if (!sortColumn) return filteredRows;

		return sortByConfig(
			filteredRows,
			{ field: effectiveSortState.key, direction: effectiveSortState.direction },
			(row) =>
				typeof sortColumn.getSortValue === 'function'
					? sortColumn.getSortValue(row)
					: row[sortColumn.key]
		);
	}, [columns, effectiveSortState.direction, effectiveSortState.key, filteredRows]);

	return (
		<section className="module-page">
			<header className="module-header module-header-list">
				<div>
					<h2>Candidates</h2>
				</div>
				<div className="module-header-actions">
					<Link
						href="/candidates/bulk-upload"
						className="btn-link btn-link-icon"
						aria-label="Bulk Upload Resumes"
						title="Bulk Upload Resumes"
					>
						<UploadCloud aria-hidden="true" className="btn-refresh-icon-svg" />
					</Link>
					<Link
						href="/candidates/new"
						className="btn-link btn-link-icon"
						aria-label="New Candidate"
						title="New Candidate"
					>
						<Plus aria-hidden="true" className="btn-refresh-icon-svg" />
					</Link>
				</div>
			</header>

			<article className="panel">
				<div className="panel-header-row">
					<h3>Candidate Pipeline</h3>
					<div className="view-toggle" role="tablist" aria-label="Candidate view mode">
						<button
							type="button"
							className={`btn-secondary view-toggle-button${viewMode === 'list' ? ' active' : ''}`}
							onClick={() => setNextViewMode('list')}
							role="tab"
							aria-selected={viewMode === 'list'}
						>
							<LayoutList aria-hidden="true" />
							List
						</button>
						<button
							type="button"
							className={`btn-secondary view-toggle-button${viewMode === 'kanban' ? ' active' : ''}`}
							onClick={() => setNextViewMode('kanban')}
							role="tab"
							aria-selected={viewMode === 'kanban'}
						>
							<LayoutGrid aria-hidden="true" />
							Kanban
						</button>
					</div>
				</div>
				<div className="list-controls candidates-list-controls">
					{advancedCriteriaSummary.length > 0 ? (
						<div className="candidates-search-token-field">
							<div className="candidates-search-token-field-chips" aria-label="Active advanced filters">
								{advancedCriteriaSummary.map((summary, index) => (
									<span key={`${summary}-${index}`} className="chip candidates-advanced-search-chip">
										<span>{summary}</span>
										<button
											type="button"
											className="candidates-advanced-search-chip-remove"
											onClick={() => removeAdvancedCriterion(index)}
											aria-label={`Remove ${summary}`}
											title={`Remove ${summary}`}
										>
											<X aria-hidden="true" />
										</button>
									</span>
								))}
								<input
									placeholder="Search within filtered candidates"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									aria-label="Search within advanced filtered candidates"
								/>
							</div>
						</div>
					) : (
						<input
							placeholder="Search name, owner, title, email"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					)}
					<div className="list-controls-toolbar-group candidates-list-controls-tools">
						<button
							type="button"
							className="table-toolbar-button candidates-advanced-search-toggle"
							onClick={() => setAdvancedSearchOpen(true)}
						>
							<Filter aria-hidden="true" />
							Advanced Search
							{advancedCriteriaSummary.length > 0 ? (
								<span className="candidates-advanced-search-count">{advancedCriteriaSummary.length}</span>
							) : null}
						</button>
						{viewMode === 'list' ? (
							<>
								<SavedListViews
									listKey="candidates"
									columns={columns}
									defaultState={{ query: '', advancedCriteria: [], sortState: defaultSortState, viewMode: 'list' }}
									currentState={{ query, advancedCriteria: normalizedAdvancedCriteria, sortState: effectiveSortState, viewMode }}
									onApplyState={applySavedViewState}
								/>
								<TableColumnPicker tableKey="candidates" columns={columns} />
							</>
						) : null}
					</div>
				</div>
				{viewMode === 'list' ? (
					<EntityTable
						tableKey="candidates"
						columns={columns}
						rows={filteredRows}
						loading={loading}
						loadingLabel="Loading candidates"
						sortState={sortState.key ? sortState : undefined}
						onSortStateChange={setSortState}
						rowActions={[{ label: 'Open', onClick: onOpen }]}
					/>
				) : (
					<KanbanBoard
						columns={CANDIDATE_STATUS_OPTIONS}
						rows={kanbanRows}
						getRowId={(row) => row.id}
						getRowColumn={(row) => row.status}
						loading={loading}
						loadingLabel="Loading candidates"
						movingRowIds={movingRowIds}
						emptyLabel="No candidates."
						onMove={onMoveCandidate}
						renderCard={(row) => (
							<div className="kanban-card-body">
								<button type="button" className="kanban-card-link" onClick={() => onOpen(row)}>
									{row.fullName}
								</button>
								<p className="kanban-card-meta">{row.currentTitle}</p>
								<p className="kanban-card-meta">{row.ownerName || '-'}</p>
								<p className="kanban-card-time">{row.lastActivityAtLabel}</p>
							</div>
						)}
					/>
				)}
			</article>
			<CandidateAdvancedSearchModal
				open={advancedSearchOpen}
				criteria={normalizedAdvancedCriteria}
				ownerOptions={ownerOptions}
				sourceOptions={sourceOptions}
				divisionOptions={divisionOptions}
				onApply={(nextCriteria) => {
					setAdvancedCriteria(normalizeCandidateAdvancedCriteria(nextCriteria));
					setAdvancedSearchOpen(false);
				}}
				onClose={() => setAdvancedSearchOpen(false)}
			/>
		</section>
	);
}
