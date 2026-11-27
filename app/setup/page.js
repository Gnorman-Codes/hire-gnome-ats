'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import FormField from '@/app/components/form-field';
import LoadingIndicator from '@/app/components/loading-indicator';
import { useToast } from '@/app/components/toast-provider';
import useSystemBranding from '@/app/hooks/use-system-branding';
import { DEFAULT_THEME_KEY, THEME_OPTIONS } from '@/lib/theme-options.cjs';
import { isValidEmailAddress } from '@/lib/email-validation';

const INITIAL_FORM = {
	siteName: 'Hire Gnome ATS',
	themeKey: DEFAULT_THEME_KEY,
	firstName: '',
	lastName: '',
	email: '',
	password: '',
	confirmPassword: ''
};

export default function SetupPage() {
	const router = useRouter();
	const toast = useToast();
	const branding = useSystemBranding();
	const [checkingState, setCheckingState] = useState(true);
	const [saving, setSaving] = useState(false);
	const [form, setForm] = useState(INITIAL_FORM);
	const [logoFile, setLogoFile] = useState(null);
	const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
	const initialThemeRef = useRef('');
	const setupCompletedRef = useRef(false);

	useEffect(() => {
		let cancelled = false;

		async function checkStatus() {
			const res = await fetch('/api/onboarding/status', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			if (cancelled) return;

			if (!res.ok) {
				toast.error('Failed to load onboarding status.');
				setCheckingState(false);
				return;
			}

			if (!data.needsOnboarding) {
				router.replace('/login');
				return;
			}

			setCheckingState(false);
		}

		checkStatus();
		return () => {
			cancelled = true;
		};
	}, [router, toast]);

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
		if (!initialThemeRef.current) {
			initialThemeRef.current =
				String(document.documentElement.getAttribute('data-theme') || '').trim() || DEFAULT_THEME_KEY;
		}
	}, []);

	useEffect(() => {
		if (typeof document === 'undefined') return;
		const nextTheme = String(form.themeKey || '').trim() || DEFAULT_THEME_KEY;
		document.documentElement.setAttribute('data-theme', nextTheme);
	}, [form.themeKey]);

	useEffect(() => {
		return () => {
			if (typeof document === 'undefined') return;
			if (setupCompletedRef.current) return;
			if (!initialThemeRef.current) return;
			document.documentElement.setAttribute('data-theme', initialThemeRef.current);
		};
	}, []);

	useEffect(() => {
		setForm((current) => {
			if (current.siteName !== INITIAL_FORM.siteName) {
				return current;
			}
			const nextSiteName = String(branding.siteName || '').trim();
			if (!nextSiteName || nextSiteName === current.siteName) {
				return current;
			}
			return {
				...current,
				siteName: nextSiteName
			};
		});
	}, [branding.siteName]);

	const canSubmit = useMemo(() => {
		if (checkingState || saving) return false;
		if (!form.siteName.trim()) return false;
		if (!form.firstName.trim()) return false;
		if (!form.lastName.trim()) return false;
		if (!isValidEmailAddress(form.email)) return false;
		if (form.password.trim().length < 8) return false;
		if (form.password !== form.confirmPassword) return false;
		return true;
	}, [checkingState, form, saving]);

	async function onSubmit(event) {
		event.preventDefault();
		if (saving) return;

		if (!form.siteName.trim() || !form.firstName.trim() || !form.lastName.trim()) {
			toast.error('Complete all required fields.');
			return;
		}
		if (!isValidEmailAddress(form.email)) {
			toast.error('Enter a valid email address.');
			return;
		}
		if (form.password.trim().length < 8) {
			toast.error('Password must be at least 8 characters.');
			return;
		}
		if (form.password !== form.confirmPassword) {
			toast.error('Passwords do not match.');
			return;
		}

		setSaving(true);
		const payload = new FormData();
		payload.set('siteName', form.siteName);
		payload.set('themeKey', form.themeKey);
		payload.set('firstName', form.firstName);
		payload.set('lastName', form.lastName);
		payload.set('email', form.email);
		payload.set('password', form.password);
		if (logoFile) {
			payload.set('logoFile', logoFile);
		}

		const res = await fetch('/api/onboarding/setup', {
			method: 'POST',
			body: payload
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			toast.error(data.error || 'Failed to complete onboarding.');
			setSaving(false);
			return;
		}

		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('hg:branding-updated', {
					detail: {
						siteName: data.siteName || form.siteName,
						logoUrl: data.logoUrl || '/branding/hire-gnome.png',
						themeKey: data.themeKey || form.themeKey || DEFAULT_THEME_KEY,
						hasCustomLogo: Boolean(data.hasCustomLogo)
					}
				})
			);
		}
		setupCompletedRef.current = true;
		toast.success('Setup complete. Welcome.');
		router.replace('/');
		router.refresh();
	}

	if (checkingState) {
		return (
			<section className="auth-page">
				<article className="auth-card">
					<LoadingIndicator className="page-loading-indicator" label="Loading setup" />
				</article>
			</section>
		);
	}

	const useDefaultBrandPlaque = !logoPreviewUrl && !branding.hasCustomLogo;

	return (
		<section className="auth-page">
			<article className="auth-card setup-card">
				<div className={useDefaultBrandPlaque ? 'auth-brand-link brand-plaque' : 'auth-brand-link'}>
					<img src={logoPreviewUrl || branding.logoUrl} alt={form.siteName || branding.siteName} className="auth-brand-logo" />
				</div>
				<h1>Initial Setup</h1>
				<p className="auth-subtitle">Create your system administrator account and base branding.</p>
				<form onSubmit={onSubmit} className="auth-form">
					<section className="form-section">
						<h4>Branding</h4>
						<div className="setup-form-grid">
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
						</div>
						<FormField label="Logo Image" hint="Optional. PNG, JPG, WEBP, or SVG. Max 5 MB. Recommended: 1200 x 320.">
							<input
								type="file"
								accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
								onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
							/>
						</FormField>
					</section>

					<section className="form-section">
						<h4>Administrator</h4>
						<div className="setup-form-grid">
							<FormField label="First Name" required>
								<input
									value={form.firstName}
									onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Last Name" required>
								<input
									value={form.lastName}
									onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
									required
								/>
							</FormField>
						</div>
						<div className="setup-form-grid">
							<FormField label="Email" required>
								<input
									type="email"
									autoComplete="email"
									value={form.email}
									onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
									required
								/>
							</FormField>
							<div />
						</div>
						<div className="setup-form-grid">
							<FormField label="Password" required hint="At least 8 characters.">
								<input
									type="password"
									autoComplete="new-password"
									value={form.password}
									onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
									required
								/>
							</FormField>
							<FormField label="Confirm Password" required>
								<input
									type="password"
									autoComplete="new-password"
									value={form.confirmPassword}
									onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))}
									required
								/>
							</FormField>
						</div>
					</section>

					<div className="form-actions">
						<button type="submit" disabled={!canSubmit}>
							{saving ? 'Completing Setup...' : 'Complete Setup'}
						</button>
					</div>
				</form>
			</article>
		</section>
	);
}
