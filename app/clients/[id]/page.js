'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, MoreVertical, Save } from 'lucide-react';
import LookupTypeaheadSelect from '@/app/components/lookup-typeahead-select';
import AddressTypeaheadInput from '@/app/components/address-typeahead-input';
import FormField from '@/app/components/form-field';
import PhoneInput from '@/app/components/phone-input';
import LoadingIndicator from '@/app/components/loading-indicator';
import SaveActionButton from '@/app/components/save-action-button';
import CustomFieldsSection, { areRequiredCustomFieldsComplete } from '@/app/components/custom-fields-section';
import SyncedNoteActions from '@/app/components/synced-note-actions';
import { isSyncedActivityNote } from '@/lib/synced-activity-note';
import ListSortControls from '@/app/components/list-sort-controls';
import AuditTrailPanel from '@/app/components/audit-trail-panel';
import { useToast } from '@/app/components/toast-provider';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import useArchivedEntities from '@/app/hooks/use-archived-entities';
import useIsAdministrator from '@/app/hooks/use-is-administrator';
import { INDUSTRY_OPTIONS, normalizeIndustryValue } from '@/app/constants/industry-options';
import useUnsavedChangesGuard from '@/app/hooks/use-unsaved-changes-guard';
import { cascadeSelectionFromIds, getArchiveCascadeOptions } from '@/lib/archive-cascade-options';
import { formatDateTimeAt } from '@/lib/date-format';
import {
	clearRecordNavigationContext,
	readRecordNavigationContext,
	RECORD_NAVIGATION_QUERY_PARAM,
	withRecordNavigationQuery
} from '@/lib/record-navigation-context';
import { formatSelectValueLabel } from '@/lib/select-value-label';
import { sortByConfig } from '@/lib/list-sort';
import { isValidOptionalHttpUrl } from '@/lib/url-validation';
import { CLIENT_STATUS_OPTIONS, normalizeClientStatusValue } from '@/lib/client-status-options';

const initialForm = {
	name: '',
	industry: '',
	status: 'Prospect',
	divisionId: '',
	ownerId: '',
	phone: '',
	address: '',
	city: '',
	state: '',
	zipCode: '',
	website: '',
	description: '',
	customFields: {}
};

function toForm(row) {
	if (!row) return initialForm;
	return {
		name: row.name || '',
		industry: normalizeIndustryValue(row.industry),
		status: normalizeClientStatusValue(row.status),
		divisionId: row.divisionId == null ? '' : String(row.divisionId),
		ownerId: row.ownerId == null ? '' : String(row.ownerId),
		phone: row.phone || '',
		address: row.address || '',
		city: row.city || '',
		state: row.state || '',
		zipCode: row.zipCode || '',
		website: row.website || '',
		description: row.description || '',
		customFields:
			row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
				? row.customFields
				: {}
	};
}

function formatDate(value) {
	return formatDateTimeAt(value);
}

function normalizeZipFromPlace(postalCode) {
	const match = String(postalCode || '').match(/\d{5}/);
	return match ? match[0] : '';
}

export default function ClientDetailsPage() {
	const { id } = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const actionsMenuRef = useRef(null);
	const [actingUser, setActingUser] = useState(null);
	const [client, setClient] = useState(null);
	const [form, setForm] = useState(initialForm);
	const [noteContent, setNoteContent] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });
	const [noteState, setNoteState] = useState({ saving: false, error: '' });
	const [actionsOpen, setActionsOpen] = useState(false);
	const [showAuditTrail, setShowAuditTrail] = useState(false);
	const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
	const [workspaceTab, setWorkspaceTab] = useState('notes');
	const [detailsPanelHeight, setDetailsPanelHeight] = useState(0);
	const [notesSort, setNotesSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [contactsSort, setContactsSort] = useState({ field: 'name', direction: 'asc' });
	const [jobsSort, setJobsSort] = useState({ field: 'title', direction: 'asc' });
	const [recordNavigationContext, setRecordNavigationContext] = useState(null);
	const detailsPanelRef = useRef(null);
	const toast = useToast();
	const { requestConfirmWithOptions } = useConfirmDialog();
	const { archiveEntity } = useArchivedEntities('CLIENT');
	const isAdmin = useIsAdministrator(actingUser);
	const hasValidWebsite = isValidOptionalHttpUrl(form.website);
	const customFieldsComplete = areRequiredCustomFieldsComplete(
		customFieldDefinitions,
		form.customFields
	);
	const canSave = Boolean(
		form.name.trim() &&
		form.status &&
		form.ownerId &&
		form.zipCode.trim() &&
		hasValidWebsite &&
		customFieldsComplete &&
		(!isAdmin || form.divisionId)
	);
	const websiteError =
		form.website.trim() && !hasValidWebsite ? 'Enter a valid website URL, including http:// or https://.' : '';
	const { markAsClean, confirmNavigation } = useUnsavedChangesGuard(form, {
		enabled: !loading && Boolean(client)
	});
	const clientNavigationState = useMemo(() => {
		if (!recordNavigationContext?.ids?.length || !id) return null;
		const ids = recordNavigationContext.ids.map((value) => String(value));
		const currentId = String(id);
		const currentIndex = ids.indexOf(currentId);
		if (currentIndex < 0) return null;
		return {
			label: recordNavigationContext.label || 'Filtered Clients',
			listPath: recordNavigationContext.listPath || '/clients',
			position: currentIndex + 1,
			total: ids.length,
			previousId: currentIndex > 0 ? ids[currentIndex - 1] : '',
			nextId: currentIndex < ids.length - 1 ? ids[currentIndex + 1] : ''
		};
	}, [id, recordNavigationContext]);
	const shouldUseRecordNavigation = searchParams.get(RECORD_NAVIGATION_QUERY_PARAM) === '1';

	const sortedNotes = useMemo(
		() =>
			sortByConfig(client?.notes || [], notesSort, (note, field) => {
				if (field === 'createdAt') return note.createdAt || '';
				if (field === 'author') {
					return note.createdByUser
						? `${note.createdByUser.firstName} ${note.createdByUser.lastName}`
						: '';
				}
				if (field === 'content') return note.content || '';
				return '';
			}),
		[client?.notes, notesSort]
	);

	const sortedContacts = useMemo(
		() =>
			sortByConfig(client?.contacts || [], contactsSort, (contact, field) => {
				if (field === 'name') return `${contact.firstName || ''} ${contact.lastName || ''}`;
				if (field === 'title') return contact.title || '';
				return '';
			}),
		[client?.contacts, contactsSort]
	);

	const sortedJobOrders = useMemo(
		() =>
			sortByConfig(client?.jobOrders || [], jobsSort, (jobOrder, field) => {
				if (field === 'title') return jobOrder.title || '';
				if (field === 'status') return formatSelectValueLabel(jobOrder.status);
				if (field === 'submissions') return Number(jobOrder._count?.submissions || 0);
				if (field === 'interviews') return Number(jobOrder._count?.interviews || 0);
				return '';
			}),
		[client?.jobOrders, jobsSort]
	);

	async function load() {
		setLoading(true);
		setError('');

		const clientRes = await fetch(`/api/clients/${id}`);
		if (!clientRes.ok) {
			const data = await clientRes.json().catch(() => ({}));
			setError(data.error || 'Failed to load client details.');
			setLoading(false);
			return;
		}

		const clientData = await clientRes.json();
		const nextForm = toForm(clientData);
		setClient(clientData);
		setForm(nextForm);
		markAsClean(nextForm);
		setLoading(false);
	}

	useEffect(() => {
		let cancelled = false;

		async function loadSessionUser() {
			const sessionRes = await fetch('/api/session/acting-user');
			const sessionData = await sessionRes.json().catch(() => ({ user: null }));
			if (cancelled) return;
			setActingUser(sessionData?.user || null);
		}

		loadSessionUser();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		load();
	}, [id]);

	useEffect(() => {
		if (shouldUseRecordNavigation) {
			setRecordNavigationContext(readRecordNavigationContext('client'));
			return;
		}
		clearRecordNavigationContext('client');
		setRecordNavigationContext(null);
	}, [id, shouldUseRecordNavigation]);

	useEffect(() => {
		const panel = detailsPanelRef.current;
		if (!panel || typeof ResizeObserver === 'undefined') return;

		const updateHeight = () => {
			setDetailsPanelHeight(panel.getBoundingClientRect().height);
		};
		updateHeight();

		const observer = new ResizeObserver(updateHeight);
		observer.observe(panel);
		return () => observer.disconnect();
	}, [client, form, saveState.saving, workspaceTab]);

	useEffect(() => {
		function onMouseDown(event) {
			if (!actionsMenuRef.current) return;
			if (actionsMenuRef.current.contains(event.target)) return;
			setActionsOpen(false);
		}

		function onKeyDown(event) {
			if (event.key === 'Escape') {
				setActionsOpen(false);
			}
		}

		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, []);

	useEffect(() => {
		if (saveState.error) {
			toast.error(saveState.error);
		}
	}, [saveState.error, toast]);

	useEffect(() => {
		if (saveState.success) {
			toast.success(saveState.success);
		}
	}, [saveState.success, toast]);

	useEffect(() => {
		if (noteState.error) {
			toast.error(noteState.error);
		}
	}, [noteState.error, toast]);

	async function onSave(e) {
		e.preventDefault();
		if (!canSave) {
			setSaveState({
				saving: false,
				error: isAdmin
					? 'Client Name, Status, Division, Zip Code, and Owner are required.'
					: 'Client Name, Status, Zip Code, and Owner are required.',
				success: ''
			});
			return;
		}
		setSaveState({ saving: true, error: '', success: '' });

		const res = await fetch(`/api/clients/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setSaveState({ saving: false, error: data.error || 'Failed to update client.', success: '' });
			return;
		}

		const updated = await res.json();
		const nextForm = toForm(updated);
		setClient((current) => (current ? { ...current, ...updated } : current));
		setForm(nextForm);
		markAsClean(nextForm);
		setSaveState({ saving: false, error: '', success: 'Client updated.' });
	}

	async function onAddNote(e) {
		e.preventDefault();
		if (!noteContent.trim()) return;
		setNoteState({ saving: true, error: '' });

		try {
			const res = await fetch(`/api/clients/${id}/notes`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: noteContent })
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setNoteState({ saving: false, error: data.error || 'Failed to save note.' });
				return;
			}

			setNoteContent('');
			await load();
			setNoteState({ saving: false, error: '' });
		} catch {
			setNoteState({ saving: false, error: 'Failed to save note.' });
		}
	}

	function onAddContact() {
		setActionsOpen(false);
		router.push(`/contacts/new?clientId=${client.id}`);
	}

	function onAddJobOrder() {
		setActionsOpen(false);
		router.push(`/job-orders/new?clientId=${client.id}`);
	}

	function onToggleAuditTrail() {
		setActionsOpen(false);
		setShowAuditTrail((current) => !current);
	}

	async function onArchiveClient() {
		if (!client?.id) return;
		setActionsOpen(false);
		const archiveOptions = getArchiveCascadeOptions('CLIENT');
		const decision = await requestConfirmWithOptions({
			title: 'Archive Client',
			message: `Archive ${client.name}? You can restore it from Archive later.`,
			confirmLabel: 'Archive',
			cancelLabel: 'Cancel',
			isDanger: true,
			options: archiveOptions
		});
		if (!decision?.confirmed) return;
		const cascade = cascadeSelectionFromIds('CLIENT', decision.selections);
		const result = await archiveEntity(client.id, '', cascade);
		if (!result.ok) {
			toast.error(result.error || 'Failed to archive client.');
			return;
		}
		const relatedCount = Math.max(0, Number(result.archivedCount || 1) - 1);
		toast.success(
			relatedCount > 0
				? `Client archived with ${relatedCount} related record${relatedCount === 1 ? '' : 's'}.`
				: 'Client archived.'
		);
		router.push('/clients');
	}

	async function onNavigateToClient(targetId) {
		if (!targetId || String(targetId) === String(id)) return;
		if (!(await confirmNavigation())) return;
		router.push(withRecordNavigationQuery(`/clients/${targetId}`));
	}

	if (loading) {
		return (
			<section className="module-page">
				<LoadingIndicator className="page-loading-indicator" label="Loading client details" />
			</section>
		);
	}

	if (error || !client) {
		return (
			<section className="module-page">
				<p>{error || 'Client not found.'}</p>
				<button type="button" onClick={() => router.push('/clients')}>
					Back to Clients
				</button>
			</section>
		);
	}

	const workspacePanelStyle =
		detailsPanelHeight > 0 ? { height: `${detailsPanelHeight}px`, maxHeight: `${detailsPanelHeight}px` } : undefined;

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<Link
						href={clientNavigationState?.listPath || '/clients'}
						className="module-back-link"
						aria-label="Back to List"
					>
						&larr; Back
					</Link>
					<h2>{client.name}</h2>
					<p>{client.industry || 'No industry set'}</p>
				</div>
				<div className="module-header-actions">
					{clientNavigationState ? (
						<div className="record-navigation-controls" aria-label={`${clientNavigationState.label} navigation`}>
							<p className="simple-list-meta record-navigation-meta">
								{clientNavigationState.label}: {clientNavigationState.position} of {clientNavigationState.total}
							</p>
							<div className="record-navigation-buttons">
								<button
									type="button"
									className="btn-secondary record-navigation-button"
									onClick={() => onNavigateToClient(clientNavigationState.previousId)}
									disabled={!clientNavigationState.previousId}
									aria-label="Previous Client"
									title="Previous Client"
								>
									<ChevronLeft aria-hidden="true" className="btn-refresh-icon-svg" />
								</button>
								<button
									type="button"
									className="btn-secondary record-navigation-button"
									onClick={() => onNavigateToClient(clientNavigationState.nextId)}
									disabled={!clientNavigationState.nextId}
									aria-label="Next Client"
									title="Next Client"
								>
									<ChevronRight aria-hidden="true" className="btn-refresh-icon-svg" />
								</button>
							</div>
						</div>
					) : null}
					<div className="actions-menu" ref={actionsMenuRef}>
						<button
							type="button"
							className="btn-secondary actions-menu-toggle"
							onClick={() => setActionsOpen((current) => !current)}
							aria-haspopup="menu"
							aria-expanded={actionsOpen}
							aria-label="Open client actions"
							title="Actions"
							>
								<span className="actions-menu-icon" aria-hidden="true">
									<MoreVertical />
								</span>
							</button>
						{actionsOpen ? (
							<div className="actions-menu-list" role="menu" aria-label="Client actions">
								<button type="button" role="menuitem" className="actions-menu-item" onClick={onAddContact}>
									Add Contact
								</button>
								<button type="button" role="menuitem" className="actions-menu-item" onClick={onAddJobOrder}>
									Add Job Order
								</button>
								<div className="actions-menu-divider" role="separator" />
								<button
									type="button"
									role="menuitem"
									className="actions-menu-item actions-menu-item-danger"
									onClick={onArchiveClient}
								>
									Archive Client
								</button>
								{isAdmin ? (
									<>
										<div className="actions-menu-divider" role="separator" />
										<button type="button" role="menuitem" className="actions-menu-item" onClick={onToggleAuditTrail}>
											{showAuditTrail ? 'Hide Audit Trail' : 'View Audit Trail'}
										</button>
									</>
								) : null}
							</div>
						) : null}
					</div>
				</div>
			</header>

			<article className="panel">
				<h3>Snapshot</h3>
				<div className="info-list snapshot-grid snapshot-grid-six">
					<p>
						<span>Record ID</span>
						<strong>{client.recordId || '-'}</strong>
					</p>
					<p>
						<span>Owner</span>
						<strong>
							{client.ownerUser
								? `${client.ownerUser.firstName} ${client.ownerUser.lastName}`
								: '-'}
						</strong>
					</p>
					<p>
						<span>Industry</span>
						<strong>{client.industry || '-'}</strong>
					</p>
					<p>
						<span>Status</span>
						<strong>{normalizeClientStatusValue(client.status)}</strong>
					</p>
				</div>
			</article>

			<div className="detail-layout detail-layout-equal">
				<article className="panel panel-spacious" ref={detailsPanelRef}>
					<h3>Client Details</h3>
					<p className="panel-subtext">Edit account details and save updates.</p>
					<form onSubmit={onSave} className="detail-form">
						<section className="form-section">
							<h4>Account</h4>
							<FormField label="Client Name" required>
								<input
									value={form.name}
									onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
									required
								/>
							</FormField>
							<div className="detail-form-grid-3">
								<FormField label="Industry">
									<select
										value={form.industry}
										onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
									>
										<option value="">Select industry</option>
										{INDUSTRY_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</FormField>
								<FormField label="Status" required>
									<select
										value={form.status}
										onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
										required
									>
										<option value="">Select status</option>
										{CLIENT_STATUS_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</FormField>
								{isAdmin ? (
									<FormField label="Division" required>
										<LookupTypeaheadSelect
											entity="divisions"
											lookupParams={{}}
											value={form.divisionId}
											onChange={(nextValue) =>
												setForm((f) => ({
													...f,
													divisionId: nextValue,
													ownerId: ''
												}))
											}
											placeholder="Search division"
											label="Division"
											emptyLabel="No matching divisions."
										/>
									</FormField>
								) : null}
							</div>
							<div className="detail-form-grid-2">
								<FormField label="Owner" required>
									<LookupTypeaheadSelect
										entity="users"
										lookupParams={isAdmin && form.divisionId ? { divisionId: form.divisionId } : {}}
										value={form.ownerId}
										onChange={(nextValue) => setForm((f) => ({ ...f, ownerId: nextValue }))}
										placeholder={isAdmin && !form.divisionId ? 'Select division first' : 'Search owner'}
										label="Owner"
										disabled={isAdmin && !form.divisionId}
										emptyLabel="No matching users."
									/>
								</FormField>
								<FormField label="Main Phone">
									<PhoneInput
										value={form.phone}
										onChange={(nextValue) => setForm((f) => ({ ...f, phone: nextValue }))}
									/>
								</FormField>
							</div>
							<FormField label="Street Address">
								<AddressTypeaheadInput
									value={form.address}
									onChange={(nextValue) =>
										setForm((f) => ({
											...f,
											address: nextValue
										}))
									}
									onPlaceDetailsChange={(details) =>
										setForm((f) => ({
											...f,
											city: details?.city ?? f.city,
											state: details?.state ?? f.state,
											zipCode: details?.postalCode ? normalizeZipFromPlace(details.postalCode) : f.zipCode
										}))
									}
									placeholder="Search address or enter manually"
									label="Street Address"
								/>
							</FormField>
							<div className="detail-form-grid-3">
								<FormField label="City">
									<input
										value={form.city}
										onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
									/>
								</FormField>
								<FormField label="State">
									<input
										value={form.state}
										onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
									/>
								</FormField>
								<FormField label="Zip Code" required>
									<input
										value={form.zipCode}
										onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))}
										required
									/>
								</FormField>
							</div>
							<FormField label="Website">
								<input
									type="url"
									placeholder="https://example.com"
									value={form.website}
									onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
								/>
							</FormField>
							{websiteError ? <p className="panel-subtext error">{websiteError}</p> : null}
							<FormField label="Description">
								<textarea
									placeholder="Company description"
									value={form.description}
									onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
								/>
							</FormField>
							<CustomFieldsSection
								moduleKey="clients"
								values={form.customFields}
								onChange={(nextCustomFields) =>
									setForm((f) => ({
										...f,
										customFields: nextCustomFields
									}))
								}
								onDefinitionsChange={setCustomFieldDefinitions}
							/>
						</section>

					<div className="form-actions">
						<SaveActionButton
							saving={saveState.saving}
							disabled={saveState.saving || !canSave}
							label="Save Client"
							savingLabel="Saving Client..."
						/>
						<span className="form-actions-meta">
								<span>Updated:</span>
								<strong>{formatDate(client.updatedAt)}</strong>
							</span>
						</div>
					</form>
				</article>

				<article className="panel workspace-panel workspace-panel-lock-height" style={workspacePanelStyle}>
					<h3>Client Workspace</h3>
					<div className="side-tabs side-tabs-warm side-tabs-counted" role="tablist" aria-label="Client workspace tabs">
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'notes'}
							className={workspaceTab === 'notes' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('notes')}
						>
							<span>Notes</span>
							<span className="side-tab-count" aria-hidden="true">{client.notes?.length ?? 0}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'contacts'}
							className={workspaceTab === 'contacts' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('contacts')}
						>
							<span>Contacts</span>
							<span className="side-tab-count" aria-hidden="true">{client.contacts.length}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'jobs'}
							className={workspaceTab === 'jobs' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('jobs')}
						>
							<span>Job Orders</span>
							<span className="side-tab-count" aria-hidden="true">{client.jobOrders.length}</span>
						</button>
					</div>

					{workspaceTab === 'notes' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<form onSubmit={onAddNote}>
								<FormField label="Note" required>
									<textarea
										placeholder="Add client note"
										value={noteContent}
										onChange={(e) => setNoteContent(e.target.value)}
										required
									/>
								</FormField>
								<SaveActionButton
									saving={noteState.saving}
									label="Save Note"
									savingLabel="Saving Note..."
									icon={Save}
								/>
							</form>
							<h4 className="side-section-title">Saved Notes</h4>
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Notes"
									value={notesSort.field}
									direction={notesSort.direction}
									onValueChange={(field) => setNotesSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setNotesSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'createdAt', label: 'Created Date' },
										{ value: 'author', label: 'Author' },
										{ value: 'content', label: 'Note Content' }
									]}
									disabled={sortedNotes.length < 2}
								/>
								{client.notes?.length === 0 ? (
									<p className="panel-subtext">No notes yet.</p>
								) : (
									<ul className="simple-list">
										{sortedNotes.map((note) => (
											<li key={note.id}>
												<div>
													<p>{note.content}</p>
													<p className="simple-list-meta">
														By{' '}
														{note.createdByUser
															? `${note.createdByUser.firstName} ${note.createdByUser.lastName}`
															: 'Unknown User'}{' '}
														@ <span className="meta-emphasis-time">{formatDate(note.createdAt)}</span>
													</p>
													{isSyncedActivityNote(note.recordId, 'client') ? (
														<SyncedNoteActions note={note} url={`/api/clients/${id}/notes`}
															onChange={(noteId, updated) => setClient((current) => ({
																...current,
																notes: updated ? current.notes.map((entry) => entry.id === noteId ? { ...entry, ...updated } : entry)
																	: current.notes.filter((entry) => entry.id !== noteId)
															}))}
														/>
													) : null}
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'contacts' ? (
						<div className="side-tab-content side-tab-content-list-only">
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Contacts"
									value={contactsSort.field}
									direction={contactsSort.direction}
									onValueChange={(field) => setContactsSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setContactsSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'name', label: 'Name' },
										{ value: 'title', label: 'Title' }
									]}
									disabled={sortedContacts.length < 2}
								/>
								{client.contacts.length === 0 ? (
									<p className="panel-subtext">No contacts for this client.</p>
								) : (
									<ul className="simple-list">
										{sortedContacts.map((contact) => (
											<li key={contact.id}>
												<div>
													<strong>
														<Link href={`/contacts/${contact.id}`}>
															{contact.firstName} {contact.lastName}
														</Link>
													</strong>
													<p>{contact.title || '-'}</p>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'jobs' ? (
						<div className="side-tab-content side-tab-content-list-only">
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Job Orders"
									value={jobsSort.field}
									direction={jobsSort.direction}
									onValueChange={(field) => setJobsSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setJobsSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'title', label: 'Title' },
										{ value: 'status', label: 'Status' },
										{ value: 'submissions', label: 'Submissions' },
										{ value: 'interviews', label: 'Interviews' }
									]}
									disabled={sortedJobOrders.length < 2}
								/>
								{client.jobOrders.length === 0 ? (
									<p className="panel-subtext">No job orders for this client.</p>
								) : (
									<ul className="simple-list">
										{sortedJobOrders.map((jobOrder) => (
											<li key={jobOrder.id}>
												<div>
													<strong>
														<Link href={`/job-orders/${jobOrder.id}`}>{jobOrder.title}</Link>
													</strong>
													<p>{formatSelectValueLabel(jobOrder.status)}</p>
												</div>
												<div>
													<p>
														Submissions: {jobOrder._count?.submissions ?? 0} | Interviews:{' '}
														{jobOrder._count?.interviews ?? 0}
													</p>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}
				</article>
			</div>
			{isAdmin ? <AuditTrailPanel entityType="CLIENT" entityId={id} visible={showAuditTrail} /> : null}
		</section>
	);
}
