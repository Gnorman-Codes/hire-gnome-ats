'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import FormField from '@/app/components/form-field';
import { useToast } from '@/app/components/toast-provider';
import useSystemBranding from '@/app/hooks/use-system-branding';

const initialForm = {
	currentPassword: '',
	newPassword: '',
	confirmPassword: ''
};

export default function RequiredPasswordChangePage() {
	const router = useRouter();
	const toast = useToast();
	const branding = useSystemBranding();
	const [form, setForm] = useState(initialForm);
	const [saving, setSaving] = useState(false);

	async function onSubmit(event) {
		event.preventDefault();
		if (saving) return;

		setSaving(true);
		const response = await fetch('/api/session/change-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(form)
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			const message =
				data?.errors?.fieldErrors?.currentPassword?.[0]
				|| data?.errors?.fieldErrors?.newPassword?.[0]
				|| data?.errors?.fieldErrors?.confirmPassword?.[0]
				|| data?.error
				|| 'Failed to update password.';
			toast.error(message);
			setSaving(false);
			return;
		}

		toast.success(data?.message || 'Password updated.');
		router.replace('/');
		router.refresh();
	}

	return (
		<section className="auth-page">
			<article className="auth-card">
				<div className={branding.hasCustomLogo ? 'auth-brand-link' : 'auth-brand-link brand-plaque'}>
					<img src={branding.logoUrl} alt={branding.siteName} className="auth-brand-logo" />
				</div>
				<h1>Choose a New Password</h1>
				<p className="auth-subtitle">
					Your temporary password must be changed before you can continue to {branding.siteName}.
				</p>
				<form onSubmit={onSubmit} className="auth-form">
					<FormField label="Temporary Password" required>
						<input
							type="password"
							autoComplete="current-password"
							value={form.currentPassword}
							onChange={(event) =>
								setForm((current) => ({ ...current, currentPassword: event.target.value }))
							}
							required
						/>
					</FormField>
					<FormField label="New Password" required>
						<input
							type="password"
							autoComplete="new-password"
							minLength={8}
							value={form.newPassword}
							onChange={(event) =>
								setForm((current) => ({ ...current, newPassword: event.target.value }))
							}
							required
						/>
					</FormField>
					<FormField label="Confirm New Password" required>
						<input
							type="password"
							autoComplete="new-password"
							minLength={8}
							value={form.confirmPassword}
							onChange={(event) =>
								setForm((current) => ({ ...current, confirmPassword: event.target.value }))
							}
							required
						/>
					</FormField>
					<button type="submit" disabled={saving}>
						{saving ? 'Changing Password...' : 'Change Password and Continue'}
					</button>
				</form>
			</article>
		</section>
	);
}
