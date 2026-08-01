'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Botpoison from '@botpoison/browser';
import { CheckCircle2, Send, X } from 'lucide-react';
import FormField from '@/app/components/form-field';

const QUALIFYING_ACTIVE_MS = (process.env.NODE_ENV === 'development' ? 1 : 8) * 60 * 1000;
const DISMISSAL_MS = 7 * 24 * 60 * 60 * 1000;
const TRACKING_INTERVAL_MS = 1000;
const PROGRESS_KEY = 'hg:demo-workspace:progress';
const DISMISSED_KEY = 'hg:demo-workspace:dismissed-until';
const SUBMITTED_KEY = 'hg:demo-workspace:submitted';
const BOTPOISON_PUBLIC_KEY = 'pk_10bb1324-a6ed-40f0-8b60-7f1dec9fc97a';
const MAIN_SECTION_PATHS = [
	'/',
	'/candidates',
	'/clients',
	'/contacts',
	'/job-orders',
	'/submissions',
	'/interviews',
	'/placements',
	'/reports',
	'/archive'
];
const TEAM_SIZE_OPTIONS = [
	{ label: 'Solo recruiter', value: 'Solo recruiter' },
	{ label: '2-5 recruiters', value: '2–5 recruiters' },
	{ label: '6-15 recruiters', value: '6–15 recruiters' },
	{ label: '16+ recruiters', value: '16+ recruiters' }
];
const EMPTY_FORM = {
	firstName: '',
	lastName: '',
	workEmail: '',
	agencyName: '',
	teamSize: '',
	currentAts: '',
	note: ''
};

function sectionForPath(pathname) {
	if (pathname === '/') return '/';
	return MAIN_SECTION_PATHS.find((path) => path !== '/' && (pathname === path || pathname.startsWith(`${path}/`))) || '';
}

function readJsonStorage(key, fallback) {
	try {
		const value = window.localStorage.getItem(key);
		return value ? JSON.parse(value) : fallback;
	} catch {
		return fallback;
	}
}

export default function DemoWorkspaceRequest({ demoMode, userId, pathname, autoPromptEnabled = true }) {
	const [open, setOpen] = useState(false);
	const [view, setView] = useState('prompt');
	const [form, setForm] = useState(EMPTY_FORM);
	const [status, setStatus] = useState('idle');
	const [message, setMessage] = useState('');
	const [submitted, setSubmitted] = useState(false);
	const [qualified, setQualified] = useState(false);
	const autoOpenedRef = useRef(false);

	useEffect(() => {
		if (!demoMode || !userId || typeof window === 'undefined') return undefined;
		setSubmitted(window.localStorage.getItem(SUBMITTED_KEY) === '1');

		const stored = readJsonStorage(PROGRESS_KEY, {});
		let activeMs = Number(stored.activeMs) || 0;
		const sections = new Set(Array.isArray(stored.sections) ? stored.sections : []);
		const currentSection = sectionForPath(pathname);
		if (currentSection) sections.add(currentSection);

		function persistAndEvaluate() {
			window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ activeMs, sections: [...sections] }));
			setQualified(activeMs >= QUALIFYING_ACTIVE_MS && sections.size >= 3);
		}

		persistAndEvaluate();
		const intervalId = window.setInterval(() => {
			if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
			activeMs += TRACKING_INTERVAL_MS;
			persistAndEvaluate();
		}, TRACKING_INTERVAL_MS);

		return () => window.clearInterval(intervalId);
	}, [demoMode, pathname, userId]);

	useEffect(() => {
		if (!demoMode || !qualified || submitted || !autoPromptEnabled || autoOpenedRef.current) return;
		const dismissedUntil = Number(window.localStorage.getItem(DISMISSED_KEY)) || 0;
		if (dismissedUntil > Date.now()) return;
		autoOpenedRef.current = true;
		setView('prompt');
		setStatus('idle');
		setMessage('');
		setOpen(true);
	}, [autoPromptEnabled, demoMode, qualified, submitted]);

	useEffect(() => {
		if (!open || typeof document === 'undefined') return undefined;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		function onKeyDown(event) {
			if (event.key === 'Escape' && status !== 'submitting') dismiss();
		}
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			document.removeEventListener('keydown', onKeyDown);
		};
	});

	function openRequestForm() {
		if (submitted) return;
		setView('form');
		setStatus('idle');
		setMessage('');
		setOpen(true);
	}

	function dismiss() {
		if (status === 'submitting') return;
		window.localStorage.setItem(DISMISSED_KEY, String(Date.now() + DISMISSAL_MS));
		setOpen(false);
	}

	function updateField(event) {
		const { name, value } = event.target;
		setForm((current) => ({ ...current, [name]: value }));
		if (status === 'error') {
			setStatus('idle');
			setMessage('');
		}
	}

	async function submitRequest(event) {
		event.preventDefault();
		if (status === 'submitting' || submitted) return;
		setStatus('submitting');
		setMessage('');

		const challenge = await new Botpoison({ publicKey: BOTPOISON_PUBLIC_KEY })
			.challenge()
			.catch(() => null);
		if (!challenge?.solution) {
			setStatus('error');
			setMessage('We could not verify your request right now. Please try again.');
			return;
		}

		const response = await fetch('/api/demo-workspace-request', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...form, botpoisonSolution: challenge.solution })
		}).catch(() => null);
		const data = await response?.json().catch(() => ({}));

		if (!response?.ok) {
			setStatus('error');
			setMessage(data?.error || 'We could not send your request right now. Please try again.');
			return;
		}

		window.localStorage.setItem(SUBMITTED_KEY, '1');
		setSubmitted(true);
		setStatus('success');
		setMessage(data?.duplicate ? 'We already have your workspace request.' : 'Your workspace request has been sent. We will be in touch soon.');
		setView('success');
	}

	if (!demoMode || !userId) return null;

	return (
		<>
			<button
				type="button"
				className="btn-secondary demo-workspace-cta"
				onClick={openRequestForm}
				disabled={submitted}
				title={submitted ? 'Workspace request received' : 'Request a private Hire Gnome workspace'}
			>
				{submitted ? <CheckCircle2 aria-hidden="true" /> : <Send aria-hidden="true" />}
				<span>{submitted ? 'Workspace requested' : 'Request a workspace'}</span>
			</button>

			{open ? createPortal((
				<div className="confirm-overlay" onClick={dismiss}>
				<div
					className="confirm-dialog demo-workspace-modal"
					role="dialog"
					aria-modal="true"
					aria-labelledby="demo-workspace-title"
					onClick={(event) => event.stopPropagation()}
				>
					<div className="report-detail-modal-head">
						<div>
							<h3 id="demo-workspace-title" className="confirm-title">
								{view === 'success'
									? 'Request received'
									: view === 'form'
										? 'Get Your Workspace'
										: 'Ready to try Hire Gnome with your own data?'}
							</h3>
							{view !== 'success' ? (
								<p className="panel-subtext">
									Request a private Hire Gnome workspace with a clean database for your agency.
								</p>
							) : null}
						</div>
						<button
							type="button"
							className="btn-secondary btn-link-icon report-detail-modal-close"
							onClick={dismiss}
							disabled={status === 'submitting'}
							aria-label="Close workspace request"
							title="Close"
						>
							<X aria-hidden="true" />
						</button>
					</div>

					{view === 'prompt' ? (
						<div className="demo-workspace-actions">
							<button type="button" className="btn-secondary" onClick={dismiss}>Keep exploring</button>
							<button type="button" className="btn-primary" onClick={() => setView('form')}>Request a workspace</button>
						</div>
					) : null}

					{view === 'form' ? (
						<form className="demo-workspace-form" onSubmit={submitRequest}>
							<div className="form-grid-2">
								<FormField label="First name" required>
									<input name="firstName" aria-label="First name" value={form.firstName} onChange={updateField} autoComplete="given-name" required maxLength={80} />
								</FormField>
								<FormField label="Last name" required>
									<input name="lastName" aria-label="Last name" value={form.lastName} onChange={updateField} autoComplete="family-name" required maxLength={80} />
								</FormField>
							</div>
							<FormField label="Work email" required>
								<input name="workEmail" type="email" aria-label="Work email" value={form.workEmail} onChange={updateField} autoComplete="email" required maxLength={254} />
							</FormField>
							<FormField label="Agency name" required>
								<input name="agencyName" aria-label="Agency name" value={form.agencyName} onChange={updateField} autoComplete="organization" required maxLength={160} />
							</FormField>
							<div className="form-grid-2">
								<FormField label="Team size" required>
									<select name="teamSize" aria-label="Team size" value={form.teamSize} onChange={updateField} required>
										<option value="">Select...</option>
										{TEAM_SIZE_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>{option.label}</option>
										))}
									</select>
								</FormField>
								<FormField label="Current ATS" hint="Optional">
									<input name="currentAts" aria-label="Current ATS" value={form.currentAts} onChange={updateField} placeholder="Bullhorn, Zoho, etc." maxLength={120} />
								</FormField>
							</div>
							<FormField label="Anything else we should know?" hint="Optional">
								<textarea name="note" aria-label="Anything else we should know?" value={form.note} onChange={updateField} placeholder="Migration needs, timeline, questions..." rows={3} maxLength={2000} />
							</FormField>
							{status === 'error' ? <p className="form-status form-status-error" role="alert">{message}</p> : null}
							<div className="demo-workspace-actions">
								<button type="button" className="btn-secondary" onClick={dismiss} disabled={status === 'submitting'}>Keep exploring</button>
								<button type="submit" className="btn-primary" disabled={status === 'submitting'}>
									{status === 'submitting' ? 'Sending...' : 'Submit request'}
								</button>
							</div>
						</form>
					) : null}

					{view === 'success' ? (
						<div className="demo-workspace-success" role="status">
							<CheckCircle2 aria-hidden="true" />
							<p>{message}</p>
							<button type="button" className="btn-primary" onClick={dismiss}>Keep exploring</button>
						</div>
					) : null}
				</div>
				</div>
			), document.body) : null}
		</>
	);
}
