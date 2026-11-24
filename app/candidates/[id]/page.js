'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BookmarkPlus, BookmarkX, ChevronLeft, ChevronRight, Download, FileText, LoaderCircle, MoreVertical, RefreshCcw, Save, Sparkles, Trash2, Upload, UserPlus, X } from 'lucide-react';
import LookupTypeaheadSelect from '@/app/components/lookup-typeahead-select';
import PhoneInput from '@/app/components/phone-input';
import AddressTypeaheadInput from '@/app/components/address-typeahead-input';
import FormField from '@/app/components/form-field';
import LoadingIndicator from '@/app/components/loading-indicator';
import SaveActionButton from '@/app/components/save-action-button';
import CustomFieldsSection, { areRequiredCustomFieldsComplete } from '@/app/components/custom-fields-section';
import SkillChipSelect from '@/app/components/skill-chip-select';
import ListSortControls from '@/app/components/list-sort-controls';
import AuditTrailPanel from '@/app/components/audit-trail-panel';
import ActivityTimeline from '@/app/components/activity-timeline';
import MatchExplanationModal from '@/app/components/match-explanation-modal';
import EmailDraftModal from '@/app/components/email-draft-modal';
import { useToast } from '@/app/components/toast-provider';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import useArchivedEntities from '@/app/hooks/use-archived-entities';
import useIsAdministrator from '@/app/hooks/use-is-administrator';
import {
	CANDIDATE_SOURCE_OPTIONS,
	normalizeCandidateSourceValue
} from '@/app/constants/candidate-source-options';
import useUnsavedChangesGuard from '@/app/hooks/use-unsaved-changes-guard';
import { cascadeSelectionFromIds, getArchiveCascadeOptions } from '@/lib/archive-cascade-options';
import { candidateAttachmentAcceptString } from '@/lib/candidate-attachment-options';
import { formatDateTimeAt } from '@/lib/date-format';
import { isValidEmailAddress } from '@/lib/email-validation';
import { formatSelectValueLabel } from '@/lib/select-value-label';
import { sortByConfig } from '@/lib/list-sort';
import { submissionCreatedByLabel, submissionOriginLabel } from '@/lib/submission-origin';
import { getEffectiveSubmissionStatus } from '@/lib/submission-status';
import { getCandidateCompleteness } from '@/lib/candidate-completeness';
import { buildCandidateTimeline } from '@/lib/activity-timeline';
import { deriveCandidateSuggestedNextStep } from '@/lib/candidate-next-step';
import {
	clearRecordNavigationContext,
	readRecordNavigationContext,
	RECORD_NAVIGATION_QUERY_PARAM,
	withRecordNavigationQuery
} from '@/lib/record-navigation-context';
import { isValidOptionalHttpUrl } from '@/lib/url-validation';
import { CANDIDATE_STATUS_OPTIONS, isCandidateEligibleForSubmission, isCandidateQualifiedForPipeline } from '@/lib/candidate-status';

const initialActivity = {
	type: 'call',
	subject: '',
	description: '',
	dueAt: '',
	status: 'open'
};

const initialEducationForm = {
	schoolName: '',
	degree: '',
	fieldOfStudy: '',
	startDate: '',
	endDate: '',
	isCurrent: false,
	description: ''
};

const initialWorkExperienceForm = {
	companyName: '',
	title: '',
	location: '',
	startDate: '',
	endDate: '',
	isCurrent: false,
	description: ''
};

function normalizeSummaryItems(values) {
	if (!Array.isArray(values)) return [];
	return values
		.map((value) => String(value || '').trim())
		.filter(Boolean);
}

const initialEditForm = {
	firstName: '',
	lastName: '',
	email: '',
	mobile: '',
	status: 'new',
	source: '',
	divisionId: '',
	ownerId: '',
	currentJobTitle: '',
	currentEmployer: '',
	address: '',
	addressPlaceId: '',
	addressLatitude: '',
	addressLongitude: '',
	city: '',
	state: '',
	zipCode: '',
	website: '',
	linkedinUrl: '',
	skillIds: undefined,
	skillSet: '',
	stageChangeReason: '',
	summary: '',
	customFields: {}
};

function normalizeSkillKey(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '');
}

function uniqueSkillNames(values) {
	const seen = new Set();
	const result = [];

	for (const rawValue of values) {
		const value = String(rawValue || '').trim();
		if (!value) continue;
		const key = normalizeSkillKey(value);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}

	return result;
}

function sanitizeOtherSkillSet(skillSetValue, row, availableSkills = []) {
	const otherSkills = uniqueSkillNames(String(skillSetValue || '').split(/[,;\n|/]+/));
	if (otherSkills.length === 0) return '';

	const knownSkills = uniqueSkillNames([
		...availableSkills.filter((skill) => skill?.isActive).map((skill) => skill?.name),
		...(Array.isArray(row?.candidateSkills)
			? row.candidateSkills.map((candidateSkill) => candidateSkill?.skill?.name)
			: [])
	]);
	if (knownSkills.length === 0) {
		return otherSkills.join(', ');
	}

	const knownKeys = new Set(knownSkills.map((skillName) => normalizeSkillKey(skillName)));
	const filteredOtherSkills = otherSkills.filter(
		(skillName) => !knownKeys.has(normalizeSkillKey(skillName))
	);
	return filteredOtherSkills.join(', ');
}

function toForm(row, availableSkills = []) {
	if (!row) return initialEditForm;

	return {
		firstName: row.firstName || '',
		lastName: row.lastName || '',
		email: row.email || '',
		mobile: row.mobile || row.phone || '',
		status: row.status || 'new',
		source: normalizeCandidateSourceValue(row.source),
		divisionId: row.divisionId == null ? '' : String(row.divisionId),
		ownerId: row.ownerId == null ? '' : String(row.ownerId),
		currentJobTitle: row.currentJobTitle || '',
		currentEmployer: row.currentEmployer || '',
		address: row.address || '',
		addressPlaceId: row.addressPlaceId || '',
		addressLatitude: row.addressLatitude ?? '',
		addressLongitude: row.addressLongitude ?? '',
		city: row.city || '',
		state: row.state || '',
		zipCode: row.zipCode || '',
		website: row.website || '',
		linkedinUrl: row.linkedinUrl || '',
			skillIds: Array.isArray(row.candidateSkills) && row.candidateSkills.length > 0
				? row.candidateSkills
						.map((candidateSkill) => candidateSkill?.skill?.id)
						.filter(Boolean)
						.map((skillId) => String(skillId))
				: undefined,
			skillSet: sanitizeOtherSkillSet(row.skillSet, row, availableSkills),
			stageChangeReason: '',
			summary: row.summary || '',
			customFields:
				row.customFields && typeof row.customFields === 'object' && !Array.isArray(row.customFields)
					? row.customFields
					: {}
	};
}

function formatDate(value) {
	return formatDateTimeAt(value);
}

function formatFileSize(bytes) {
	const value = Number(bytes);
	if (!Number.isFinite(value) || value <= 0) return '-';
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateOnly(value) {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString();
}

function formatDateRange(startDate, endDate, isCurrent) {
	const start = formatDateOnly(startDate) || 'Start n/a';
	const end = isCurrent ? 'Present' : formatDateOnly(endDate) || 'End n/a';
	return `${start} - ${end}`;
}

function truncateText(value, maxLength = 220) {
	const text = String(value || '').trim();
	if (!text) return '';
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength).trimEnd()}...`;
}

function wait(ms) {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

function buildCandidateLocation(form) {
	const city = String(form?.city || '').trim();
	const state = String(form?.state || '').trim();
	const zipCode = String(form?.zipCode || '').trim();
	const address = String(form?.address || '').trim();

	if (city && state) return `${city}, ${state}`;
	if (city) return city;
	if (state) return state;
	if (zipCode) return zipCode;
	return address;
}

function getLatestCandidateActivity(candidate) {
	if (!candidate) return null;

	const events = [];
	const latestByDate = (items, getDateValue) =>
		(Array.isArray(items) ? items : []).reduce((latest, item) => {
			const rawValue = getDateValue(item);
			const timestamp = rawValue ? new Date(rawValue).getTime() : Number.NaN;
			if (Number.isNaN(timestamp)) return latest;
			if (!latest || timestamp > latest.timestamp) {
				return { item, timestamp, rawValue };
			}
			return latest;
		}, null);

	const latestNote = latestByDate(candidate.notes, (note) => note?.createdAt);
	if (latestNote) {
		events.push({
			label: latestNote.item?.noteType === 'email' ? 'Inbound email note' : 'Candidate note added',
			rawValue: latestNote.rawValue,
			timestamp: latestNote.timestamp
		});
	}

	const latestActivity = latestByDate(candidate.activities, (activity) => activity?.dueAt || activity?.createdAt);
	if (latestActivity) {
		const activityType = formatSelectValueLabel(latestActivity.item?.type || 'activity');
		events.push({
			label: `${activityType} activity updated`,
			rawValue: latestActivity.rawValue,
			timestamp: latestActivity.timestamp
		});
	}

	const latestSubmission = latestByDate(candidate.submissions, (submission) => submission?.createdAt);
	if (latestSubmission) {
		events.push({
			label: `Submitted to ${latestSubmission.item?.jobOrder?.title || 'job order'}`,
			rawValue: latestSubmission.rawValue,
			timestamp: latestSubmission.timestamp
		});
	}

	const latestAttachment = latestByDate(candidate.attachments, (attachment) => attachment?.createdAt);
	if (latestAttachment) {
		events.push({
			label: latestAttachment.item?.isResume ? 'Primary resume updated' : 'Candidate file uploaded',
			rawValue: latestAttachment.rawValue,
			timestamp: latestAttachment.timestamp
		});
	}

	if (candidate.aiSummary?.updatedAt) {
		const timestamp = new Date(candidate.aiSummary.updatedAt).getTime();
		if (!Number.isNaN(timestamp)) {
			events.push({
				label: 'AI summary refreshed',
				rawValue: candidate.aiSummary.updatedAt,
				timestamp
			});
		}
	}

	const latestEvent = events.sort((left, right) => right.timestamp - left.timestamp)[0];
	if (!latestEvent) return null;
	return {
		label: latestEvent.label,
		formattedAt: formatDate(latestEvent.rawValue)
	};
}

export default function CandidateDetailsPage() {
	const { id } = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const [actingUser, setActingUser] = useState(null);
	const [candidate, setCandidate] = useState(null);
	const [skills, setSkills] = useState([]);
	const [editForm, setEditForm] = useState(initialEditForm);
	const [loading, setLoading] = useState(true);
	const [noteContent, setNoteContent] = useState('');
	const [activityForm, setActivityForm] = useState(initialActivity);
	const [educationForm, setEducationForm] = useState(initialEducationForm);
	const [workExperienceForm, setWorkExperienceForm] = useState(initialWorkExperienceForm);
	const [error, setError] = useState('');
	const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });
	const [noteState, setNoteState] = useState({ saving: false, error: '' });
	const [activityState, setActivityState] = useState({ saving: false, error: '' });
	const [educationState, setEducationState] = useState({ saving: false, deletingId: null, error: '' });
	const [workExperienceState, setWorkExperienceState] = useState({
		saving: false,
		deletingId: null,
		error: ''
	});
	const [attachmentState, setAttachmentState] = useState({
		uploading: false,
		deletingId: null,
		updatingId: null,
		error: '',
		success: ''
	});
	const [attachmentFile, setAttachmentFile] = useState(null);
	const [attachmentIsResume, setAttachmentIsResume] = useState(false);
	const [attachmentInputKey, setAttachmentInputKey] = useState(0);
	const [workspaceTab, setWorkspaceTab] = useState('status-history');
	const [matchExplanationTarget, setMatchExplanationTarget] = useState(null);
	const [summaryState, setSummaryState] = useState({ generating: false });
	const [aiAvailable, setAiAvailable] = useState(false);
	const [detailsPanelHeight, setDetailsPanelHeight] = useState(0);
	const [notesSort, setNotesSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [activitiesSort, setActivitiesSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [submissionsSort, setSubmissionsSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [filesSort, setFilesSort] = useState({ field: 'createdAt', direction: 'desc' });
	const [educationSort, setEducationSort] = useState({ field: 'startDate', direction: 'desc' });
	const [workSort, setWorkSort] = useState({ field: 'startDate', direction: 'desc' });
	const [jobMatchesSort, setJobMatchesSort] = useState({ field: 'scorePercent', direction: 'desc' });
	const [jobMatchState, setJobMatchState] = useState({
		loading: false,
		error: '',
		computedAt: '',
		totalJobOrdersEvaluated: 0,
		activeHiringJobOrders: 0,
		matchEligibility: '',
		matches: [],
		submittingJobOrderId: ''
	});
	const detailsPanelRef = useRef(null);
	const workspacePanelRef = useRef(null);
	const actionsMenuRef = useRef(null);
	const [actionsOpen, setActionsOpen] = useState(false);
	const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
	const [showAuditTrail, setShowAuditTrail] = useState(false);
	const [emailDraftOpen, setEmailDraftOpen] = useState(false);
	const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
	const [recordNavigationContext, setRecordNavigationContext] = useState(null);
	const toast = useToast();
	const { requestConfirm, requestConfirmWithOptions } = useConfirmDialog();
	const { archiveEntity } = useArchivedEntities('CANDIDATE');
	const { markAsClean, confirmNavigation } = useUnsavedChangesGuard(editForm, {
		enabled: !loading && Boolean(candidate)
	});

	const skillOptions = useMemo(
		() =>
			skills
				.filter((skill) => skill.isActive)
				.map((skill) => ({
					value: String(skill.id),
					label: skill.name
				})),
		[skills]
	);
	const isAdmin = useIsAdministrator(actingUser);
	const hasRequiredFields = Boolean(
		editForm.firstName.trim() &&
			editForm.lastName.trim() &&
			editForm.email.trim() &&
			editForm.mobile.trim() &&
			editForm.status.trim() &&
			editForm.source.trim() &&
			(!isAdmin || editForm.divisionId.trim()) &&
			editForm.ownerId.trim() &&
			editForm.currentJobTitle.trim() &&
			editForm.currentEmployer.trim()
	);
	const hasValidEmail = isValidEmailAddress(editForm.email);
	const hasValidWebsite = isValidOptionalHttpUrl(editForm.website);
	const hasValidLinkedinUrl = isValidOptionalHttpUrl(editForm.linkedinUrl);
	const customFieldsComplete = areRequiredCustomFieldsComplete(
		customFieldDefinitions,
		editForm.customFields
	);
	const statusIsChanging =
		Boolean(candidate) && String(editForm.status || '').trim() !== String(candidate?.status || '').trim();
	const hasStageChangeReason = !statusIsChanging || Boolean(editForm.stageChangeReason.trim());
	const canSaveCandidate =
		hasRequiredFields &&
		hasValidEmail &&
		hasValidWebsite &&
		hasValidLinkedinUrl &&
		customFieldsComplete &&
		hasStageChangeReason;
	const candidateEligibleForSubmission = isCandidateEligibleForSubmission(candidate?.status);
	const candidateQualifiedForPipeline = isCandidateQualifiedForPipeline(candidate?.status);
	const emailError =
		editForm.email.trim() && !hasValidEmail ? 'Enter a valid email address.' : '';
	const websiteError =
		editForm.website.trim() && !hasValidWebsite ? 'Enter a valid website URL, including http:// or https://.' : '';
	const linkedinUrlError =
		editForm.linkedinUrl.trim() && !hasValidLinkedinUrl
			? 'Enter a valid LinkedIn URL, including http:// or https://.'
			: '';
	const stageChangeReasonError =
		statusIsChanging && !editForm.stageChangeReason.trim()
			? 'Status change reason is required.'
			: '';
	const candidateCompleteness = useMemo(
		() => getCandidateCompleteness({ candidate, editForm, customFieldDefinitions }),
		[candidate, editForm, customFieldDefinitions]
	);
	const candidateCompletenessSeverityClass =
		candidateCompleteness.scorePercent >= 85
			? ' candidate-completeness-chip-good'
			: candidateCompleteness.scorePercent >= 65
				? ' candidate-completeness-chip-warn'
				: ' candidate-completeness-chip-poor';
	const candidateLocation = useMemo(() => buildCandidateLocation(editForm), [editForm]);
	const candidateTopSkillNames = useMemo(() => {
		const selectedSkillNames = Array.isArray(editForm.skillIds)
			? editForm.skillIds
					.map((skillId) => skills.find((skill) => String(skill.id) === String(skillId))?.name)
					.filter(Boolean)
			: [];
		const otherSkillNames = uniqueSkillNames(String(editForm.skillSet || '').split(/[,;\n|/]+/));
		return uniqueSkillNames([...selectedSkillNames, ...otherSkillNames]).slice(0, 8);
	}, [editForm.skillIds, editForm.skillSet, skills]);
	const candidateSummarySnippet = useMemo(() => {
		if (candidate?.aiSummary?.overview) return String(candidate.aiSummary.overview).trim();
		if (editForm.summary) return String(editForm.summary).trim();
		return '';
	}, [candidate?.aiSummary?.overview, editForm.summary]);
	const latestCandidateActivity = useMemo(() => getLatestCandidateActivity(candidate), [candidate]);
	const candidateTimelineItems = useMemo(() => buildCandidateTimeline(candidate), [candidate]);
	const candidateSuggestedNextStep = useMemo(
		() =>
			deriveCandidateSuggestedNextStep(candidate, {
				aiAvailable,
				completenessScore: candidateCompleteness.scorePercent,
				jobMatchCount: jobMatchState.matches.length,
				topGaps: candidateCompleteness.topGaps
			}),
		[
			aiAvailable,
			candidate,
			candidateCompleteness.scorePercent,
			candidateCompleteness.topGaps,
			jobMatchState.matches.length
		]
	);
	const candidateNavigationState = useMemo(() => {
		if (!recordNavigationContext?.ids?.length || !id) return null;
		const ids = recordNavigationContext.ids.map((value) => String(value));
		const currentId = String(id);
		const currentIndex = ids.indexOf(currentId);
		if (currentIndex < 0) return null;
		return {
			label: recordNavigationContext.label || 'Filtered Candidates',
			listPath: recordNavigationContext.listPath || '/candidates',
			position: currentIndex + 1,
			total: ids.length,
			previousId: currentIndex > 0 ? ids[currentIndex - 1] : '',
			nextId: currentIndex < ids.length - 1 ? ids[currentIndex + 1] : ''
		};
	}, [id, recordNavigationContext]);
	const shouldUseRecordNavigation = searchParams.get(RECORD_NAVIGATION_QUERY_PARAM) === '1';

	const submissionRows = useMemo(() => {
		if (!candidate) return [];

		return candidate.submissions.map((submission) => ({
			id: submission.id,
			jobOrder: submission.jobOrder?.title || '-',
			client: submission.jobOrder?.client?.name || '-',
			status: formatSelectValueLabel(getEffectiveSubmissionStatus(submission)),
			createdAt: formatDate(submission.createdAt),
			createdAtRaw: submission.createdAt || '',
			createdBy: submissionCreatedByLabel(submission)
		}));
	}, [candidate]);

	const sortedNotes = useMemo(
		() =>
			sortByConfig(candidate?.notes || [], notesSort, (note, field) => {
				if (field === 'createdAt') return note.createdAt || '';
				if (field === 'author') {
					return note.createdByUser
						? `${note.createdByUser.firstName} ${note.createdByUser.lastName}`
						: '';
				}
				if (field === 'content') return note.content || '';
				return '';
			}),
		[candidate?.notes, notesSort]
	);

	const sortedActivities = useMemo(
		() =>
			sortByConfig(candidate?.activities || [], activitiesSort, (activity, field) => {
				if (field === 'createdAt') return activity.dueAt || activity.createdAt || '';
				if (field === 'subject') return activity.subject || '';
				if (field === 'status') return formatSelectValueLabel(activity.status);
				if (field === 'type') return activity.type || '';
				return '';
			}),
		[candidate?.activities, activitiesSort]
	);

	const sortedSubmissions = useMemo(
		() =>
			sortByConfig(submissionRows, submissionsSort, (submission, field) => {
				if (field === 'createdAt') return submission.createdAtRaw || '';
				if (field === 'jobOrder') return submission.jobOrder || '';
				if (field === 'client') return submission.client || '';
				if (field === 'status') return submission.status || '';
				return '';
			}),
		[submissionRows, submissionsSort]
	);

	const sortedAttachments = useMemo(
		() =>
			sortByConfig(candidate?.attachments || [], filesSort, (attachment, field) => {
				if (field === 'createdAt') return attachment.createdAt || '';
				if (field === 'fileName') return attachment.fileName || '';
				if (field === 'sizeBytes') return Number(attachment.sizeBytes || 0);
				if (field === 'uploadedBy') {
					return attachment.uploadedByUser
						? `${attachment.uploadedByUser.firstName} ${attachment.uploadedByUser.lastName}`
						: '';
				}
				return '';
			}),
		[candidate?.attachments, filesSort]
	);

	const sortedEducations = useMemo(
		() =>
			sortByConfig(candidate?.candidateEducations || [], educationSort, (education, field) => {
				if (field === 'startDate') return education.startDate || '';
				if (field === 'schoolName') return education.schoolName || '';
				if (field === 'degree') return education.degree || '';
				return '';
			}),
		[candidate?.candidateEducations, educationSort]
	);

	const sortedWorkExperiences = useMemo(
		() =>
			sortByConfig(candidate?.candidateWorkExperiences || [], workSort, (workExperience, field) => {
				if (field === 'startDate') return workExperience.startDate || '';
				if (field === 'companyName') return workExperience.companyName || '';
				if (field === 'title') return workExperience.title || '';
				return '';
			}),
		[candidate?.candidateWorkExperiences, workSort]
	);

	const sortedJobMatches = useMemo(
		() =>
			sortByConfig(jobMatchState.matches || [], jobMatchesSort, (match, field) => {
				if (field === 'scorePercent') return Number(match.scorePercent || 0);
				if (field === 'jobOrder') return match.jobOrderTitle || '';
				if (field === 'client') return match.clientName || '';
				if (field === 'location') return match.location || '';
				return '';
			}),
		[jobMatchState.matches, jobMatchesSort]
	);

	async function load() {
		setLoading(true);
		setError('');

		const [candidateRes, skillsRes, settingsRes] = await Promise.all([
			fetch(`/api/candidates/${id}`),
			fetch('/api/skills?active=true'),
			fetch('/api/system-settings', { cache: 'no-store' })
		]);
		if (!candidateRes.ok) {
			const data = await candidateRes.json().catch(() => ({}));
			setError(data.error || 'Failed to load candidate.');
			setLoading(false);
			return;
		}

		const [candidateData, skillData, settingsData] = await Promise.all([
			candidateRes.json(),
			skillsRes.ok ? skillsRes.json() : Promise.resolve([]),
			settingsRes.ok ? settingsRes.json().catch(() => ({})) : Promise.resolve({})
		]);
		const normalizedSkills = Array.isArray(skillData) ? skillData : [];
		const nextEditForm = toForm(candidateData, normalizedSkills);
		setAiAvailable(Boolean(settingsData?.aiAvailable));
		setCandidate(candidateData);
		setSkills(normalizedSkills);
		setEditForm(nextEditForm);
		markAsClean(nextEditForm);
		setLoading(false);
	}

	async function loadJobMatches(options = {}) {
		if (!id) return;
		const { keepResults = true, retryOnFailure = true } = options;
		if (!candidateQualifiedForPipeline) {
			setJobMatchState((current) => ({
				...current,
				loading: false,
				error: '',
				matchEligibility: 'Matches are unavailable until this candidate reaches Qualified status or beyond.',
				matches: [],
				submittingJobOrderId: ''
			}));
			return;
		}

		setJobMatchState((current) => ({
			...current,
			loading: true,
			error: '',
			matchEligibility: '',
			matches: keepResults ? current.matches : []
		}));

		try {
			const res = await fetch(`/api/candidates/${id}/matches?includeSubmitted=false&limit=10`);
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				if (retryOnFailure) {
					await wait(300);
					await loadJobMatches({ keepResults, retryOnFailure: false });
					return;
				}
				setJobMatchState((current) => ({
					...current,
					loading: false,
					error: data.error || 'Failed to load job order matches.'
				}));
				return;
			}

			const data = await res.json();
			setJobMatchState((current) => ({
				...current,
				loading: false,
				error: '',
				computedAt: data.computedAt || '',
				totalJobOrdersEvaluated: Number(data.totalJobOrdersEvaluated || 0),
				activeHiringJobOrders: Number(data.activeHiringJobOrders || 0),
				matchEligibility: data.matchEligibility || '',
				matches: Array.isArray(data.matches) ? data.matches : []
			}));
		} catch {
			if (retryOnFailure) {
				await wait(300);
				await loadJobMatches({ keepResults, retryOnFailure: false });
				return;
			}
			setJobMatchState((current) => ({
				...current,
				loading: false,
				error: 'Failed to load job order matches.'
			}));
		}
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
			setRecordNavigationContext(readRecordNavigationContext('candidate'));
			return;
		}
		clearRecordNavigationContext('candidate');
		setRecordNavigationContext(null);
	}, [id, shouldUseRecordNavigation]);

	useEffect(() => {
		if (!candidate?.id) return;
		loadJobMatches({ keepResults: false });
	}, [candidate?.id]);

	useEffect(() => {
		if (!aiSummaryOpen || !candidate?.id || candidate.aiSummary || !aiAvailable || summaryState.generating) {
			return;
		}
		onGenerateAiSummary();
	}, [
		aiAvailable,
		aiSummaryOpen,
		candidate?.aiSummary,
		candidate?.id,
		summaryState.generating
	]);

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
		}, [candidate, editForm, saveState.saving, workspaceTab]);

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

	useEffect(() => {
		if (activityState.error) {
			toast.error(activityState.error);
		}
	}, [activityState.error, toast]);

	useEffect(() => {
		if (attachmentState.error) {
			toast.error(attachmentState.error);
		}
	}, [attachmentState.error, toast]);

	useEffect(() => {
		if (attachmentState.success) {
			toast.success(attachmentState.success);
		}
	}, [attachmentState.success, toast]);

	useEffect(() => {
		if (educationState.error) {
			toast.error(educationState.error);
		}
	}, [educationState.error, toast]);

	useEffect(() => {
		if (workExperienceState.error) {
			toast.error(workExperienceState.error);
		}
	}, [workExperienceState.error, toast]);

	useEffect(() => {
		if (jobMatchState.error) {
			toast.error(jobMatchState.error);
		}
	}, [jobMatchState.error, toast]);

	async function onAddSubmission() {
		if (!candidate) return;
		setActionsOpen(false);
		if (!candidateEligibleForSubmission) {
			toast.error('Candidate must be In Review or beyond before adding a submission.');
			return;
		}
		if (
			candidateCompleteness.scorePercent < 70 &&
			candidateCompleteness.topGaps.length > 0 &&
			!(await requestConfirm({
				title: 'Profile Needs Cleanup',
				message:
					`This candidate profile is only ${candidateCompleteness.scorePercent}% complete.\n\n` +
					`Top gaps:\n- ${candidateCompleteness.topGaps.join('\n- ')}\n\n` +
					'Continue to create a submission anyway?',
				confirmLabel: 'Continue',
				cancelLabel: 'Review Profile'
			}))
		) {
			return;
		}
		if (!(await confirmNavigation())) return;

		const query = new URLSearchParams();
		query.set('candidateId', String(candidate.id));
		router.push(`/submissions/new?${query.toString()}`);
	}

	async function onAddInterview() {
		if (!candidate) return;
		setActionsOpen(false);
		if (!candidateQualifiedForPipeline) {
			toast.error('Candidate must be Qualified or beyond before scheduling an interview.');
			return;
		}
		if (!(await confirmNavigation())) return;

		const query = new URLSearchParams();
		query.set('candidateId', String(candidate.id));
		const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
		if (candidateName) {
			query.set('subject', `Interview: ${candidateName}`);
		}
		router.push(`/interviews/new?${query.toString()}`);
	}

	async function onAddPlacement() {
		if (!candidate) return;
		setActionsOpen(false);
		if (!(await confirmNavigation())) return;

		const query = new URLSearchParams();
		query.set('candidateId', String(candidate.id));
		router.push(`/placements/new?${query.toString()}`);
	}

	async function onGenerateAiSummary() {
		if (!candidate?.id || summaryState.generating) return;

		setSummaryState({ generating: true });
		const res = await fetch(`/api/candidates/${id}/ai-summary`, {
			method: 'POST'
		});
		const data = await res.json().catch(() => ({}));

		if (!res.ok) {
			setSummaryState({ generating: false });
			toast.error(data.error || 'Failed to generate candidate summary.');
			return;
		}

		setCandidate((current) => (current ? { ...current, aiSummary: data.aiSummary || null } : current));
		setSummaryState({ generating: false });
		toast.success(candidate.aiSummary ? 'Candidate summary refreshed.' : 'Candidate summary generated.');
	}

	function onOpenAiSummary() {
		setActionsOpen(false);
		if (!aiAvailable && !candidate?.aiSummary) return;
		setAiSummaryOpen(true);
	}

	function onToggleAuditTrail() {
		setActionsOpen(false);
		setShowAuditTrail((current) => !current);
	}

	function scrollToRef(ref) {
		ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function openWorkspaceTab(tabKey) {
		setWorkspaceTab(tabKey);
		window.requestAnimationFrame(() => {
			scrollToRef(workspacePanelRef);
		});
	}

	async function onRunSuggestedNextStep() {
		if (!candidateSuggestedNextStep?.actionKey) return;

		switch (candidateSuggestedNextStep.actionKey) {
			case 'details':
				scrollToRef(detailsPanelRef);
				return;
			case 'files':
				openWorkspaceTab('files');
				return;
			case 'activities':
				openWorkspaceTab('activities');
				return;
			case 'status-history':
				openWorkspaceTab('status-history');
				return;
			case 'email-draft':
				onOpenEmailDraft();
				return;
			case 'add-submission':
				await onAddSubmission();
				return;
			case 'add-interview':
				await onAddInterview();
				return;
			case 'add-placement':
				await onAddPlacement();
				return;
			default:
				return;
		}
	}

	async function onNavigateToCandidate(targetId) {
		if (!targetId || String(targetId) === String(id)) return;
		if (!(await confirmNavigation())) return;
		router.push(withRecordNavigationQuery(`/candidates/${targetId}`));
	}

	async function onArchiveCandidate() {
		if (!candidate?.id) return;
		setActionsOpen(false);
		const archiveOptions = getArchiveCascadeOptions('CANDIDATE');
		const decision = await requestConfirmWithOptions({
			title: 'Archive Candidate',
			message: `Archive ${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() + '? You can restore it from Archive later.',
			confirmLabel: 'Archive',
			cancelLabel: 'Cancel',
			isDanger: true,
			options: archiveOptions
		});
		if (!decision?.confirmed) return;
		const cascade = cascadeSelectionFromIds('CANDIDATE', decision.selections);
		const result = await archiveEntity(candidate.id, '', cascade);
		if (!result.ok) {
			toast.error(result.error || 'Failed to archive candidate.');
			return;
		}
		const relatedCount = Math.max(0, Number(result.archivedCount || 1) - 1);
		toast.success(
			relatedCount > 0
				? `Candidate archived with ${relatedCount} related record${relatedCount === 1 ? '' : 's'}.`
				: 'Candidate archived.'
		);
		router.push('/candidates');
	}

	function onOpenEmailDraft() {
		setActionsOpen(false);
		if (!aiAvailable) return;
		setEmailDraftOpen(true);
	}

	async function onCreateMatchedSubmission(match) {
		if (!candidate?.id || !match?.jobOrderId) return;
		if (!candidateEligibleForSubmission) {
			setJobMatchState((current) => ({
				...current,
				error: 'Candidate must be In Review or beyond before creating submissions.'
			}));
			return;
		}
		if (
			candidateCompleteness.scorePercent < 70 &&
			candidateCompleteness.topGaps.length > 0 &&
			!(await requestConfirm({
				title: 'Profile Needs Cleanup',
				message:
					`This candidate profile is only ${candidateCompleteness.scorePercent}% complete.\n\n` +
					`Top gaps:\n- ${candidateCompleteness.topGaps.join('\n- ')}\n\n` +
					'Continue to create a submission anyway?',
				confirmLabel: 'Continue',
				cancelLabel: 'Review Profile'
			}))
		) {
			return;
		}

		setJobMatchState((current) => ({
			...current,
			submittingJobOrderId: String(match.jobOrderId),
			error: ''
		}));

		const res = await fetch('/api/submissions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				candidateId: candidate.id,
				jobOrderId: match.jobOrderId,
				status: 'submitted',
				notes: ''
			})
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setJobMatchState((current) => ({
				...current,
				submittingJobOrderId: '',
				error: data.error || 'Failed to create submission from match.'
			}));
			return;
		}

		const createdSubmission = await res.json();
		setCandidate((current) => {
			if (!current) return current;
			const alreadyExists = current.submissions.some(
				(submission) => submission.id === createdSubmission.id
			);
			const nextSubmissions = alreadyExists
				? current.submissions
				: [createdSubmission, ...current.submissions];
			return { ...current, submissions: nextSubmissions };
		});
		setJobMatchState((current) => ({ ...current, submittingJobOrderId: '' }));
		await loadJobMatches();
	}

	async function onSaveProfile(e) {
		e.preventDefault();
		if (!canSaveCandidate) {
			setSaveState({
				saving: false,
				error:
					isAdmin
						? 'Complete required fields (First Name, Last Name, Email, Mobile, Stage, Source, Division, Owner), use valid email/URLs, and add a status change reason when changing status.'
						: 'Complete required fields (First Name, Last Name, Email, Mobile, Stage, Source, Owner), use valid email/URLs, and add a status change reason when changing status.',
				success: ''
			});
			return;
		}
		setSaveState({ saving: true, error: '', success: '' });

		const res = await fetch(`/api/candidates/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(editForm)
		});

		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			setSaveState({ saving: false, error: data.error || 'Failed to save candidate.', success: '' });
			return;
		}

		const updated = await res.json();
		const nextEditForm = toForm(updated, skills);
		setCandidate((current) => (current ? { ...current, ...updated } : current));
		setEditForm(nextEditForm);
		markAsClean(nextEditForm);
		setSaveState({ saving: false, error: '', success: 'Candidate updated.' });
	}

	async function onAddNote(e) {
		e.preventDefault();
		if (!noteContent.trim()) return;
		setNoteState({ saving: true, error: '' });

		try {
			const res = await fetch(`/api/candidates/${id}/notes`, {
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

	async function onAddActivity(e) {
		e.preventDefault();
		setActivityState({ saving: true, error: '' });

		try {
			const res = await fetch(`/api/candidates/${id}/activities`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(activityForm)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setActivityState({ saving: false, error: data.error || 'Failed to save activity.' });
				return;
			}

			setActivityForm(initialActivity);
			await load();
			setActivityState({ saving: false, error: '' });
		} catch {
			setActivityState({ saving: false, error: 'Failed to save activity.' });
		}
	}

	async function onAddEducation(e) {
		e.preventDefault();
		if (!educationForm.schoolName.trim()) {
			setEducationState({ saving: false, deletingId: null, error: 'School is required.' });
			return;
		}

		setEducationState({ saving: true, deletingId: null, error: '' });
		try {
			const res = await fetch(`/api/candidates/${id}/educations`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(educationForm)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setEducationState({
					saving: false,
					deletingId: null,
					error: data.error || 'Failed to save education.'
				});
				return;
			}

			setEducationForm(initialEducationForm);
			await load();
			setEducationState({ saving: false, deletingId: null, error: '' });
		} catch {
			setEducationState({ saving: false, deletingId: null, error: 'Failed to save education.' });
		}
	}

	async function onDeleteEducation(education) {
		if (!education) return;
		const confirmed = await requestConfirm({
			message: `Delete education record for "${education.schoolName}"?`,
			confirmLabel: 'Delete',
			cancelLabel: 'Keep',
			isDanger: true
		});
		if (!confirmed) return;

		setEducationState({ saving: false, deletingId: education.id, error: '' });
		try {
			const res = await fetch(`/api/candidates/${id}/educations/${education.id}`, {
				method: 'DELETE'
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setEducationState({
					saving: false,
					deletingId: null,
					error: data.error || 'Failed to delete education.'
				});
				return;
			}

			await load();
			setEducationState({ saving: false, deletingId: null, error: '' });
		} catch {
			setEducationState({ saving: false, deletingId: null, error: 'Failed to delete education.' });
		}
	}

	async function onAddWorkExperience(e) {
		e.preventDefault();
		if (!workExperienceForm.companyName.trim()) {
			setWorkExperienceState({ saving: false, deletingId: null, error: 'Company is required.' });
			return;
		}

		setWorkExperienceState({ saving: true, deletingId: null, error: '' });
		try {
			const res = await fetch(`/api/candidates/${id}/work-experiences`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(workExperienceForm)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setWorkExperienceState({
					saving: false,
					deletingId: null,
					error: data.error || 'Failed to save work experience.'
				});
				return;
			}

			setWorkExperienceForm(initialWorkExperienceForm);
			await load();
			setWorkExperienceState({ saving: false, deletingId: null, error: '' });
		} catch {
			setWorkExperienceState({ saving: false, deletingId: null, error: 'Failed to save work experience.' });
		}
	}

	async function onDeleteWorkExperience(workExperience) {
		if (!workExperience) return;
		const confirmed = await requestConfirm({
			message: `Delete work experience at "${workExperience.companyName}"?`,
			confirmLabel: 'Delete',
			cancelLabel: 'Keep',
			isDanger: true
		});
		if (!confirmed) return;

		setWorkExperienceState({ saving: false, deletingId: workExperience.id, error: '' });
		try {
			const res = await fetch(`/api/candidates/${id}/work-experiences/${workExperience.id}`, {
				method: 'DELETE'
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setWorkExperienceState({
					saving: false,
					deletingId: null,
					error: data.error || 'Failed to delete work experience.'
				});
				return;
			}

			await load();
			setWorkExperienceState({ saving: false, deletingId: null, error: '' });
		} catch {
			setWorkExperienceState({ saving: false, deletingId: null, error: 'Failed to delete work experience.' });
		}
	}

	async function onUploadAttachment(e) {
		e.preventDefault();
		if (!attachmentFile) {
			setAttachmentState({
				uploading: false,
				deletingId: null,
				updatingId: null,
				error: 'Select a file to upload.',
				success: ''
			});
			return;
		}

		setAttachmentState((current) => ({ ...current, uploading: true, error: '', success: '' }));

		try {
			const formData = new FormData();
			formData.append('file', attachmentFile);
			formData.append('isResume', attachmentIsResume ? 'true' : 'false');

			const res = await fetch(`/api/candidates/${id}/files`, {
				method: 'POST',
				body: formData
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
			setAttachmentState({
				uploading: false,
				deletingId: null,
				updatingId: null,
				error: data.error || 'Failed to upload file.',
				success: ''
			});
				return;
			}

			setAttachmentFile(null);
			setAttachmentIsResume(false);
			setAttachmentInputKey((value) => value + 1);
			await load();
			setAttachmentState({ uploading: false, deletingId: null, updatingId: null, error: '', success: 'File uploaded.' });
		} catch {
			setAttachmentState({ uploading: false, deletingId: null, updatingId: null, error: 'Failed to upload file.', success: '' });
		}
	}

	async function onToggleAttachmentResume(attachment) {
		if (!attachment) return;

		setAttachmentState((current) => ({
			...current,
			updatingId: attachment.id,
			error: '',
			success: ''
		}));

		try {
			const res = await fetch(`/api/candidates/${id}/files/${attachment.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isResume: !attachment.isResume })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setAttachmentState((current) => ({
					...current,
					updatingId: null,
					error: data.error || 'Failed to update file.',
					success: ''
				}));
				return;
			}

			await load();
			setAttachmentState((current) => ({
					...current,
					updatingId: null,
					error: '',
					success: attachment.isResume ? 'Resume label removed.' : 'File marked as resume.'
				}));
		} catch {
			setAttachmentState((current) => ({
				...current,
				updatingId: null,
				error: 'Failed to update file.',
				success: ''
			}));
		}
	}

	async function onDeleteAttachment(attachment) {
		if (!attachment) return;
		const confirmed = await requestConfirm({
			message: `Delete file "${attachment.fileName}"?`,
			confirmLabel: 'Delete',
			cancelLabel: 'Keep',
			isDanger: true
		});
		if (!confirmed) return;

		setAttachmentState((current) => ({
			...current,
			deletingId: attachment.id,
			error: '',
			success: ''
		}));

		try {
			const res = await fetch(`/api/candidates/${id}/files/${attachment.id}`, {
				method: 'DELETE'
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setAttachmentState((current) => ({
					...current,
					deletingId: null,
					error: data.error || 'Failed to delete file.',
					success: ''
				}));
				return;
			}

			await load();
			setAttachmentState((current) => ({
				...current,
				deletingId: null,
				error: '',
				success: 'File deleted.'
			}));
		} catch {
			setAttachmentState((current) => ({
				...current,
				deletingId: null,
				error: 'Failed to delete file.',
				success: ''
			}));
		}
	}

	if (loading) {
		return (
			<section className="module-page">
				<LoadingIndicator className="page-loading-indicator" label="Loading candidate details" />
			</section>
		);
	}

	if (error || !candidate) {
		return (
			<section className="module-page">
				<p>{error || 'Candidate not found.'}</p>
				<button type="button" onClick={() => router.push('/candidates')}>
					Back to Candidates
				</button>
			</section>
		);
	}

	const workspacePanelStyle =
		detailsPanelHeight > 0 ? { height: `${detailsPanelHeight}px`, maxHeight: `${detailsPanelHeight}px` } : undefined;
	const attachmentUploadWarning = searchParams.get('attachmentUpload') === 'failed';

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<Link
						href={candidateNavigationState?.listPath || '/candidates'}
						className="module-back-link"
						aria-label="Back to List"
					>
						&larr; Back
					</Link>
					<h2>
						{candidate.firstName} {candidate.lastName}
					</h2>
					<p>
						{candidate.email} | Stage: {candidate.status}
					</p>
				</div>
					<div className="module-header-actions">
						{candidateNavigationState ? (
							<div className="record-navigation-controls" aria-label={`${candidateNavigationState.label} navigation`}>
								<p className="simple-list-meta record-navigation-meta">
									{candidateNavigationState.label}: {candidateNavigationState.position} of {candidateNavigationState.total}
								</p>
								<div className="record-navigation-buttons">
									<button
										type="button"
										className="btn-secondary record-navigation-button"
										onClick={() => onNavigateToCandidate(candidateNavigationState.previousId)}
										disabled={!candidateNavigationState.previousId}
										aria-label="Previous Candidate"
										title="Previous Candidate"
									>
										<ChevronLeft aria-hidden="true" className="btn-refresh-icon-svg" />
									</button>
									<button
										type="button"
										className="btn-secondary record-navigation-button"
										onClick={() => onNavigateToCandidate(candidateNavigationState.nextId)}
										disabled={!candidateNavigationState.nextId}
										aria-label="Next Candidate"
										title="Next Candidate"
									>
										<ChevronRight aria-hidden="true" className="btn-refresh-icon-svg" />
									</button>
								</div>
							</div>
						) : null}
						<button
							type="button"
							className="btn-secondary btn-link-icon candidate-ai-summary-trigger"
							onClick={onOpenAiSummary}
							disabled={!aiAvailable && !candidate.aiSummary}
							aria-label="Open AI Summary"
							title={
								aiAvailable || candidate.aiSummary
									? 'Open AI Summary'
									: 'Enable OpenAI in Admin Area > System Settings to use this.'
							}
						>
							<Sparkles aria-hidden="true" className="btn-refresh-icon-svg" />
						</button>
						<div className="actions-menu" ref={actionsMenuRef}>
							<button
								type="button"
								className="btn-secondary actions-menu-toggle"
								onClick={() => setActionsOpen((current) => !current)}
								aria-haspopup="menu"
								aria-expanded={actionsOpen}
								aria-label="Open candidate actions"
								title="Actions"
								>
									<span className="actions-menu-icon" aria-hidden="true">
										<MoreVertical />
									</span>
								</button>
							{actionsOpen ? (
								<div className="actions-menu-list" role="menu" aria-label="Candidate actions">
									<button
										type="button"
										role="menuitem"
										className="actions-menu-item"
										onClick={onAddSubmission}
										disabled={!candidateEligibleForSubmission}
									>
										Add Submission
									</button>
									<button
										type="button"
										role="menuitem"
										className="actions-menu-item"
										onClick={onAddInterview}
										disabled={!candidateQualifiedForPipeline}
									>
										Add Interview
									</button>
									<button
										type="button"
										role="menuitem"
										className="actions-menu-item"
										onClick={onAddPlacement}
									>
										Add Placement
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
										onClick={onArchiveCandidate}
									>
										Archive Candidate
									</button>
									{isAdmin ? (
										<>
											<div className="actions-menu-divider" role="separator" />
											<button
												type="button"
												role="menuitem"
												className="actions-menu-item"
												onClick={onToggleAuditTrail}
											>
												{showAuditTrail ? 'Hide Audit Trail' : 'View Audit Trail'}
											</button>
										</>
									) : null}
								</div>
							) : null}
						</div>
					</div>
				</header>
			{attachmentUploadWarning ? (
				<div className="validation-chip-stack">
					<div className="validation-chip-row">
						<span className="chip validation-chip-invalid">Resume Auto-Attach Failed</span>
					</div>
					<p className="panel-subtext">Upload the file in Workspace {'>'} Files.</p>
				</div>
			) : null}

			<article className="panel candidate-hero-card">
				<div className="candidate-hero-grid">
					<div className="candidate-hero-main">
						<div className="candidate-hero-kicker">Candidate Snapshot</div>
						<div className="candidate-hero-heading-row">
							<div>
								<h3 className="candidate-hero-title">
									{editForm.currentJobTitle || 'Current title not set'}
								</h3>
								<p className="candidate-hero-subtitle">
									{editForm.currentEmployer || 'Current employer not set'}
									{candidateLocation ? ` | ${candidateLocation}` : ''}
								</p>
							</div>
							<div className="candidate-hero-chip-group">
								<span className="chip candidate-hero-status-chip">
									{formatSelectValueLabel(editForm.status)}
								</span>
							</div>
						</div>

						{candidateTopSkillNames.length > 0 ? (
							<div className="candidate-hero-skills">
								{candidateTopSkillNames.map((skillName) => (
									<span key={skillName} className="skill-chip">
										{skillName}
									</span>
								))}
							</div>
						) : (
							<p className="panel-subtext candidate-hero-empty-row">Add skills to make this profile easier to scan and submit.</p>
						)}

						<div className="candidate-hero-summary-card">
							<span className="candidate-hero-section-label">AI Summary</span>
							<p className="candidate-hero-summary-copy">
								{candidateSummarySnippet || 'No AI summary snippet yet. Generate one from the sparkles action to add a recruiter-ready summary here.'}
							</p>
						</div>

						<div className="candidate-hero-meta-row">
							<p className="simple-list-meta candidate-hero-last-activity">
								Last activity:{' '}
								{latestCandidateActivity ? (
									<>
										{latestCandidateActivity.label} @{' '}
										<span className="meta-emphasis-time">{latestCandidateActivity.formattedAt}</span>
									</>
								) : (
									'No activity yet'
								)}
							</p>
							<p className="simple-list-meta candidate-hero-record-id">
								Record ID: <span className="meta-emphasis-time">{candidate.recordId || '-'}</span>
							</p>
						</div>
					</div>

					<div className="candidate-hero-side">
						<div className="candidate-next-step-card">
							<span className="candidate-hero-section-label">Suggested Next Step</span>
							<h4 className="candidate-next-step-title">
								{candidateSuggestedNextStep?.title || 'Review Recent Candidate Activity'}
							</h4>
							<p className="candidate-next-step-copy">
								{candidateSuggestedNextStep?.description || 'No timeline signal is available yet, so review the candidate profile and recent activity.'}
							</p>
							{candidateSuggestedNextStep?.actionLabel ? (
								<div className="candidate-next-step-actions">
									<button
										type="button"
										className="btn-secondary"
										onClick={onRunSuggestedNextStep}
									>
										{candidateSuggestedNextStep.actionLabel}
									</button>
								</div>
							) : null}
						</div>
						<div className="candidate-completeness-panel">
							<div className="candidate-completeness-summary">
								<span className="candidate-completeness-label">Profile Completeness</span>
								<div className="candidate-completeness-summary-main">
									<span className="candidate-completeness-score">{candidateCompleteness.scorePercent}%</span>
									<span className={`chip candidate-completeness-chip${candidateCompletenessSeverityClass}`}>
										{candidateCompleteness.levelLabel}
									</span>
								</div>
							</div>
							<div className="candidate-completeness-card">
								<div className="candidate-completeness-meter" aria-hidden="true">
									<span
										className="candidate-completeness-meter-fill"
										style={{ width: `${candidateCompleteness.scorePercent}%` }}
									/>
								</div>
								<p className="panel-subtext candidate-completeness-copy">
									{candidateCompleteness.completedSections} of {candidateCompleteness.totalSections} profile areas are complete.
								</p>
								{candidateCompleteness.topGaps.length > 0 ? (
									<div className="candidate-completeness-gaps">
										<span className="candidate-completeness-gaps-label">Top gaps</span>
										<div className="candidate-completeness-gap-list">
											{candidateCompleteness.topGaps.map((gap) => (
												<span key={gap} className="chip candidate-completeness-gap-chip">
													{gap}
												</span>
											))}
										</div>
									</div>
								) : (
									<p className="panel-subtext candidate-completeness-copy">Profile is in strong shape for recruiter review.</p>
								)}
							</div>
						</div>
					</div>
				</div>
			</article>

			<div className="detail-layout detail-layout-equal">
				<article className="panel panel-spacious" ref={detailsPanelRef}>
					<h3>Candidate Details</h3>
					<p className="panel-subtext">Edit profile fields and save updates.</p>
					<form onSubmit={onSaveProfile} className="detail-form">
					<section className="form-section">
						<h4>Contact</h4>
						<div className="detail-form-grid-2">
							<FormField label="First Name" required>
								<input
									value={editForm.firstName}
									onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Last Name" required>
								<input
									value={editForm.lastName}
									onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
									required
								/>
							</FormField>
						</div>
						<div className="detail-form-grid-2">
							<FormField label="Email" required>
								<input
									placeholder="name@email.com"
									type="email"
									value={editForm.email}
									onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Mobile" required>
								<PhoneInput
									placeholder="(555) 555-5555"
									value={editForm.mobile}
									onChange={(mobile) => setEditForm((f) => ({ ...f, mobile }))}
									required
								/>
							</FormField>
						</div>
						{emailError ? (
							<div className="validation-chip-stack">
								<div className="validation-chip-row">
									<span className="chip validation-chip-invalid">Invalid Email Address</span>
								</div>
							</div>
						) : null}
						<FormField label="Address">
							<AddressTypeaheadInput
								value={editForm.address}
								onChange={(nextValue) =>
									setEditForm((f) => ({
										...f,
										address: nextValue
									}))
								}
								onPlaceDetailsChange={(details) =>
									setEditForm((f) => ({
										...f,
										addressPlaceId: details?.placeId || '',
										addressLatitude: details?.latitude ?? '',
										addressLongitude: details?.longitude ?? '',
										city: details?.city ?? f.city,
										state: details?.state ?? f.state,
										zipCode: details?.postalCode ?? f.zipCode
									}))
								}
								placeholder="Search address or enter manually"
								label="Address"
							/>
						</FormField>
						<div className="detail-form-grid-3">
							<FormField label="City">
								<input
									value={editForm.city}
									onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
								/>
							</FormField>
							<FormField label="State">
								<input
									value={editForm.state}
									onChange={(e) => setEditForm((f) => ({ ...f, state: e.target.value }))}
								/>
							</FormField>
							<FormField label="Zip Code">
								<input
									value={editForm.zipCode}
									onChange={(e) => setEditForm((f) => ({ ...f, zipCode: e.target.value }))}
								/>
							</FormField>
						</div>
						<div className="detail-form-grid-2">
							<FormField label="Website">
								<input
									type="url"
									placeholder="https://example.com"
									value={editForm.website}
									onChange={(e) => setEditForm((f) => ({ ...f, website: e.target.value }))}
								/>
							</FormField>
							<FormField label="LinkedIn URL">
								<input
									type="url"
									placeholder="https://linkedin.com/in/..."
									value={editForm.linkedinUrl}
									onChange={(e) => setEditForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
								/>
							</FormField>
						</div>
						{websiteError ? <p className="panel-subtext error">{websiteError}</p> : null}
						{linkedinUrlError ? <p className="panel-subtext error">{linkedinUrlError}</p> : null}
					</section>

					<section className="form-section">
						<h4>Pipeline</h4>
						<div className="detail-form-grid-2">
							<FormField label="Status" required>
								<select
									value={editForm.status}
									onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
									required
								>
									{CANDIDATE_STATUS_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</FormField>
							<FormField label="Source" required>
								<select
									value={editForm.source}
									onChange={(e) => setEditForm((f) => ({ ...f, source: e.target.value }))}
									required
								>
									<option value="">Select source</option>
									{CANDIDATE_SOURCE_OPTIONS.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</FormField>
						</div>
						<div className="detail-form-grid-2">
							{isAdmin ? (
								<FormField label="Division" required>
									<LookupTypeaheadSelect
										entity="divisions"
										lookupParams={{}}
										value={editForm.divisionId}
										onChange={(nextValue) =>
											setEditForm((f) => ({
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
							<FormField label="Owner" required>
								<LookupTypeaheadSelect
									entity="users"
									lookupParams={isAdmin && editForm.divisionId ? { divisionId: editForm.divisionId } : {}}
									value={editForm.ownerId}
									onChange={(nextValue) => setEditForm((f) => ({ ...f, ownerId: nextValue }))}
									placeholder={isAdmin && !editForm.divisionId ? 'Select division first' : 'Search owner'}
									label="Owner"
									disabled={isAdmin && !editForm.divisionId}
									emptyLabel="No matching users."
								/>
							</FormField>
						</div>
						{statusIsChanging ? (
							<FormField label="Status Change Reason" required>
								<textarea
									rows={3}
									value={editForm.stageChangeReason}
									onChange={(e) =>
										setEditForm((f) => ({ ...f, stageChangeReason: e.target.value }))
									}
									required
								/>
							</FormField>
						) : null}
						{stageChangeReasonError ? <p className="panel-subtext error">{stageChangeReasonError}</p> : null}
					</section>

					<section className="form-section">
						<h4>Current Role</h4>
						<div className="detail-form-grid-2">
							<FormField label="Current Job Title" required>
								<input
									value={editForm.currentJobTitle}
									onChange={(e) => setEditForm((f) => ({ ...f, currentJobTitle: e.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Current Employer" required>
								<input
									value={editForm.currentEmployer}
									onChange={(e) => setEditForm((f) => ({ ...f, currentEmployer: e.target.value }))}
									required
								/>
							</FormField>
						</div>
					</section>

					<section className="form-section">
						<h4>Skills</h4>
						<div className="form-field">
							<SkillChipSelect
								options={skillOptions}
								values={editForm.skillIds || []}
								onChange={(nextSkillIds) => setEditForm((f) => ({ ...f, skillIds: nextSkillIds }))}
								placeholder="Type to search and add a skill"
							/>
						</div>
						<div className="form-field">
							<input
								value={editForm.skillSet}
								onChange={(e) => setEditForm((f) => ({ ...f, skillSet: e.target.value }))}
							/>
						</div>
					</section>

					<section className="form-section">
						<h4>Resume</h4>
						<div className="form-field">
							<textarea
								rows={8}
								value={editForm.summary}
								onChange={(e) => setEditForm((f) => ({ ...f, summary: e.target.value }))}
							/>
						</div>
					</section>
					<CustomFieldsSection
						moduleKey="candidates"
						values={editForm.customFields}
						onChange={(nextCustomFields) =>
							setEditForm((f) => ({
								...f,
								customFields: nextCustomFields
							}))
						}
						onDefinitionsChange={setCustomFieldDefinitions}
					/>

					<div className="form-actions">
						<SaveActionButton
							saving={saveState.saving}
							disabled={saveState.saving || !canSaveCandidate}
							label="Save Candidate"
							savingLabel="Saving Candidate..."
						/>
						<span className="form-actions-meta">
							<span>Updated:</span>
							<strong>{formatDate(candidate.updatedAt)}</strong>
						</span>
					</div>
				</form>
				</article>

					<article className="panel workspace-panel workspace-panel-lock-height" style={workspacePanelStyle} ref={workspacePanelRef}>
						<h3>Candidate Workspace</h3>
						<div
							className="side-tabs side-tabs-warm side-tabs-counted"
							role="tablist"
							aria-label="Candidate workspace tabs"
						>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'status-history'}
							className={workspaceTab === 'status-history' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('status-history')}
						>
							<span>Timeline</span>
							<span className="side-tab-count" aria-hidden="true">
								{candidateTimelineItems.length}
							</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'notes'}
							className={workspaceTab === 'notes' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('notes')}
						>
							<span>Notes</span>
							<span className="side-tab-count" aria-hidden="true">{candidate.notes?.length ?? 0}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'activities'}
							className={workspaceTab === 'activities' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('activities')}
						>
							<span>Activities</span>
							<span className="side-tab-count" aria-hidden="true">{candidate.activities?.length ?? 0}</span>
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={workspaceTab === 'submissions'}
							className={workspaceTab === 'submissions' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('submissions')}
						>
							<span>Submissions</span>
							<span className="side-tab-count" aria-hidden="true">{submissionRows.length}</span>
						</button>
							<button
								type="button"
								role="tab"
								aria-selected={workspaceTab === 'files'}
							className={workspaceTab === 'files' ? 'side-tab active' : 'side-tab'}
							onClick={() => setWorkspaceTab('files')}
						>
								<span>Files</span>
								<span className="side-tab-count" aria-hidden="true">{candidate.attachments?.length ?? 0}</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={workspaceTab === 'education'}
								className={workspaceTab === 'education' ? 'side-tab active' : 'side-tab'}
								onClick={() => setWorkspaceTab('education')}
							>
								<span>Education</span>
								<span className="side-tab-count" aria-hidden="true">{candidate.candidateEducations?.length ?? 0}</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={workspaceTab === 'work'}
								className={workspaceTab === 'work' ? 'side-tab active' : 'side-tab'}
								onClick={() => setWorkspaceTab('work')}
							>
								<span>Work</span>
								<span className="side-tab-count" aria-hidden="true">{candidate.candidateWorkExperiences?.length ?? 0}</span>
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={workspaceTab === 'matches'}
								className={workspaceTab === 'matches' ? 'side-tab active' : 'side-tab'}
								onClick={() => setWorkspaceTab('matches')}
							>
								<span>Matches</span>
								<span className="side-tab-count" aria-hidden="true">{jobMatchState.matches.length}</span>
							</button>
						</div>
					{workspaceTab === 'notes' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<form onSubmit={onAddNote}>
								<FormField label="Note" required>
									<textarea
										placeholder="Add candidate note"
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
								{candidate.notes?.length === 0 ? (
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
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'activities' ? (
						<div className="side-tab-content side-tab-content-with-scroll">
							<form onSubmit={onAddActivity}>
								<div className="detail-form-grid-2">
									<FormField label="Activity Type">
										<select
											value={activityForm.type}
											onChange={(e) => setActivityForm((f) => ({ ...f, type: e.target.value }))}
										>
											<option value="call">Call</option>
											<option value="email">Email</option>
											<option value="meeting">Meeting</option>
											<option value="task">Task</option>
										</select>
									</FormField>
									<FormField label="Status">
										<select
											value={activityForm.status}
											onChange={(e) => setActivityForm((f) => ({ ...f, status: e.target.value }))}
										>
											<option value="open">Open</option>
											<option value="completed">Completed</option>
										</select>
									</FormField>
								</div>
								<FormField label="Subject" required>
									<input
										placeholder="Activity subject"
										value={activityForm.subject}
										onChange={(e) => setActivityForm((f) => ({ ...f, subject: e.target.value }))}
										required
									/>
								</FormField>
								<FormField label="Due At">
									<input
										type="datetime-local"
										value={activityForm.dueAt}
										onChange={(e) => setActivityForm((f) => ({ ...f, dueAt: e.target.value }))}
									/>
								</FormField>
								<FormField label="Details">
									<textarea
										placeholder="Activity details"
										value={activityForm.description}
										onChange={(e) => setActivityForm((f) => ({ ...f, description: e.target.value }))}
									/>
								</FormField>
								<SaveActionButton
									saving={activityState.saving}
									label="Save Activity"
									savingLabel="Saving Activity..."
									icon={Save}
								/>
							</form>
							<h4 className="side-section-title">Activity Log</h4>
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Activities"
									value={activitiesSort.field}
									direction={activitiesSort.direction}
									onValueChange={(field) => setActivitiesSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setActivitiesSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'createdAt', label: 'Due/Created Date' },
										{ value: 'subject', label: 'Subject' },
										{ value: 'status', label: 'Status' },
										{ value: 'type', label: 'Type' }
									]}
									disabled={sortedActivities.length < 2}
								/>
								{candidate.activities?.length === 0 ? (
									<p className="panel-subtext">No activities logged yet.</p>
								) : (
									<ul className="simple-list">
										{sortedActivities.map((activity) => (
											<li key={activity.id}>
												<div>
													<strong>{activity.subject}</strong>
													<p>
														{activity.type} | {formatSelectValueLabel(activity.status)}
													</p>
													<p className="simple-list-meta">@ <span className="meta-emphasis-time">{formatDate(activity.dueAt || activity.createdAt)}</span></p>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

					{workspaceTab === 'submissions' ? (
						<div className="side-tab-content side-tab-content-list-only">
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Submissions"
									value={submissionsSort.field}
									direction={submissionsSort.direction}
									onValueChange={(field) => setSubmissionsSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setSubmissionsSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'createdAt', label: 'Submitted Date' },
										{ value: 'jobOrder', label: 'Job Order' },
										{ value: 'client', label: 'Client' },
										{ value: 'status', label: 'Status' }
									]}
									disabled={sortedSubmissions.length < 2}
								/>
								{submissionRows.length === 0 ? (
									<p className="panel-subtext">No submissions yet.</p>
								) : (
									<ul className="simple-list">
										{sortedSubmissions.map((submission) => (
											<li key={submission.id}>
												<div>
													<strong>
														<Link href={`/submissions/${submission.id}`}>{submission.jobOrder}</Link>
													</strong>
													<p>{submission.client}</p>
													<p className="simple-list-meta">By {submission.createdBy} @ <span className="meta-emphasis-time">{submission.createdAt}</span></p>
												</div>
												<div className="simple-list-actions simple-list-indicators">
													<div className="submission-chip-stack">
														<span className="chip">{submission.status}</span>
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
										))}
									</ul>
								)}
							</div>
						</div>
					) : null}

						{workspaceTab === 'files' ? (
							<div className="side-tab-content side-tab-content-with-scroll">
							<form onSubmit={onUploadAttachment}>
								<div className="form-field">
									<label className="form-label">
										Attachment File <span className="required-indicator">*</span>
									</label>
									<div className="candidate-attachment-upload-row">
										<input
											key={attachmentInputKey}
											className="candidate-attachment-file-input"
											type="file"
											accept={candidateAttachmentAcceptString()}
											onChange={(e) => {
												const file = e.target.files?.[0] || null;
												setAttachmentFile(file);
											}}
											required
										/>
										<label className="candidate-attachment-resume-option">
											<input
												type="checkbox"
												checked={attachmentIsResume}
												onChange={(event) => setAttachmentIsResume(event.target.checked)}
											/>
											<span>Primary Resume?</span>
										</label>
									</div>
								</div>
								{attachmentFile ? (
									<p className="panel-subtext">Selected: {attachmentFile.name}</p>
								) : null}
								<SaveActionButton
									saving={attachmentState.uploading}
									disabled={attachmentState.uploading || !attachmentFile}
									label="Upload File"
									savingLabel="Uploading File..."
									icon={Upload}
								/>
							</form>
							<h4 className="side-section-title">Uploaded Files</h4>
							<div className="workspace-scroll-area">
								<ListSortControls
									label="Sort Files"
									value={filesSort.field}
									direction={filesSort.direction}
									onValueChange={(field) => setFilesSort((current) => ({ ...current, field }))}
									onDirectionToggle={() =>
										setFilesSort((current) => ({
											...current,
											direction: current.direction === 'asc' ? 'desc' : 'asc'
										}))
									}
									options={[
										{ value: 'createdAt', label: 'Upload Date' },
										{ value: 'fileName', label: 'File Name' },
										{ value: 'sizeBytes', label: 'File Size' },
										{ value: 'uploadedBy', label: 'Uploaded By' }
									]}
									disabled={sortedAttachments.length < 2}
								/>
								{!candidate.attachments || candidate.attachments.length === 0 ? (
									<p className="panel-subtext">No files uploaded.</p>
								) : (
									<ul className="simple-list">
										{sortedAttachments.map((attachment) => (
											<li key={attachment.id}>
												<div>
													<div className="simple-list-title-row">
														<strong>{attachment.fileName}</strong>
														{attachment.isResume ? <span className="chip chip-resume">Resume</span> : null}
													</div>
													<p>{formatFileSize(attachment.sizeBytes)}</p>
													<p className="simple-list-meta">
														By{' '}
														{attachment.uploadedByUser
															? `${attachment.uploadedByUser.firstName} ${attachment.uploadedByUser.lastName}`
															: 'Unknown User'}{' '}
														@ <span className="meta-emphasis-time">{formatDate(attachment.createdAt)}</span>
													</p>
												</div>
												<div className="simple-list-actions">
													<div className="row-actions row-actions-right">
														<button
															type="button"
															className={`row-action-icon${attachment.isResume ? ' row-action-icon-resume-active' : ''}`}
															aria-label={attachment.isResume ? 'Remove resume label' : 'Mark as resume'}
															title={attachment.isResume ? 'Remove resume label' : 'Mark as resume'}
															disabled={
																attachmentState.uploading ||
																attachmentState.updatingId === attachment.id ||
																attachmentState.deletingId === attachment.id
															}
															onClick={() => onToggleAttachmentResume(attachment)}
														>
															{attachmentState.updatingId === attachment.id ? (
																<LoaderCircle
																	aria-hidden="true"
																	className="row-action-lucide row-action-icon-spinner"
																/>
															) : (
																attachment.isResume ? (
																	<BookmarkX aria-hidden="true" className="row-action-lucide" />
																) : (
																	<BookmarkPlus aria-hidden="true" className="row-action-lucide" />
																)
															)}
														</button>
														<a
															href={`/api/candidates/${id}/files/${attachment.id}/download`}
															className="row-action-icon"
															aria-label="Download file"
															title="Download file"
														>
															<Download aria-hidden="true" className="row-action-lucide" />
														</a>
														<button
															type="button"
															className="row-action-icon"
															aria-label="Delete file"
															title="Delete file"
															disabled={
																attachmentState.uploading ||
																attachmentState.updatingId === attachment.id ||
																attachmentState.deletingId === attachment.id
															}
															onClick={() => onDeleteAttachment(attachment)}
														>
															{attachmentState.deletingId === attachment.id ? (
																<LoaderCircle
																	aria-hidden="true"
																	className="row-action-lucide row-action-icon-spinner"
																/>
															) : (
																<Trash2 aria-hidden="true" className="row-action-lucide" />
															)}
														</button>
													</div>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>
							</div>
						) : null}
						{workspaceTab === 'education' ? (
							<div className="side-tab-content side-tab-content-with-scroll">
								<form onSubmit={onAddEducation}>
									<FormField label="School" required>
										<input
											value={educationForm.schoolName}
											onChange={(e) =>
												setEducationForm((current) => ({ ...current, schoolName: e.target.value }))
											}
											required
										/>
									</FormField>
									<div className="detail-form-grid-2">
										<FormField label="Degree">
											<input
												value={educationForm.degree}
												onChange={(e) =>
													setEducationForm((current) => ({ ...current, degree: e.target.value }))
												}
											/>
										</FormField>
										<FormField label="Field Of Study">
											<input
												value={educationForm.fieldOfStudy}
												onChange={(e) =>
													setEducationForm((current) => ({ ...current, fieldOfStudy: e.target.value }))
												}
											/>
										</FormField>
									</div>
									<div className="detail-form-grid-2">
										<FormField label="Start Date">
											<input
												type="date"
												value={educationForm.startDate}
												onChange={(e) =>
													setEducationForm((current) => ({ ...current, startDate: e.target.value }))
												}
											/>
										</FormField>
										<FormField label="End Date">
											<input
												type="date"
												value={educationForm.endDate}
												onChange={(e) =>
													setEducationForm((current) => ({ ...current, endDate: e.target.value }))
												}
												disabled={educationForm.isCurrent}
											/>
										</FormField>
									</div>
									<label className="switch-field">
										<input
											type="checkbox"
											className="switch-input"
											checked={educationForm.isCurrent}
											onChange={(event) =>
												setEducationForm((current) => ({
													...current,
													isCurrent: event.target.checked,
													endDate: event.target.checked ? '' : current.endDate
												}))
											}
										/>
										<span className="switch-track" aria-hidden="true">
											<span className="switch-thumb" />
										</span>
										<span className="switch-copy">
											<span className="switch-label">Currently Enrolled</span>
											<span className="switch-hint">Enable if this education is in progress.</span>
										</span>
									</label>
									<FormField label="Description">
										<textarea
											value={educationForm.description}
											onChange={(e) =>
												setEducationForm((current) => ({ ...current, description: e.target.value }))
											}
										/>
									</FormField>
									<SaveActionButton
										saving={educationState.saving}
										label="Save Education"
										savingLabel="Saving Education..."
										icon={Save}
									/>
								</form>
								<h4 className="side-section-title">Education History</h4>
								<div className="workspace-scroll-area">
									<ListSortControls
										label="Sort Education"
										value={educationSort.field}
										direction={educationSort.direction}
										onValueChange={(field) => setEducationSort((current) => ({ ...current, field }))}
										onDirectionToggle={() =>
											setEducationSort((current) => ({
												...current,
												direction: current.direction === 'asc' ? 'desc' : 'asc'
											}))
										}
										options={[
											{ value: 'startDate', label: 'Start Date' },
											{ value: 'schoolName', label: 'School' },
											{ value: 'degree', label: 'Degree' }
										]}
										disabled={sortedEducations.length < 2}
									/>
									{candidate.candidateEducations?.length === 0 ? (
										<p className="panel-subtext">No education history yet.</p>
									) : (
										<ul className="simple-list">
											{sortedEducations.map((education) => (
												<li key={education.id}>
													<div>
														<strong>{education.schoolName}</strong>
														<p>
															{education.degree || '-'}
															{education.fieldOfStudy ? ` | ${education.fieldOfStudy}` : ''}
														</p>
														<p>{formatDateRange(education.startDate, education.endDate, education.isCurrent)}</p>
													</div>
													<div className="simple-list-actions">
														<div className="row-actions row-actions-right">
															<button
																type="button"
																className="row-action-icon"
																aria-label="Delete education"
																title="Delete education"
																disabled={
																	educationState.saving ||
																	educationState.deletingId === education.id
																}
																onClick={() => onDeleteEducation(education)}
															>
																{educationState.deletingId === education.id ? (
																	<LoaderCircle
																		aria-hidden="true"
																		className="row-action-lucide row-action-icon-spinner"
																	/>
																) : (
																	<Trash2 aria-hidden="true" className="row-action-lucide" />
																)}
															</button>
														</div>
													</div>
												</li>
											))}
										</ul>
									)}
								</div>
							</div>
						) : null}
						{workspaceTab === 'work' ? (
							<div className="side-tab-content side-tab-content-with-scroll">
								<form onSubmit={onAddWorkExperience}>
									<FormField label="Company" required>
										<input
											value={workExperienceForm.companyName}
											onChange={(e) =>
												setWorkExperienceForm((current) => ({ ...current, companyName: e.target.value }))
											}
											required
										/>
									</FormField>
									<div className="detail-form-grid-2">
										<FormField label="Job Title">
											<input
												value={workExperienceForm.title}
												onChange={(e) =>
													setWorkExperienceForm((current) => ({ ...current, title: e.target.value }))
												}
											/>
										</FormField>
										<FormField label="Location">
											<input
												value={workExperienceForm.location}
												onChange={(e) =>
													setWorkExperienceForm((current) => ({ ...current, location: e.target.value }))
												}
											/>
										</FormField>
									</div>
									<div className="detail-form-grid-2">
										<FormField label="Start Date">
											<input
												type="date"
												value={workExperienceForm.startDate}
												onChange={(e) =>
													setWorkExperienceForm((current) => ({ ...current, startDate: e.target.value }))
												}
											/>
										</FormField>
										<FormField label="End Date">
											<input
												type="date"
												value={workExperienceForm.endDate}
												onChange={(e) =>
													setWorkExperienceForm((current) => ({ ...current, endDate: e.target.value }))
												}
												disabled={workExperienceForm.isCurrent}
											/>
										</FormField>
									</div>
									<label className="switch-field">
										<input
											type="checkbox"
											className="switch-input"
											checked={workExperienceForm.isCurrent}
											onChange={(event) =>
												setWorkExperienceForm((current) => ({
													...current,
													isCurrent: event.target.checked,
													endDate: event.target.checked ? '' : current.endDate
												}))
											}
										/>
										<span className="switch-track" aria-hidden="true">
											<span className="switch-thumb" />
										</span>
										<span className="switch-copy">
											<span className="switch-label">Current Role</span>
											<span className="switch-hint">Enable if this role is still active.</span>
										</span>
									</label>
									<FormField label="Description">
										<textarea
											value={workExperienceForm.description}
											onChange={(e) =>
												setWorkExperienceForm((current) => ({ ...current, description: e.target.value }))
											}
										/>
									</FormField>
									<SaveActionButton
										saving={workExperienceState.saving}
										label="Save Work Experience"
										savingLabel="Saving Work Experience..."
										icon={Save}
									/>
								</form>
								<h4 className="side-section-title">Work Experience</h4>
								<div className="workspace-scroll-area">
									<ListSortControls
										label="Sort Work"
										value={workSort.field}
										direction={workSort.direction}
										onValueChange={(field) => setWorkSort((current) => ({ ...current, field }))}
										onDirectionToggle={() =>
											setWorkSort((current) => ({
												...current,
												direction: current.direction === 'asc' ? 'desc' : 'asc'
											}))
										}
										options={[
											{ value: 'startDate', label: 'Start Date' },
											{ value: 'companyName', label: 'Company' },
											{ value: 'title', label: 'Title' }
										]}
										disabled={sortedWorkExperiences.length < 2}
									/>
									{candidate.candidateWorkExperiences?.length === 0 ? (
										<p className="panel-subtext">No work experience history yet.</p>
									) : (
										<ul className="simple-list">
											{sortedWorkExperiences.map((workExperience) => (
												<li key={workExperience.id}>
													<div>
														<strong>{workExperience.companyName}</strong>
														<p>{workExperience.title || '-'}</p>
														<p>{formatDateRange(workExperience.startDate, workExperience.endDate, workExperience.isCurrent)}</p>
													</div>
													<div className="simple-list-actions">
														<div className="row-actions row-actions-right">
															<button
																type="button"
																className="row-action-icon"
																aria-label="Delete work experience"
																title="Delete work experience"
																disabled={
																	workExperienceState.saving ||
																	workExperienceState.deletingId === workExperience.id
																}
																onClick={() => onDeleteWorkExperience(workExperience)}
															>
																{workExperienceState.deletingId === workExperience.id ? (
																	<LoaderCircle
																		aria-hidden="true"
																		className="row-action-lucide row-action-icon-spinner"
																	/>
																) : (
																	<Trash2 aria-hidden="true" className="row-action-lucide" />
																)}
															</button>
														</div>
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
										onClick={() => loadJobMatches()}
										disabled={jobMatchState.loading || !!jobMatchState.submittingJobOrderId}
										aria-label={jobMatchState.loading ? 'Refreshing matches' : 'Refresh matches'}
										title={jobMatchState.loading ? 'Refreshing matches' : 'Refresh matches'}
									>
										<RefreshCcw
											aria-hidden="true"
											className={jobMatchState.loading ? 'btn-refresh-icon-svg row-action-icon-spinner' : 'btn-refresh-icon-svg'}
										/>
									</button>
									{jobMatchState.computedAt ? (
										<span className="form-actions-meta">
											<span>Updated:</span>
											<strong>{formatDate(jobMatchState.computedAt)}</strong>
										</span>
									) : null}
								</div>
								<div className="workspace-scroll-area">
									{jobMatchState.matchEligibility ? (
										<p className="panel-subtext">{jobMatchState.matchEligibility}</p>
									) : (
										<>
											<ListSortControls
												label="Sort Matches"
												value={jobMatchesSort.field}
												direction={jobMatchesSort.direction}
												onValueChange={(field) => setJobMatchesSort((current) => ({ ...current, field }))}
												onDirectionToggle={() =>
													setJobMatchesSort((current) => ({
														...current,
														direction: current.direction === 'asc' ? 'desc' : 'asc'
													}))
												}
												options={[
													{ value: 'scorePercent', label: 'Match Score' },
													{ value: 'jobOrder', label: 'Job Order' },
													{ value: 'client', label: 'Client' },
													{ value: 'location', label: 'Location' }
												]}
												disabled={sortedJobMatches.length < 2}
											/>
											{!jobMatchState.loading && sortedJobMatches.length === 0 ? (
												<p className="panel-subtext">
													No open active job order matches available for this candidate.
												</p>
											) : (
												<ul className="simple-list">
													{sortedJobMatches.map((match) => {
														const isSubmitting =
															jobMatchState.submittingJobOrderId === String(match.jobOrderId);
														return (
															<li key={match.jobOrderId}>
																<div>
																	<strong>
																		<Link href={`/job-orders/${match.jobOrderId}`}>{match.jobOrderTitle}</Link>
																	</strong>
																	<p>
																		{match.clientName || '-'}
																		{match.contactName ? ` | ${match.contactName}` : ''}
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
																					candidateId: Number(id),
																					candidateName: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
																					jobOrderId: match.jobOrderId,
																					jobOrderTitle: match.jobOrderTitle,
																					scorePercent: match.scorePercent,
																					reasons: match.reasons || [],
																					risks: match.risks || []
																				})
																			}
																			disabled={!aiAvailable || jobMatchState.loading}
																		>
																			<Sparkles aria-hidden="true" className="row-action-lucide" />
																		</button>
																		<SaveActionButton
																			type="button"
																			onClick={() => onCreateMatchedSubmission(match)}
																			saving={isSubmitting}
																			disabled={isSubmitting || jobMatchState.loading}
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
								{!jobMatchState.matchEligibility ? (
									<p className="panel-subtext">
										Evaluated {jobMatchState.totalJobOrdersEvaluated} open job order
										{jobMatchState.totalJobOrdersEvaluated === 1 ? '' : 's'}.
									</p>
								) : null}
							</div>
						) : null}

						{workspaceTab === 'status-history' ? (
							<div className="side-tab-content side-tab-content-with-scroll">
								<h4 className="side-section-title">Timeline</h4>
								<p className="panel-subtext">
									Unified candidate activity across notes, activities, files, submissions, interviews, placements, and AI updates.
								</p>
								<div className="workspace-scroll-area">
									<ActivityTimeline items={candidateTimelineItems} emptyText="No candidate timeline events yet." />
								</div>
							</div>
						) : null}
					</article>
			</div>
			{isAdmin ? <AuditTrailPanel entityType="CANDIDATE" entityId={id} visible={showAuditTrail} /> : null}
			{aiSummaryOpen ? (
				<div className="confirm-overlay" onClick={() => setAiSummaryOpen(false)}>
					<div
						className="confirm-dialog report-detail-modal candidate-ai-summary-modal"
						role="dialog"
						aria-modal="true"
						aria-labelledby="candidate-ai-summary-title"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="report-detail-modal-head">
							<div>
								<h3 id="candidate-ai-summary-title" className="confirm-title">AI Candidate Summary</h3>
								<p className="panel-subtext">
									{candidate.firstName} {candidate.lastName}
								</p>
							</div>
							<div className="ai-summary-toolbar">
								<button
									type="button"
									className="row-action-icon submission-write-up-action"
									onClick={onGenerateAiSummary}
									disabled={summaryState.generating || !aiAvailable}
									aria-label={
										summaryState.generating
											? 'Generating summary'
											: candidate.aiSummary
												? 'Refresh summary'
												: 'Generate summary'
									}
									title={aiAvailable ? undefined : 'Enable OpenAI in Admin Area > System Settings to use this.'}
								>
									{summaryState.generating ? (
										<LoaderCircle aria-hidden="true" className="row-action-icon-spinner" />
									) : candidate.aiSummary ? (
										<RefreshCcw aria-hidden="true" />
									) : (
										<Sparkles aria-hidden="true" />
									)}
								</button>
								<button
									type="button"
									className="btn-secondary btn-link-icon report-detail-modal-close"
									onClick={() => setAiSummaryOpen(false)}
									aria-label="Close AI Summary"
									title="Close"
								>
									<X aria-hidden="true" className="btn-refresh-icon-svg" />
								</button>
							</div>
						</div>
						<div className="report-detail-modal-body">
							{!aiAvailable ? (
								<p className="panel-subtext">Enable OpenAI in Admin Area &gt; System Settings to use this.</p>
							) : null}
							{candidate.aiSummary ? (
								<div className="ai-summary-sections">
									<section className="ai-summary-section">
										<h5>Overview</h5>
										<p>{candidate.aiSummary.overview}</p>
									</section>
									<section className="ai-summary-section">
										<h5>Strengths</h5>
										{normalizeSummaryItems(candidate.aiSummary.strengths).length > 0 ? (
											<ul className="ai-summary-list">
												{normalizeSummaryItems(candidate.aiSummary.strengths).map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										) : (
											<p className="panel-subtext">No strengths generated.</p>
										)}
									</section>
									<section className="ai-summary-section">
										<h5>Concerns</h5>
										{normalizeSummaryItems(candidate.aiSummary.concerns).length > 0 ? (
											<ul className="ai-summary-list">
												{normalizeSummaryItems(candidate.aiSummary.concerns).map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
										) : (
											<p className="panel-subtext">No concerns generated.</p>
										)}
									</section>
									<section className="ai-summary-section">
										<h5>Suggested Next Step</h5>
										<p>{candidate.aiSummary.suggestedNextStep || 'No next step generated.'}</p>
									</section>
									<p className="simple-list-meta">
										Generated by{' '}
										{candidate.aiSummary.generatedByUser
											? `${candidate.aiSummary.generatedByUser.firstName} ${candidate.aiSummary.generatedByUser.lastName}`
											: 'Unknown User'}{' '}
										@ <span className="meta-emphasis-time">{formatDate(candidate.aiSummary.updatedAt)}</span>
									</p>
								</div>
							) : summaryState.generating ? (
								<p className="panel-subtext">
									Generating summary from the candidate profile, resume, history, skills, and recent notes.
								</p>
							) : (
								<p className="panel-subtext">
									No AI summary has been generated yet.
								</p>
							)}
						</div>
					</div>
				</div>
			) : null}
			<EmailDraftModal
				open={emailDraftOpen}
				onClose={() => setEmailDraftOpen(false)}
				entityType="candidate"
				entityId={Number(id)}
				entityName={`${candidate.firstName || ''} ${candidate.lastName || ''}`.trim()}
				emailAddress={candidate.email || ''}
			/>
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
