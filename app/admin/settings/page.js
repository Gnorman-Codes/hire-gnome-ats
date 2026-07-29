'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import AdminGate from '@/app/components/admin-gate';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import FormField from '@/app/components/form-field';
import LoadingIndicator from '@/app/components/loading-indicator';
import { useToast } from '@/app/components/toast-provider';
import { THEME_OPTIONS } from '@/lib/theme-options';
import { toBooleanFlag } from '@/lib/boolean-flag';
import { formatDateTimeAt } from '@/lib/date-format';

const initialForm = {
	siteName: '',
	themeKey: 'classic_blue',
	careerSiteEnabled: false,
	clientPortalEnabled: true,
	careerHeroTitle: '',
	careerHeroBody: '',
	apiErrorLogRetentionDays: '90',
	removeLogo: false,
	googleMapsApiKey: '',
	openAiApiKey: '',
	objectStorageProvider: 's3',
	objectStorageRegion: 'us-east-1',
	objectStorageBucket: '',
	objectStorageEndpoint: '',
	objectStorageForcePathStyle: true,
	objectStorageAccessKeyId: '',
	objectStorageSecretAccessKey: '',
	smtpHost: '',
	smtpPort: '',
	smtpSecure: false,
	smtpUser: '',
	smtpPass: '',
	smtpFromName: '',
	smtpFromEmail: '',
	bullhornUsername: '',
	bullhornPassword: '',
	bullhornClientId: '',
	bullhornClientSecret: ''
};

function toDiagnosticsStatusLabel(status) {
	const normalized = String(status || '').trim().toLowerCase();
	if (normalized === 'pass') return 'Pass';
	if (normalized === 'warn') return 'Warning';
	if (normalized === 'fail') return 'Fail';
	return 'Info';
}

function toInboundEventStatusLabel(status) {
	const normalized = String(status || '').trim().toLowerCase();
	if (normalized === 'processed') return 'Processed';
	if (normalized === 'no_match') return 'No Match';
	if (normalized === 'failed') return 'Failed';
	return normalized ? normalized.replace(/_/g, ' ') : 'Unknown';
}

function toInboundEventStatusClassName(status) {
	const normalized = String(status || '').trim().toLowerCase();
	if (normalized === 'processed') return 'settings-diagnostics-status-pass';
	if (normalized === 'no_match') return 'settings-diagnostics-status-warn';
	if (normalized === 'failed') return 'settings-diagnostics-status-fail';
	return '';
}

export default function AdminSettingsPage() {
	const toast = useToast();
	const { requestPrompt } = useConfirmDialog();
	const [activeTab, setActiveTab] = useState('branding');
	const [loading, setLoading] = useState(true);
	const [brandingSaving, setBrandingSaving] = useState(false);
	const [platformSaving, setPlatformSaving] = useState(false);
	const [demoMode, setDemoMode] = useState(false);
	const [managedIntegrations, setManagedIntegrations] = useState(false);
	const [form, setForm] = useState(initialForm);
	const [savedForm, setSavedForm] = useState(initialForm);
	const [logoFile, setLogoFile] = useState(null);
	const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
	const [emailTestSettings, setEmailTestSettings] = useState({
		emailTestMode: false,
		emailTestRecipient: ''
	});
	const committedThemeRef = useRef('classic_blue');
	const [currentBranding, setCurrentBranding] = useState({
		siteName: '',
		logoUrl: '/branding/hire-gnome.png',
		themeKey: 'classic_blue',
		hasCustomLogo: false
	});
	const [diagnosticsState, setDiagnosticsState] = useState({
		running: false,
		loaded: false,
		error: '',
		result: null
	});
	const [diagnosticsExporting, setDiagnosticsExporting] = useState(false);
	const [sendingTestEmail, setSendingTestEmail] = useState(false);
	const [purgingData, setPurgingData] = useState(false);

	useEffect(() => {
		if (typeof document === 'undefined') return;
		const currentTheme = String(document.documentElement.getAttribute('data-theme') || '').trim();
		if (currentTheme) {
			committedThemeRef.current = currentTheme;
		}
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setLoading(true);
			const res = await fetch('/api/system-settings', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (!cancelled) {
					toast.error(data.error || 'Failed to load system settings.');
					setLoading(false);
				}
				return;
			}
			if (cancelled) return;
			setDemoMode(Boolean(data.demoMode));
			setManagedIntegrations(Boolean(data.managedIntegrations));
			committedThemeRef.current = data.themeKey || 'classic_blue';
			setCurrentBranding({
				siteName: data.siteName || '',
				logoUrl: data.logoUrl || '/branding/hire-gnome.png',
				themeKey: data.themeKey || 'classic_blue',
				hasCustomLogo: Boolean(data.hasCustomLogo)
			});
			const nextForm = buildFormFromSettings(data);
			setForm(nextForm);
			setSavedForm(nextForm);
			setEmailTestSettings({
				emailTestMode: Boolean(data.emailTestMode),
				emailTestRecipient: data.emailTestRecipient || ''
			});
			setLogoFile(null);
			setLogoPreviewUrl('');
			setLoading(false);
		}

		load();
		return () => {
			cancelled = true;
		};
	}, [toast]);

	useEffect(() => {
		if (!logoFile) {
			setLogoPreviewUrl('');
			return undefined;
		}
		const objectUrl = URL.createObjectURL(logoFile);
		setLogoPreviewUrl(objectUrl);
		return () => {
			URL.revokeObjectURL(objectUrl);
		};
	}, [logoFile]);

	useEffect(() => {
		if (typeof document === 'undefined') return;
		if (loading) return;
		const nextTheme = String(form.themeKey || '').trim() || 'classic_blue';
		document.documentElement.setAttribute('data-theme', nextTheme);
	}, [form.themeKey, loading]);

	useEffect(() => {
		return () => {
			if (typeof document === 'undefined') return;
			document.documentElement.setAttribute('data-theme', committedThemeRef.current || 'classic_blue');
		};
	}, []);

	const isS3ObjectStorage = form.objectStorageProvider !== 'local';
	const displayedLogo = logoPreviewUrl || (form.removeLogo ? '/branding/hire-gnome.png' : currentBranding.logoUrl);
	const brandingDirty = useMemo(
		() =>
			Boolean(logoFile)
			|| form.removeLogo
			|| String(form.siteName || '').trim() !== String(savedForm.siteName || '').trim()
			|| String(form.themeKey || '').trim() !== String(savedForm.themeKey || '').trim()
			|| Boolean(form.careerSiteEnabled) !== Boolean(savedForm.careerSiteEnabled)
			|| Boolean(form.clientPortalEnabled) !== Boolean(savedForm.clientPortalEnabled)
			|| String(form.careerHeroTitle || '').trim() !== String(savedForm.careerHeroTitle || '').trim()
			|| String(form.careerHeroBody || '').trim() !== String(savedForm.careerHeroBody || '').trim(),
		[
			form.careerSiteEnabled,
			form.careerHeroBody,
			form.careerHeroTitle,
			form.clientPortalEnabled,
			form.removeLogo,
			form.siteName,
			form.themeKey,
			logoFile,
			savedForm.careerSiteEnabled,
			savedForm.careerHeroBody,
			savedForm.careerHeroTitle,
			savedForm.clientPortalEnabled,
			savedForm.siteName,
			savedForm.themeKey
		]
	);
	const platformDirty = useMemo(
		() =>
			String(form.apiErrorLogRetentionDays || '') !== String(savedForm.apiErrorLogRetentionDays || '')
			|| String(form.bullhornUsername || '') !== String(savedForm.bullhornUsername || '')
			|| String(form.bullhornPassword || '') !== String(savedForm.bullhornPassword || '')
			|| String(form.bullhornClientId || '') !== String(savedForm.bullhornClientId || '')
			|| String(form.bullhornClientSecret || '') !== String(savedForm.bullhornClientSecret || '')
			|| (
				!managedIntegrations
				&& (
					String(form.googleMapsApiKey || '') !== String(savedForm.googleMapsApiKey || '')
					|| String(form.openAiApiKey || '') !== String(savedForm.openAiApiKey || '')
					|| String(form.smtpHost || '') !== String(savedForm.smtpHost || '')
					|| String(form.smtpPort || '') !== String(savedForm.smtpPort || '')
					|| Boolean(form.smtpSecure) !== Boolean(savedForm.smtpSecure)
					|| String(form.smtpUser || '') !== String(savedForm.smtpUser || '')
					|| String(form.smtpPass || '') !== String(savedForm.smtpPass || '')
					|| String(form.smtpFromName || '') !== String(savedForm.smtpFromName || '')
					|| String(form.smtpFromEmail || '') !== String(savedForm.smtpFromEmail || '')
					|| String(form.objectStorageProvider || '') !== String(savedForm.objectStorageProvider || '')
					|| String(form.objectStorageRegion || '') !== String(savedForm.objectStorageRegion || '')
					|| String(form.objectStorageBucket || '') !== String(savedForm.objectStorageBucket || '')
					|| String(form.objectStorageEndpoint || '') !== String(savedForm.objectStorageEndpoint || '')
					|| Boolean(form.objectStorageForcePathStyle) !== Boolean(savedForm.objectStorageForcePathStyle)
					|| String(form.objectStorageAccessKeyId || '') !== String(savedForm.objectStorageAccessKeyId || '')
					|| String(form.objectStorageSecretAccessKey || '') !== String(savedForm.objectStorageSecretAccessKey || '')
				)
			),
		[
			form.apiErrorLogRetentionDays,
			form.googleMapsApiKey,
			form.objectStorageAccessKeyId,
			form.objectStorageBucket,
			form.objectStorageEndpoint,
			form.objectStorageForcePathStyle,
			form.objectStorageProvider,
			form.objectStorageRegion,
			form.objectStorageSecretAccessKey,
			form.openAiApiKey,
			form.smtpFromEmail,
			form.smtpFromName,
			form.smtpHost,
			form.smtpPass,
			form.smtpPort,
			form.smtpSecure,
			form.smtpUser,
			form.bullhornUsername,
			form.bullhornPassword,
			form.bullhornClientId,
			form.bullhornClientSecret,
			managedIntegrations,
			savedForm.apiErrorLogRetentionDays,
			savedForm.googleMapsApiKey,
			savedForm.objectStorageAccessKeyId,
			savedForm.objectStorageBucket,
			savedForm.objectStorageEndpoint,
			savedForm.objectStorageForcePathStyle,
			savedForm.objectStorageProvider,
			savedForm.objectStorageRegion,
			savedForm.objectStorageSecretAccessKey,
			savedForm.openAiApiKey,
			savedForm.smtpFromEmail,
			savedForm.smtpFromName,
			savedForm.smtpHost,
			savedForm.smtpPass,
			savedForm.smtpPort,
			savedForm.smtpSecure,
			savedForm.smtpUser,
			savedForm.bullhornUsername,
			savedForm.bullhornPassword,
			savedForm.bullhornClientId,
			savedForm.bullhornClientSecret
		]
	);
	const canSaveBranding = Boolean(form.siteName.trim()) && !loading && !brandingSaving;
	const canSavePlatform = !demoMode && !loading && !platformSaving;

	function buildFormFromSettings(data, fallback = initialForm) {
		const integrationFallback = data.managedIntegrations ? initialForm : fallback;
		return {
			siteName: data.siteName || fallback.siteName || '',
			themeKey: data.themeKey || fallback.themeKey || 'classic_blue',
			careerSiteEnabled: toBooleanFlag(
				data.careerSiteEnabled,
				toBooleanFlag(fallback.careerSiteEnabled, false)
			),
			clientPortalEnabled: toBooleanFlag(
				data.clientPortalEnabled,
				toBooleanFlag(fallback.clientPortalEnabled, true)
			),
			careerHeroTitle: data.careerHeroTitle ?? fallback.careerHeroTitle ?? '',
			careerHeroBody: data.careerHeroBody ?? fallback.careerHeroBody ?? '',
			apiErrorLogRetentionDays: String(data.apiErrorLogRetentionDays || fallback.apiErrorLogRetentionDays || 90),
			removeLogo: false,
			googleMapsApiKey: data.googleMapsApiKey ?? integrationFallback.googleMapsApiKey ?? '',
			openAiApiKey: data.openAiApiKey ?? integrationFallback.openAiApiKey ?? '',
			objectStorageProvider: data.objectStorageProvider || integrationFallback.objectStorageProvider || 's3',
			objectStorageRegion: data.objectStorageRegion || integrationFallback.objectStorageRegion || 'us-east-1',
			objectStorageBucket: data.objectStorageBucket ?? integrationFallback.objectStorageBucket ?? '',
			objectStorageEndpoint: data.objectStorageEndpoint ?? integrationFallback.objectStorageEndpoint ?? '',
			objectStorageForcePathStyle:
				typeof data.objectStorageForcePathStyle === 'boolean'
					? data.objectStorageForcePathStyle
					: typeof integrationFallback.objectStorageForcePathStyle === 'boolean'
						? integrationFallback.objectStorageForcePathStyle
						: true,
			objectStorageAccessKeyId: data.objectStorageAccessKeyId ?? integrationFallback.objectStorageAccessKeyId ?? '',
			objectStorageSecretAccessKey: data.objectStorageSecretAccessKey ?? integrationFallback.objectStorageSecretAccessKey ?? '',
			smtpHost: data.smtpHost ?? integrationFallback.smtpHost ?? '',
			smtpPort: data.smtpPort == null ? String(integrationFallback.smtpPort ?? '') : String(data.smtpPort),
			smtpSecure:
				typeof data.smtpSecure === 'boolean'
					? data.smtpSecure
					: Boolean(integrationFallback.smtpSecure),
			smtpUser: data.smtpUser ?? integrationFallback.smtpUser ?? '',
			smtpPass: data.smtpPass ?? integrationFallback.smtpPass ?? '',
			smtpFromName: data.smtpFromName ?? integrationFallback.smtpFromName ?? data.siteName ?? fallback.siteName ?? '',
			smtpFromEmail: data.smtpFromEmail ?? integrationFallback.smtpFromEmail ?? '',
			bullhornUsername: data.bullhornUsername ?? fallback.bullhornUsername ?? '',
			bullhornPassword: data.bullhornPassword ?? fallback.bullhornPassword ?? '',
			bullhornClientId: data.bullhornClientId ?? fallback.bullhornClientId ?? '',
			bullhornClientSecret: data.bullhornClientSecret ?? fallback.bullhornClientSecret ?? ''
		};
	}

	async function onSaveBranding(event) {
		event.preventDefault();
		if (!canSaveBranding || !brandingDirty) return;

		setBrandingSaving(true);
		const payload = new FormData();
		payload.set('siteName', form.siteName);
		payload.set('themeKey', form.themeKey);
		payload.set('careerSiteEnabled', form.careerSiteEnabled ? 'true' : 'false');
		payload.set('clientPortalEnabled', form.clientPortalEnabled ? 'true' : 'false');
		payload.set('careerHeroTitle', form.careerHeroTitle);
		payload.set('careerHeroBody', form.careerHeroBody);
		payload.set('removeLogo', form.removeLogo ? 'true' : 'false');
		if (logoFile) {
			payload.set('logoFile', logoFile);
		}

		const res = await fetch('/api/system-settings', {
			method: 'PATCH',
			body: payload
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			toast.error(data.error || 'Failed to save branding settings.');
			setBrandingSaving(false);
			return;
		}

		setCurrentBranding({
			siteName: data.siteName || form.siteName,
			logoUrl: data.logoUrl || '/branding/hire-gnome.png',
			themeKey: data.themeKey || form.themeKey || 'classic_blue',
			hasCustomLogo: Boolean(data.hasCustomLogo)
		});
		committedThemeRef.current = data.themeKey || form.themeKey || 'classic_blue';
		const nextForm = buildFormFromSettings(data, form);
		setForm(nextForm);
		setSavedForm(nextForm);
		setEmailTestSettings({
			emailTestMode: Boolean(data.emailTestMode),
			emailTestRecipient: data.emailTestRecipient || ''
		});
		setLogoFile(null);
		setLogoPreviewUrl('');
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('hg:branding-updated', {
					detail: {
						siteName: data.siteName || form.siteName,
						logoUrl: data.logoUrl || '/branding/hire-gnome.png',
						themeKey: data.themeKey || form.themeKey || 'classic_blue',
						careerSiteEnabled: toBooleanFlag(data.careerSiteEnabled, false),
						clientPortalEnabled: toBooleanFlag(data.clientPortalEnabled, true),
						hasCustomLogo: Boolean(data.hasCustomLogo)
					}
				})
			);
		}
		toast.success(data.message || 'Branding updated.');
		setBrandingSaving(false);
	}

	async function onSavePlatformSettings(event) {
		event.preventDefault();
		if (demoMode || !canSavePlatform || !platformDirty) return;

		setPlatformSaving(true);
		const payload = new FormData();
		payload.set('apiErrorLogRetentionDays', form.apiErrorLogRetentionDays || '90');
		if (!managedIntegrations) {
			payload.set('googleMapsApiKey', form.googleMapsApiKey);
			payload.set('openAiApiKey', form.openAiApiKey);
			payload.set('objectStorageProvider', form.objectStorageProvider);
			payload.set('objectStorageRegion', form.objectStorageRegion);
			payload.set('objectStorageBucket', form.objectStorageBucket);
			payload.set('objectStorageEndpoint', form.objectStorageEndpoint);
			payload.set('objectStorageForcePathStyle', form.objectStorageForcePathStyle ? 'true' : 'false');
			payload.set('objectStorageAccessKeyId', form.objectStorageAccessKeyId);
			payload.set('objectStorageSecretAccessKey', form.objectStorageSecretAccessKey);
			payload.set('smtpHost', form.smtpHost);
			payload.set('smtpPort', form.smtpPort);
			payload.set('smtpSecure', form.smtpSecure ? 'true' : 'false');
			payload.set('smtpUser', form.smtpUser);
			payload.set('smtpPass', form.smtpPass);
			payload.set('smtpFromName', form.smtpFromName);
			payload.set('smtpFromEmail', form.smtpFromEmail);
		}
		payload.set('bullhornUsername', form.bullhornUsername);
		payload.set('bullhornPassword', form.bullhornPassword);
		payload.set('bullhornClientId', form.bullhornClientId);
		payload.set('bullhornClientSecret', form.bullhornClientSecret);

		const res = await fetch('/api/system-settings', {
			method: 'PATCH',
			body: payload
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			toast.error(data.error || 'Failed to save platform settings.');
			setPlatformSaving(false);
			return;
		}

		const nextForm = buildFormFromSettings(data, form);
		setForm(nextForm);
		setSavedForm(nextForm);
		toast.success(data.message || 'Platform settings updated.');
		setPlatformSaving(false);
	}

	async function onSendTestEmail() {
			if (managedIntegrations || demoMode || loading || platformSaving || brandingSaving || sendingTestEmail) return;
		setSendingTestEmail(true);

		try {
			const res = await fetch('/api/admin/system-settings/email-test', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					siteName: form.siteName,
					smtpHost: form.smtpHost,
					smtpPort: form.smtpPort,
					smtpSecure: form.smtpSecure,
					smtpUser: form.smtpUser,
					smtpPass: form.smtpPass,
					smtpFromName: form.smtpFromName,
					smtpFromEmail: form.smtpFromEmail
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(data.error || 'Failed to send test email.');
				return;
			}
			toast.success(data.message || 'Test email sent.');
		} catch (error) {
			toast.error(error?.message || 'Failed to send test email.');
		} finally {
			setSendingTestEmail(false);
		}
	}

	async function onRunDiagnostics() {
		if (diagnosticsState.running) return;
		setDiagnosticsState((current) => ({
			...current,
			running: true,
			error: ''
		}));

		try {
			const res = await fetch('/api/admin/diagnostics', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				const errorMessage = data.error || 'Failed to run diagnostics.';
				setDiagnosticsState((current) => ({
					...current,
					running: false,
					loaded: false,
					error: errorMessage,
					result: null
				}));
				toast.error(errorMessage);
				return;
			}

			setDiagnosticsState({
				running: false,
				loaded: true,
				error: '',
				result: data
			});

			if (data?.summary?.failCount > 0) {
				toast.error(`Diagnostics completed with ${data.summary.failCount} failure(s).`);
				return;
			}

			if (data?.summary?.warnCount > 0) {
				toast.info(`Diagnostics completed with ${data.summary.warnCount} warning(s).`);
				return;
			}

			toast.success('Diagnostics passed.');
		} catch (error) {
			const errorMessage = error?.message || 'Failed to run diagnostics.';
			setDiagnosticsState((current) => ({
				...current,
				running: false,
				loaded: false,
				error: errorMessage,
				result: null
			}));
			toast.error(errorMessage);
		}
	}

	async function onExportDiagnostics() {
		if (diagnosticsExporting || diagnosticsState.running) return;
		setDiagnosticsExporting(true);
		try {
			const res = await fetch('/api/admin/diagnostics?format=markdown', { cache: 'no-store' });
			if (!res.ok) {
				const payload = await res.json().catch(() => ({}));
				throw new Error(payload.error || 'Failed to export diagnostics report.');
			}
			const reportText = await res.text();
			const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' });
			const objectUrl = URL.createObjectURL(blob);
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = `diagnostics-${timestamp}.md`;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(objectUrl);
			toast.success('Diagnostics report downloaded.');
		} catch (error) {
			toast.error(error?.message || 'Failed to export diagnostics report.');
		} finally {
			setDiagnosticsExporting(false);
		}
	}

	async function onPurgeOperationalData() {
		if (purgingData) return;

		let challenge;
		try {
			const res = await fetch('/api/admin/purge-data', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(data.error || 'Failed to generate purge confirmation.');
				return;
			}
			challenge = data;
		} catch {
			toast.error('Failed to generate purge confirmation.');
			return;
		}

		const confirmation = await requestPrompt({
			title: 'Purge Operational Data',
			message: String(challenge.description || '').trim() || 'This permanently deletes operational ATS data while preserving users and core configuration.',
			inputLabel: `Type ${challenge.word} to continue`,
			confirmLabel: 'Purge Data',
			cancelLabel: 'Keep Data',
			required: true,
			isDanger: true
		});
		if (!confirmation) return;

		if (String(confirmation).trim().toUpperCase() !== String(challenge.word || '').trim().toUpperCase()) {
			toast.error('The confirmation word did not match. No data was purged.');
			return;
		}

		setPurgingData(true);
		try {
			const res = await fetch('/api/admin/purge-data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					word: challenge.word,
					token: challenge.token,
					confirmation
				})
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(data.error || 'Failed to purge operational data.');
				return;
			}
			const totalPurged = Array.isArray(data.summary)
				? data.summary.reduce((sum, item) => sum + Number(item?.count || 0), 0)
				: 0;
			toast.success(`Purged ${totalPurged} operational records.`);
			setDiagnosticsState((current) => ({
				...current,
				loaded: false,
				result: null,
				error: ''
			}));
		} catch {
			toast.error('Failed to purge operational data.');
		} finally {
			setPurgingData(false);
		}
	}

	return (
		<AdminGate>
			<section className="module-page">
				<header className="module-header">
					<div>
						<Link href="/admin" className="module-back-link" aria-label="Back to List">&larr; Back</Link>
						<h2>System Settings</h2>
						<p>Manage branding, integrations, and email delivery settings.</p>
					</div>
				</header>

				{loading ? <LoadingIndicator className="page-loading-indicator" label="Loading system settings" /> : null}

				{!loading ? (
						<>
							<div className="admin-settings-tabs" role="tablist" aria-label="System settings sections">
								<button
									type="button"
									role="tab"
									aria-selected={activeTab === 'branding'}
									className={`admin-settings-tab ${activeTab === 'branding' ? 'is-active' : ''}`}
									onClick={() => setActiveTab('branding')}
								>
									Branding
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={activeTab === 'platform'}
									className={`admin-settings-tab ${activeTab === 'platform' ? 'is-active' : ''}`}
									onClick={() => setActiveTab('platform')}
								>
									Platform Settings
								</button>
								<button
									type="button"
									role="tab"
									aria-selected={activeTab === 'diagnostics'}
									className={`admin-settings-tab ${activeTab === 'diagnostics' ? 'is-active' : ''}`}
									onClick={() => setActiveTab('diagnostics')}
								>
									Diagnostics
								</button>
							</div>

							{activeTab === 'branding' ? (
							<article className="panel panel-spacious panel-narrow">
								<form onSubmit={onSaveBranding} className="detail-form">
									<section className="form-section">
								<h4>Branding</h4>
								{demoMode ? (
									<p className="panel-subtext">Demo mode is enabled. Branding can still be changed here.</p>
								) : null}
								<FormField label="Site Name" required>
									<input
										value={form.siteName}
										onChange={(event) => setForm((current) => ({ ...current, siteName: event.target.value }))}
										required
									/>
								</FormField>

								<FormField label="Theme Preset">
									<select
										value={form.themeKey}
										onChange={(event) => setForm((current) => ({ ...current, themeKey: event.target.value }))}
									>
										{THEME_OPTIONS.map((theme) => (
											<option key={theme.value} value={theme.value}>
												{theme.label}
											</option>
										))}
									</select>
								</FormField>
								<FormField label="Career Hero Title" hint="Shown as the primary headline on the public careers page.">
									<input
										value={form.careerHeroTitle}
										onChange={(event) =>
											setForm((current) => ({ ...current, careerHeroTitle: event.target.value }))
										}
										placeholder="Find your next placement opportunity."
									/>
								</FormField>
								<FormField label="Career Hero Body" hint="Short supporting copy shown under the public careers headline.">
									<textarea
										rows={3}
										value={form.careerHeroBody}
										onChange={(event) =>
											setForm((current) => ({ ...current, careerHeroBody: event.target.value }))
										}
										placeholder="Explore active roles across healthcare, technology, and professional services. Apply directly through the listing in under two minutes."
									/>
								</FormField>

								<div className="branding-logo-controls">
									<FormField label="Logo Image" hint="PNG, JPG, WEBP, or SVG. Max 5 MB. Recommended: 1200 x 320 (wide, transparent background preferred).">
										<input
											type="file"
											accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
											onChange={(event) => {
												const file = event.target.files?.[0] || null;
												setLogoFile(file);
												if (file) {
													setForm((current) => ({ ...current, removeLogo: false }));
												}
											}}
										/>
									</FormField>

									<label className="switch-field">
										<input
											type="checkbox"
											className="switch-input"
											checked={form.removeLogo}
											onChange={(event) => {
												const checked = event.target.checked;
												setForm((current) => ({ ...current, removeLogo: checked }));
												if (checked) {
													setLogoFile(null);
												}
											}}
										/>
										<span className="switch-track" aria-hidden="true">
											<span className="switch-thumb" />
										</span>
										<span className="switch-copy">
											<span className="switch-label">Use Default Logo</span>
											<span className="switch-hint">Turn on to remove the uploaded custom logo.</span>
										</span>
									</label>

									<div className="branding-preview-card">
										<p className="branding-preview-label">Preview</p>
										<img src={displayedLogo} alt={form.siteName || 'Site logo preview'} className="branding-preview-logo" />
									</div>
								</div>
								<label className="switch-field">
									<input
										type="checkbox"
										className="switch-input"
										checked={form.careerSiteEnabled}
										onChange={(event) =>
											setForm((current) => ({ ...current, careerSiteEnabled: event.target.checked }))
										}
									/>
									<span className="switch-track" aria-hidden="true">
										<span className="switch-thumb" />
									</span>
									<span className="switch-copy">
										<span className="switch-label">Public Career Site</span>
										<span className="switch-hint">Enable to publish `/careers` and accept applications.</span>
									</span>
								</label>
								<label className="switch-field">
									<input
										type="checkbox"
										className="switch-input"
										checked={form.clientPortalEnabled}
										onChange={(event) =>
											setForm((current) => ({ ...current, clientPortalEnabled: event.target.checked }))
										}
									/>
									<span className="switch-track" aria-hidden="true">
										<span className="switch-thumb" />
									</span>
									<span className="switch-copy">
										<span className="switch-label">Client Review Portal</span>
										<span className="switch-hint">Enable external client review links on job orders.</span>
									</span>
								</label>
							</section>
							<div className="form-actions">
								<button type="submit" disabled={!canSaveBranding || !brandingDirty}>
									{brandingSaving ? 'Saving Branding...' : 'Save Branding'}
								</button>
							</div>
							</form>
						</article>
							) : null}

						{activeTab === 'platform' ? (
						<article className="panel panel-spacious panel-narrow">
							<form onSubmit={onSavePlatformSettings} className="detail-form">
							{managedIntegrations ? (
								<section className="form-section">
									<h4>Managed Hosting</h4>
									<p className="panel-subtext">
										Email delivery, AI, maps, and file storage are configured and maintained by your hosting provider.
									</p>
								</section>
							) : null}
							<section className="form-section">
								<h4>{managedIntegrations ? 'Platform Operations' : 'Integrations'}</h4>
								{demoMode ? (
									<p className="panel-subtext">Demo mode is enabled. Integration settings are read-only here.</p>
								) : null}
								{!managedIntegrations ? (
									<>
								<FormField label="Google Maps API Key" hint="Used for address autocomplete and place details. Leave blank to disable Google address lookup.">
									<input
										type="password"
										value={form.googleMapsApiKey}
										onChange={(event) =>
											setForm((current) => ({ ...current, googleMapsApiKey: event.target.value }))
										}
										disabled={demoMode}
									/>
								</FormField>
								<FormField label="OpenAI API Key" hint="Used for AI resume parsing. Leave blank to use the fallback parser only.">
									<input
										type="password"
										value={form.openAiApiKey}
										onChange={(event) =>
											setForm((current) => ({ ...current, openAiApiKey: event.target.value }))
										}
										disabled={demoMode}
									/>
								</FormField>
									</>
								) : null}
								<FormField label="API Error Log Retention (days)" hint="Old API error logs are automatically removed after this many days.">
									<input
										type="number"
										min="1"
										max="3650"
										value={form.apiErrorLogRetentionDays}
										onChange={(event) =>
											setForm((current) => ({ ...current, apiErrorLogRetentionDays: event.target.value }))
										}
										disabled={demoMode}
									/>
								</FormField>
							</section>

							{!managedIntegrations ? (
							<section className="form-section">
								<h4>Email Delivery (SMTP)</h4>
								<div className="form-grid-2">
									<FormField label="SMTP Host">
										<input
											value={form.smtpHost}
											onChange={(event) => setForm((current) => ({ ...current, smtpHost: event.target.value }))}
											disabled={demoMode}
										/>
									</FormField>
									<FormField label="SMTP Port">
										<input
											type="number"
											min="1"
											value={form.smtpPort}
											onChange={(event) => setForm((current) => ({ ...current, smtpPort: event.target.value }))}
											disabled={demoMode}
										/>
									</FormField>
								</div>
								<div className="form-grid-2">
									<FormField label="SMTP Username">
										<input
											value={form.smtpUser}
											onChange={(event) => setForm((current) => ({ ...current, smtpUser: event.target.value }))}
											disabled={demoMode}
										/>
									</FormField>
									<FormField label="SMTP Password">
										<input
											type="password"
											value={form.smtpPass}
											onChange={(event) => setForm((current) => ({ ...current, smtpPass: event.target.value }))}
											disabled={demoMode}
										/>
									</FormField>
								</div>
								<div className="form-grid-2">
									<FormField label="From Name">
										<input
											value={form.smtpFromName}
											onChange={(event) =>
												setForm((current) => ({ ...current, smtpFromName: event.target.value }))
											}
											disabled={demoMode}
										/>
									</FormField>
									<FormField label="From Email">
										<input
											type="email"
											value={form.smtpFromEmail}
											onChange={(event) =>
												setForm((current) => ({ ...current, smtpFromEmail: event.target.value }))
											}
											disabled={demoMode}
										/>
									</FormField>
								</div>
								<label className="switch-field">
									<input
										type="checkbox"
										className="switch-input"
										checked={form.smtpSecure}
										onChange={(event) =>
											setForm((current) => ({ ...current, smtpSecure: event.target.checked }))
										}
										disabled={demoMode}
									/>
									<span className="switch-track" aria-hidden="true">
										<span className="switch-thumb" />
									</span>
									<span className="switch-copy">
										<span className="switch-label">Use Secure SMTP (TLS/SSL)</span>
										<span className="switch-hint">Enable when your mail server requires secure mode.</span>
									</span>
								</label>
								<p className="panel-subtext">
									Outgoing emails stay disabled until required SMTP values are configured.
								</p>
								<div className="form-actions">
									<button
										type="button"
										className="btn-secondary"
										onClick={onSendTestEmail}
										disabled={demoMode || loading || platformSaving || brandingSaving || sendingTestEmail}
									>
										{sendingTestEmail ? 'Sending Test Email...' : 'Send Test Email'}
									</button>
								</div>
								<p className="panel-subtext">
									{emailTestSettings.emailTestMode
										? `EMAIL_TEST_MODE is enabled. Outbound email is routed to ${emailTestSettings.emailTestRecipient || 'EMAIL_TEST_RECIPIENT'}.`
										: 'Test email is sent to your signed-in administrator email address.'}
									</p>
								</section>
							) : null}

							<section className="form-section">
								<h4>Bullhorn Export</h4>
								<p className="panel-subtext">
									Store Bullhorn API credentials here so administrators can run background exports without re-entering them each time.
								</p>
								<div className="form-grid-2">
									<FormField label="Username">
										<input
											value={form.bullhornUsername}
											onChange={(event) =>
												setForm((current) => ({ ...current, bullhornUsername: event.target.value }))
											}
											disabled={demoMode}
										/>
									</FormField>
									<FormField label="Password">
										<input
											type="password"
											autoComplete="new-password"
											value={form.bullhornPassword}
											onChange={(event) =>
												setForm((current) => ({ ...current, bullhornPassword: event.target.value }))
											}
											disabled={demoMode}
										/>
									</FormField>
								</div>
								<div className="form-grid-2">
									<FormField label="Client ID">
										<input
											value={form.bullhornClientId}
											onChange={(event) =>
												setForm((current) => ({ ...current, bullhornClientId: event.target.value }))
											}
											disabled={demoMode}
										/>
									</FormField>
									<FormField label="Client Secret">
										<input
											type="password"
											autoComplete="new-password"
											value={form.bullhornClientSecret}
											onChange={(event) =>
												setForm((current) => ({ ...current, bullhornClientSecret: event.target.value }))
											}
											disabled={demoMode}
										/>
									</FormField>
								</div>
							</section>

							{!managedIntegrations ? (
							<section className="form-section">
								<h4>Object Storage</h4>
								<div className="form-grid-2">
									<FormField label="Provider">
										<select
											value={form.objectStorageProvider}
											onChange={(event) =>
												setForm((current) => ({ ...current, objectStorageProvider: event.target.value }))
											}
											disabled={demoMode}
										>
											<option value="s3">S3 / S3-Compatible</option>
											<option value="local">Local Filesystem</option>
										</select>
									</FormField>
									<FormField label="Region">
										<input
											value={form.objectStorageRegion}
											onChange={(event) =>
												setForm((current) => ({ ...current, objectStorageRegion: event.target.value }))
											}
											disabled={demoMode || !isS3ObjectStorage}
										/>
									</FormField>
								</div>
								<div className="form-grid-2">
									<FormField label="Bucket">
										<input
											value={form.objectStorageBucket}
											onChange={(event) =>
												setForm((current) => ({ ...current, objectStorageBucket: event.target.value }))
											}
											disabled={demoMode || !isS3ObjectStorage}
										/>
									</FormField>
									<FormField label="Endpoint (optional)">
										<input
											type="url"
											value={form.objectStorageEndpoint}
											onChange={(event) =>
												setForm((current) => ({ ...current, objectStorageEndpoint: event.target.value }))
											}
											disabled={demoMode || !isS3ObjectStorage}
										/>
									</FormField>
								</div>
								<div className="form-grid-2">
									<FormField label="Access Key ID">
										<input
											type="password"
											autoComplete="new-password"
											value={form.objectStorageAccessKeyId}
											onChange={(event) =>
												setForm((current) => ({ ...current, objectStorageAccessKeyId: event.target.value }))
											}
											disabled={demoMode || !isS3ObjectStorage}
										/>
									</FormField>
									<FormField label="Secret Access Key">
										<input
											type="password"
											autoComplete="new-password"
											value={form.objectStorageSecretAccessKey}
											onChange={(event) =>
												setForm((current) => ({ ...current, objectStorageSecretAccessKey: event.target.value }))
											}
											disabled={demoMode || !isS3ObjectStorage}
										/>
									</FormField>
								</div>
								<label className="switch-field">
									<input
										type="checkbox"
										className="switch-input"
										checked={form.objectStorageForcePathStyle}
										onChange={(event) =>
											setForm((current) => ({
												...current,
												objectStorageForcePathStyle: event.target.checked
											}))
										}
										disabled={demoMode || !isS3ObjectStorage}
									/>
									<span className="switch-track" aria-hidden="true">
										<span className="switch-thumb" />
									</span>
									<span className="switch-copy">
										<span className="switch-label">Force Path Style</span>
										<span className="switch-hint">Enable for S3-compatible endpoints that require path-style URLs.</span>
									</span>
								</label>
								<p className="panel-subtext">
									If S3 values are incomplete, uploads automatically fall back to local storage.
								</p>
							</section>
							) : null}

							<div className="form-actions">
								<button type="submit" disabled={!canSavePlatform || !platformDirty}>
									{platformSaving ? 'Saving Platform Settings...' : 'Save Platform Settings'}
								</button>
							</div>
							</form>
						</article>
						) : null}

						{activeTab === 'diagnostics' ? (
						<article className="panel panel-spacious panel-narrow">
							<section className="form-section">
								<h4>System Diagnostics</h4>
								<p className="panel-subtext">
									Run operational checks for environment, database, integrations, storage, and alerting.
								</p>
								<div className="settings-diagnostics-toolbar">
									<button type="button" onClick={onRunDiagnostics} disabled={diagnosticsState.running}>
										{diagnosticsState.running ? 'Running Diagnostics...' : 'Run Diagnostics'}
									</button>
									<button
										type="button"
										className="btn-secondary"
										onClick={onExportDiagnostics}
										disabled={
											diagnosticsState.running
											|| diagnosticsExporting
											|| !diagnosticsState.loaded
											|| !diagnosticsState.result
										}
									>
										{diagnosticsExporting ? 'Exporting...' : 'Export Report'}
									</button>
									{diagnosticsState.loaded && diagnosticsState.result ? (
										<p className="panel-subtext">
											Last run: <strong>{formatDateTimeAt(diagnosticsState.result.generatedAt)}</strong>
										</p>
									) : null}
								</div>
								{diagnosticsState.error ? <p className="panel-subtext error">{diagnosticsState.error}</p> : null}
								{diagnosticsState.loaded && diagnosticsState.result?.summary ? (
									<p className="panel-subtext">
										{`Checks: ${diagnosticsState.result.summary.total} | Pass: ${diagnosticsState.result.summary.passCount} | Warnings: ${diagnosticsState.result.summary.warnCount} | Failures: ${diagnosticsState.result.summary.failCount}`}
									</p>
								) : null}
								{diagnosticsState.loaded && Array.isArray(diagnosticsState.result?.checks) ? (
									<ul className="settings-diagnostics-list">
										{diagnosticsState.result.checks.map((check) => (
											<li key={check.key} className="settings-diagnostics-item">
												<div className="settings-diagnostics-head">
													<strong>{check.label}</strong>
													<span className={`settings-diagnostics-status settings-diagnostics-status-${check.status}`}>
														{toDiagnosticsStatusLabel(check.status)}
													</span>
												</div>
												<p className="panel-subtext">{check.message}</p>
											</li>
										))}
									</ul>
								) : null}
								{diagnosticsState.loaded ? (
									<div className="settings-diagnostics-inbound-block">
										<h5>Recent Inbound Email Events</h5>
										{Array.isArray(diagnosticsState.result?.recentInboundEmails)
											&& diagnosticsState.result.recentInboundEmails.length > 0 ? (
												<ul className="settings-diagnostics-list">
													{diagnosticsState.result.recentInboundEmails.map((event) => (
														<li key={event.id} className="settings-diagnostics-item">
															<div className="settings-diagnostics-head">
																<strong>{event.subject || '(No subject)'}</strong>
																<span
																	className={`settings-diagnostics-status ${toInboundEventStatusClassName(event.status)}`.trim()}
																>
																	{toInboundEventStatusLabel(event.status)}
																</span>
															</div>
															<p className="panel-subtext">
																From: <strong>{event.fromEmail || '-'}</strong>
															</p>
															<p className="panel-subtext">
																Matches: Candidates {event.matchedCandidates ?? 0} | Contacts {event.matchedContacts ?? 0}
															</p>
															<p className="panel-subtext">
																Notes: {event.notesCreated ?? 0} | Candidate Files: {event.attachmentsSaved ?? 0}
															</p>
															{event.attachmentDiagnosticsSummary ? (
																<p className="panel-subtext">
																	Attachment diagnostics: <strong>{event.attachmentDiagnosticsSummary}</strong>
																</p>
															) : null}
															<p className="panel-subtext">
																Received: <strong>{formatDateTimeAt(event.createdAt)}</strong>
															</p>
														</li>
													))}
												</ul>
											) : (
												<p className="panel-subtext">No inbound email events recorded yet.</p>
											)}
									</div>
								) : null}
								<hr />
								<div className="settings-diagnostics-danger">
									<h5>Purge Operational Data</h5>
									<p className="panel-subtext">
										Delete operational ATS records and migration artifacts while preserving users, divisions, system settings, skills, custom field definitions, and zip codes.
									</p>
									<p className="panel-subtext error">
										This action is destructive and cannot be undone. You will have to type a confirmation word before the purge runs.
									</p>
									<div className="form-actions">
										<button
											type="button"
											className="btn-danger"
											onClick={onPurgeOperationalData}
											disabled={purgingData}
										>
											{purgingData ? 'Purging Data...' : 'Purge Data'}
										</button>
									</div>
								</div>
							</section>
						</article>
						) : null}
					</>
				) : null}
			</section>
		</AdminGate>
	);
}
