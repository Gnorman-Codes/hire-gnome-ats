import nodemailer from 'nodemailer';
import { isValidEmailAddress } from '@/lib/email-validation';
import { getIntegrationSettings } from '@/lib/system-settings';

let cachedTransporter = null;
let cachedTransporterKey = '';

function toBoolean(value, fallback = false) {
	if (typeof value !== 'string') return fallback;
	const normalized = value.trim().toLowerCase();
	if (!normalized) return fallback;
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
	return fallback;
}

function toEmailList(input) {
	if (!input) return [];
	const values = Array.isArray(input) ? input : [input];
	const deduped = [];
	const seen = new Set();

	for (const value of values) {
		const normalized = String(value || '').trim().toLowerCase();
		if (!isValidEmailAddress(normalized)) continue;
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		deduped.push(normalized);
	}

	return deduped;
}

function formatFromAddress(fromName, fromEmail) {
	if (!fromEmail) return '';
	const safeName = String(fromName || '').trim().replace(/"/g, '');
	if (!safeName) return fromEmail;
	return `"${safeName}" <${fromEmail}>`;
}

async function getMailConfig() {
	const integrationSettings = await getIntegrationSettings();
	return {
		host: String(integrationSettings.smtpHost || '').trim(),
		port: integrationSettings.smtpPort,
		secure: Boolean(integrationSettings.smtpSecure),
		user: String(integrationSettings.smtpUser || '').trim(),
		pass: String(integrationSettings.smtpPass || '').trim(),
		fromName: String(integrationSettings.smtpFromName || '').trim(),
		fromEmail: String(integrationSettings.smtpFromEmail || '').trim(),
		testMode: toBoolean(String(integrationSettings.emailTestMode ?? ''), false),
		testRecipient: String(integrationSettings.emailTestRecipient || '').trim().toLowerCase()
	};
}

function getTransporter(config) {
	const key = JSON.stringify({
		host: config.host,
		port: config.port,
		secure: config.secure,
		user: config.user,
		pass: config.pass
	});

	if (cachedTransporter && cachedTransporterKey === key) {
		return cachedTransporter;
	}

	const transporter = nodemailer.createTransport({
		host: config.host,
		port: config.port,
		secure: config.secure,
		auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined
	});

	cachedTransporter = transporter;
	cachedTransporterKey = key;
	return transporter;
}

function validateMailConfig(config) {
	if (!config.host) {
		return 'SMTP host is required in Admin Area > System Settings to send emails.';
	}
	if (!config.port) {
		return 'SMTP port is required in Admin Area > System Settings to send emails.';
	}
	if (!config.fromEmail || !isValidEmailAddress(config.fromEmail)) {
		return 'SMTP from email is required in Admin Area > System Settings and must be valid.';
	}
	if ((config.user && !config.pass) || (!config.user && config.pass)) {
		return 'SMTP username and password must both be set when using SMTP auth.';
	}
	if (config.testMode && !isValidEmailAddress(config.testRecipient)) {
		return 'EMAIL_TEST_RECIPIENT is missing or invalid while EMAIL_TEST_MODE=true.';
	}
	return '';
}

function resolveEnvelopeRecipients(recipients, config) {
	if (config.testMode) {
		return [config.testRecipient];
	}
	return recipients;
}

export async function sendEmailMessage({
	to,
	subject,
	text = '',
	html = '',
	attachments = [],
	replyTo = '',
	expectedTestMode
}) {
	let deliveryStarted = false;
	try {
		const recipients = toEmailList(to);
		if (recipients.length === 0) {
			return {
				sent: false,
				skipped: true,
				reason: 'No valid recipient email addresses were provided.'
			};
		}

		const config = await getMailConfig();
		if (typeof expectedTestMode === 'boolean' && config.testMode !== expectedTestMode) {
			return { sent: false, skipped: true, reason: 'Email delivery mode changed. Reopen the review before sending.' };
		}
		const configError = validateMailConfig(config);
		if (configError) {
			return {
				sent: false,
				skipped: true,
				reason: configError
			};
		}

		const envelopeRecipients = resolveEnvelopeRecipients(recipients, config);
		if (envelopeRecipients.length === 0) {
			return {
				sent: false,
				skipped: true,
				reason: 'No valid email recipients were resolved.'
			};
		}

		const transporter = getTransporter(config);
		const from = formatFromAddress(config.fromName, config.fromEmail);

		deliveryStarted = true;
		await transporter.sendMail({
			from,
			to: envelopeRecipients.join(', '),
			replyTo: replyTo || undefined,
			subject,
			text: text || undefined,
			html: html || undefined,
			attachments
		});

		return {
			sent: true,
			skipped: false,
			testMode: config.testMode,
			deliveredTo: envelopeRecipients,
			originalRecipients: recipients
		};
	} catch (error) {
		return {
			sent: false,
			skipped: true,
			deliveryUncertain: deliveryStarted && !(
				Number(error?.responseCode) >= 400 && Number(error?.responseCode) < 600
			),
			reason: error instanceof Error ? error.message : 'Failed to send email.'
		};
	}
}
