#!/usr/bin/env node
/* eslint-disable no-console */

require('./load-env.cjs');

const { spawnSync } = require('node:child_process');
const { DEFAULT_THEME_KEY } = require('../lib/theme-options.cjs');
const { PrismaClient } = require('@prisma/client');

const RESET_MODE_VALUES = new Set(['full', 'seed']);
const DEMO_SITE_NAME = 'Hire Gnome ATS';

function parseArgValue(name, fallback = '') {
	const prefix = `--${name}=`;
	const entry = process.argv.find((value) => String(value).startsWith(prefix));
	if (!entry) return fallback;
	return String(entry.slice(prefix.length)).trim();
}

function toBoolean(value, fallback = false) {
	const normalized = String(value || '').trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function parseOptions() {
	const modeRaw = parseArgValue('mode', 'full').toLowerCase();
	const mode = RESET_MODE_VALUES.has(modeRaw) ? modeRaw : 'full';
	const preserveSettings = toBoolean(parseArgValue('preserve-settings', 'true'), true);
	return {
		mode,
		preserveSettings
	};
}

function runCommand(command, args) {
	const result = spawnSync(command, args, {
		stdio: 'inherit',
		env: process.env
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.`);
	}
}

function isMissingSystemSettingsTableError(error) {
	if (!error) return false;
	if (error.code === 'P2021') return true;
	return String(error.message || '').includes('SystemSetting');
}

async function loadSystemSettingsSnapshot(enabled) {
	if (!enabled) return null;
	const prisma = new PrismaClient();
	try {
		const settings = await prisma.systemSetting.findFirst({
			orderBy: { id: 'asc' },
			select: {
				recordId: true,
				careerSiteEnabled: true,
				apiErrorLogRetentionDays: true,
				googleMapsApiKey: true,
				openAiApiKey: true,
				smtpHost: true,
				smtpPort: true,
				smtpSecure: true,
				smtpUser: true,
				smtpPass: true,
				smtpFromName: true,
				smtpFromEmail: true,
				objectStorageProvider: true,
				objectStorageRegion: true,
				objectStorageBucket: true,
				objectStorageEndpoint: true,
				objectStorageForcePathStyle: true,
				objectStorageAccessKeyId: true,
				objectStorageSecretAccessKey: true
			}
		});
		return settings || null;
	} catch (error) {
		if (isMissingSystemSettingsTableError(error)) {
			console.log('[demo-reset] System settings table not found yet; skipping settings snapshot.');
			return null;
		}
		throw error;
	} finally {
		await prisma.$disconnect();
	}
}

async function restoreSystemSettings(snapshot) {
	if (!snapshot) return false;
	const prisma = new PrismaClient();
	try {
		const existing = await prisma.systemSetting.findFirst({
			orderBy: { id: 'asc' },
			select: { id: true }
		});
		if (existing) {
			await prisma.systemSetting.update({
				where: { id: existing.id },
				data: snapshot
			});
		} else {
			await prisma.systemSetting.create({
				data: snapshot
			});
		}
		return true;
	} catch (error) {
		if (isMissingSystemSettingsTableError(error)) {
			console.log('[demo-reset] System settings table not available after reset; skipping restore.');
			return false;
		}
		throw error;
	} finally {
		await prisma.$disconnect();
	}
}

async function applyDemoBrandingDefaults() {
	const prisma = new PrismaClient();
	try {
		const existing = await prisma.systemSetting.findFirst({
			orderBy: { id: 'asc' },
			select: { id: true }
		});
		if (!existing) return false;
		await prisma.systemSetting.update({
			where: { id: existing.id },
			data: {
				siteName: DEMO_SITE_NAME,
				siteTitle: DEMO_SITE_NAME,
				themeKey: DEFAULT_THEME_KEY,
				logoStorageProvider: null,
				logoStorageBucket: null,
				logoStorageKey: null,
				logoContentType: null,
				logoFileName: null
			}
		});
		return true;
	} catch (error) {
		if (isMissingSystemSettingsTableError(error)) {
			console.log('[demo-reset] System settings table not available after reset; skipping branding reset.');
			return false;
		}
		throw error;
	} finally {
		await prisma.$disconnect();
	}
}

async function main() {
	const options = parseOptions();
	console.log(`[demo-reset] Starting demo reset (mode=${options.mode}, preserveSettings=${options.preserveSettings}).`);

	const settingsSnapshot = await loadSystemSettingsSnapshot(options.preserveSettings);

	if (options.mode === 'full') {
		console.log('[demo-reset] Running prisma migrate reset...');
		runCommand('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-generate']);
		console.log('[demo-reset] Removing orphaned candidate local-storage files after full reset...');
		runCommand('node', ['scripts/local-storage-candidate-orphans.js', '--delete']);
	} else {
		console.log('[demo-reset] Skipping full DB reset (seed-only mode).');
	}

	console.log('[demo-reset] Seeding realistic demo data...');
	runCommand('node', ['scripts/seed-dummy-data.js']);

	if (options.preserveSettings) {
		const restored = await restoreSystemSettings(settingsSnapshot);
		console.log(restored
			? '[demo-reset] Restored system settings snapshot.'
			: '[demo-reset] No system settings snapshot to restore.');
	}

	const brandingReset = await applyDemoBrandingDefaults();
	console.log(brandingReset
		? `[demo-reset] Reset branding to the demo defaults (theme=${DEFAULT_THEME_KEY}).`
		: '[demo-reset] No system settings record available for branding reset.');

	console.log('[demo-reset] Completed successfully.');
}

main().catch((error) => {
	console.error('[demo-reset] Failed.');
	console.error(error?.message || error);
	process.exitCode = 1;
});
