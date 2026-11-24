'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LookupTypeaheadSelect from '@/app/components/lookup-typeahead-select';
import FormField from '@/app/components/form-field';
import CustomFieldsSection, { areRequiredCustomFieldsComplete } from '@/app/components/custom-fields-section';
import AddressTypeaheadInput from '@/app/components/address-typeahead-input';
import EmailChipInput from '@/app/components/email-chip-input';
import SaveActionButton from '@/app/components/save-action-button';
import NewRecordGuide from '@/app/components/new-record-guide';
import { useToast } from '@/app/components/toast-provider';
import useUnsavedChangesGuard from '@/app/hooks/use-unsaved-changes-guard';
import { INTERVIEW_TYPE_OPTIONS, normalizeInterviewType } from '@/app/constants/interview-type-options';
import { fetchLookupOptionById } from '@/lib/lookup-client';
import { isValidOptionalHttpUrl, normalizeHttpUrl } from '@/lib/url-validation';
import { formatCandidateStatusLabel, isCandidateQualifiedForPipeline } from '@/lib/candidate-status';
import {
	VIDEO_CALL_PROVIDER_OPTIONS,
	getVideoCallLinkPlaceholder,
	getVideoCallProviderTemplate,
	normalizeVideoCallProvider
} from '@/lib/video-call-links';

const initialForm = {
	interviewMode: 'phone',
	status: 'scheduled',
	subject: '',
	interviewer: '',
	interviewerEmail: '',
	startsAt: '',
	durationMinutes: '60',
	location: '',
	locationPlaceId: '',
	locationLatitude: '',
	locationLongitude: '',
	videoCallProvider: '',
	videoLink: '',
	optionalParticipantEmails: [],
	candidateId: '',
	jobOrderId: '',
	customFields: {}
};

const DURATION_OPTIONS = [
	{ value: '30', label: '30 minutes' },
	{ value: '45', label: '45 minutes' },
	{ value: '60', label: '60 minutes' },
	{ value: '90', label: '90 minutes' },
	{ value: '120', label: '120 minutes' }
];

function useInterviewRecord(entity, id) {
	const [lookup, setLookup] = useState(null);

	useEffect(() => {
		if (!id) return;
		let active = true;
		fetchLookupOptionById(entity, id).then((option) => {
			if (active) setLookup({ id, option });
		});
		return () => {
			active = false;
		};
	}, [entity, id]);

	return lookup?.id === id ? lookup : null;
}

function toLocalDateTimeValue(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
		return '';
	}

	const pad = (value) => String(value).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
		date.getMinutes()
	)}`;
}

function calculateEndsAt(startsAt, durationMinutes) {
	if (!startsAt) {
		return '';
	}

	const startDate = new Date(startsAt);
	const parsedDuration = Number.parseInt(durationMinutes, 10);
	if (Number.isNaN(startDate.getTime()) || Number.isNaN(parsedDuration) || parsedDuration <= 0) {
		return '';
	}

	const endDate = new Date(startDate.getTime() + parsedDuration * 60 * 1000);
	return toLocalDateTimeValue(endDate);
}

function NewInterviewsPageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const prefillCandidateId = searchParams.get('candidateId') || '';
	const prefillJobOrderId = searchParams.get('jobOrderId') || '';
	const prefillSubject = searchParams.get('subject') || '';
	const [form, setForm] = useState({
		...initialForm,
		candidateId: prefillCandidateId,
		jobOrderId: prefillJobOrderId,
		subject: prefillSubject
	});
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
	const toast = useToast();
	useUnsavedChangesGuard(form);
	const computedEndsAt = useMemo(
		() => calculateEndsAt(form.startsAt, form.durationMinutes),
		[form.startsAt, form.durationMinutes]
	);
	const candidateLookup = useInterviewRecord('candidates', form.candidateId);
	const jobOrderLookup = useInterviewRecord('job-orders', form.jobOrderId);
	const selectedCandidateStatus = candidateLookup?.option?.status;

	const hasRequiredFields = Boolean(
		form.subject.trim() &&
			candidateLookup?.option &&
			jobOrderLookup?.option &&
			form.interviewer.trim() &&
			form.interviewerEmail.trim() &&
			form.startsAt &&
			form.durationMinutes &&
			computedEndsAt
	);
	const hasValidEmail = /\S+@\S+\.\S+/.test(form.interviewerEmail.trim());
	const hasValidVideoLink = isValidOptionalHttpUrl(form.videoLink);
	const selectedCandidateIsQualified =
		!form.candidateId ||
		!selectedCandidateStatus ||
		isCandidateQualifiedForPipeline(selectedCandidateStatus);
	const customFieldsComplete = areRequiredCustomFieldsComplete(
		customFieldDefinitions,
		form.customFields
	);
	const canSave = hasRequiredFields && hasValidEmail && hasValidVideoLink && selectedCandidateIsQualified;
	const canSaveWithCustomFields = canSave && customFieldsComplete;
	const emailError =
		form.interviewerEmail.trim() && !hasValidEmail ? 'Enter a valid interviewer email address.' : '';
	const videoLinkError =
		form.videoLink.trim() && !hasValidVideoLink
			? 'Enter a valid video call link URL, including http:// or https://.'
			: '';

	useEffect(() => {
		if (error) {
			toast.error(error);
		}
	}, [error, toast]);

	async function onSubmit(e) {
		e.preventDefault();
		setError('');
		if (!canSave) {
			if (!selectedCandidateIsQualified) {
					setError(
						`Candidate must be Qualified or beyond before interviews can be scheduled. Current status: ${formatCandidateStatusLabel(
							selectedCandidateStatus
						)}.`
					);
				return;
			}
			setError(
				'Complete required fields (Subject, Candidate, Job Order, Interviewer, Interviewer Email, Start Date & Time) and use a valid interviewer email address.'
			);
			return;
		}
		if (!customFieldsComplete) {
			setError('Complete all required custom fields before saving.');
			return;
		}
		setSaving(true);

		try {
			const { videoCallProvider: _videoCallProvider, ...formPayload } = form;
			const payload = {
				...formPayload,
				endsAt: computedEndsAt
			};

			const res = await fetch('/api/interviews', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setError(data.error || 'Failed to create interview.');
				return;
			}

			const interview = await res.json();
			router.push(`/interviews/${interview.id}`);
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<Link href="/interviews" className="module-back-link" aria-label="Back to List">&larr; Back</Link>
					<h2>New Interview</h2>
					<p>Schedule interviews for candidate-job pairings.</p>
				</div>
			</header>

			<div className="new-record-layout">
			<article className="panel panel-narrow">
				<h3>Schedule Interview</h3>
				<form onSubmit={onSubmit}>
					<div className="form-grid-2">
						<FormField label="Type">
							<select
								value={form.interviewMode}
								onChange={(e) =>
									setForm((f) =>
										normalizeInterviewType(e.target.value) === 'video'
											? {
													...f,
													interviewMode: normalizeInterviewType(e.target.value),
													location: '',
													locationPlaceId: '',
													locationLatitude: '',
													locationLongitude: ''
												}
											: { ...f, interviewMode: normalizeInterviewType(e.target.value) }
									)
								}
							>
								{INTERVIEW_TYPE_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="Status">
							<select
								value={form.status}
								onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
							>
								<option value="scheduled">Scheduled</option>
								<option value="completed">Completed</option>
							</select>
						</FormField>
					</div>
						<FormField label="Subject" required>
							<input
								value={form.subject}
								onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
								required
							/>
						</FormField>
					<div className="form-grid-2">
						<FormField label="Candidate" required>
							<LookupTypeaheadSelect
								entity="candidates"
								lookupParams={{ qualifiedOnly: 'true' }}
								value={form.candidateId}
								onChange={(nextValue) => setForm((f) => ({ ...f, candidateId: nextValue }))}
								placeholder="Search candidate"
								label="Candidate"
								emptyLabel="No qualified candidates available."
							/>
							{candidateLookup && !candidateLookup.option ? (
								<p className="panel-subtext error" role="alert">This candidate is no longer available. Select a candidate to continue.</p>
							) : null}
						</FormField>
						<FormField label="Job Order" required>
							<LookupTypeaheadSelect
								entity="job-orders"
								lookupParams={{}}
								value={form.jobOrderId}
								onChange={(nextValue) => setForm((f) => ({ ...f, jobOrderId: nextValue }))}
								placeholder="Search job order"
								label="Job Order"
								emptyLabel="No matching job orders."
							/>
							{jobOrderLookup && !jobOrderLookup.option ? (
								<p className="panel-subtext error" role="alert">This job order is no longer available. Select a job order to continue.</p>
							) : null}
						</FormField>
					</div>
					{!selectedCandidateIsQualified ? (
						<div className="validation-chip-row">
							<span className="chip validation-chip-invalid">Candidate Not Interview-Ready</span>
						</div>
					) : null}
						<div className="form-grid-2">
							<FormField label="Interviewer" required>
								<input
									value={form.interviewer}
									onChange={(e) => setForm((f) => ({ ...f, interviewer: e.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Interviewer Email" required>
								<input
									type="email"
									value={form.interviewerEmail}
									onChange={(e) => setForm((f) => ({ ...f, interviewerEmail: e.target.value }))}
									required
								/>
							</FormField>
						</div>
						{emailError ? <p className="panel-subtext error">{emailError}</p> : null}
						<FormField label="Optional Participants" hint="Press Enter or comma to add">
							<EmailChipInput
								values={form.optionalParticipantEmails}
								onChange={(nextValues) => setForm((f) => ({ ...f, optionalParticipantEmails: nextValues }))}
								placeholder="participant@company.com"
								emptyLabel="No optional participants."
							/>
						</FormField>
					<div className="form-grid-2">
						<FormField label="Start Date & Time" required>
							<input
								type="datetime-local"
								value={form.startsAt}
								onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
								required
							/>
						</FormField>
						<FormField label="Duration" required>
							<select
								value={form.durationMinutes}
								onChange={(e) => setForm((f) => ({ ...f, durationMinutes: e.target.value }))}
								required
							>
								{DURATION_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</FormField>
					</div>
					<input type="hidden" value={computedEndsAt} readOnly />
					{form.interviewMode === 'video' ? null : (
						<FormField label="Location">
							<AddressTypeaheadInput
								value={form.location}
								onChange={(nextValue) => setForm((f) => ({ ...f, location: nextValue }))}
								onPlaceDetailsChange={(details) =>
									setForm((f) => ({
										...f,
										locationPlaceId: details?.placeId || '',
										locationLatitude: details?.latitude ?? '',
										locationLongitude: details?.longitude ?? ''
									}))
								}
								placeholder="Search address or enter manually"
								label="Location"
							/>
						</FormField>
					)}
					<div className="form-grid-2">
						<FormField label="Video Call Provider">
							<select
								value={form.videoCallProvider}
								onChange={(e) => {
									const nextProvider = normalizeVideoCallProvider(e.target.value);
									setForm((f) => {
										const nextLink = f.videoLink.trim()
											? f.videoLink
											: getVideoCallProviderTemplate(nextProvider);
										return {
											...f,
											videoCallProvider: nextProvider,
											videoLink: nextLink
										};
									});
								}}
							>
								<option value="">Select provider</option>
								{VIDEO_CALL_PROVIDER_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</FormField>
						<FormField label="Video Call Link">
							<input
								type="url"
								value={form.videoLink}
								placeholder={getVideoCallLinkPlaceholder(form.videoCallProvider)}
								onChange={(e) => setForm((f) => ({ ...f, videoLink: e.target.value }))}
								onBlur={(e) =>
									setForm((f) => ({
										...f,
										videoLink: normalizeHttpUrl(e.target.value)
									}))
								}
							/>
						</FormField>
					</div>
					{videoLinkError ? <p className="panel-subtext error">{videoLinkError}</p> : null}
					<CustomFieldsSection
						moduleKey="interviews"
						values={form.customFields}
						onChange={(nextCustomFields) =>
							setForm((f) => ({
								...f,
								customFields: nextCustomFields
							}))
						}
						onDefinitionsChange={setCustomFieldDefinitions}
					/>
					<SaveActionButton
						saving={saving}
						disabled={saving || !canSaveWithCustomFields}
						label="Save Interview"
						savingLabel="Saving Interview..."
					/>
				</form>
			</article>
			<NewRecordGuide
				title="Interview Setup"
				intro="Use interviews for real candidate-job conversations. This record is where timing, interviewer data, and AI question generation live."
				checklist={[
					'Candidate and job order should already be a valid pairing before you schedule.',
					'Use a valid interviewer email and real start time so downstream communication stays reliable.',
					'Choose the right interview type and provide location or video details where relevant.'
				]}
				outcomes={[
					'The interview detail opens after save for updates, notes, and AI-generated question sets.',
					'Interview records feed reporting and candidate/job activity history immediately.'
				]}
				tips={[
					'Optional participants are useful for panel visibility, but do not replace the main interviewer.',
					'If this is only tentative, wait until the slot is real instead of cluttering the pipeline.'
				]}
			/>
			</div>
		</section>
	);
}

export default function NewInterviewsPage() {
	return (
		<Suspense
			fallback={
				<section className="module-page">
					<p>Loading interview setup...</p>
				</section>
			}
		>
			<NewInterviewsPageContent />
		</Suspense>
	);
}
