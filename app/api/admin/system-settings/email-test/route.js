import nodemailer from 'nodemailer';
import { NextResponse } from 'next/server';
import { AccessControlError, getActingUser } from '@/lib/access-control';
import { isValidEmailAddress } from '@/lib/email-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { withApiLogging } from '@/lib/api-logging';
import { hostedManagedIntegrationsEnabled } from '@/lib/hosted-managed-integrations';

export const dynamic = 'force-dynamic';

function asTrimmedString(value) {
	if (value == null) return '';
	return String(value).trim();
}

function toBoolean(value) {
	if (value == null || value === '') return false;
	return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toNullablePort(value) {
	const parsed = Number.parseInt(asTrimmedString(value), 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

function formatFromAddress(fromName, fromEmail) {
	if (!fromEmail) return '';
	const safeName = asTrimmedString(fromName).replace(/"/g, '');
	if (!safeName) return fromEmail;
	return `"${safeName}" <${fromEmail}>`;
}

function validateSmtpConfig(config) {
	if (!config.smtpHost) {
		return 'SMTP host is required.';
	}
	if (!config.smtpPort) {
		return 'SMTP port must be a positive number.';
	}
	if (!config.smtpFromEmail || !isValidEmailAddress(config.smtpFromEmail)) {
		return 'SMTP from email must be a valid email address.';
	}
	if ((config.smtpUser && !config.smtpPass) || (!config.smtpUser && config.smtpPass)) {
		return 'SMTP username and password must both be set when using SMTP auth.';
	}
	return '';
}

function buildTextBody({ siteName, requestedRecipient, deliveredRecipient, testModeEnabled, testModeRecipient }) {
	const lines = [
		`This is a test email from ${siteName}.`,
		'',
		'Your SMTP configuration is able to send email from the Admin Area settings.',
		'',
		`Requested recipient: ${requestedRecipient}`,
		`Delivered recipient: ${deliveredRecipient}`,
		`Email test mode enabled: ${testModeEnabled ? 'yes' : 'no'}`
	];

	if (testModeEnabled && testModeRecipient) {
		lines.push(`Email test mode recipient: ${testModeRecipient}`);
	}

	lines.push(`Sent at: ${new Date().toISOString()}`);
	return `${lines.join('\n')}\n`;
}

function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

async function postAdmin_system_settings_email_testHandler(req) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'admin.system_settings.email_test.post');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser) {
			throw new AccessControlError('Authentication required.', 401);
		}
		if (actingUser.role !== 'ADMINISTRATOR') {
			throw new AccessControlError('Only administrators can send a test email.', 403);
		}
		if (hostedManagedIntegrationsEnabled()) {
			return NextResponse.json(
				{ error: 'Email delivery settings are managed by your hosting provider.' },
				{ status: 403 }
			);
		}

		const body = await req.json().catch(() => ({}));
		const siteName = asTrimmedString(body?.siteName) || 'Hire Gnome ATS';
		const smtpHost = asTrimmedString(body?.smtpHost);
		const smtpPort = toNullablePort(body?.smtpPort);
		const smtpSecure = toBoolean(body?.smtpSecure);
		const smtpUser = asTrimmedString(body?.smtpUser);
		const smtpPass = asTrimmedString(body?.smtpPass);
		const smtpFromName = asTrimmedString(body?.smtpFromName);
		const smtpFromEmail = asTrimmedString(body?.smtpFromEmail).toLowerCase();
		const requestedRecipient = asTrimmedString(actingUser.email).toLowerCase();

		if (!isValidEmailAddress(requestedRecipient)) {
			return NextResponse.json(
				{ error: 'Your admin user account must have a valid email address to receive test emails.' },
				{ status: 400 }
			);
		}

		const configError = validateSmtpConfig({
			smtpHost,
			smtpPort,
			smtpUser,
			smtpPass,
			smtpFromEmail
		});
		if (configError) {
			return NextResponse.json({ error: configError }, { status: 400 });
		}

		const testModeEnabled = toBoolean(process.env.EMAIL_TEST_MODE);
		const testModeRecipient = asTrimmedString(process.env.EMAIL_TEST_RECIPIENT).toLowerCase();
		if (testModeEnabled && !isValidEmailAddress(testModeRecipient)) {
			return NextResponse.json(
				{ error: 'EMAIL_TEST_MODE is enabled but EMAIL_TEST_RECIPIENT is missing or invalid.' },
				{ status: 400 }
			);
		}

		const deliveredRecipient = testModeEnabled ? testModeRecipient : requestedRecipient;
		const transporter = nodemailer.createTransport({
			host: smtpHost,
			port: smtpPort,
			secure: smtpSecure,
			auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
		});

		await transporter.sendMail({
			from: formatFromAddress(smtpFromName, smtpFromEmail),
			to: deliveredRecipient,
			subject: `${siteName}: SMTP Test Email`,
			text: buildTextBody({
				siteName,
				requestedRecipient,
				deliveredRecipient,
				testModeEnabled,
				testModeRecipient
			})
		});

		return NextResponse.json({
			ok: true,
			message: testModeEnabled
				? `Test email sent. EMAIL_TEST_MODE is enabled, so delivery was routed to ${deliveredRecipient}.`
				: `Test email sent to ${deliveredRecipient}.`,
			requestedRecipient,
			deliveredRecipient,
			testModeEnabled
		});
	} catch (error) {
		const fallback = error instanceof Error ? error.message : 'Failed to send test email.';
		return handleError(error, fallback);
	}
}

export const POST = withApiLogging('admin.system_settings.email_test.post', postAdmin_system_settings_email_testHandler);
