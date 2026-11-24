'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import AdminGate from '@/app/components/admin-gate';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import { useToast } from '@/app/components/toast-provider';
import FormField from '@/app/components/form-field';
import LoadingIndicator from '@/app/components/loading-indicator';

const endpoint = '/api/admin/closer-gnome';

function CloserConnectionSettings() {
	const { requestConfirm } = useConfirmDialog();
	const toast = useToast();
	const [settings, setSettings] = useState(null);
	const [url, setUrl] = useState('');
	const [token, setToken] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');
	const addressField = useRef(null);
	const tokenField = useRef(null);

	useEffect(() => {
		const controller = new AbortController();
		setUrl(window.location.origin);
		async function load() {
			try {
				const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
				const data = await response.json();
				if (!response.ok) throw new Error(data.error || 'Could not load the integration settings.');
				if (!controller.signal.aborted) setSettings(data);
			} catch (failure) {
				if (!controller.signal.aborted) setError(failure.message);
			}
		}
		void load();
		return () => controller.abort();
	}, []);

	function update(field, value) {
		setSettings((current) => ({ ...current, [field]: value }));
		setStatus('');
	}

	async function copy(value, label, field) {
		try {
			await navigator.clipboard.writeText(value);
		} catch {
			field.current?.focus();
			field.current?.select();
			if (!document.execCommand('copy')) {
				toast.error('Copy the selected value with your keyboard.');
				return;
			}
		}
		toast.success(`${label} copied.`);
	}

	async function save(generateToken) {
		if (generateToken && settings.source !== 'none' && !(await requestConfirm({
			title: 'Replace integration token',
			message: 'The current token will stop working. Paste the new token into Closer Gnome to reconnect.',
			confirmLabel: 'Replace Token',
			isDanger: true
		}))) return;
		setBusy(true);
		setError('');
		setStatus('');
		try {
			const response = await fetch(endpoint, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					writesEnabled: settings.writesEnabled,
					ssoRedirectUri: settings.ssoRedirectUri, version: settings.version, generateToken
				})
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || 'Could not save the integration settings.');
			const { token: issued, ...saved } = data;
			setSettings((current) => ({ ...current, ...saved }));
			if (issued) setToken(issued);
			setStatus(issued ? 'Token generated. Copy it into Closer Gnome.' : 'Integration settings saved.');
		} catch (failure) {
			setError(failure.message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="module-page">
			<header className="module-header">
				<div><h2>Closer Gnome Connection</h2><p>Copy the address and token into Closer Gnome under Admin → Hire Gnome Connection.</p></div>
				<Link className="btn-secondary" href="/admin">Back to Admin</Link>
			</header>
			{error ? <p role="alert" className="panel-subtext">{error}</p> : null}
			{status ? <p role="status" className="panel-subtext">{status}</p> : null}
			{settings ? (
				<article className="panel panel-spacious panel-narrow">
					<form className="closer-connection-form" onSubmit={(event) => { event.preventDefault(); void save(!settings.usesServiceAccount); }}>
						<FormField label="Hire Gnome address" hint="Read only">
							<div className="closer-copy-field">
								<input ref={addressField} aria-label="Hire Gnome address" value={url} readOnly onFocus={(event) => event.target.select()} />
								<button type="button" className="btn-secondary" onClick={() => void copy(url, 'Address', addressField)}>Copy Address</button>
							</div>
						</FormField>
						{token ? (
							<>
								<FormField label="Integration token" hint="Read only">
									<div className="closer-copy-field">
										<input ref={tokenField} aria-label="Integration token" value={token} readOnly spellCheck={false} autoComplete="off" onFocus={(event) => event.target.select()} />
										<button type="button" className="btn-secondary" onClick={() => void copy(token, 'Token', tokenField)}>Copy Token</button>
									</div>
								</FormField>
								<p className="panel-subtext">Copy the token before leaving this page. It’s shown once.</p>
							</>
						) : (
							<p className="panel-subtext">{settings.source === 'environment' ? 'The current token is managed through environment settings.' :
								settings.usesServiceAccount ? 'A token is already active. Generate a replacement if you need a new copy.' :
								settings.source === 'admin' ? 'The current token uses a Hire Gnome user. Generate a new token to switch to the service account.' :
								'Generate a token to connect Closer Gnome.'}</p>
						)}
						<p className="panel-subtext">Hire Gnome uses a dedicated account for sync. Recruiters keep their own record access in Closer.</p>
						<label className="closer-write-option"><input type="checkbox" checked={settings.writesEnabled} onChange={(event) => update('writesEnabled', event.target.checked)} disabled={busy} />
							{' '}Allow Closer Gnome to sync changes to Hire Gnome
						</label>
						<FormField label="Sign-in callback URL" hint="Optional for single sign-on">
							<input aria-label="Sign-in callback URL" type="url" maxLength={2048} value={settings.ssoRedirectUri}
								onChange={(event) => update('ssoRedirectUri', event.target.value)}
								placeholder="https://crm.example.com/login/hire-gnome/callback" disabled={busy} />
						</FormField>
						<p className="panel-subtext">Use the callback URL shown in Closer Gnome under Admin → Hire Gnome Connection.</p>
						<div className="form-actions">
							<button type="submit" disabled={busy}>
								{settings.usesServiceAccount ? 'Save Settings' : 'Generate Token'}
							</button>
							{settings.usesServiceAccount ? (
								<button type="button" className="btn-secondary" disabled={busy} onClick={(event) => {
									if (event.currentTarget.form.reportValidity()) void save(true);
								}}>Replace Token</button>
							) : null}
						</div>
					</form>
				</article>
			) : !error ? <LoadingIndicator className="page-loading-indicator" label="Loading connection settings" /> : null}
		</section>
	);
}

export default function CloserGnomeAdminPage() {
	return <AdminGate><CloserConnectionSettings /></AdminGate>;
}
