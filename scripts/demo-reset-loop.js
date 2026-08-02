#!/usr/bin/env node
/* eslint-disable no-console */

require('./load-env.cjs');

const { spawn } = require('node:child_process');
const path = require('node:path');
const { mkdir, readFile, rename, writeFile } = require('node:fs/promises');

const MAX_TIMER_DELAY_MS = 2_147_000_000;
let activeResetChild = null;

function toPositiveInt(value, fallback) {
	const parsed = Number.parseInt(String(value || '').trim(), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
	return parsed;
}

function toBoolean(value, fallback = false) {
	const normalized = String(value || '').trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function normalizeMode(value) {
	const normalized = String(value || '').trim().toLowerCase();
	if (normalized === 'full') return 'full';
	return 'seed';
}

function runResetOnce(mode) {
	return new Promise((resolve, reject) => {
		const child = spawn('node', ['scripts/demo-reset.js', `--mode=${mode}`, '--preserve-settings=true'], {
			stdio: 'inherit',
			env: process.env
		});
		activeResetChild = child;

		child.on('error', (error) => {
			activeResetChild = null;
			reject(error);
		});
		child.on('exit', (code) => {
			activeResetChild = null;
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`demo-reset exited with code ${code}.`));
		});
	});
}

function getStateFilePath() {
	return path.resolve(
		process.env.DEMO_RESET_STATE_FILE || path.join(process.cwd(), '.runtime', 'demo-reset-state.json')
	);
}

async function readState(stateFile) {
	try {
		const value = JSON.parse(await readFile(stateFile, 'utf8'));
		return {
			lastAttemptAt: typeof value.lastAttemptAt === 'string' ? value.lastAttemptAt : null,
			lastCompletedAt: typeof value.lastCompletedAt === 'string' ? value.lastCompletedAt : null
		};
	} catch (error) {
		if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
			return { lastAttemptAt: null, lastCompletedAt: null };
		}
		throw error;
	}
}

async function writeState(stateFile, state) {
	await mkdir(path.dirname(stateFile), { recursive: true });
	const temporaryFile = `${stateFile}.${process.pid}.tmp`;
	await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	await rename(temporaryFile, stateFile);
}

function parseTimestamp(value) {
	const timestamp = Date.parse(String(value || ''));
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function getNextDelayMs({ state, intervalMs, retryMs, runOnStart }) {
	const now = Date.now();
	const lastCompletedMs = parseTimestamp(state.lastCompletedAt);
	const lastAttemptMs = parseTimestamp(state.lastAttemptAt);

	if (lastCompletedMs > 0) {
		const nextRegularReset = lastCompletedMs + intervalMs;
		const nextRetry = lastAttemptMs > lastCompletedMs ? lastAttemptMs + retryMs : 0;
		return Math.max(0, Math.max(nextRegularReset, nextRetry) - now);
	}
	if (lastAttemptMs > 0) {
		return Math.max(0, lastAttemptMs + retryMs - now);
	}
	return runOnStart ? 0 : intervalMs;
}

async function main() {
	const mode = normalizeMode(process.env.DEMO_RESET_MODE || 'seed');
	const intervalMinutes = toPositiveInt(process.env.DEMO_RESET_INTERVAL_MINUTES, 360);
	const retryMinutes = toPositiveInt(process.env.DEMO_RESET_RETRY_MINUTES, 15);
	const runOnStart = toBoolean(process.env.DEMO_RESET_RUN_ON_START, true);
	const intervalMs = intervalMinutes * 60 * 1000;
	const retryMs = retryMinutes * 60 * 1000;
	const stateFile = getStateFilePath();
	let timer = null;
	let running = false;
	let stopped = false;
	let state = await readState(stateFile);

	console.log(`[demo-reset-loop] Mode: ${mode}.`);
	console.log(`[demo-reset-loop] Interval: every ${intervalMinutes} minute(s).`);
	console.log(`[demo-reset-loop] Failure retry: every ${retryMinutes} minute(s).`);
	console.log(`[demo-reset-loop] Run on start: ${runOnStart ? 'yes' : 'no'}.`);
	console.log(`[demo-reset-loop] State file: ${stateFile}.`);

	const executeCycle = async () => {
		if (running) {
			console.log('[demo-reset-loop] Reset already running. Skipping this interval.');
			return;
		}
		running = true;
		const startedAt = new Date();
		try {
			state = { ...state, lastAttemptAt: startedAt.toISOString() };
			await writeState(stateFile, state);
			console.log(`[demo-reset-loop] Reset started at ${startedAt.toISOString()}.`);
			await runResetOnce(mode);
			state = { ...state, lastCompletedAt: new Date().toISOString() };
			await writeState(stateFile, state);
			console.log('[demo-reset-loop] Reset completed.');
			return true;
		} catch (error) {
			console.error('[demo-reset-loop] Reset failed.');
			console.error(error?.message || error);
			return false;
		} finally {
			running = false;
		}
	};

	const schedule = (delayMs) => {
		if (stopped) return;
		const boundedDelay = Math.max(0, delayMs);
		console.log(`[demo-reset-loop] Next reset in ${Math.ceil(boundedDelay / 60000)} minute(s).`);
		const timerDelay = Math.min(boundedDelay, MAX_TIMER_DELAY_MS);
		timer = setTimeout(async () => {
			if (boundedDelay > MAX_TIMER_DELAY_MS) {
				schedule(boundedDelay - timerDelay);
				return;
			}
			try {
				const succeeded = await executeCycle();
				schedule(succeeded ? intervalMs : retryMs);
			} catch (error) {
				console.error('[demo-reset-loop] Unexpected scheduler error.');
				console.error(error?.message || error);
				schedule(retryMs);
			}
		}, timerDelay);
	};

	schedule(getNextDelayMs({ state, intervalMs, retryMs, runOnStart }));

	const stop = () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		if (activeResetChild && !activeResetChild.killed) activeResetChild.kill('SIGTERM');
		console.log('[demo-reset-loop] Stopped.');
		process.exit(0);
	};

	process.on('SIGINT', stop);
	process.on('SIGTERM', stop);
}

main().catch((error) => {
	console.error('[demo-reset-loop] Fatal error.');
	console.error(error?.message || error);
	process.exit(1);
});
