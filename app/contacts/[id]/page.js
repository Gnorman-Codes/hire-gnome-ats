'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, ChevronLeft, ChevronRight, MoreVertical, Save } from 'lucide-react';
import LookupTypeaheadSelect from '@/app/components/lookup-typeahead-select';
import PhoneInput from '@/app/components/phone-input';
import AddressTypeaheadInput from '@/app/components/address-typeahead-input';
import FormField from '@/app/components/form-field';
import LoadingIndicator from '@/app/components/loading-indicator';
import SaveActionButton from '@/app/components/save-action-button';
import CustomFieldsSection, { areRequiredCustomFieldsComplete } from '@/app/components/custom-fields-section';
import SyncedNoteActions from '@/app/components/synced-note-actions';
import { isSyncedActivityNote } from '@/lib/synced-activity-note';
import ListSortControls from '@/app/components/list-sort-controls';
import AuditTrailPanel from '@/app/components/audit-trail-panel';
import EmailDraftModal from '@/app/components/email-draft-modal';
import { useToast } from '@/app/components/toast-provider';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import useArchivedEntities from '@/app/hooks/use-archived-entities';
import useIsAdministrator from '@/app/hooks/use-is-administrator';
import {
	CONTACT_SOURCE_OPTIONS,
	normalizeContactSourceValue
} from '@/app/constants/contact-source-options';
import useUnsavedChangesGuard from '@/app/hooks/use-unsaved-changes-guard';
import { formatDateTimeAt } from '@/lib/date-format';
import { isValidEmailAddress } from '@/lib/email-validation';
import {
	clearRecordNavigationContext,
	readRecordNavigationContext,
	RECORD_NAVIGATION_QUERY_PARAM,
	withRecordNavigationQuery
} from '@/lib/record-navigation-context';
import { formatSelectValueLabel } from '@/lib/select-value-label';
import { sortByConfig } from '@/lib/list-sort';
import { isValidOptionalHttpUrl } from '@/lib/url-validation';

const initialForm = {
	firstName: '',
	lastName: '',
	email: '',
	phone: '',
	address: '',
	addressPlaceId: '',
	addressLatitude: '',
	addressLongitude: '',
	title: '',
	department: '',
	linkedinUrl: '',
	source: '',
	ownerId: '',
	clientId: '',
	customFields: {}
};

function toForm(row) {
	if (!row) return initialForm;
	return {
		firstName: row.firstName || '',
		lastName: row.lastName || '',
		email: row.email || '',
		phone: row.phone || '',
		address: row.address || '',
		addressPlaceId: row.addressPlaceId || '',
		addressLatitude: row.addressLatitude ?? '',
		addressLongitude: row.addressLongitude ?? '',
		title: row.title || '',
		department: row.department || '',
		linkedinUrl: row.linkedinUrl || '',
		source: normalizeContactSourceValue(row.source),
		ownerId: row.ownerId == null ? '' : String(row.ownerId),
		clientId: String(row.clientId || ''),
		customFields:
			row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
				? row.customFields
				: {}
	};
}

function formatDate(value) {
	return formatDateTimeAt(value);
}

export default function ContactDetailsPage() {
	const { id } = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [contact, setContact] = useState(null);
	const [form, setForm] = useState(initialForm);
	const [noteContent, setNoteContent] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });
	const [noteState, setNoteState] = useState({ saving: false, error: '' });
	const [actionsOpen, setActionsOpen] = useState(false);
	const [showAuditTrail, setShowAuditTrail] = useState(false);
	const [emailDraftOpen, setEmailDraftOpen] = useState(false);
	const [aiAvailable, setAiAvailable] = useState(false);
	const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
	const [workspaceTab, setWorkspaceTab] = useState('notes');
	const [detailsPanelHeight, setDetailsPanelHeight] = useState(0);
	const [notesSort, setNotesSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [jobsSort, setJobsSort] = useState({ field: 'title', direction: 'asc' });
	const [recordNavigationContext, setRecordNavigationContext] = useState(null);
	const detailsPanelRef = useRef(null);
	const actionsMenuRef = useRef(null);
	const toast = useToast();
	const { requestConfirm } = useConfirmDialog();
	const { archiveEntity } = useArchivedEntities('CONTACT');
	const isAdmin = useIsAdministrator();
	const hasValidEmail = !form.email.trim() || isValidEmailAddress(form.email);
	const emailError =
		form.email.trim() && !hasValidEmail ? 'Invalid Email Address' : '';
	const hasValidLinkedinUrl = isValidOptionalHttpUrl(form.linkedinUrl);
	const linkedinUrlError =
		form.linkedinUrl.trim() && !hasValidLinkedinUrl
			? 'Enter a valid LinkedIn URL, including http:// or https://.'
			: '';
	const customFieldsComplete = areRequiredCustomFieldsComplete(
		customFieldDefinitions,
		form.customFields
	);
	const { markAsClean, confirmNavigation } = useUnsavedChangesGuard(form, {
		enabled: !loading && Boolean(contact)
	});

	const canSave = useMemo(
		() =>
			Boolean(
				form.firstName.trim() &&
					form.lastName.trim() &&
					form.email.trim() &&
					form.phone.trim() &&
					form.source &&
					form.ownerId &&
					form.clientId &&
					customFieldsComplete &&
					hasValidEmail &&
					hasValidLinkedinUrl
			),
		[customFieldsComplete, form, hasValidEmail, hasValidLinkedinUrl]
	);
	const isClientLocked = Boolean(contact?.id);
	const contactNavigationState = useMemo(() => {
		if (!recordNavigationContext?.ids?.length || !id) return null;
		const ids = recordNavigationContext.ids.map((value) => String(value));
		const currentId = String(id);
		const currentIndex = ids.indexOf(currentId);
		if (currentIndex < 0) return null;
		return {
			label: recordNavigationContext.label || 'Filtered Contacts',
			listPath: recordNavigationContext.listPath || '/contacts',
			position: currentIndex + 1,
			total: ids.length,
			previousId: currentIndex > 0 ? ids[currentIndex - 1] : '',
			nextId: currentIndex < ids.length - 1 ? ids[currentIndex + 1] : ''
		};
	}, [id, recordNavigationContext]);
	const shouldUseRecordNavigation = searchParams.get(RECORD_NAVIGATION_QUERY_PARAM) === '1';

	const sortedNotes = useMemo(
		() =>
			sortByConfig(contact?.notes || [], notesSort, (note, field) => {
				if (field === 'createdAt') return note.createdAt || '';
				if (field === 'author') {
					return note.createdByUser
						? `${note.createdByUser.firstName} ${note.createdByUser.lastName}`
						: '';
				}
				if (field === 'content') return note.content || '';
				return '';
			}),
		[contact?.notes, notesSort]
	);

	const sortedJobOrders = useMemo(
		() =>
			sortByConfig(contact?.jobOrders || [], jobsSort, (jobOrder, field) => {
				if (field === 'title') return jobOrder.title || '';
				if (field === 'status') return formatSelectValueLabel(jobOrder.status);
				return '';
			}),
		[contact?.jobOrders, jobsSort]
	);

	async function load() {
		setLoading(true);
		setError('');

		const [contactRes, settingsRes] = await Promise.all([
			fetch(`/api/contacts/${id}`),
			fetch('/api/system-settings', { cache: 'no-store' })
		]);

		if (!contactRes.ok) {
			const data = await contactRes.json().catch(() => ({}));
			setError(data.error || 'Failed to load contact details.');
			setLoading(false);
			return;
		}

		const contactData = await contactRes.json();
		const settingsData = settingsRes.ok ? await settingsRes.json().catch(() => ({})) : {};
		const nextForm = toForm(contactData);
		setAiAvailable(Boolean(settingsData?.aiAvailable));
		setContact(contactData);
		setForm(nextForm);
		markAsClean(nextForm);
		setLoading(false);
	}

	useEffect(() => {
		load();
	}, [id]);

	useEffect(() => {
		if (shouldUseRecordNavigation) {
			setRecordNavigationContext(readRecordNavigationContext('contact'));
			return;
		}
		clearRecordNavigationContext('contact');
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
	}, [contact, form, saveState.saving, workspaceTab]);

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
		if (!form.email.trim()) {
			setSaveState({ saving: false, error: 'Email is required.', success: '' });
			return;
		}
		if (!form.phone.trim()) {
			setSaveState({ saving: false, error: 'Phone is required.', success: '' });
			return;
		}
		if (!form.source) {
			setSaveState({ saving: false, error: 'Source is required.', success: '' });
			return;
		}
		if (!form.ownerId) {
			setSaveState({ saving: false, error: 'Owner is required.', success: '' });
			return;
		}
		if (!form.clientId) {
			setSaveState({ saving: false, error: 'Client is required.', success: '' });
			return;
		}

		setSaveState({ saving: true, error: '', success: '' });

		const res = await fetch(`/api/contacts/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setSaveState({ saving: false, error: data.error || 'Failed to update contact.', success: '' });
			return;
		}

		const updated = await res.json();
		const nextForm = toForm(updated);
		setContact((current) => (current ? { ...current, ...updated } : current));
		setForm(nextForm);
		markAsClean(nextForm);
		setSaveState({ saving: false, error: '', success: 'Contact updated.' });
	}

	async function onAddNote(e) {
		e.preventDefault();
		if (!noteContent.trim()) return;
		setNoteState({ saving: true, error: '' });

		try {
			const res = await fetch(`/api/contacts/${id}/notes`, {
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

	function onToggleAuditTrail() {
		setActionsOpen(false);
		setShowAuditTrail((current) => !current);
	}

	function onOpenEmailDraft() {
		setActionsOpen(false);
		if (!aiAvailable) return;
		setEmailDraftOpen(true);
	}

	function onAddJobOrder() {
		setActionsOpen(false);
		if (!contact?.clientId || !contact?.id) return;
		router.push(`/job-orders/new?clientId=${contact.clientId}&contactId=${contact.id}`);
	}

	async function onArchiveContact() {
		if (!contact?.id) return;
		setActionsOpen(false);
		const confirmed = await requestConfirm({
			title: 'Archive Contact',
			message: `Archive ${contact.firstName || ''} ${contact.lastName || ''}`.trim() + '? You can restore it from Archive later.',
			confirmLabel: 'Archive',
			cancelLabel: 'Cancel',
			destructive: true
		});
		if (!confirmed) return;
		const result = await archiveEntity(contact.id);
		if (!result.ok) {
			toast.error(result.error || 'Failed to archive contact.');
			return;
		}
		toast.success('Contact archived.');
		router.push('/contacts');
	}

	async function onNavigateToContact(targetId) {
		if (!targetId || String(targetId) === String(id)) return;
		if (!(await confirmNavigation())) return;
		router.push(withRecordNavigationQuery(`/contacts/${targetId}`));
	}

	if (loading) {
		return (
			<section className="module-page">
				<LoadingIndicator className="page-loading-indicator" label="Loading contact details" />
			</section>
		);
	}

	if (error || !contact) {
		return (
			<section className="module-page">
				<p>{error || 'Contact not found.'}</p>
				<button type="button" onClick={() => router.push('/contacts')}>
					Back to Contacts
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
						href={contactNavigationState?.listPath || '/contacts'}
						className="module-back-link"
						aria-label="Back to List"
					>
						&larr; Back
					</Link>
					<h2>
						{contact.firstName} {contact.lastName}
					</h2>
					<p>{contact.client?.name || 'No client linked'}</p>
				</div>
				<div className="module-header-actions">
					{contactNavigationState ? (
						<div className="record-navigation-controls" aria-label={`${contactNavigationState.label} navigation`}>
							<p className="simple-list-meta record-navigation-meta">
								{contactNavigationState.label}: {contactNavigationState.position} of {contactNavigationState.total}
							</p>
							<div className="record-navigation-buttons">
								<button
									type="button"
									className="btn-secondary record-navigation-button"
									onClick={() => onNavigateToContact(contactNavigationState.previousId)}
									disabled={!contactNavigationState.previousId}
									aria-label="Previous Contact"
									title="Previous Contact"
								>
									<ChevronLeft aria-hidden="true" className="btn-refresh-icon-svg" />
								</button>
								<button
									type="button"
									className="btn-secondary record-navigation-button"
									onClick={() => onNavigateToContact(contactNavigationState.nextId)}
									disabled={!contactNavigationState.nextId}
									aria-label="Next Contact"
									title="Next Contact"
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
							aria-label="Open contact actions"
							title="Actions"
							>
								<span className="actions-menu-icon" aria-hidden="true">
									<MoreVertical />
								</span>
							</button>
						{actionsOpen ? (
							<div className="actions-menu-list" role="menu" aria-label="Contact actions">
								<button type="button" role="menuitem" className="actions-menu-item" onClick={onAddJobOrder}>
									Add Job Order
								</button>
								<button
									type="button"
									role="menuitem"
									className="actions-menu-item"
									onClick={onOpenEmailDraft}
									disabled={!aiAvailable}
									title={aiAvailable ? 'Draft Email' : 'Enable OpenAI in Admin Area > System Settings to use this.'}
								>
									Draft Email
								</button>
								{!aiAvailable ? (
									<p className="actions-menu-hint">Enable OpenAI in Admin Area &gt; System Settings to use this.</p>
								) : null}
								<div className="actions-menu-divider" role="separator" />
								<button
									type="button"
									role="menuitem"
									className="actions-menu-item actions-menu-item-danger"
									onClick={onArchiveContact}
								>
									Archive Contact
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
				<div className="info-list snapshot-grid">
					<p>
						<span>Record ID</span>
						<strong>{contact.recordId || '-'}</strong>
					</p>
					<p>
						<span>Client</span>
						<strong>
							{contact.client?.id ? (
								<Link href={`/clients/${contact.client.id}`}>
									{contact.client.name}{' '}
									<ArrowUpRight aria-hidden="true" className="snapshot-link-icon" />
								</Link>
							) : (
								contact.client?.name || '-'
							)}
						</strong>
					</p>
					<p>
						<span>Owner</span>
						<strong>
							{contact.ownerUser
								? `${contact.ownerUser.firstName} ${contact.ownerUser.lastName}`
								: '-'}
						</strong>
					</p>
				</div>
			</article>

			<div className="detail-layout detail-layout-equal">
				<article className="panel panel-spacious" ref={detailsPanelRef}>
					<h3>Contact Details</h3>
					<p className="panel-subtext">
						Edit contact details and save updates. Required: Name, Email, Phone, Source, Owner, Client.
					</p>
					<form onSubmit={onSave} className="detail-form">
						<section className="form-section">
							<h4>Contact Information</h4>
							<div className="detail-form-grid-2">
								<FormField label="First Name" required>
									<input
										value={form.firstName}
										onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
										required
									/>
								</FormField>
								<FormField label="Last Name" required>
									<input
										value={form.lastName}
										onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
										required
									/>
								</FormField>
							</div>
							<FormField label="Email" required>
								<input
									placeholder="name@company.com"
									type="email"
									value={form.email}
									onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
									required
								/>
							</FormField>
							{emailError ? (
								<div className="validation-chip-row">
									<span className="chip validation-chip-invalid">{emailError}</span>
								</div>
							) : null}
							<div className="detail-form-grid-2">
								<FormField label="Phone" required>
									<PhoneInput
										placeholder="(555) 555-5555"
										value={form.phone}
										onChange={(phone) => setForm((f) => ({ ...f, phone }))}
										required
									/>
								</FormField>
								<FormField label="Title">
									<input
										value={form.title}
										onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
									/>
								</FormField>
							</div>
							<FormField label="Address">
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
											addressPlaceId: details?.placeId || '',
											addressLatitude: details?.latitude ?? '',
											addressLongitude: details?.longitude ?? ''
										}))
									}
									placeholder="Search address or enter manually"
									label="Address"
								/>
							</FormField>
							<div className="detail-form-grid-2">
								<FormField label="Department">
									<input
										value={form.department}
										onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
									/>
								</FormField>
								<FormField label="LinkedIn URL">
									<input
										type="url"
										placeholder="https://linkedin.com/in/..."
										value={form.linkedinUrl}
										onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
									/>
								</FormField>
							</div>
							{linkedinUrlError ? <p className="panel-subtext error">{linkedinUrlError}</p> : null}
						</section>

						<section className="form-section">
							<h4>Ownership</h4>
							<div className="detail-form-grid-2">
								<FormField label="Source" required>
									<select
										value={form.source}
										onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
										required
									>
										<option value="">Select source</option>
										{CONTACT_SOURCE_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</FormField>
								<FormField label="Owner" required>
									<LookupTypeaheadSelect
										entity="users"
										lookupParams={{}}
										value={form.ownerId}
										onChange={(nextValue) => setForm((f) => ({ ...f, ownerId: nextValue }))}
										placeholder="Search owner"
										label="Owner"
										emptyLabel="No matching users."
									/>
								</FormField>
							</div>
							<FormField label="Client" required>
								<LookupTypeaheadSelect
									entity="clients"
									lookupParams={{}}
									value={form.clientId}
									onChange={(nextValue) => setForm((f) => ({ ...f, clientId: nextValue }))}
									placeholder={isClientLocked ? 'Client locked after create' : 'Search client'}
									label="Client"
									emptyLabel="No matching clients."
									disabled={isClientLocked}
								/>
							</FormField>
						</section>
						<CustomFieldsSection
							moduleKey="contacts"
							values={form.customFields}
							onChange={(nextCustomFields) =>
								setForm((f) => ({
									...f,
									customFields: nextCustomFields
								}))
							}
							onDefinitionsChange={setCustomFieldDefinitions}
						/>

					<div className="form-actions">
						<SaveActionButton
							saving={saveState.saving}
							disabled={saveState.saving || !canSave}
							label="Save Contact"
							savingLabel="Saving Contact..."
						/>
						<span className="form-actions-meta">
								<span>Updated:</span>
								<strong>{formatDate(contact.updatedAt)}</strong>
							</span>
						</div>
					</form>
				</article>

				<article className="panel workspace-panel workspace-panel-lock-height" style={workspacePanelStyle}>
					<h3>Contact Workspace</h3>
					<div className="side-tabs side-tabs-two side-tabs-warm side-tabs-counted" role="tablist" aria-label="Contact workspace tabs">
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'notes'}
							className={workspaceTab === 'notes' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('notes')}
						>
							<span>Notes</span>
							<span className="side-tab-count" aria-hidden="true">{contact.notes?.length ?? 0}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'jobs'}
							className={workspaceTab === 'jobs' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('jobs')}
						>
							<span>Linked Job Orders</span>
							<span className="side-tab-count" aria-hidden="true">{contact.jobOrders.length}</span>
						</button>
					</div>

					{workspaceTab === 'notes' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<form onSubmit={onAddNote}>
								<FormField label="Note" required>
									<textarea
										placeholder="Add contact note"
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
								{contact.notes?.length === 0 ? (
									<p className="panel-subtext">No notes yet.</p>
								) : (
									<ul className="simple-list">
										{sortedNotes.map((note) => (
											<li key={note.id}>
												<div>
													{note.noteType === 'email' ? <span className="chip inbound-email-note-chip">Email</span> : null}
													<p>{note.content}</p>
													<p className="simple-list-meta">
														By{' '}
														{note.createdByUser
															? `${note.createdByUser.firstName} ${note.createdByUser.lastName}`
															: 'Unknown User'}{' '}
														@ <span className="meta-emphasis-time">{formatDate(note.createdAt)}</span>
													</p>
													{isSyncedActivityNote(note.recordId, 'contact') ? (
														<SyncedNoteActions note={note} url={`/api/contacts/${id}/notes`}
															onChange={(noteId, updated) => setContact((current) => ({
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
										{ value: 'status', label: 'Status' }
									]}
									disabled={sortedJobOrders.length < 2}
								/>
								{contact.jobOrders.length === 0 ? (
									<p className="panel-subtext">No linked job orders.</p>
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
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}
				</article>
			</div>
			{isAdmin ? <AuditTrailPanel entityType="CONTACT" entityId={id} visible={showAuditTrail} /> : null}
			<EmailDraftModal
				open={emailDraftOpen}
				onClose={() => setEmailDraftOpen(false)}
				entityType="contact"
				entityId={Number(id)}
				entityName={`${contact.firstName || ''} ${contact.lastName || ''}`.trim()}
				emailAddress={contact.email || ''}
			/>
		</section>
	);
}
