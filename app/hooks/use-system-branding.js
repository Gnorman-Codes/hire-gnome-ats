'use client';

import { DEFAULT_THEME_KEY } from '@/lib/theme-options.cjs';
import { useCallback, useEffect, useState } from 'react';
import { toBooleanFlag } from '@/lib/boolean-flag';

const defaults = {
	siteName: 'Hire Gnome ATS',
	logoUrl: '/branding/hire-gnome.png',
	themeKey: DEFAULT_THEME_KEY,
	hasCustomLogo: false,
	careerSiteEnabled: false,
	demoMode: false
};
const BRANDING_UPDATED_EVENT = 'hg:branding-updated';

function initialThemeKey() {
	if (typeof window === 'undefined') return defaults.themeKey;
	const fromHtml = String(document.documentElement.getAttribute('data-theme') || '').trim();
	if (fromHtml) return fromHtml;
	return defaults.themeKey;
}

function normalizeBranding(data) {
	const siteName = String(data?.siteName || defaults.siteName);
	return {
		siteName,
		siteTitle: siteName,
		logoUrl: String(data?.logoUrl || defaults.logoUrl),
		themeKey: String(data?.themeKey || defaults.themeKey),
		hasCustomLogo: Boolean(data?.hasCustomLogo),
		careerSiteEnabled: toBooleanFlag(data?.careerSiteEnabled, false),
		demoMode: toBooleanFlag(data?.demoMode, false)
	};
}

export default function useSystemBranding() {
	const [branding, setBranding] = useState(() => ({
		...defaults,
		themeKey: initialThemeKey()
	}));
	const loadBranding = useCallback(async () => {
		const res = await fetch('/api/system-settings', { cache: 'no-store' });
		if (!res.ok) return;
		const data = await res.json().catch(() => ({}));
		setBranding(normalizeBranding(data));
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			const res = await fetch('/api/system-settings', { cache: 'no-store' });
			if (!res.ok) return;
			const data = await res.json().catch(() => ({}));
			if (cancelled) return;
			setBranding(normalizeBranding(data));
		}

		function onBrandingUpdated(event) {
			const detail = event?.detail;
			if (detail && typeof detail === 'object') {
				setBranding(normalizeBranding(detail));
				return;
			}
			loadBranding().catch(() => null);
		}

		load();
		window.addEventListener(BRANDING_UPDATED_EVENT, onBrandingUpdated);
		return () => {
			cancelled = true;
			window.removeEventListener(BRANDING_UPDATED_EVENT, onBrandingUpdated);
		};
	}, [loadBranding]);

	return branding;
}
