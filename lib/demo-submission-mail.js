import 'server-only';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

const demoAddress = 'demo-submissions@example.test';

export function getDemoSubmissionSinkDirectory() {
	const directory = (process.env.DEMO_SUBMISSION_MAIL_DIR || '').trim();
	return isAbsolute(directory) ? directory : '';
}

export async function captureDemoSubmissionEmail({ communicationId, subject, text }) {
	const directory = getDemoSubmissionSinkDirectory();
	if (!directory) return { sent: false };
	try {
		const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
		const { message } = await transport.sendMail({ from: demoAddress, to: demoAddress, subject, text });
		const path = join(directory, `submission-${communicationId}-${randomUUID()}.eml`);
		await writeFile(path, message, { flag: 'wx', mode: 0o600 });
		return { sent: true, testMode: true };
	} catch {
		return { sent: false };
	}
}
