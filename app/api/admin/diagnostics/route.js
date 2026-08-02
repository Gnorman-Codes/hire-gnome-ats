import { NextResponse } from 'next/server';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AccessControlError, getActingUser } from '@/lib/access-control';
import { prisma } from '@/lib/prisma';
import { getIntegrationSettings, getSystemSettingRecord } from '@/lib/system-settings';
import { getObjectStorageConfig } from '@/lib/object-storage';
import { withApiLogging } from '@/lib/api-logging';

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function isMissingInboundEmailEventTableError(error) {
	if (!error) return false;
	if (error.code === 'P2021') return true;
	return String(error.message || '').includes('InboundEmailEvent');
}

function createCheckResult({ key, label, status, message, details = {} }) {
	return {
		key,
		label,
		status,
		message,
		details
	};
}

function summarizeAttachmentDiagnostics(payload) {
	const diagnostics = Array.isArray(payload?.AttachmentDiagnostics) ? payload.AttachmentDiagnostics : [];
	if (diagnostics.length === 0) return '';

	const parts = diagnostics.slice(0, 3).map((entry) => {
		const fileName = String(entry?.fileName || 'attachment').trim() || 'attachment';
		const reason = String(entry?.reason || 'unknown').trim().replace(/_/g, ' ');
		return `${fileName}: ${reason}`;
	});
	const remainder = diagnostics.length - parts.length;
	if (remainder > 0) {
		parts.push(`+${remainder} more`);
	}
	return parts.join(' | ');
}

function toBooleanFlag(value) {
	return Boolean(String(value || '').trim());
}

function escapeMarkdownCell(value) {
	return String(value ?? '')
		.replace(/\|/g, '\\|')
		.replace(/\r?\n/g, ' ')
		.trim();
}

function formatDiagnosticsMarkdown(result) {
	const generatedAt = result?.generatedAt || new Date().toISOString();
	const summary = result?.summary || {};
	const checks = Array.isArray(result?.checks) ? result.checks : [];
	const recentInboundEmails = Array.isArray(result?.recentInboundEmails) ? result.recentInboundEmails : [];
	const lines = [
		'# Hire Gnome ATS Diagnostics Report',
		'',
		`Generated: ${generatedAt}`,
		'',
		'## Summary',
		'',
		`- Total Checks: ${Number(summary.total || checks.length)}`,
		`- Pass: ${Number(summary.passCount || 0)}`,
		`- Warnings: ${Number(summary.warnCount || 0)}`,
		`- Failures: ${Number(summary.failCount || 0)}`,
		`- Overall Status: ${summary.ok ? 'PASS' : 'ATTENTION REQUIRED'}`,
		'',
		'## Checks',
		'',
		'| Check | Status | Message |',
		'|---|---|---|'
	];

	for (const check of checks) {
		lines.push(
			`| ${escapeMarkdownCell(check?.label || check?.key || '-')} | ${escapeMarkdownCell(String(check?.status || '').toUpperCase() || 'INFO')} | ${escapeMarkdownCell(check?.message || '-')} |`
		);
	}

	lines.push('', '## Recent Inbound Email Events', '');
	if (recentInboundEmails.length === 0) {
		lines.push('- No inbound email events recorded.');
	} else {
		lines.push('| Received | Status | Subject | Matches | Notes | Attachments | Attachment Diagnostics |', '|---|---|---|---|---|---|---|');
		for (const event of recentInboundEmails) {
			lines.push(
				`| ${escapeMarkdownCell(event?.createdAt || '-')} | ${escapeMarkdownCell(event?.status || '-')} | ${escapeMarkdownCell(event?.subject || '-')} | ${escapeMarkdownCell(`Candidates ${event?.matchedCandidates ?? 0}, Contacts ${event?.matchedContacts ?? 0}`)} | ${escapeMarkdownCell(String(event?.notesCreated ?? 0))} | ${escapeMarkdownCell(String(event?.attachmentsSaved ?? 0))} | ${escapeMarkdownCell(event?.attachmentDiagnosticsSummary || '-')} |`
			);
		}
	}

	return `${lines.join('\n')}\n`;
}

function getBackupDirectoryPath() {
	const raw = String(process.env.DB_BACKUP_DIR || '').trim();
	return raw || path.join(process.cwd(), '.backups');
}

async function runDiagnostics() {
	const checks = [];
	const generatedAt = new Date().toISOString();
	let recentInboundEmails = [];

	try {
		await prisma.$queryRaw`SELECT 1`;
		checks.push(
			createCheckResult({
				key: 'database_connectivity',
				label: 'Database Connectivity',
				status: 'pass',
				message: 'Database connection succeeded.'
			})
		);
	} catch (error) {
		checks.push(
			createCheckResult({
				key: 'database_connectivity',
				label: 'Database Connectivity',
				status: 'fail',
				message: 'Database connection failed.',
				details: {
					error: error?.message || 'Unknown error'
				}
			})
		);
	}

	const authSessionSecret = String(process.env.AUTH_SESSION_SECRET || '').trim();
	if (!authSessionSecret) {
		checks.push(
			createCheckResult({
				key: 'auth_session_secret',
				label: 'Auth Session Secret',
				status: 'fail',
				message: 'AUTH_SESSION_SECRET is not set.'
			})
		);
	} else if (authSessionSecret.length < 24) {
		checks.push(
			createCheckResult({
				key: 'auth_session_secret',
				label: 'Auth Session Secret',
				status: 'warn',
				message: 'AUTH_SESSION_SECRET is set but shorter than recommended minimum (24 chars).',
				details: {
					length: authSessionSecret.length
				}
			})
		);
	} else {
		checks.push(
			createCheckResult({
				key: 'auth_session_secret',
				label: 'Auth Session Secret',
				status: 'pass',
				message: 'AUTH_SESSION_SECRET is configured.'
			})
		);
	}

	const authAppBaseUrl = String(process.env.AUTH_APP_BASE_URL || '').trim();
	if (!authAppBaseUrl) {
		checks.push(
			createCheckResult({
				key: 'auth_app_base_url',
				label: 'App Base URL',
				status: 'fail',
				message: 'AUTH_APP_BASE_URL is not set.'
			})
		);
	} else {
		try {
			const parsed = new URL(authAppBaseUrl);
			const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
			const isHttps = parsed.protocol === 'https:';
			checks.push(
				createCheckResult({
					key: 'auth_app_base_url',
					label: 'App Base URL',
					status: isHttps || isLocalhost ? 'pass' : 'warn',
					message: isHttps || isLocalhost
						? 'AUTH_APP_BASE_URL is valid.'
						: 'AUTH_APP_BASE_URL is valid but not HTTPS.',
					details: {
						url: authAppBaseUrl
					}
				})
			);
		} catch {
			checks.push(
				createCheckResult({
					key: 'auth_app_base_url',
					label: 'App Base URL',
					status: 'fail',
					message: 'AUTH_APP_BASE_URL is not a valid URL.'
				})
			);
		}
	}

	const emailTestMode = String(process.env.EMAIL_TEST_MODE || '').trim().toLowerCase();
	const emailTestRecipient = String(process.env.EMAIL_TEST_RECIPIENT || '').trim();
	if (emailTestMode === 'true' && !emailTestRecipient) {
		checks.push(
			createCheckResult({
				key: 'email_test_mode',
				label: 'Email Test Routing',
				status: 'warn',
				message: 'EMAIL_TEST_MODE is true but EMAIL_TEST_RECIPIENT is empty.'
			})
		);
	} else {
		checks.push(
			createCheckResult({
				key: 'email_test_mode',
				label: 'Email Test Routing',
				status: 'pass',
				message: emailTestMode === 'true'
					? 'Email test routing is enabled and configured.'
					: 'Email test routing is disabled.'
			})
		);
	}

	try {
		const setting = await getSystemSettingRecord();
		checks.push(
			createCheckResult({
				key: 'system_settings',
				label: 'System Settings Record',
				status: setting ? 'pass' : 'warn',
				message: setting
					? 'System settings record is present.'
					: 'System settings record is missing. Defaults will be used.'
			})
		);
	} catch (error) {
		checks.push(
			createCheckResult({
				key: 'system_settings',
				label: 'System Settings Record',
				status: 'fail',
				message: 'Failed to load system settings record.',
				details: {
					error: error?.message || 'Unknown error'
				}
			})
		);
	}

	try {
		const integrationSettings = await getIntegrationSettings({ forceRefresh: true });
		const smtpReady = toBooleanFlag(integrationSettings.smtpHost)
			&& toBooleanFlag(integrationSettings.smtpUser)
			&& toBooleanFlag(integrationSettings.smtpFromEmail);
		checks.push(
			createCheckResult({
				key: 'smtp_configuration',
				label: 'SMTP Configuration',
				status: smtpReady ? 'pass' : 'warn',
				message: smtpReady
					? 'SMTP settings are configured for outgoing email.'
					: 'SMTP settings are incomplete. Outgoing email may be disabled.',
				details: {
					smtpHostConfigured: toBooleanFlag(integrationSettings.smtpHost),
					smtpUserConfigured: toBooleanFlag(integrationSettings.smtpUser),
					smtpFromEmailConfigured: toBooleanFlag(integrationSettings.smtpFromEmail)
				}
			})
		);
	} catch (error) {
		checks.push(
			createCheckResult({
				key: 'smtp_configuration',
				label: 'SMTP Configuration',
				status: 'fail',
				message: 'Failed to evaluate SMTP configuration.',
				details: {
					error: error?.message || 'Unknown error'
				}
			})
		);
	}

	try {
		const storageConfig = await getObjectStorageConfig();
		const usingLocal = storageConfig.mode === 'local';
		const s3Ready = toBooleanFlag(storageConfig.bucket)
			&& toBooleanFlag(storageConfig.accessKeyId)
			&& toBooleanFlag(storageConfig.secretAccessKey);
		checks.push(
			createCheckResult({
				key: 'object_storage',
				label: 'Object Storage',
				status: usingLocal || s3Ready ? 'pass' : 'warn',
				message: usingLocal
					? 'Object storage is running in local mode.'
					: s3Ready
						? 'Object storage is configured for S3/S3-compatible mode.'
						: 'Object storage is set to S3 mode but configuration is incomplete.',
				details: {
					mode: storageConfig.mode,
					bucketConfigured: toBooleanFlag(storageConfig.bucket)
				}
			})
		);
	} catch (error) {
		checks.push(
			createCheckResult({
				key: 'object_storage',
				label: 'Object Storage',
				status: 'fail',
				message: 'Failed to evaluate object storage configuration.',
				details: {
					error: error?.message || 'Unknown error'
				}
			})
		);
	}

	const backupDirectory = getBackupDirectoryPath();
	try {
		await mkdir(backupDirectory, { recursive: true });
		const tempFilePath = path.join(backupDirectory, `.diagnostics-${Date.now()}.tmp`);
		await writeFile(tempFilePath, 'ok');
		await unlink(tempFilePath);
		checks.push(
			createCheckResult({
				key: 'backup_directory',
				label: 'Backup Directory',
				status: 'pass',
				message: 'Backup directory is writable.',
				details: {
					path: backupDirectory
				}
			})
		);
	} catch (error) {
		checks.push(
			createCheckResult({
				key: 'backup_directory',
				label: 'Backup Directory',
				status: 'fail',
				message: 'Backup directory is not writable.',
				details: {
					path: backupDirectory,
					error: error?.message || 'Unknown error'
				}
			})
		);
	}

	const errorAlertWebhookConfigured = toBooleanFlag(process.env.ERROR_ALERT_WEBHOOK_URL);
	checks.push(
		createCheckResult({
			key: 'error_alert_webhook',
			label: 'Error Alert Webhook',
			status: errorAlertWebhookConfigured ? 'pass' : 'warn',
			message: errorAlertWebhookConfigured
				? 'Error alert webhook is configured.'
				: 'Error alert webhook is not configured.'
		})
	);

	const healthAlertWebhookConfigured = toBooleanFlag(process.env.HEALTH_ALERT_WEBHOOK_URL);
	checks.push(
		createCheckResult({
			key: 'health_alert_webhook',
			label: 'Health Alert Webhook',
			status: healthAlertWebhookConfigured ? 'pass' : 'warn',
			message: healthAlertWebhookConfigured
				? 'Health alert webhook is configured.'
				: 'Health alert webhook is not configured.'
		})
	);

	try {
		recentInboundEmails = await prisma.inboundEmailEvent.findMany({
			orderBy: { createdAt: 'desc' },
			take: 12,
			select: {
				id: true,
				status: true,
				subject: true,
				fromEmail: true,
				matchedCandidates: true,
				matchedContacts: true,
				notesCreated: true,
				attachmentsSaved: true,
				createdAt: true,
				payload: true
			}
		});
		recentInboundEmails = recentInboundEmails.map((event) => ({
			...event,
			attachmentDiagnosticsSummary: summarizeAttachmentDiagnostics(event.payload)
		}));
		checks.push(
			createCheckResult({
				key: 'inbound_email_events',
				label: 'Inbound Email Event Log',
				status: 'pass',
				message: recentInboundEmails.length > 0
					? `Inbound email event log is available. Showing ${recentInboundEmails.length} recent events.`
					: 'Inbound email event log is available. No events recorded yet.'
			})
		);
	} catch (error) {
		if (isMissingInboundEmailEventTableError(error)) {
			checks.push(
				createCheckResult({
					key: 'inbound_email_events',
					label: 'Inbound Email Event Log',
					status: 'warn',
					message: 'Inbound email event table is missing. Apply the latest migration to enable inbound email diagnostics.'
				})
			);
		} else {
			checks.push(
				createCheckResult({
					key: 'inbound_email_events',
					label: 'Inbound Email Event Log',
					status: 'fail',
					message: 'Failed to load inbound email events.',
					details: {
						error: error?.message || 'Unknown error'
					}
				})
			);
		}
	}

	const passCount = checks.filter((check) => check.status === 'pass').length;
	const warnCount = checks.filter((check) => check.status === 'warn').length;
	const failCount = checks.filter((check) => check.status === 'fail').length;

	return {
		generatedAt,
		summary: {
			ok: failCount === 0,
			total: checks.length,
			passCount,
			warnCount,
			failCount
		},
		checks,
		recentInboundEmails
	};
}

async function getAdmin_diagnosticsHandler(req) {
	try {
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser || actingUser.role !== 'ADMINISTRATOR') {
			throw new AccessControlError('Administrator access is required.', 403);
		}

		const result = await runDiagnostics();
		const format = String(req.nextUrl?.searchParams?.get('format') || '')
			.trim()
			.toLowerCase();
		if (format === 'md' || format === 'markdown') {
			const markdown = formatDiagnosticsMarkdown(result);
			const fileSafeIso = String(result.generatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
			return new NextResponse(markdown, {
				headers: {
					'Content-Type': 'text/markdown; charset=utf-8',
					'Content-Disposition': `attachment; filename="diagnostics-${fileSafeIso}.md"`,
					'Cache-Control': 'no-store'
				}
			});
		}

		return NextResponse.json(result, {
			headers: {
				'Cache-Control': 'no-store'
			}
		});
	} catch (error) {
		return handleError(error, 'Failed to run diagnostics.');
	}
}

export const GET = withApiLogging('admin.diagnostics.get', getAdmin_diagnosticsHandler);
