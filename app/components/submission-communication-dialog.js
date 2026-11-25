'use client';

import { useEffect, useRef, useState } from 'react';

export default function SubmissionCommunicationDialog({ kind, submission, onClose, onRecorded }) {
	const dialog = useRef(null);
	const activeRequest = useRef(false);
	const requestId = useRef('');
	const isEmail = kind === 'email';
	const endpoint = `/api/submissions/${submission.id}/communications`;
	const [review, setReview] = useState(null);
	const [subject, setSubject] = useState('');
	const [body, setBody] = useState('');
	const [contactName, setContactName] = useState(() =>
		[submission.jobOrder?.contact?.firstName, submission.jobOrder?.contact?.lastName].filter(Boolean).join(' ')
	);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [outcomeUnknown, setOutcomeUnknown] = useState(false);

	useEffect(() => {
		const element = dialog.current;
		element.showModal();
		return () => element.close();
	}, []);

	useEffect(() => {
		if (!isEmail) return;
		const controller = new AbortController();
		async function loadReview() {
			try {
				const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Could not load the email review.');
				if (controller.signal.aborted) return;
				setReview(data);
				setSubject(data.subject);
				setBody(data.body);
			} catch (error) {
				if (!controller.signal.aborted) setError(error.message);
			}
		}
		loadReview();
		return () => controller.abort();
	}, [endpoint, isEmail]);

	async function submit(event) {
		event.preventDefault();
		if (activeRequest.current || !body.trim() || (isEmail && (!review || review.unavailable || !subject.trim()))) return;
		activeRequest.current = true;
		requestId.current ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
			byte.toString(16).padStart(2, '0')
		).join('');
		setBusy(true);
		setError('');

		try {
			const payload = { kind, body, requestId: requestId.current };
			const fields = isEmail ? {
				subject,
				contactId: review.contactId,
				recipientEmail: review.recipientEmail,
				replyTo: review.replyTo,
				testMode: review.testMode
			} : { contactName };
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...payload, ...fields })
			});
			const data = await response.json();
			if (data.communication) onRecorded(data.communication, response.ok);
			if (response.ok) return;
			setError(data.error || 'Could not save this communication.');
			if (data.retryable) requestId.current = '';
			setOutcomeUnknown(response.status >= 500 || ['sending', 'unconfirmed'].includes(data.communication?.deliveryStatus));
		} catch {
			setOutcomeUnknown(true);
			setError('The server did not confirm the result. Retry this same request to check it without creating a duplicate.');
		} finally {
			activeRequest.current = false;
			setBusy(false);
		}
	}

	const title = isEmail ? 'Review Submission Email' : 'Log Client Feedback';
	const canSubmit = body.trim() && (!isEmail || (review && !review.unavailable && subject.trim()));

	return (
		<dialog
			ref={dialog}
			className="confirm-dialog submission-communication-dialog"
			aria-labelledby="submission-communication-title"
			onCancel={(event) => {
				event.preventDefault();
				if (!activeRequest.current) onClose();
			}}
		>
			<h3 className="confirm-title" id="submission-communication-title">{title}</h3>
			{isEmail && !review && !error ? <p role="status" className="panel-subtext">Loading email review…</p> : null}
			{review?.unavailable ? <p role="alert" className="panel-subtext error">{review.unavailable}</p> : null}
			{review?.testMode && !review.unavailable ? (
				<p className="panel-subtext" role="status">
					{review.demoSink
						? 'This demo captures submission email locally. The hiring manager will not receive it.'
						: 'Test mode is on. This email will go to the configured test recipient.'}
				</p>
			) : null}
			<form className="email-draft-body" onSubmit={submit}>
				{isEmail && review ? (
					<>
						<label className="email-draft-field">
							<span className="form-label">To</span>
							<input value={review.recipientEmail ? `${review.contactName} <${review.recipientEmail}>` : 'No hiring manager email'} readOnly />
						</label>
						<label className="email-draft-field">
							<span className="form-label">Reply-To</span>
							<input value={review.replyTo} readOnly />
						</label>
						<label className="email-draft-field">
							<span className="form-label">Subject</span>
							<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} required readOnly={busy || outcomeUnknown} />
						</label>
					</>
				) : null}
				{!isEmail ? (
					<label className="email-draft-field">
						<span className="form-label">Feedback From</span>
						<input value={contactName} onChange={(event) => setContactName(event.target.value)} maxLength={191} readOnly={busy || outcomeUnknown} />
					</label>
				) : null}
				{!isEmail || review ? (
					<label className="email-draft-field">
						<span className="form-label">{isEmail ? 'Message' : 'Feedback (Internal)'}</span>
						<textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} maxLength={12000} required readOnly={busy || outcomeUnknown} />
					</label>
				) : null}
				{error ? <p role="alert" className="panel-subtext error">{error}</p> : null}
				<div className="confirm-actions">
					<button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
					<button type="submit" className="btn-primary" disabled={busy || !canSubmit}>
						{busy ? (isEmail ? 'Sending…' : 'Saving…') : outcomeUnknown ? 'Retry Same Request' : isEmail ? 'Send Email' : 'Save Feedback'}
					</button>
				</div>
			</form>
		</dialog>
	);
}
