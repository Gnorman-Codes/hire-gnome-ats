'use client';

import { Suspense, useState } from 'react';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import FormField from '@/app/components/form-field';
import { useToast } from '@/app/components/toast-provider';
import useSystemBranding from '@/app/hooks/use-system-branding';

function LoginPageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const toast = useToast();
	const branding = useSystemBranding();
	const nextPath = searchParams.get('next') || '/';
	const [form, setForm] = useState({
		email: '',
		password: ''
	});
	const [saving, setSaving] = useState(false);
	const [checkingSetup, setCheckingSetup] = useState(true);
	const [demoMode, setDemoMode] = useState(false);
	const [demoAccounts, setDemoAccounts] = useState([]);

	useEffect(() => {
		let cancelled = false;

		async function checkSetupState() {
			const res = await fetch('/api/onboarding/status', { cache: 'no-store' });
			const data = await res.json().catch(() => ({}));
			if (cancelled) return;
			setDemoMode(Boolean(data.demoMode));
			setDemoAccounts(Array.isArray(data.demoAccounts) ? data.demoAccounts : []);
			if (!res.ok) {
				setCheckingSetup(false);
				return;
			}
			if (data.needsOnboarding) {
				router.replace('/setup');
				return;
			}
			setCheckingSetup(false);
		}

		checkSetupState();
		return () => {
			cancelled = true;
		};
	}, [router]);

	async function onSubmit(event) {
		event.preventDefault();
		if (checkingSetup) return;
		if (!form.email.trim() || !form.password.trim()) {
			toast.error('Email and password are required.');
			return;
		}

		setSaving(true);
		const res = await fetch('/api/session/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});

		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			toast.error(data.error || 'Login failed. Check your credentials and try again.');
			setSaving(false);
			return;
		}

		router.replace(data?.user?.passwordChangeRequired ? '/account/password' : nextPath);
		router.refresh();
	}

	return (
		<section className="auth-page">
			<article className="auth-card">
				<Link
					href="/"
					className={branding.hasCustomLogo ? 'auth-brand-link' : 'auth-brand-link brand-plaque'}
					aria-label={`${branding.siteName} home`}
				>
					<img src={branding.logoUrl} alt={branding.siteName} className="auth-brand-logo" />
				</Link>
				<h1>Sign In</h1>
				<p className="auth-subtitle">Use your user email and password to access {branding.siteName}.</p>
				{demoMode && demoAccounts.length > 0 ? (
					<div className="auth-demo-credentials">
						<p className="auth-demo-title">Demo Credentials</p>
						<ul>
							{demoAccounts.map((account) => (
								<li key={account.label}>
									<strong>{account.label}:</strong> {account.email} / {account.password}
								</li>
							))}
						</ul>
					</div>
				) : null}
				<form onSubmit={onSubmit} className="auth-form">
					<FormField label="Email" required>
						<input
							type="email"
							autoComplete="email"
							value={form.email}
							onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
							required
						/>
					</FormField>
					<FormField label="Password" required>
						<input
							type="password"
							autoComplete="current-password"
							value={form.password}
							onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
							required
						/>
					</FormField>
					<button type="submit" disabled={saving || checkingSetup}>
						{saving ? 'Signing In...' : checkingSetup ? 'Loading...' : 'Sign In'}
					</button>
				</form>
				<div className="auth-links auth-links-reset">
					<Link href="/forgot-password" className="auth-link">
						Forgot password?
					</Link>
				</div>
			</article>
		</section>
	);
}

export default function LoginPage() {
	return (
		<Suspense
			fallback={
				<section className="auth-page">
					<article className="auth-card">
						<p className="auth-subtitle">Loading sign in...</p>
					</article>
				</section>
			}
		>
			<LoginPageContent />
		</Suspense>
	);
}
