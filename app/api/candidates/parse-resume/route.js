import { NextResponse } from 'next/server';
import { z } from 'zod';
import { extractResumeTextFromFile } from '@/lib/resume-file-parser';
import { parseResumeDraft } from '@/lib/resume-parse-service';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import {
	RESUME_PARSE_RATE_LIMIT_MAX_REQUESTS,
	RESUME_PARSE_RATE_LIMIT_WINDOW_SECONDS
} from '@/lib/security-constants';
import { parseJsonBody, ValidationError } from '@/lib/request-validation';

import { withApiLogging } from '@/lib/api-logging';
import { getActingUser } from '@/lib/access-control';
const parseResumeSchema = z.object({
	resumeText: z.string().min(40)
});

async function postParseResume(req) {
	try {
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser) {
			return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
		}

		const mutationThrottleResponse = await enforceMutationThrottle(
			req,
			'candidates.parse_resume.post',
			{
				maxRequests: RESUME_PARSE_RATE_LIMIT_MAX_REQUESTS,
				windowSeconds: RESUME_PARSE_RATE_LIMIT_WINDOW_SECONDS,
				message: 'Too many resume parse requests. Please try again shortly.'
			}
		);
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const contentType = req.headers.get('content-type') || '';

		if (contentType.includes('multipart/form-data')) {
			const formData = await req.formData();
			const file = formData.get('file');

			if (!file || typeof file.arrayBuffer !== 'function') {
				return NextResponse.json({ error: 'Upload a resume file.' }, { status: 400 });
			}

			const { text, fileType } = await extractResumeTextFromFile(file);
			if (text.length < 40) {
				return NextResponse.json(
					{ error: 'Could not extract enough text from the uploaded file.' },
					{ status: 400 }
				);
			}

			const result = await parseResumeDraft(text);
			return NextResponse.json({
				...result,
				meta: {
					input: 'file',
					fileType,
					fileName: file.name || '',
					parser: result.parser
				}
			});
		}

		const body = await parseJsonBody(req);
		const parsed = parseResumeSchema.safeParse(body);

		if (!parsed.success) {
			return NextResponse.json(
				{ error: 'Provide resume text (at least 40 characters) to parse.' },
				{ status: 400 }
			);
		}

		const result = await parseResumeDraft(parsed.data.resumeText);

		return NextResponse.json({
			...result,
			meta: { input: 'text', parser: result.parser }
		});
	} catch (error) {
		if (error instanceof ValidationError) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		return NextResponse.json({ error: error.message || 'Failed to parse resume.' }, { status: 400 });
	}
}

export const POST = withApiLogging('candidates.parse_resume.post', postParseResume);
