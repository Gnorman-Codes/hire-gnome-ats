'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowUpRight, ChevronLeft, ChevronRight, GripVertical, MoreVertical, RefreshCcw, Sparkles, UserPlus } from 'lucide-react';
import LookupTypeaheadSelect from '@/app/components/lookup-typeahead-select';
import AddressTypeaheadInput from '@/app/components/address-typeahead-input';
import FormField from '@/app/components/form-field';
import LoadingIndicator from '@/app/components/loading-indicator';
import SaveActionButton from '@/app/components/save-action-button';
import CustomFieldsSection, { areRequiredCustomFieldsComplete } from '@/app/components/custom-fields-section';
import RichTextEditor from '@/app/components/rich-text-editor';
import ListSortControls from '@/app/components/list-sort-controls';
import AuditTrailPanel from '@/app/components/audit-trail-panel';
import ActivityTimeline from '@/app/components/activity-timeline';
import MatchExplanationModal from '@/app/components/match-explanation-modal';
import ClientPortalModal from '@/app/components/client-portal-modal';
import { useToast } from '@/app/components/toast-provider';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import useArchivedEntities from '@/app/hooks/use-archived-entities';
import useIsAdministrator from '@/app/hooks/use-is-administrator';
import useUnsavedChangesGuard from '@/app/hooks/use-unsaved-changes-guard';
import { cascadeSelectionFromIds, getArchiveCascadeOptions } from '@/lib/archive-cascade-options';
import { formatDateTimeAt } from '@/lib/date-format';
import {
	JOB_ORDER_EMPLOYMENT_TYPES,
	JOB_ORDER_STATUS_OPTIONS,
	toJobOrderStatusValue
} from '@/lib/job-order-options';
import { formatPersonName } from '@/lib/person-name';
import {
	clearRecordNavigationContext,
	readRecordNavigationContext,
	RECORD_NAVIGATION_QUERY_PARAM,
	withRecordNavigationQuery
} from '@/lib/record-navigation-context';
import { formatSelectValueLabel } from '@/lib/select-value-label';
import { hasMeaningfulRichTextContent } from '@/lib/rich-text';
import { sortByConfig } from '@/lib/list-sort';
import { submissionCreatedByLabel, submissionOriginLabel } from '@/lib/submission-origin';
import { getEffectiveSubmissionStatus } from '@/lib/submission-status';
import { formatCurrencyInput, parseCurrencyInput } from '@/lib/currency-input';
import { fetchLookupOptionById } from '@/lib/lookup-client';
import { toBooleanFlag } from '@/lib/boolean-flag';
import { buildJobOrderTimeline } from '@/lib/activity-timeline';

const JOB_ORDER_CURRENCIES = ['USD', 'CAD'];

const initialForm = {
	title: '',
	description: '',
	publicDescription: '',
	location: '',
	locationPlaceId: '',
	locationLatitude: '',
	locationLongitude: '',
	city: '',
	state: '',
	zipCode: '',
	status: 'open',
	employmentType: '',
	openings: '1',
	currency: 'USD',
	salaryMin: '',
	salaryMax: '',
	publishToCareerSite: false,
	divisionId: '',
	ownerId: '',
	clientId: '',
	contactId: '',
	customFields: {}
};

const initialSubmissionForm = {
	candidateId: '',
	status: 'submitted',
	notes: ''
};

function reorderSubmissionCollection(submissions, orderedIds) {
	if (!Array.isArray(submissions) || submissions.length === 0) return [];
	const orderMap = new Map(orderedIds.map((submissionId, index) => [Number(submissionId), index + 1]));
	return [...submissions]
		.map((submission) => ({
			...submission,
			submissionPriority: orderMap.get(Number(submission.id)) ?? Number(submission.submissionPriority || 0)
		}))
		.sort((a, b) => {
			const aPriority = Number(a.submissionPriority || 0);
			const bPriority = Number(b.submissionPriority || 0);
			if (aPriority !== bPriority) return aPriority - bPriority;
			return Number(a.id) - Number(b.id);
		});
}

function moveSubmissionId(orderedIds, draggedId, targetId) {
	const fromIndex = orderedIds.indexOf(Number(draggedId));
	const toIndex = orderedIds.indexOf(Number(targetId));
	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return orderedIds;
	const next = [...orderedIds];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	return next;
}

const submissionStatuses = [
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'under_review', label: 'Under Review' },
	{ value: 'qualified', label: 'Qualified' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'offered', label: 'Offered' },
	{ value: 'hired', label: 'Hired' },
	{ value: 'placed', label: 'Placed' }
];

function formatClientFeedbackLabel(value) {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'request_interview') return 'Requested Interview';
	if (normalized === 'pass') return 'Passed';
	if (normalized === 'comment') return 'Feedback';
	if (normalized === 'need_more_info') return 'Needs More Info';
	return normalized ? normalized.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase()) : 'Client Update';
}

function toForm(row) {
	if (!row) return initialForm;
	const employmentType = JOB_ORDER_EMPLOYMENT_TYPES.includes(row.employmentType) ? row.employmentType : '';
	const currency = JOB_ORDER_CURRENCIES.includes(row.currency) ? row.currency : 'USD';

	return {
		title: row.title || '',
		description: row.description || '',
		publicDescription: row.publicDescription || '',
		location: row.location || '',
		locationPlaceId: row.locationPlaceId || '',
		locationLatitude: row.locationLatitude ?? '',
		locationLongitude: row.locationLongitude ?? '',
		city: row.city || '',
		state: row.state || '',
		zipCode: row.zipCode || '',
		status: toJobOrderStatusValue(row.status),
		employmentType,
		openings: row.openings == null ? '1' : String(row.openings),
		currency,
		salaryMin: row.salaryMin == null ? '' : formatCurrencyInput(String(row.salaryMin), currency),
		salaryMax: row.salaryMax == null ? '' : formatCurrencyInput(String(row.salaryMax), currency),
		publishToCareerSite: Boolean(row.publishToCareerSite),
		divisionId: row.divisionId == null ? '' : String(row.divisionId),
		ownerId: row.ownerId == null ? '' : String(row.ownerId),
		clientId: String(row.clientId || ''),
		contactId: row.contactId ? String(row.contactId) : '',
		customFields:
			row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
				? row.customFields
				: {}
	};
}

function toSalaryPayloadValue(value) {
	const parsed = parseCurrencyInput(value);
	return parsed == null ? '' : parsed;
}

function normalizeZipValue(value) {
	const rawValue = String(value || '').trim();
	if (!rawValue) return '';
	const match = rawValue.match(/\d{5}/);
	return match ? match[0] : rawValue;
}

function toJobOrderPayload(formValue) {
	const currency = JOB_ORDER_CURRENCIES.includes(formValue.currency) ? formValue.currency : 'USD';
	return {
		...formValue,
		status: toJobOrderStatusValue(formValue.status),
		currency,
		salaryMin: toSalaryPayloadValue(formValue.salaryMin),
		salaryMax: toSalaryPayloadValue(formValue.salaryMax)
	};
}

function formatDate(value) {
	return formatDateTimeAt(value);
}

export default function JobOrderDetailsPage() {
	const { id } = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [actingUser, setActingUser] = useState(null);
	const [jobOrder, setJobOrder] = useState(null);
	const [portalAccess, setPortalAccess] = useState(null);
	const [ownerDivisionId, setOwnerDivisionId] = useState(null);
	const [selectedClientDivisionId, setSelectedClientDivisionId] = useState(null);
	const [careerSiteEnabled, setCareerSiteEnabled] = useState(false);
	const [clientPortalEnabled, setClientPortalEnabled] = useState(true);
	const [aiAvailable, setAiAvailable] = useState(false);
	const [form, setForm] = useState(initialForm);
	const [submissionForm, setSubmissionForm] = useState(initialSubmissionForm);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });
	const [submissionState, setSubmissionState] = useState({
		saving: false,
		error: '',
		success: ''
	});
	const [actionsOpen, setActionsOpen] = useState(false);
	const [showClientPortalModal, setShowClientPortalModal] = useState(false);
	const [showAuditTrail, setShowAuditTrail] = useState(false);
	const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
	const [closeState, setCloseState] = useState({ closing: false, error: '' });
	const [enhanceState, setEnhanceState] = useState({ enhancing: false, error: '', success: '' });
	const [workspaceTab, setWorkspaceTab] = useState('timeline');
	const [matchExplanationTarget, setMatchExplanationTarget] = useState(null);
	const [detailsPanelHeight, setDetailsPanelHeight] = useState(0);
	const [submissionSort, setSubmissionSort] = useState({ field: 'submissionPriority', direction: 'asc' });
	const [interviewSort, setInterviewSort] = useState({ field: 'startsAt', direction: 'desc' });
	const [placementSort, setPlacementSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [matchesSort, setMatchesSort] = useState({ field: 'scorePercent', direction: 'desc' });
	const [submissionOrderState, setSubmissionOrderState] = useState({
		saving: false,
		draggingId: '',
		overId: ''
	});
	const [recordNavigationContext, setRecordNavigationContext] = useState(null);
	const [matchState, setMatchState] = useState({
		loading: false,
		error: '',
		computedAt: '',
		requiredSkillNames: [],
		totalCandidatesEvaluated: 0,
		matchEligibility: '',
		matches: [],
		submittingCandidateId: ''
	});
	const detailsPanelRef = useRef(null);
	const actionsMenuRef = useRef(null);
	const { requestConfirm, requestConfirmWithOptions } = useConfirmDialog();
	const { archiveEntity } = useArchivedEntities('JOB_ORDER');
	const toast = useToast();
	const isAdmin = useIsAdministrator(actingUser);
	const { markAsClean, confirmNavigation } = useUnsavedChangesGuard(form, {
		enabled: !loading && Boolean(jobOrder)
	});
	const jobOrderNavigationState = useMemo(() => {
		if (!recordNavigationContext?.ids?.length || !id) return null;
		const ids = recordNavigationContext.ids.map((value) => String(value));
		const currentId = String(id);
		const currentIndex = ids.indexOf(currentId);
		if (currentIndex < 0) return null;
		return {
			label: recordNavigationContext.label || 'Filtered Job Orders',
			listPath: recordNavigationContext.listPath || '/job-orders',
			position: currentIndex + 1,
			total: ids.length,
			previousId: currentIndex > 0 ? ids[currentIndex - 1] : '',
			nextId: currentIndex < ids.length - 1 ? ids[currentIndex + 1] : ''
		};
	}, [id, recordNavigationContext]);
	const shouldUseRecordNavigation = searchParams.get(RECORD_NAVIGATION_QUERY_PARAM) === '1';

	const selectedDivisionId = useMemo(() => {
		if (isAdmin) return form.divisionId || '';
		if (selectedClientDivisionId) return String(selectedClientDivisionId);
		if (ownerDivisionId) return String(ownerDivisionId);
		if (jobOrder?.divisionId) return String(jobOrder.divisionId);
		return '';
	}, [form.divisionId, isAdmin, jobOrder?.divisionId, ownerDivisionId, selectedClientDivisionId]);

	const ownerLookupParams = useMemo(
		() => (selectedDivisionId ? { divisionId: selectedDivisionId } : {}),
		[selectedDivisionId]
	);
	const clientLookupParams = useMemo(
		() => (selectedDivisionId ? { divisionId: selectedDivisionId } : {}),
		[selectedDivisionId]
	);
	const contactLookupParams = useMemo(() => {
		const params = {};
		if (form.clientId) {
			params.clientId = form.clientId;
		}
		if (selectedDivisionId) {
			params.divisionId = selectedDivisionId;
		}
		return params;
	}, [form.clientId, selectedDivisionId]);
	const submissionCandidateLookupParams = useMemo(() => {
		const params = {
			submissionEligibleOnly: 'true',
			excludeSubmittedJobOrderId: String(id)
		};
		if (jobOrder?.divisionId) {
			params.divisionId = String(jobOrder.divisionId);
		}
		return params;
	}, [id, jobOrder?.divisionId]);

	const submittedCandidateIds = useMemo(() => {
		if (!jobOrder?.submissions) return new Set();

		return new Set(
			jobOrder.submissions
				.map((submission) => submission.candidateId ?? submission.candidate?.id)
				.filter((candidateId) => candidateId != null)
				.map((candidateId) => String(candidateId))
		);
	}, [jobOrder?.submissions]);

	const sortedSubmissions = useMemo(
		() =>
			sortByConfig(jobOrder?.submissions || [], submissionSort, (submission, field) => {
				if (field === 'submissionPriority') return Number(submission.submissionPriority || 0);
				if (field === 'createdAt') return submission.createdAt || '';
				if (field === 'candidate') {
					return formatPersonName(submission.candidate?.firstName, submission.candidate?.lastName, {
						format: 'last-first'
					});
				}
				if (field === 'status') return formatSelectValueLabel(submission.status);
				if (field === 'submittedBy') return submissionCreatedByLabel(submission);
				return '';
			}),
		[jobOrder?.submissions, submissionSort]
	);

	const canReorderSubmissions =
		submissionSort.field === 'submissionPriority' &&
		submissionSort.direction === 'asc' &&
		!submissionState.saving &&
		!submissionOrderState.saving;
	const jobOrderTimelineItems = useMemo(
		() => buildJobOrderTimeline(jobOrder, portalAccess),
		[jobOrder, portalAccess]
	);

	const sortedInterviews = useMemo(
		() =>
			sortByConfig(jobOrder?.interviews || [], interviewSort, (interview, field) => {
				if (field === 'startsAt') return interview.startsAt || interview.createdAt || '';
				if (field === 'subject') return interview.subject || '';
				if (field === 'status') return formatSelectValueLabel(interview.status);
				if (field === 'candidate') {
					return formatPersonName(interview.candidate?.firstName, interview.candidate?.lastName, {
						format: 'last-first'
					});
				}
				return '';
			}),
		[jobOrder?.interviews, interviewSort]
	);

	const sortedPlacements = useMemo(
		() =>
			sortByConfig(jobOrder?.offers || [], placementSort, (offer, field) => {
				if (field === 'createdAt') return offer.createdAt || '';
				if (field === 'status') return formatSelectValueLabel(offer.status);
				if (field === 'candidate') {
					return formatPersonName(offer.candidate?.firstName, offer.candidate?.lastName, {
						format: 'last-first'
					});
				}
				return '';
			}),
		[jobOrder?.offers, placementSort]
	);

	const sortedMatches = useMemo(
		() =>
			sortByConfig(matchState.matches || [], matchesSort, (match, field) => {
				if (field === 'scorePercent') return Number(match.scorePercent || 0);
				if (field === 'candidate') return match.candidateName || '';
				if (field === 'owner') return match.ownerName || '';
				return '';
			}),
		[matchState.matches, matchesSort]
	);

	async function load() {
		setLoading(true);
		setError('');

		const [jobRes, settingsRes, portalRes] = await Promise.all([
			fetch(`/api/job-orders/${id}`),
			fetch('/api/system-settings', { cache: 'no-store' }),
			fetch(`/api/job-orders/${id}/client-portal`)
		]);
		const settingsData = await settingsRes.json().catch(() => ({}));
		setCareerSiteEnabled(toBooleanFlag(settingsData?.careerSiteEnabled, false));
		setClientPortalEnabled(toBooleanFlag(settingsData?.clientPortalEnabled, true));
		setAiAvailable(Boolean(settingsData?.aiAvailable));

		if (!jobRes.ok) {
			setError('Job order not found.');
			setLoading(false);
			return;
		}

		const jobData = await jobRes.json();
		const portalData = portalRes.ok ? await portalRes.json().catch(() => ({})) : {};

		const nextForm = toForm(jobData);
		setJobOrder(jobData);
		setPortalAccess(portalData.access || null);
		setOwnerDivisionId(jobData.ownerUser?.divisionId ?? null);
		setSelectedClientDivisionId(jobData.client?.divisionId ?? null);
		setForm(nextForm);
		markAsClean(nextForm);
		setSubmissionForm(initialSubmissionForm);
		setSubmissionState({ saving: false, error: '', success: '' });
		setSubmissionOrderState({ saving: false, draggingId: '', overId: '' });
		setLoading(false);
	}

	async function loadMatches(options = {}) {
		if (!id) return;
		const { keepResults = true } = options;

		setMatchState((current) => ({
			...current,
			loading: true,
			error: '',
			matches: keepResults ? current.matches : []
		}));

		const res = await fetch(`/api/job-orders/${id}/matches?includeSubmitted=false&limit=10`);
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setMatchState((current) => ({
				...current,
				loading: false,
				error: data.error || 'Failed to load candidate matches.'
			}));
			return;
		}

		const data = await res.json();
		setMatchState((current) => ({
			...current,
			loading: false,
			error: '',
			computedAt: data.computedAt || '',
			requiredSkillNames: Array.isArray(data.requiredSkillNames) ? data.requiredSkillNames : [],
			totalCandidatesEvaluated: Number(data.totalCandidatesEvaluated || 0),
			matchEligibility: data.matchEligibility || '',
			matches: Array.isArray(data.matches) ? data.matches : []
		}));
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
			setRecordNavigationContext(readRecordNavigationContext('job-order'));
			return;
		}
		clearRecordNavigationContext('job-order');
		setRecordNavigationContext(null);
	}, [id, shouldUseRecordNavigation]);

	useEffect(() => {
		if (!jobOrder?.id) return;
		loadMatches({ keepResults: false });
	}, [jobOrder?.id]);

	useEffect(() => {
		let active = true;
		if (!form.ownerId) {
			setOwnerDivisionId(null);
			return () => {
				active = false;
			};
		}

		fetchLookupOptionById('users', form.ownerId, {})
			.then((option) => {
				if (!active) return;
				setOwnerDivisionId(option?.divisionId ?? null);
			})
			.catch(() => {
				if (!active) return;
				setOwnerDivisionId(null);
			});

		return () => {
			active = false;
		};
	}, [form.ownerId]);

	useEffect(() => {
		let active = true;
		if (!form.clientId) {
			setSelectedClientDivisionId(null);
			return () => {
				active = false;
			};
		}

		fetchLookupOptionById('clients', form.clientId, {})
			.then((option) => {
				if (!active) return;
				setSelectedClientDivisionId(option?.divisionId ?? null);
			})
			.catch(() => {
				if (!active) return;
				setSelectedClientDivisionId(null);
			});

		return () => {
			active = false;
		};
	}, [form.clientId]);

	useEffect(() => {
		if (
			form.clientId &&
			ownerDivisionId != null &&
			selectedClientDivisionId != null &&
			Number(ownerDivisionId) !== Number(selectedClientDivisionId)
		) {
			setForm((current) => ({ ...current, clientId: '', contactId: '' }));
		}
	}, [form.clientId, ownerDivisionId, selectedClientDivisionId]);

	useEffect(() => {
		if (!isAdmin) return;
		if (!form.divisionId) {
			setForm((current) => {
				if (!current.ownerId && !current.clientId && !current.contactId) return current;
				return {
					...current,
					ownerId: '',
					clientId: '',
					contactId: ''
				};
			});
			return;
		}
		if (!form.clientId || selectedClientDivisionId == null) return;
		if (Number(form.divisionId) === Number(selectedClientDivisionId)) return;
		setForm((current) => ({
			...current,
			ownerId: '',
			clientId: '',
			contactId: ''
		}));
	}, [form.clientId, form.divisionId, isAdmin, selectedClientDivisionId]);

	useEffect(() => {
		if (!form.clientId) {
			setForm((f) => (f.contactId ? { ...f, contactId: '' } : f));
		}
	}, [form.clientId]);

	useEffect(() => {
		if (!hasMeaningfulRichTextContent(form.publicDescription) && form.publishToCareerSite) {
			setForm((current) => ({ ...current, publishToCareerSite: false }));
		}
	}, [form.publicDescription, form.publishToCareerSite]);

	useEffect(() => {
		if (!submissionForm.candidateId) return;
		if (!submittedCandidateIds.has(String(submissionForm.candidateId))) return;

		setSubmissionForm((current) => ({ ...current, candidateId: '' }));
	}, [submissionForm.candidateId, submittedCandidateIds]);

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
		const panel = detailsPanelRef.current;
		if (!panel || typeof ResizeObserver === 'undefined') return;

		const updateHeight = () => {
			setDetailsPanelHeight(panel.getBoundingClientRect().height);
		};
		updateHeight();

		const observer = new ResizeObserver(updateHeight);
		observer.observe(panel);
		return () => observer.disconnect();
	}, [jobOrder, form, saveState.saving, submissionState.saving, workspaceTab]);

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
		if (closeState.error) {
			toast.error(closeState.error);
		}
	}, [closeState.error, toast]);

	useEffect(() => {
		if (enhanceState.error) {
			toast.error(enhanceState.error);
		}
	}, [enhanceState.error, toast]);

	useEffect(() => {
		if (enhanceState.success) {
			toast.success(enhanceState.success);
		}
	}, [enhanceState.success, toast]);

	useEffect(() => {
		if (submissionState.error) {
			toast.error(submissionState.error);
		}
	}, [submissionState.error, toast]);

	useEffect(() => {
		if (submissionState.success) {
			toast.success(submissionState.success);
		}
	}, [submissionState.success, toast]);

	async function onSave(e) {
		e.preventDefault();
		const salaryMin = parseCurrencyInput(form.salaryMin);
		const salaryMax = parseCurrencyInput(form.salaryMax);
		if (isAdmin && !form.divisionId) {
			setSaveState({ saving: false, error: 'Division is required.', success: '' });
			return;
		}
		if (!form.clientId) {
			setSaveState({ saving: false, error: 'Client is required.', success: '' });
			return;
		}
		if (!form.ownerId) {
			setSaveState({ saving: false, error: 'Owner is required.', success: '' });
			return;
		}
		if (!form.status) {
			setSaveState({ saving: false, error: 'Status is required.', success: '' });
			return;
		}
		if (!form.employmentType) {
			setSaveState({ saving: false, error: 'Employment Type is required.', success: '' });
			return;
		}
		if (!form.contactId) {
			setSaveState({ saving: false, error: 'Hiring Manager is required.', success: '' });
			return;
		}
		if (!form.zipCode.trim()) {
			setSaveState({ saving: false, error: 'Zip code is required.', success: '' });
			return;
		}
		if (salaryMin != null && salaryMax != null && salaryMin > salaryMax) {
			setSaveState({ saving: false, error: 'Salary Min cannot be greater than Salary Max.', success: '' });
			return;
		}
		if (careerSiteEnabled && form.publishToCareerSite && !hasMeaningfulRichTextContent(form.publicDescription)) {
			setSaveState({
				saving: false,
				error: 'Public description is required when posting to the career site.',
				success: ''
			});
			return;
		}

		setSaveState({ saving: true, error: '', success: '' });

		const res = await fetch(`/api/job-orders/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(toJobOrderPayload(form))
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			const firstFieldError = data?.errors?.fieldErrors
				? Object.values(data.errors.fieldErrors).flat().filter(Boolean)[0]
				: '';
			setSaveState({
				saving: false,
				error: data.error || firstFieldError || 'Failed to update job order.',
				success: ''
			});
			return;
		}

		const updated = await res.json();
		const nextForm = toForm(updated);
		setJobOrder((current) => (current ? { ...current, ...updated } : current));
		setForm(nextForm);
		markAsClean(nextForm);
		setSaveState({ saving: false, error: '', success: 'Job order updated.' });
	}

	async function onCreateSubmission(e) {
		e.preventDefault();
		setSubmissionState({ saving: false, error: '', success: '' });

		if (!submissionForm.candidateId) {
			setSubmissionState({ saving: false, error: 'Candidate is required.', success: '' });
			return;
		}

		if (submittedCandidateIds.has(String(submissionForm.candidateId))) {
			setSubmissionState({
				saving: false,
				error: 'This candidate is already submitted to this job order.',
				success: ''
			});
			return;
		}

		setSubmissionState({ saving: true, error: '', success: '' });

		const res = await fetch('/api/submissions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				candidateId: submissionForm.candidateId,
				jobOrderId: jobOrder.id,
				status: submissionForm.status,
				notes: submissionForm.notes
			})
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setSubmissionState({
				saving: false,
				error: data.error || 'Failed to create submission.',
				success: ''
			});
			return;
		}

		const createdSubmission = await res.json();
		setJobOrder((current) => {
			if (!current) return current;
			const alreadyExists = current.submissions.some(
				(submission) => submission.id === createdSubmission.id
			);
			const nextSubmissions = alreadyExists
				? current.submissions
				: [...current.submissions, createdSubmission];
			const currentCount = current._count?.submissions ?? current.submissions.length;
			return {
				...current,
				submissions: nextSubmissions,
				_count: {
					...current._count,
					submissions: alreadyExists ? currentCount : currentCount + 1
				}
			};
		});
		setSubmissionForm(initialSubmissionForm);
		setSubmissionState({ saving: false, error: '', success: 'Submission added.' });
		await loadMatches();
	}

	async function onCreateMatchedSubmission(match) {
		if (!jobOrder?.id || !match?.candidateId) return;

		if (submittedCandidateIds.has(String(match.candidateId))) {
			setMatchState((current) => ({
				...current,
				error: 'This candidate is already submitted to this job order.'
			}));
			return;
		}

		setMatchState((current) => ({
			...current,
			submittingCandidateId: String(match.candidateId),
			error: ''
		}));

		const res = await fetch('/api/submissions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				candidateId: match.candidateId,
				jobOrderId: jobOrder.id,
				status: 'submitted',
				notes: ''
			})
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setMatchState((current) => ({
				...current,
				submittingCandidateId: '',
				error: data.error || 'Failed to create submission from match.'
			}));
			return;
		}

		const createdSubmission = await res.json();
		setJobOrder((current) => {
			if (!current) return current;
			const alreadyExists = current.submissions.some(
				(submission) => submission.id === createdSubmission.id
			);
			const nextSubmissions = alreadyExists
				? current.submissions
				: [...current.submissions, createdSubmission];
			const currentCount = current._count?.submissions ?? current.submissions.length;
			return {
				...current,
				submissions: nextSubmissions,
				_count: {
					...current._count,
					submissions: alreadyExists ? currentCount : currentCount + 1
				}
			};
		});
		setSubmissionState({ saving: false, error: '', success: 'Submission added from match.' });
		setMatchState((current) => ({ ...current, submittingCandidateId: '' }));
		await loadMatches();
	}

	async function persistSubmissionOrder(nextOrderedIds) {
		if (!jobOrder) return;
		const previousSubmissions = jobOrder.submissions;
		setSubmissionOrderState({ saving: true, draggingId: '', overId: '' });
		setJobOrder((current) =>
			current
				? {
						...current,
						submissions: reorderSubmissionCollection(current.submissions, nextOrderedIds)
					}
				: current
		);

		try {
			const res = await fetch(`/api/job-orders/${id}/submissions/order`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ submissionIds: nextOrderedIds })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				throw new Error(data.error || 'Failed to save submission order.');
			}
			setSubmissionOrderState({ saving: false, draggingId: '', overId: '' });
			toast.success('Submission order updated.');
		} catch (reorderError) {
			setJobOrder((current) =>
				current
					? {
							...current,
							submissions: previousSubmissions
						}
					: current
			);
			setSubmissionOrderState({ saving: false, draggingId: '', overId: '' });
			toast.error(reorderError.message || 'Failed to save submission order.');
		}
	}

	function onSubmissionDragStart(event, submissionId) {
		if (!canReorderSubmissions) return;
		const handle = event.currentTarget;
		if (typeof event.dataTransfer?.setDragImage === 'function' && handle instanceof HTMLElement) {
			const dragPreview = handle.cloneNode(true);
			dragPreview.style.position = 'fixed';
			dragPreview.style.top = '-9999px';
			dragPreview.style.left = '-9999px';
			dragPreview.style.margin = '0';
			dragPreview.style.pointerEvents = 'none';
			document.body.appendChild(dragPreview);
			event.dataTransfer.setDragImage(dragPreview, dragPreview.offsetWidth / 2, dragPreview.offsetHeight / 2);
			requestAnimationFrame(() => {
				dragPreview.remove();
			});
		}
		setSubmissionOrderState({
			saving: false,
			draggingId: String(submissionId),
			overId: String(submissionId)
		});
	}

	function onSubmissionDragOver(event, submissionId) {
		if (!canReorderSubmissions) return;
		event.preventDefault();
		if (!submissionOrderState.draggingId || submissionOrderState.draggingId === String(submissionId)) return;
		setSubmissionOrderState((current) => ({ ...current, overId: String(submissionId) }));
	}

	async function onSubmissionDrop(submissionId) {
		if (!canReorderSubmissions || !submissionOrderState.draggingId) return;
		const currentOrder = sortedSubmissions.map((submission) => Number(submission.id));
		const nextOrderedIds = moveSubmissionId(
			currentOrder,
			submissionOrderState.draggingId,
			submissionId
		);
		if (nextOrderedIds.join(',') === currentOrder.join(',')) {
			setSubmissionOrderState({ saving: false, draggingId: '', overId: '' });
			return;
		}
		await persistSubmissionOrder(nextOrderedIds);
	}

	function onSubmissionDragEnd() {
		setSubmissionOrderState((current) => ({ ...current, draggingId: '', overId: '' }));
	}

	async function onCloseJobOrder() {
		if (!jobOrder) return;
		if (jobOrder.status === 'closed') {
			setActionsOpen(false);
			return;
		}

		const confirmed = await requestConfirm({
			message: `Close this job order?\n\nTitle: ${jobOrder.title || '-'}\nClient: ${jobOrder.client?.name || '-'}`,
			confirmLabel: 'Close',
			cancelLabel: 'Keep Open',
			isDanger: true
		});
		if (!confirmed) return;

		setCloseState({ closing: true, error: '' });
		setSaveState((current) => ({ ...current, error: '', success: '' }));

		const res = await fetch(`/api/job-orders/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...toJobOrderPayload(form), status: 'closed' })
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setCloseState({
				closing: false,
				error: data.error || 'Failed to close job order.'
			});
			return;
		}

		const updated = await res.json();
		const nextForm = toForm(updated);
		setJobOrder((current) => (current ? { ...current, ...updated } : current));
		setForm(nextForm);
		markAsClean(nextForm);
		setCloseState({ closing: false, error: '' });
		setActionsOpen(false);
		setSaveState({ saving: false, error: '', success: 'Job order closed.' });
	}

	async function onEnhancePublicPosting() {
		if (!hasMeaningfulRichTextContent(form.publicDescription)) {
			setEnhanceState({
				enhancing: false,
				error: 'Public description is required before AI enhancement.',
				success: ''
			});
			return;
		}

		setEnhanceState({ enhancing: true, error: '', success: '' });

		const res = await fetch(`/api/job-orders/${id}/enhance-public-description`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: form.title,
				description: form.description,
				publicDescription: form.publicDescription,
				location: form.location,
				employmentType: form.employmentType,
				currency: form.currency,
				salaryMin: form.salaryMin,
				salaryMax: form.salaryMax
			})
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setEnhanceState({
				enhancing: false,
				error: data.error || 'Failed to enhance public posting.',
				success: ''
			});
			return;
		}

		const data = await res.json().catch(() => ({}));
		const nextPublicDescription = String(data?.enhancedPublicDescription || '');
		if (!hasMeaningfulRichTextContent(nextPublicDescription)) {
			setEnhanceState({
				enhancing: false,
				error: 'OpenAI returned an empty enhancement.',
				success: ''
			});
			return;
		}

		setForm((current) => ({
			...current,
			publicDescription: nextPublicDescription
		}));
		setEnhanceState({
			enhancing: false,
			error: '',
			success: 'Public posting enhanced with AI. Review and save.'
		});
	}

	function onToggleAuditTrail() {
		setActionsOpen(false);
		setShowAuditTrail((current) => !current);
	}

	function onOpenClientPortal() {
		setActionsOpen(false);
		if (!clientPortalEnabled) {
			toast.error('Client review portal is disabled. An administrator must enable it in Admin Area > System Settings.');
			return;
		}
		setShowClientPortalModal(true);
	}

	async function onArchiveJobOrder() {
		if (!jobOrder?.id) return;
		setActionsOpen(false);
		const archiveOptions = getArchiveCascadeOptions('JOB_ORDER');
		const decision = await requestConfirmWithOptions({
			title: 'Archive Job Order',
			message: `Archive ${jobOrder.title}? You can restore it from Archive later.`,
			confirmLabel: 'Archive',
			cancelLabel: 'Cancel',
			isDanger: true,
			options: archiveOptions
		});
		if (!decision?.confirmed) return;
		const cascade = cascadeSelectionFromIds('JOB_ORDER', decision.selections);
		const result = await archiveEntity(jobOrder.id, '', cascade);
		if (!result.ok) {
			toast.error(result.error || 'Failed to archive job order.');
			return;
		}
		const relatedCount = Math.max(0, Number(result.archivedCount || 1) - 1);
		toast.success(
			relatedCount > 0
				? `Job order archived with ${relatedCount} related record${relatedCount === 1 ? '' : 's'}.`
				: 'Job order archived.'
		);
		router.push('/job-orders');
	}

	async function onNavigateToJobOrder(targetId) {
		if (!targetId || String(targetId) === String(id)) return;
		if (!(await confirmNavigation())) return;
		router.push(withRecordNavigationQuery(`/job-orders/${targetId}`));
	}

	if (loading) {
		return (
			<section className="module-page">
				<LoadingIndicator className="page-loading-indicator" label="Loading job order details" />
			</section>
		);
	}

	if (error || !jobOrder) {
		return (
			<section className="module-page">
				<p>{error || 'Job order not found.'}</p>
				<button type="button" onClick={() => router.push('/job-orders')}>
					Back to Job Orders
				</button>
			</section>
		);
	}

	const workspacePanelStyle =
		detailsPanelHeight > 0 ? { height: `${detailsPanelHeight}px`, maxHeight: `${detailsPanelHeight}px` } : undefined;
	const requiresPublicDescription = careerSiteEnabled && form.publishToCareerSite;
	const hasPublicDescription = hasMeaningfulRichTextContent(form.publicDescription);
	const canPublishToCareerSite = careerSiteEnabled && hasPublicDescription;
	const salaryMinValue = parseCurrencyInput(form.salaryMin);
	const salaryMaxValue = parseCurrencyInput(form.salaryMax);
	const hasSalaryRangeError =
		salaryMinValue != null && salaryMaxValue != null && salaryMinValue > salaryMaxValue;
	const showSalaryRangeStatus = salaryMinValue != null || salaryMaxValue != null;
	const customFieldsComplete = areRequiredCustomFieldsComplete(
		customFieldDefinitions,
		form.customFields
	);
	const canEnhancePublicPosting =
		aiAvailable &&
		careerSiteEnabled &&
		!enhanceState.enhancing &&
		!saveState.saving &&
		!closeState.closing &&
		hasMeaningfulRichTextContent(form.publicDescription);
	const isPublicPostingConfigured = careerSiteEnabled && Boolean(jobOrder.publishToCareerSite);
	const canViewPublicPosting = isPublicPostingConfigured && jobOrder.status === 'open';
	const publicPostingHref = canViewPublicPosting ? `/careers/jobs/${jobOrder.id}` : '';
	const statusOptions = JOB_ORDER_STATUS_OPTIONS.filter(
		(option) => option.value !== 'closed' || form.status === 'closed'
	);
	const canSaveJobOrder =
		form.title.trim().length > 0 &&
		(!isAdmin || Boolean(form.divisionId)) &&
		Boolean(form.status) &&
		Boolean(form.employmentType) &&
		Boolean(form.ownerId) &&
		Boolean(form.clientId) &&
		Boolean(form.contactId) &&
		Boolean(form.zipCode.trim()) &&
		!hasSalaryRangeError &&
		customFieldsComplete &&
		(!requiresPublicDescription || hasPublicDescription) &&
		!saveState.saving;

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<Link
						href={jobOrderNavigationState?.listPath || '/job-orders'}
						className="module-back-link"
						aria-label="Back to List"
					>
						&larr; Back
					</Link>
					<h2>{jobOrder.title}</h2>
					<p>{jobOrder.client?.name || 'No client linked'}</p>
				</div>
				<div className="module-header-actions">
					{jobOrderNavigationState ? (
						<div className="record-navigation-controls" aria-label={`${jobOrderNavigationState.label} navigation`}>
							<p className="simple-list-meta record-navigation-meta">
								{jobOrderNavigationState.label}: {jobOrderNavigationState.position} of {jobOrderNavigationState.total}
							</p>
							<div className="record-navigation-buttons">
								<button
									type="button"
									className="btn-secondary record-navigation-button"
									onClick={() => onNavigateToJobOrder(jobOrderNavigationState.previousId)}
									disabled={!jobOrderNavigationState.previousId}
									aria-label="Previous Job Order"
									title="Previous Job Order"
								>
									<ChevronLeft aria-hidden="true" className="btn-refresh-icon-svg" />
								</button>
								<button
									type="button"
									className="btn-secondary record-navigation-button"
									onClick={() => onNavigateToJobOrder(jobOrderNavigationState.nextId)}
									disabled={!jobOrderNavigationState.nextId}
									aria-label="Next Job Order"
									title="Next Job Order"
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
							aria-label="Open job order actions"
							title="Actions"
							>
								<span className="actions-menu-icon" aria-hidden="true">
									<MoreVertical />
								</span>
							</button>
						{actionsOpen ? (
							<div className="actions-menu-list" role="menu" aria-label="Job order actions">
								{isPublicPostingConfigured ? (
									canViewPublicPosting ? (
										<a
											href={publicPostingHref}
											target="_blank"
											rel="noreferrer"
											role="menuitem"
											className="actions-menu-item"
											onClick={() => setActionsOpen(false)}
										>
											View Public Posting
										</a>
									) : (
										<button
											type="button"
											role="menuitem"
											className="actions-menu-item"
											disabled
											title="Only open job orders have a public posting."
										>
											View Public Posting
										</button>
									)
								) : null}
								<button
									type="button"
									role="menuitem"
									className="actions-menu-item"
									onClick={onOpenClientPortal}
								>
									Client Review Portal
								</button>
								<div className="actions-menu-divider" role="separator" />
								<button
									type="button"
									role="menuitem"
									className="actions-menu-item actions-menu-item-danger"
									onClick={onCloseJobOrder}
									disabled={closeState.closing || saveState.saving || jobOrder.status === 'closed'}
								>
									{closeState.closing ? 'Closing...' : 'Close Job Order'}
								</button>
								<button
									type="button"
									role="menuitem"
									className="actions-menu-item actions-menu-item-danger"
									onClick={onArchiveJobOrder}
									disabled={closeState.closing || saveState.saving}
								>
									Archive Job Order
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

			<ClientPortalModal
				open={showClientPortalModal}
				onClose={() => setShowClientPortalModal(false)}
				jobOrderId={jobOrder.id}
				jobOrderTitle={jobOrder.title}
				onAccessChange={setPortalAccess}
			/>

			<article className="panel">
				<h3>Snapshot</h3>
				<div className="info-list snapshot-grid snapshot-grid-six">
					<p>
						<span>Record ID</span>
						<strong>{jobOrder.recordId || '-'}</strong>
					</p>
					<p>
						<span>Client</span>
						<strong>
							{jobOrder.client?.id ? (
								<Link href={`/clients/${jobOrder.client.id}`}>
									{jobOrder.client.name}{' '}
									<ArrowUpRight aria-hidden="true" className="snapshot-link-icon" />
								</Link>
							) : (
								jobOrder.client?.name || '-'
							)}
						</strong>
					</p>
					<p>
						<span>Hiring Manager</span>
						<strong>
							{jobOrder.contact?.id ? (
								<Link href={`/contacts/${jobOrder.contact.id}`}>
									{`${jobOrder.contact.firstName} ${jobOrder.contact.lastName}`}{' '}
									<ArrowUpRight aria-hidden="true" className="snapshot-link-icon" />
								</Link>
							) : jobOrder.contact ? (
								`${jobOrder.contact.firstName} ${jobOrder.contact.lastName}`
							) : (
								'-'
							)}
						</strong>
					</p>
					<p>
						<span>Owner</span>
						<strong>
							{jobOrder.ownerUser
								? `${jobOrder.ownerUser.firstName} ${jobOrder.ownerUser.lastName}`
								: '-'}
						</strong>
					</p>
				</div>
				{clientPortalEnabled ? (
					<div className="job-order-portal-analytics-card">
					<div className="panel-header-row job-order-portal-analytics-head">
						<div>
							<h4>Portal Analytics</h4>
							<p className="panel-subtext">Client review link health for this job order.</p>
						</div>
					</div>
					{!jobOrder.contactId ? (
						<p className="panel-subtext">Assign a client contact to create and track a client review portal.</p>
					) : !portalAccess ? (
						<p className="panel-subtext">No client review portal link has been created yet.</p>
					) : (
						<>
							<div className="info-list snapshot-grid snapshot-grid-four">
								<p>
									<span>Sent</span>
									<strong>{portalAccess.analytics?.sent ? 'Yes' : 'No'}</strong>
								</p>
								<p>
									<span>Opened</span>
									<strong>{portalAccess.analytics?.opened ? 'Yes' : 'No'}</strong>
								</p>
								<p>
									<span>Last Viewed</span>
									<strong>{portalAccess.analytics?.lastViewedAt ? formatDate(portalAccess.analytics.lastViewedAt) : 'Not yet'}</strong>
								</p>
								<p>
									<span>Acted On</span>
									<strong>{portalAccess.analytics?.actedOn ? 'Yes' : 'No'}</strong>
								</p>
							</div>
							<p className="simple-list-meta job-order-portal-analytics-meta">
								Last emailed: <span className="meta-emphasis-time">{portalAccess.analytics?.lastEmailedAt ? formatDate(portalAccess.analytics.lastEmailedAt) : 'Not yet'}</span>
								<span className="job-order-portal-analytics-separator" aria-hidden="true">|</span>
								Last client action: <span className="meta-emphasis-time">{portalAccess.analytics?.lastActionAt ? formatDate(portalAccess.analytics.lastActionAt) : 'Not yet'}</span>
								<span className="job-order-portal-analytics-separator" aria-hidden="true">|</span>
								Client actions logged: <span className="meta-emphasis-time">{Number(portalAccess.analytics?.feedbackCount || 0)}</span>
							</p>
						</>
					)}
					</div>
				) : null}
			</article>

			<div className="detail-layout detail-layout-equal">
				<article className="panel panel-spacious" ref={detailsPanelRef}>
					<h3>Job Order Details</h3>
					<p className="panel-subtext">Edit job order details and save updates.</p>
					<form onSubmit={onSave} className="detail-form">
						<section className="form-section">
							<h4>Core Details</h4>
							<FormField label="Title" required>
								<input
									value={form.title}
									onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Internal Description">
								<textarea
									rows={8}
									value={form.description}
									onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
								/>
							</FormField>
							<div className="detail-form-grid-2">
								<FormField label="Location">
									<AddressTypeaheadInput
										value={form.location}
										onChange={(nextValue) =>
											setForm((f) => ({
												...f,
												location: nextValue
											}))
										}
										onPlaceDetailsChange={(details) =>
											setForm((f) => ({
												...f,
												locationPlaceId: details?.placeId || '',
												locationLatitude: details?.latitude ?? '',
												locationLongitude: details?.longitude ?? '',
												city: details?.city ?? f.city,
												state: details?.state ?? f.state,
												zipCode: details?.postalCode ? normalizeZipValue(details.postalCode) : f.zipCode
											}))
										}
										placeholder="Search address or enter manually"
										label="Location"
									/>
								</FormField>
								<FormField label="Employment Type" required>
									<select
										value={form.employmentType}
										onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}
										required
									>
										<option value="">Select employment type</option>
										{JOB_ORDER_EMPLOYMENT_TYPES.map((employmentType) => (
											<option key={employmentType} value={employmentType}>
												{employmentType}
											</option>
										))}
									</select>
								</FormField>
							</div>
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
										onChange={(e) => setForm((f) => ({ ...f, zipCode: normalizeZipValue(e.target.value) }))}
										required
									/>
								</FormField>
							</div>
						</section>

						<section className="form-section">
							<h4>Status and Capacity</h4>
								<FormField label="Status" required>
									<select
										value={form.status}
										onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
										required
									>
										{statusOptions.map((statusOption) => (
											<option key={statusOption.value} value={statusOption.value}>
												{statusOption.label}
											</option>
										))}
									</select>
								</FormField>
							<div className="detail-form-grid-4">
								<FormField label="Openings">
									<input
										type="number"
										min="1"
										value={form.openings}
										onChange={(e) => setForm((f) => ({ ...f, openings: e.target.value }))}
									/>
								</FormField>
								<FormField label="Currency">
									<select
										value={form.currency}
										onChange={(e) => {
											const nextCurrency = JOB_ORDER_CURRENCIES.includes(e.target.value)
												? e.target.value
												: 'USD';
											setForm((current) => ({
												...current,
												currency: nextCurrency,
												salaryMin: formatCurrencyInput(current.salaryMin, nextCurrency),
												salaryMax: formatCurrencyInput(current.salaryMax, nextCurrency)
											}));
										}}
									>
										<option value="USD">USD</option>
										<option value="CAD">CAD</option>
									</select>
								</FormField>
								<FormField label="Salary Min">
									<input
										type="text"
										inputMode="decimal"
										value={form.salaryMin}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												salaryMin: formatCurrencyInput(e.target.value, f.currency)
											}))
										}
									/>
								</FormField>
								<FormField label="Salary Max">
									<input
										type="text"
										inputMode="decimal"
										value={form.salaryMax}
										onChange={(e) =>
											setForm((f) => ({
												...f,
												salaryMax: formatCurrencyInput(e.target.value, f.currency)
											}))
										}
									/>
								</FormField>
							</div>
							{showSalaryRangeStatus ? (
								<div className="validation-chip-row">
									<span className={`chip ${hasSalaryRangeError ? 'validation-chip-invalid' : 'validation-chip-valid'}`}>
										{hasSalaryRangeError ? 'Salary Range Invalid' : 'Salary Range OK'}
									</span>
								</div>
							) : null}
						</section>

						<section className="form-section">
							<h4>Client Assignment</h4>
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
												ownerId: '',
												clientId: '',
												contactId: ''
											}))
										}
										placeholder="Search division"
										label="Division"
										emptyLabel="No matching divisions."
									/>
								</FormField>
							) : null}
								<FormField label="Owner" required>
									<LookupTypeaheadSelect
										entity="users"
										lookupParams={ownerLookupParams}
										value={form.ownerId}
										onChange={(nextValue) => setForm((f) => ({ ...f, ownerId: nextValue }))}
										onSelectOption={(option) => setOwnerDivisionId(option?.divisionId ?? null)}
										placeholder={isAdmin && !form.divisionId ? 'Select division first' : 'Search owner (required)'}
										label="Owner"
										disabled={isAdmin && !form.divisionId}
										emptyLabel="No matching users."
									/>
								</FormField>
							<FormField label="Client" required>
								<LookupTypeaheadSelect
									entity="clients"
									lookupParams={clientLookupParams}
									value={form.clientId}
									onChange={(nextValue) =>
										setForm((f) => ({ ...f, clientId: nextValue, contactId: '' }))
									}
									onSelectOption={(option) => setSelectedClientDivisionId(option?.divisionId ?? null)}
									placeholder={isAdmin && !form.divisionId ? 'Select division first' : 'Search client'}
									label="Client"
									disabled={isAdmin && !form.divisionId}
									emptyLabel="No matching clients."
								/>
							</FormField>
							<FormField label="Hiring Manager" required>
								<LookupTypeaheadSelect
									entity="contacts"
									lookupParams={contactLookupParams}
									value={form.contactId}
									onChange={(nextValue) => setForm((f) => ({ ...f, contactId: nextValue }))}
									placeholder={
										isAdmin && !form.divisionId
											? 'Select division first'
											: form.clientId
												? 'Search hiring manager'
												: 'Select client first'
									}
									label="Hiring Manager"
									disabled={!form.clientId || (isAdmin && !form.divisionId)}
									emptyLabel="No matching contacts."
								/>
							</FormField>
						{careerSiteEnabled ? (
							<>
								<div className="checkbox-grid">
									<label className="switch-field">
										<input
											type="checkbox"
											className="switch-input"
											checked={form.publishToCareerSite}
											disabled={!form.publishToCareerSite && !canPublishToCareerSite}
											onChange={(e) => {
												const checked = e.target.checked;
												setForm((f) => ({ ...f, publishToCareerSite: checked }));
												setSaveState((current) => ({ ...current, error: '' }));
											}}
										/>
										<span className="switch-track" aria-hidden="true">
											<span className="switch-thumb" />
										</span>
										<span className="switch-copy">
											<span className="switch-label">Publish to Career Site</span>
											<span className="switch-hint">
												{canPublishToCareerSite
													? 'Publish the public description to your careers page.'
													: 'Add a public description before enabling career-site publishing.'}
											</span>
										</span>
									</label>
								</div>
								<FormField label="Public Description" required={form.publishToCareerSite}>
									<RichTextEditor
										value={form.publicDescription}
										onChange={(nextValue) => setForm((f) => ({ ...f, publicDescription: nextValue }))}
										disabled={enhanceState.enhancing}
										toolbarActions={[
											{
												key: 'enhance-public-posting',
												label: 'Enhance public posting with AI',
												loadingLabel: 'Enhancing...',
												icon: Sparkles,
												iconOnly: true,
												title: aiAvailable
													? 'Enhance with AI'
													: 'Enable OpenAI in Admin Area > System Settings to use this.',
												onClick: onEnhancePublicPosting,
												disabled: !canEnhancePublicPosting,
												loading: enhanceState.enhancing
											}
										]}
										ariaLabel="Public Description"
									/>
								</FormField>
								{!aiAvailable ? (
									<p className="panel-subtext">Enable OpenAI in Admin Area &gt; System Settings to use this.</p>
								) : null}
							</>
						) : null}
					</section>
					<CustomFieldsSection
						moduleKey="jobOrders"
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
								disabled={!canSaveJobOrder}
								label="Save Job Order"
								savingLabel="Saving Job Order..."
							/>
							<span className="form-actions-meta">
								<span>Updated:</span>
								<strong>{formatDate(jobOrder.updatedAt)}</strong>
							</span>
						</div>
					</form>
				</article>

				<article className="panel workspace-panel workspace-panel-lock-height" style={workspacePanelStyle}>
					<h3>Job Order Workspace</h3>
					<div
						className="side-tabs side-tabs-warm side-tabs-counted"
						role="tablist"
						aria-label="Job order workspace tabs"
					>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'timeline'}
							className={workspaceTab === 'timeline' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('timeline')}
						>
							<span>Timeline</span>
							<span className="side-tab-count" aria-hidden="true">{jobOrderTimelineItems.length}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'submissions'}
							className={workspaceTab === 'submissions' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('submissions')}
						>
							<span>Submissions</span>
							<span className="side-tab-count" aria-hidden="true">{jobOrder.submissions.length}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'interviews'}
							className={workspaceTab === 'interviews' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('interviews')}
						>
							<span>Interviews</span>
							<span className="side-tab-count" aria-hidden="true">{jobOrder.interviews.length}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'placements'}
							className={workspaceTab === 'placements' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('placements')}
						>
							<span>Placements</span>
							<span className="side-tab-count" aria-hidden="true">{jobOrder.offers.length}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'matches'}
							className={workspaceTab === 'matches' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('matches')}
						>
							<span>Matches</span>
							<span className="side-tab-count" aria-hidden="true">{matchState.matches.length}</span>
						</button>
					</div>

					{workspaceTab === 'submissions' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<form onSubmit={onCreateSubmission} className="detail-form">
								<FormField label="Candidate" required>
									<LookupTypeaheadSelect
										entity="candidates"
										lookupParams={submissionCandidateLookupParams}
										value={submissionForm.candidateId}
										onChange={(nextValue) => {
											setSubmissionForm((current) => ({ ...current, candidateId: nextValue }));
											setSubmissionState((current) => ({ ...current, error: '', success: '' }));
										}}
										placeholder="Search candidate"
										label="Candidate"
										disabled={submissionState.saving}
										emptyLabel="No matching candidates."
									/>
								</FormField>
								<FormField label="Status">
									<select
										value={submissionForm.status}
										onChange={(e) => {
											setSubmissionForm((current) => ({ ...current, status: e.target.value }));
											setSubmissionState((current) => ({ ...current, error: '', success: '' }));
										}}
									>
										{submissionStatuses.map((statusOption) => (
											<option key={statusOption.value} value={statusOption.value}>
												{statusOption.label}
											</option>
										))}
									</select>
								</FormField>
								<FormField label="Notes">
									<textarea
										placeholder="Submission notes"
										value={submissionForm.notes}
										onChange={(e) => {
											setSubmissionForm((current) => ({ ...current, notes: e.target.value }));
											setSubmissionState((current) => ({ ...current, error: '', success: '' }));
										}}
									/>
								</FormField>
								<div className="form-actions">
									<SaveActionButton
										saving={submissionState.saving}
										disabled={submissionState.saving || !submissionForm.candidateId}
										label="Add Submission"
										savingLabel="Adding Submission..."
										icon={UserPlus}
									/>
								</div>
							</form>
							<h4 className="side-section-title">Current Submissions</h4>
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Submissions"
									value={submissionSort.field}
									direction={submissionSort.direction}
									onValueChange={(field) =>
										setSubmissionSort((current) => ({
											field,
											direction: field === 'submissionPriority' ? 'asc' : current.direction
										}))
									}
									onDirectionToggle={() => {
										if (submissionSort.field === 'submissionPriority') return;
										setSubmissionSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}));
									}}
									options={[
										{ value: 'submissionPriority', label: 'Priority Order' },
										{ value: 'createdAt', label: 'Submitted Date' },
										{ value: 'candidate', label: 'Candidate' },
										{ value: 'status', label: 'Status' },
										{ value: 'submittedBy', label: 'Submitted By' }
									]}
									disabled={sortedSubmissions.length < 2}
									disableDirectionToggle={submissionSort.field === 'submissionPriority'}
								/>
								{sortedSubmissions.length > 1 ? (
									<p className="panel-subtext">
										{canReorderSubmissions
											? 'Drag and drop submissions to set preference order.'
											: 'Switch sort to Priority Order to drag and reorder submissions.'}
									</p>
								) : null}
								{jobOrder.submissions.length === 0 ? (
									<p className="panel-subtext">No submissions yet.</p>
								) : (
									<ul className="simple-list simple-list-reorderable">
										{sortedSubmissions.map((submission) => {
											const latestClientFeedback =
												clientPortalEnabled
													&& Array.isArray(submission.clientFeedback)
													&& submission.clientFeedback.length > 0
													? submission.clientFeedback[0]
													: null;
											const feedbackCount = clientPortalEnabled && Array.isArray(submission.clientFeedback)
												? submission.clientFeedback.length
												: 0;
											return (
											<li
												key={submission.id}
												className={
													canReorderSubmissions && submissionOrderState.overId === String(submission.id)
														? 'is-drop-target'
														: canReorderSubmissions && submissionOrderState.draggingId === String(submission.id)
															? 'is-dragging'
															: ''
												}
												onDragOver={(event) => onSubmissionDragOver(event, submission.id)}
												onDrop={() => onSubmissionDrop(submission.id)}
												onDragEnd={onSubmissionDragEnd}
											>
												<div className="submission-list-entry">
													<div className="submission-list-entry-body">
														<div className="submission-list-entry-head">
															<span
																className={
																	canReorderSubmissions
																		? 'submission-priority-handle submission-priority-handle-active'
																		: 'submission-priority-handle'
																}
																aria-label={`Priority ${submission.submissionPriority || 0}`}
																title={
																	canReorderSubmissions
																		? `Priority ${submission.submissionPriority || 0}. Drag to reorder.`
																		: `Priority ${submission.submissionPriority || 0}`
																}
																draggable={canReorderSubmissions}
																onDragStart={(event) => onSubmissionDragStart(event, submission.id)}
																onDragEnd={onSubmissionDragEnd}
															>
																{canReorderSubmissions ? <GripVertical aria-hidden="true" /> : null}
																<strong>#{submission.submissionPriority || 0}</strong>
															</span>
												<strong>
													<Link href={`/candidates/${submission.candidate.id}`}>
														{formatPersonName(
															submission.candidate?.firstName,
															submission.candidate?.lastName,
															{ format: 'last-first', fallback: 'Candidate unavailable' }
														)}
													</Link>
												</strong>
														</div>
														<p className="simple-list-meta">
															By{' '}
															{submissionCreatedByLabel(submission)}{' '}
															@ <span className="meta-emphasis-time">{formatDate(submission.createdAt)}</span>
														</p>
														{latestClientFeedback ? (
															<>
																<div className="submission-feedback-block">
																	<p className="submission-feedback-label">Client Update</p>
																	<p className="submission-feedback-meta">
																		{formatClientFeedbackLabel(latestClientFeedback.actionType)}
																		{latestClientFeedback.clientNameSnapshot ? ` by ${latestClientFeedback.clientNameSnapshot}` : ''}
																		{latestClientFeedback.createdAt ? (
																			<>
																				{' '}@ <span className="meta-emphasis-time">{formatDate(latestClientFeedback.createdAt)}</span>
																			</>
																		) : null}
																		{feedbackCount > 1 ? ` (+${feedbackCount - 1} more)` : ''}
																	</p>
																</div>
															</>
														) : null}
													</div>
												</div>
												<div className="simple-list-actions simple-list-indicators submission-list-entry-actions">
													<Link
														href={`/submissions/${submission.id}`}
														className="row-action-icon submission-open-link"
														title="Open submission detail"
														aria-label={`Open submission detail for ${formatPersonName(
															submission.candidate?.firstName,
															submission.candidate?.lastName,
															{ format: 'last-first', fallback: 'candidate' }
														)}`}
													>
														<ArrowUpRight aria-hidden="true" />
													</Link>
													<div className="submission-chip-stack">
														<span className="chip">{formatSelectValueLabel(getEffectiveSubmissionStatus(submission))}</span>
														<span
															className={
																submissionOriginLabel(submission) === 'Web'
																	? 'chip submission-origin-chip submission-origin-chip-web'
																	: 'chip submission-origin-chip submission-origin-chip-recruiter'
															}
														>
															{submissionOriginLabel(submission)}
														</span>
													</div>
												</div>
											</li>
											);
										})}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'interviews' ? (
						<div className="side-tab-content side-tab-content-list-only">
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Interviews"
									value={interviewSort.field}
									direction={interviewSort.direction}
									onValueChange={(field) => setInterviewSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setInterviewSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'startsAt', label: 'Start Date' },
										{ value: 'subject', label: 'Subject' },
										{ value: 'candidate', label: 'Candidate' },
										{ value: 'status', label: 'Status' }
									]}
									disabled={sortedInterviews.length < 2}
								/>
								{jobOrder.interviews.length === 0 ? (
									<p className="panel-subtext">No interviews yet.</p>
								) : (
									<ul className="simple-list">
										{sortedInterviews.map((interview) => (
											<li key={interview.id}>
												<div>
													<strong>
														<Link href={`/interviews/${interview.id}`}>{interview.subject}</Link>
													</strong>
													<p>
														{interview.candidate
															? formatPersonName(
																interview.candidate.firstName,
																interview.candidate.lastName,
																{ format: 'last-first' }
															)
															: 'Candidate unavailable'}
													</p>
													<p className="simple-list-meta">@ <span className="meta-emphasis-time">{formatDate(interview.startsAt || interview.createdAt)}</span></p>
												</div>
												<div className="simple-list-actions simple-list-indicators">
													<span className="chip">{formatSelectValueLabel(interview.status)}</span>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'placements' ? (
						<div className="side-tab-content side-tab-content-list-only">
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Placements"
									value={placementSort.field}
									direction={placementSort.direction}
									onValueChange={(field) => setPlacementSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setPlacementSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'createdAt', label: 'Created Date' },
										{ value: 'candidate', label: 'Candidate' },
										{ value: 'status', label: 'Status' }
									]}
									disabled={sortedPlacements.length < 2}
								/>
								{jobOrder.offers.length === 0 ? (
									<p className="panel-subtext">No placements yet.</p>
								) : (
									<ul className="simple-list">
										{sortedPlacements.map((offer) => (
											<li key={offer.id}>
												<div>
													<strong>
														<Link href={`/placements/${offer.id}`}>Placement #{offer.id}</Link>
													</strong>
													<p>
														{offer.candidate
															? formatPersonName(offer.candidate.firstName, offer.candidate.lastName, {
																format: 'last-first'
															})
															: 'Candidate unavailable'}
													</p>
													<p className="simple-list-meta">@ <span className="meta-emphasis-time">{formatDate(offer.createdAt)}</span></p>
												</div>
												<div className="simple-list-actions simple-list-indicators">
													<span className="chip">{formatSelectValueLabel(offer.status)}</span>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'matches' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<div className="form-actions">
								<button
									type="button"
									className="btn-secondary btn-link-icon btn-refresh-icon"
									onClick={() => loadMatches()}
									disabled={matchState.loading || !!matchState.submittingCandidateId}
									aria-label={matchState.loading ? 'Refreshing matches' : 'Refresh matches'}
									title={matchState.loading ? 'Refreshing matches' : 'Refresh matches'}
								>
									<RefreshCcw
										aria-hidden="true"
										className={matchState.loading ? 'btn-refresh-icon-svg row-action-icon-spinner' : 'btn-refresh-icon-svg'}
									/>
								</button>
								{matchState.computedAt ? (
									<span className="form-actions-meta">
										<span>Updated:</span>
										<strong>{formatDate(matchState.computedAt)}</strong>
									</span>
								) : null}
							</div>
							{!matchState.matchEligibility && matchState.requiredSkillNames.length > 0 ? (
								<p className="panel-subtext">
									Required skills inferred: {matchState.requiredSkillNames.join(', ')}
								</p>
							) : null}
							{matchState.error ? <p className="panel-subtext error">{matchState.error}</p> : null}
							<div className="workspace-scroll-area">
								{matchState.matchEligibility ? (
									<p className="panel-subtext">{matchState.matchEligibility}</p>
								) : (
									<>
										<ListSortControls
											label="Sort Matches"
											value={matchesSort.field}
											direction={matchesSort.direction}
											onValueChange={(field) => setMatchesSort((current) => ({ ...current, field }))}
											onDirectionToggle={() =>
												setMatchesSort((current) => ({
													...current,
													direction: current.direction === 'asc' ? 'desc' : 'asc'
												}))
											}
											options={[
												{ value: 'scorePercent', label: 'Match Score' },
												{ value: 'candidate', label: 'Candidate' },
												{ value: 'owner', label: 'Owner' }
											]}
											disabled={sortedMatches.length < 2}
										/>
										{!matchState.loading && matchState.matches.length === 0 ? (
											<p className="panel-subtext">
												No matches available. Try refreshing after adding more candidate detail.
											</p>
										) : (
											<ul className="simple-list">
												{sortedMatches.map((match) => {
													const isSubmitting =
														matchState.submittingCandidateId === String(match.candidateId);
													return (
														<li key={match.candidateId}>
															<div>
																<strong>
																	<Link href={`/candidates/${match.candidateId}`}>{match.candidateName}</Link>
																</strong>
																<p>
																	{match.currentJobTitle || 'No current title'} | Owner: {match.ownerName || '-'}
																</p>
																<p>
																	Match score: <strong>{match.scorePercent}%</strong>
																</p>
																{Array.isArray(match.reasons) && match.reasons.length > 0 ? (
																	<p>{match.reasons.join(' • ')}</p>
																) : null}
															</div>
															<div className="simple-list-actions">
																<div className="row-actions row-actions-right">
																	<button
																		type="button"
																		className="row-action-icon"
																		aria-label="Explain match"
																		title={aiAvailable ? 'Explain match' : 'Enable OpenAI in Admin Area > System Settings to use this.'}
																		onClick={() =>
																			setMatchExplanationTarget({
																				candidateId: match.candidateId,
																				candidateName: match.candidateName,
																				jobOrderId: Number(id),
																				jobOrderTitle: jobOrder.title,
																				scorePercent: match.scorePercent,
																				reasons: match.reasons || [],
																				risks: match.risks || []
																			})
																		}
																		disabled={!aiAvailable || matchState.loading}
																	>
																		<Sparkles aria-hidden="true" className="row-action-lucide" />
																	</button>
																	<SaveActionButton
																		type="button"
																		onClick={() => onCreateMatchedSubmission(match)}
																		saving={isSubmitting}
																		disabled={
																			isSubmitting ||
																			matchState.loading ||
																			submittedCandidateIds.has(String(match.candidateId))
																		}
																		label="Add Submission"
																		savingLabel="Adding Submission..."
																		icon={UserPlus}
																	/>
																</div>
															</div>
														</li>
													);
												})}
											</ul>
										)}
									</>
								)}
							</div>
							{!matchState.matchEligibility ? (
								<p className="panel-subtext">
									Evaluated {matchState.totalCandidatesEvaluated} candidate
									{matchState.totalCandidatesEvaluated === 1 ? '' : 's'}.
								</p>
							) : null}
						</div>
					) : null}
					{workspaceTab === 'timeline' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<h4 className="side-section-title">Timeline</h4>
							<p className="panel-subtext">Unified job-order activity across submissions, interviews, placements, client feedback, and portal lifecycle events.</p>
							<div className="workspace-scroll-area">
								<ActivityTimeline items={jobOrderTimelineItems} emptyText="No job-order timeline events yet." />
							</div>
						</div>
					) : null}
				</article>
			</div>
			{isAdmin ? <AuditTrailPanel entityType="JOB_ORDER" entityId={id} visible={showAuditTrail} /> : null}
			<MatchExplanationModal
				open={Boolean(matchExplanationTarget)}
				onClose={() => setMatchExplanationTarget(null)}
				candidateId={matchExplanationTarget?.candidateId}
				candidateName={matchExplanationTarget?.candidateName}
				jobOrderId={matchExplanationTarget?.jobOrderId}
				jobOrderTitle={matchExplanationTarget?.jobOrderTitle}
				scorePercent={matchExplanationTarget?.scorePercent}
				reasons={matchExplanationTarget?.reasons}
				risks={matchExplanationTarget?.risks}
			/>
		</section>
	);
}
