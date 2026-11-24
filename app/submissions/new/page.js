'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import LookupTypeaheadSelect from '@/app/components/lookup-typeahead-select';
import FormField from '@/app/components/form-field';
import CustomFieldsSection, { areRequiredCustomFieldsComplete } from '@/app/components/custom-fields-section';
import SaveActionButton from '@/app/components/save-action-button';
import NewRecordGuide from '@/app/components/new-record-guide';
import { useToast } from '@/app/components/toast-provider';
import useUnsavedChangesGuard from '@/app/hooks/use-unsaved-changes-guard';
import { fetchLookupOptionById } from '@/lib/lookup-client';
import { formatCandidateStatusLabel, isCandidateEligibleForSubmission } from '@/lib/candidate-status';

const initialForm = {
	candidateId: '',
	jobOrderId: '',
	status: 'submitted',
	notes: '',
	customFields: {}
};

function NewSubmissionsPageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const prefillCandidateId = searchParams.get('candidateId') || '';
	const prefillJobOrderId = searchParams.get('jobOrderId') || '';
	const [selectedCandidateStatus, setSelectedCandidateStatus] = useState(null);
	const [form, setForm] = useState({
		...initialForm,
		candidateId: prefillCandidateId,
		jobOrderId: prefillJobOrderId
	});
	const [error, setError] = useState('');
	const [saving, setSaving] = useState(false);
	const [customFieldDefinitions, setCustomFieldDefinitions] = useState([]);
	const toast = useToast();
	useUnsavedChangesGuard(form);
	const selectedCandidateIsEligible =
		!form.candidateId ||
		!selectedCandidateStatus ||
		isCandidateEligibleForSubmission(selectedCandidateStatus);
	const customFieldsComplete = areRequiredCustomFieldsComplete(
		customFieldDefinitions,
		form.customFields
	);
	const canSave = Boolean(
		form.candidateId &&
		form.jobOrderId &&
		selectedCandidateIsEligible &&
		customFieldsComplete
	);

	useEffect(() => {
		let active = true;

		async function loadSelectedCandidate() {
			if (!form.candidateId) {
				if (active) {
					setSelectedCandidateStatus(null);
				}
				return;
			}

			const option = await fetchLookupOptionById('candidates', form.candidateId, {});
			if (!active) return;
			setSelectedCandidateStatus(option?.status || null);
		}

		loadSelectedCandidate();
		return () => {
			active = false;
		};
	}, [form.candidateId]);

	useEffect(() => {
		if (error) {
			toast.error(error);
		}
	}, [error, toast]);

	async function onSubmit(e) {
		e.preventDefault();
		setError('');
		if (!form.candidateId || !form.jobOrderId) {
			setError('Candidate and Job Order are required.');
			return;
		}
		if (!selectedCandidateIsEligible) {
			setError(
				`Candidate must be In Review or beyond before submitting. Current status: ${formatCandidateStatusLabel(
					selectedCandidateStatus
				)}.`
			);
			return;
		}
		if (!customFieldsComplete) {
			setError('Complete all required custom fields before saving.');
			return;
		}
		setSaving(true);

		try {
			const res = await fetch('/api/submissions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(form)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				setError(data.error || 'Failed to create submission.');
				return;
			}

			const submission = await res.json();
			router.push(`/submissions/${submission.id}`);
		} finally {
			setSaving(false);
		}
	}

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<Link href="/submissions" className="module-back-link" aria-label="Back to List">&larr; Back</Link>
					<h2>New Submission</h2>
					<p>Create candidate submission records for job orders.</p>
				</div>
			</header>

			<div className="new-record-layout">
			<article className="panel panel-narrow">
				<h3>Add Submission</h3>
				<form onSubmit={onSubmit}>
					<FormField label="Candidate" required>
						<LookupTypeaheadSelect
							entity="candidates"
							lookupParams={{ submissionEligibleOnly: 'true' }}
							value={form.candidateId}
							onChange={(nextValue) => setForm((f) => ({ ...f, candidateId: nextValue }))}
							onSelectOption={(option) => setSelectedCandidateStatus(option?.status || null)}
							placeholder="Search candidate"
							label="Candidate"
							emptyLabel="No eligible candidates available."
						/>
					</FormField>
					{!selectedCandidateIsEligible ? (
						<div className="validation-chip-row">
							<span className="chip validation-chip-invalid">Candidate Not Submission-Ready</span>
						</div>
					) : null}
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
					</FormField>
					<FormField label="Status">
						<select
							value={form.status}
							onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
						>
							<option value="submitted">Submitted</option>
							<option value="under_review">Under Review</option>
							<option value="qualified">Qualified</option>
							<option value="rejected">Rejected</option>
							<option value="offered">Offered</option>
							<option value="hired">Hired</option>
							<option value="placed">Placed</option>
						</select>
					</FormField>
					<FormField label="Notes">
						<textarea
							placeholder="Submission notes"
							value={form.notes}
							onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
						/>
					</FormField>
					<CustomFieldsSection
						moduleKey="submissions"
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
						disabled={saving || !canSave}
						label="Create Submission"
						savingLabel="Creating Submission..."
					/>
				</form>
			</article>
			<NewRecordGuide
				title="Submission Setup"
				intro="Submissions track a candidate’s progress on an individual job order."
				checklist={[
					'Candidates can be submitted while their profile is In Review.',
					'Confirm the candidate and job order pairing is the one you actually intend to present.',
					'Use notes for recruiter context that should live on the submission itself.'
				]}
				outcomes={[
					'The submission detail opens after save for client write-up, feedback, and status updates.',
					'Submitted candidates appear on the job order submissions workspace and client portal when shared.'
				]}
				tips={[
					'Submission priority is managed on the job-order detail after save.',
					'If the candidate is not really in play yet, do not create the submission early just to hold a spot.'
				]}
			/>
			</div>
		</section>
	);
}

export default function NewSubmissionsPage() {
	return (
		<Suspense
			fallback={
				<section className="module-page">
					<p>Loading submission setup...</p>
				</section>
			}
		>
			<NewSubmissionsPageContent />
		</Suspense>
	);
}
