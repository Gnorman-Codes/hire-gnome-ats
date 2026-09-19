import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
	AccessControlError,
	getActingUser
} from '@/lib/access-control';
import { ensureDefaultUnassignedDivision } from '@/lib/default-division';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { createCandidateFromResumeFile } from '@/lib/candidate-bulk-create';
import { BULK_RESUME_UPLOAD_MAX_FILES } from '@/lib/candidate-attachment-options';
import {
	RESUME_PARSE_RATE_LIMIT_MAX_REQUESTS,
	RESUME_PARSE_RATE_LIMIT_WINDOW_SECONDS
} from '@/lib/security-constants';
import { withApiLogging } from '@/lib/api-logging';

async function postBulkUpload(req) {
	try {
		const actingUser = await getActingUser(req, { allowFallback: false });
		if (!actingUser) {
			return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
		}

		const throttleResponse = await enforceMutationThrottle(req, 'candidates.bulk_upload.post', {
			maxRequests: RESUME_PARSE_RATE_LIMIT_MAX_REQUESTS,
			windowSeconds: RESUME_PARSE_RATE_LIMIT_WINDOW_SECONDS,
			message: 'Too many bulk upload requests. Please try again shortly.'
		});
		if (throttleResponse) {
			return throttleResponse;
		}

		const contentType = req.headers.get('content-type') || '';
		if (!contentType.includes('multipart/form-data')) {
			return NextResponse.json(
				{ error: 'Send resume files as multipart/form-data.' },
				{ status: 400 }
			);
		}

		const formData = await req.formData();
		const files = formData
			.getAll('files')
			.filter((entry) => entry && typeof entry.arrayBuffer === 'function');

		if (files.length === 0) {
			return NextResponse.json({ error: 'Attach at least one resume file.' }, { status: 400 });
		}

		if (files.length > BULK_RESUME_UPLOAD_MAX_FILES) {
			return NextResponse.json(
				{
					error: `Too many files. Upload up to ${BULK_RESUME_UPLOAD_MAX_FILES} resumes at a time.`
				},
				{ status: 400 }
			);
		}

		// Administrators without a division get the shared "Unassigned" division,
		// mirroring single candidate creation.
		const defaultDivisionForAdmin =
			actingUser.role === 'ADMINISTRATOR' && !actingUser.divisionId
				? await ensureDefaultUnassignedDivision(prisma)
				: null;
		const defaultDivisionId = defaultDivisionForAdmin ? defaultDivisionForAdmin.id : null;

		// Process sequentially to keep DB/storage load predictable and to avoid
		// unique-email races between resumes belonging to the same person.
		const results = [];
		for (const file of files) {
			// eslint-disable-next-line no-await-in-loop
			const outcome = await createCandidateFromResumeFile({
				file,
				actingUser,
				defaultDivisionId
			});
			results.push(outcome);
		}

		const summary = {
			total: results.length,
			created: results.filter((entry) => entry.status === 'created').length,
			duplicates: results.filter((entry) => entry.status === 'duplicate').length,
			skipped: results.filter((entry) => entry.status === 'skipped').length,
			failed: results.filter((entry) => entry.status === 'failed').length
		};

		return NextResponse.json({ summary, results }, { status: 201 });
	} catch (error) {
		if (error instanceof AccessControlError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		return NextResponse.json(
			{ error: error?.message || 'Failed to process bulk upload.' },
			{ status: 500 }
		);
	}
}

export const POST = withApiLogging('candidates.bulk_upload.post', postBulkUpload);
