const DEFAULT_THEME_KEY = 'navy';

const THEME_OPTIONS = Object.freeze([
	{ value: DEFAULT_THEME_KEY, label: 'Navy' },
	{ value: 'classic_blue', label: 'Classic Blue' },
	{ value: 'midnight', label: 'Midnight' },
	{ value: 'emerald', label: 'Emerald' },
	{ value: 'slate', label: 'Slate' },
	{ value: 'sunset', label: 'Sunset' },
	{ value: 'high_contrast', label: 'High Contrast' }
]);

const THEME_KEYS = new Set(THEME_OPTIONS.map((option) => option.value));

function normalizeThemeKey(value) {
	const normalized = String(value || '').trim().toLowerCase();
	if (THEME_KEYS.has(normalized)) return normalized;
	return DEFAULT_THEME_KEY;
}

exports.DEFAULT_THEME_KEY = DEFAULT_THEME_KEY;
exports.THEME_OPTIONS = THEME_OPTIONS;
exports.normalizeThemeKey = normalizeThemeKey;
