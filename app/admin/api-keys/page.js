'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import AdminGate from '@/app/components/admin-gate';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import LoadingIndicator from '@/app/components/loading-indicator';
import { useToast } from '@/app/components/toast-provider';
import { roleLabel } from '@/app/constants/access-control-options';
import { formatDateTimeAt } from '@/lib/date-format';

const endpoint = '/api/admin/api-keys';
const emptyForm = { label: '', userRecordId: '', writesEnabled: false };
const statusLabels = { active: 'Active', revoked: 'Revoked', access_changed: 'Access Changed' };

async function request(method = 'GET', body, signal) {
	const response = await fetch(endpoint, {
		method, signal, cache: 'no-store',
		...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.error || 'Could not complete the API key request.');
	return data;
}

function accountLabel(user) {
	return [user.name, roleLabel(user.role), user.division].filter(Boolean).join(' · ');
}

function CopyField({ id, label, value, buttonLabel }) {
	const field = useRef(null);
	const toast = useToast();

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			toast.success(`${label} copied.`);
		} catch {
			field.current?.focus();
			field.current?.select();
			toast.error('Copy the selected value with your keyboard.');
		}
	}

	return (
		<div className="form-field">
			<label className="form-label" htmlFor={id}>{label}</label>
			<div className="api-key-copy-field">
				<input id={id} ref={field} value={value} readOnly spellCheck={false} autoComplete="off"
					onFocus={(event) => event.target.select()} />
				<button type="button" className="btn-secondary" onClick={copy}>{buttonLabel}</button>
			</div>
		</div>
	);
}

function ApiKeySettings() {
	const { requestConfirm } = useConfirmDialog();
	const toast = useToast();
	const [settings, setSettings] = useState(null);
	const [baseUrl, setBaseUrl] = useState('');
	const [form, setForm] = useState(emptyForm);
	const [issued, setIssued] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		setBaseUrl(new URL('/api/v1', window.location.origin).href);
		const controller = new AbortController();
		request('GET', undefined, controller.signal).then((data) => {
			if (!controller.signal.aborted) setSettings(data);
		}).catch((failure) => {
			if (!controller.signal.aborted) setError(failure.message);
		});
		return () => controller.abort();
	}, []);

	async function create(event) {
		event.preventDefault();
		setBusy(true);
		setError('');
		try {
			const data = await request('POST', form);
			setIssued(data);
			setForm(emptyForm);
			setSettings((current) => ({ ...current, keys: [data.key, ...current.keys] }));
		} catch (failure) {
			setError(failure.message);
		} finally {
			setBusy(false);
		}
	}

	async function revoke(key) {
		const confirmed = await requestConfirm({
			title: 'Revoke API Key?',
			message: `“${key.label}” will stop working immediately. Any integration using it will need a new key.`,
			confirmLabel: 'Revoke Key',
			isDanger: true
		});
		if (!confirmed) return;
		setBusy(true);
		setError('');
		try {
			const data = await request('DELETE', { recordId: key.recordId });
			setSettings((current) => ({
				...current, keys: current.keys.map((item) => item.recordId === key.recordId ? data.key : item)
			}));
			if (issued?.key.recordId === key.recordId) setIssued(null);
			toast.success('API key revoked.');
		} catch (failure) {
			setError(failure.message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<h2>API Keys</h2>
					<p>Give an external integration access to Hire Gnome.</p>
				</div>
				<Link className="btn-secondary" href="/admin">Back to Admin</Link>
			</header>
			{error ? <p role="alert" className="panel-subtext">{error}</p> : null}
			{!settings && !error ? <LoadingIndicator className="page-loading-indicator" label="Loading API keys" /> : null}
			{settings?.demoMode ? (
				<article className="panel panel-spacious">
					<p className="panel-subtext">API key management is disabled on the public demo.</p>
				</article>
			) : null}
			{settings && !settings.demoMode ? (
				<>
					<article className="panel panel-spacious panel-narrow api-key-form">
						{issued ? (
							<>
								<h3>API Key Created</h3>
								<p className="panel-subtext" role="status">Copy this key now. Hire Gnome only shows it once.</p>
								<CopyField id="issued-api-key" label="API Key" value={issued.token} buttonLabel="Copy Key" />
								<CopyField id="api-base-url" label="API Base URL" value={baseUrl} buttonLabel="Copy URL" />
								<p className="panel-subtext">Use the key as a Bearer token in the integration’s Authorization header.</p>
								<div className="form-actions">
									<button type="button" onClick={() => setIssued(null)}>Done</button>
								</div>
							</>
						) : (
							<>
								<h3>Create an API Key</h3>
								<CopyField id="api-base-url" label="API Base URL" value={baseUrl} buttonLabel="Copy URL" />
								{settings.users.length ? (
									<form className="api-key-form" onSubmit={create}>
										<div className="form-field">
											<label className="form-label" htmlFor="api-key-name">Key Name <span className="form-required">*</span></label>
											<input id="api-key-name" value={form.label} required maxLength={191} disabled={busy}
												onChange={(event) => setForm({ ...form, label: event.target.value })} />
										</div>
										<div className="form-field">
											<label className="form-label" htmlFor="api-key-account">Hire Gnome Account <span className="form-required">*</span></label>
											<select id="api-key-account" value={form.userRecordId} required disabled={busy}
												onChange={(event) => setForm({ ...form, userRecordId: event.target.value })}>
												<option value="">Select an account</option>
												{settings.users.map((user) => <option key={user.recordId} value={user.recordId}>{accountLabel(user)}</option>)}
											</select>
											<p className="panel-subtext">The integration uses this account’s role, division, and record permissions.</p>
										</div>
										<div className="form-field">
											<label className="form-label" htmlFor="api-key-access">Access</label>
											<select id="api-key-access" value={form.writesEnabled ? 'read-write' : 'read'} disabled={busy}
												onChange={(event) => setForm({ ...form, writesEnabled: event.target.value === 'read-write' })}>
												<option value="read">Read Only</option>
												<option value="read-write">Read and Write</option>
											</select>
										</div>
										<div className="form-actions">
											<button type="submit" disabled={busy || !form.label.trim() || !form.userRecordId}>Create Key</button>
										</div>
									</form>
								) : (
									<p className="panel-subtext">An active director or recruiter with a division is required. <Link href="/admin/users">Manage Users</Link></p>
								)}
							</>
						)}
					</article>
					<article className="panel panel-spacious">
						<h3>Issued Keys</h3>
						{settings.keys.length ? (
							<ul className="simple-list">
								{settings.keys.map((key) => (
									<li key={key.recordId}>
										<div>
											<strong>{key.label}</strong>
											<p>{accountLabel(key.user)}</p>
											<p className="simple-list-meta">
												{statusLabels[key.status]} · {key.writesEnabled ? 'Read and Write' : 'Read Only'}
												{' · '}{key.revokedAt ? `Revoked ${formatDateTimeAt(key.revokedAt)}` : `Created ${formatDateTimeAt(key.createdAt)}`}
											</p>
										</div>
										{key.status !== 'revoked' ? (
											<button type="button" className="btn-danger-soft" disabled={busy}
												aria-label={`Revoke Key: ${key.label}`} onClick={() => void revoke(key)}>Revoke Key</button>
										) : null}
									</li>
								))}
							</ul>
						) : <p className="panel-subtext">No API keys have been issued.</p>}
					</article>
				</>
			) : null}
		</section>
	);
}

export default function AdminApiKeysPage() {
	return <AdminGate><ApiKeySettings /></AdminGate>;
}
