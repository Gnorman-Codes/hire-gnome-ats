import { requestOpenAi, aiRequestErrorMessage } from './openai-request.js';
import { z } from 'zod';
import { getIntegrationSettings } from '@/lib/system-settings';

const MAX_SOURCE_CHARS = 10000;

const submissionWriteUpSchema = z.object({
	writeUp: z.string().default('')
});

function asTrimmedString(value) {
	if (typeof value !== 'string') return '';
	return value.trim();
}

function truncateText(value, maxLength = MAX_SOURCE_CHARS) {
	return asTrimmedString(String(value ?? '')).slice(0, maxLength);
}

function normalizeModelContent(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const fencedMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fencedMatch ? fencedMatch[1].trim() : raw;
}

function buildSubmissionSourceText(submission) {
	const candidate = submission?.candidate || {};
	const jobOrder = submission?.jobOrder || {};
	const client = jobOrder?.client || {};

	const skillNames = Array.isArray(candidate?.candidateSkills)
		? candidate.candidateSkills.map((candidateSkill) => candidateSkill?.skill?.name).filter(Boolean)
		: [];
	const workHistory = Array.isArray(candidate?.candidateWorkExperiences)
		? candidate.candidateWorkExperiences
				.map((work) =>
					[
						asTrimmedString(work?.title),
						asTrimmedString(work?.companyName),
						asTrimmedString(work?.location),
						truncateText(work?.description, 240)
					]
						.filter(Boolean)
						.join(' | ')
				)
				.filter(Boolean)
		: [];

	return [
		'Submission Context',
		`Submission Status: ${asTrimmedString(submission?.status) || '-'}`,
		'',
		'Candidate',
		`Name: ${[candidate?.firstName, candidate?.lastName].filter(Boolean).join(' ') || '-'}`,
		`Current Title: ${asTrimmedString(candidate?.currentJobTitle) || '-'}`,
		`Current Employer: ${asTrimmedString(candidate?.currentEmployer) || '-'}`,
		`Location: ${[candidate?.city, candidate?.state, candidate?.zipCode].filter(Boolean).join(', ') || '-'}`,
		`Resume Summary: ${truncateText(candidate?.summary, 3000) || '-'}`,
		`Other Notes: ${truncateText(candidate?.skillSet, 1200) || '-'}`,
		`Skills: ${skillNames.length > 0 ? skillNames.join(', ') : '-'}`,
		'',
		'Recent Work History',
		workHistory.length > 0 ? workHistory.join('\n') : '-',
		'',
		'Job Order',
		`Title: ${asTrimmedString(jobOrder?.title) || '-'}`,
		`Client: ${asTrimmedString(client?.name) || '-'}`,
		`Location: ${asTrimmedString(jobOrder?.location) || '-'}`,
		`Employment Type: ${asTrimmedString(jobOrder?.employmentType) || '-'}`,
		`Internal Description: ${truncateText(jobOrder?.description, 3500) || '-'}`,
		'',
		'Existing Submission Notes',
		truncateText(submission?.notes, 1600) || '-'
	].join('\n');
}

function buildSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			writeUp: { type: 'string' }
		},
		required: ['writeUp']
	};
}

export async function generateSubmissionWriteUpWithOpenAi(submission) {
	const integrationSettings = await getIntegrationSettings();
	const apiKey = integrationSettings?.openAiApiKey;
	if (!apiKey) {
		return {
			ok: false,
			error: 'OpenAI API key is not configured in Admin > Settings.'
		};
	}

	const sourceText = buildSubmissionSourceText(submission);
	if (!asTrimmedString(sourceText)) {
		return {
			ok: false,
			error: 'Submission data is too limited to generate a write-up.'
		};
	}

	try {
		const response = await requestOpenAi('submission-write-up', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: integrationSettings.openAiResumeModel,
				temperature: 0.25,
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'submission_write_up',
						strict: true,
						schema: buildSchema()
					}
				},
				messages: [
					{
						role: 'system',
						content:
							'You write concise, polished candidate submission summaries for clients. Be factual. Do not invent credentials, years, certifications, or domain expertise. Return one plain-text write-up of 2-4 short paragraphs suitable for a recruiter to send to a client.'
					},
					{
						role: 'user',
						content: [
							'Generate a polished client-facing submission write-up for this candidate and job order.',
							'',
							sourceText
						].join('\n')
					}
				]
			})
		});

		if (!response.ok) {
			return {
				ok: false,
				error: 'OpenAI submission write-up request failed.'
			};
		}

		const payload = await response.json().catch(() => ({}));
		const content = normalizeModelContent(payload?.choices?.[0]?.message?.content || '');
		if (!content) {
			return {
				ok: false,
				error: 'OpenAI returned an empty submission write-up.'
			};
		}

		const parsed = submissionWriteUpSchema.safeParse(JSON.parse(content));
		if (!parsed.success || !asTrimmedString(parsed.data.writeUp)) {
			return {
				ok: false,
				error: 'OpenAI returned an invalid submission write-up.'
			};
		}

		return {
			ok: true,
			writeUp: truncateText(parsed.data.writeUp, 6000),
			modelName: integrationSettings.openAiResumeModel
		};
	} catch (error) {
		return {
			ok: false,
			error: aiRequestErrorMessage(error, 'OpenAI submission write-up is unavailable right now.')
		};
	}
}
