import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/access-control';
import { withApiLogging } from '@/lib/api-logging';
import { DEMO_MODE } from '@/lib/demo-config';
import { logWarn, requestLogContext } from '@/lib/logger';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';

const SUBMITTED_COOKIE_NAME = 'hg_demo_workspace_requested';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const requestSchema = z.object({
	firstName: z.string().trim().min(1).max(80),
	lastName: z.string().trim().min(1).max(80),
	workEmail: z.string().trim().email().max(254),
	agencyName: z.string().trim().min(1).max(160),
	teamSize: z.string().trim().min(1).max(40),
	currentAts: z.string().trim().max(120).optional().default(''),
	note: z.string().trim().max(2000).optional().default(''),
	botpoisonSolution: z.string().trim().min(1).max(10000)
});

async function postDemoWorkspaceRequestHandler(req) {
	if (!DEMO_MODE) {
		return NextResponse.json({ error: 'Workspace requests are only available in the public demo.' }, { status: 404 });
	}
	const formsparkSubmitUrl = String(process.env.DEMO_WORKSPACE_FORMSPARK_URL || '').trim();
	if (!formsparkSubmitUrl) {
		logWarn('demo.workspace_request.formspark_not_configured', requestLogContext(req));
		return NextResponse.json(
			{ error: 'Workspace requests are temporarily unavailable. Please try again later.' },
			{ status: 503 }
		);
	}

	const user = await getAuthenticatedUser(req, { allowFallback: true });
	if (!user) {
		return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
	}

	if (req.cookies.get(SUBMITTED_COOKIE_NAME)?.value === '1') {
		return NextResponse.json({ ok: true, duplicate: true });
	}

	const mutationThrottleResponse = await enforceMutationThrottle(req, 'demo.workspace_request.post');
	if (mutationThrottleResponse) return mutationThrottleResponse;

	const body = await req.json().catch(() => null);
	const parsed = requestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json(
			{ error: 'Complete all required fields with a valid work email.' },
			{ status: 400 }
		);
	}

	const formResponse = await fetch(formsparkSubmitUrl, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			form_name: 'Demo Workspace Request',
			request_type: 'Demo Workspace Request',
			source: 'Hire Gnome Public Demo',
			first_name: parsed.data.firstName,
			last_name: parsed.data.lastName,
			email: parsed.data.workEmail,
			agency_name: parsed.data.agencyName,
			team_size: parsed.data.teamSize,
			current_ats: parsed.data.currentAts,
			notes: parsed.data.note,
			demo_user_email: user.email || '',
			_botpoison: parsed.data.botpoisonSolution,
			_email: {
				subject: 'Demo Workspace Request'
			}
		}),
		signal: AbortSignal.timeout(12000)
	}).catch(() => null);

	if (!formResponse?.ok) {
		logWarn(
			'demo.workspace_request.formspark_rejected',
			requestLogContext(req, {
				upstreamStatus: formResponse?.status || 0,
				upstreamStatusText: String(formResponse?.statusText || ''),
				formsparkStatus: String(formResponse?.headers?.get('formspark-status') || '')
			})
		);
		return NextResponse.json(
			{ error: 'We could not send your request right now. Please try again.' },
			{ status: 502 }
		);
	}

	const response = NextResponse.json({ ok: true });
	response.cookies.set(SUBMITTED_COOKIE_NAME, '1', {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: ONE_YEAR_SECONDS
	});
	return response;
}

export const POST = withApiLogging('demo.workspace_request.post', postDemoWorkspaceRequestHandler);
