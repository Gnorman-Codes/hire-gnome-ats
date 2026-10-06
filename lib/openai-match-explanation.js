import { requestOpenAi, aiRequestErrorMessage } from './openai-request.js';
import { z } from 'zod';
import { getIntegrationSettings } from '@/lib/system-settings';

const MAX_SOURCE_CHARS = 10000;

const matchExplanationSchema = z.object({
	whyItMatches: z.string().default(''),
	potentialGaps: z.string().default(''),
	whatToValidate: z.string().default(''),
	recommendedPositioning: z.string().default('')
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

function buildSourceText({ candidate, jobOrder, scorePercent, reasons, risks }) {
	const client = jobOrder?.client || {};
	const candidateSkills = Array.isArray(candidate?.candidateSkills)
		? candidate.candidateSkills.map((row) => row?.skill?.name).filter(Boolean)
		: [];
	const workHistory = Array.isArray(candidate?.candidateWorkExperiences)
		? candidate.candidateWorkExperiences
				.map((work) =>
					[
						asTrimmedString(work?.title),
						asTrimmedString(work?.companyName),
						asTrimmedString(work?.location),
						truncateText(work?.description, 220)
					]
						.filter(Boolean)
						.join(' | ')
				)
				.filter(Boolean)
		: [];

	return [
		'Match Context',
		`Match Score: ${Number.isFinite(Number(scorePercent)) ? `${Math.round(Number(scorePercent))}%` : '-'}`,
		`Scoring Reasons: ${Array.isArray(reasons) && reasons.length > 0 ? reasons.join(' | ') : '-'}`,
		`Scoring Risks: ${Array.isArray(risks) && risks.length > 0 ? risks.join(' | ') : '-'}`,
		'',
		'Candidate',
		`Name: ${[candidate?.firstName, candidate?.lastName].filter(Boolean).join(' ') || '-'}`,
		`Current Title: ${asTrimmedString(candidate?.currentJobTitle) || '-'}`,
		`Current Employer: ${asTrimmedString(candidate?.currentEmployer) || '-'}`,
		`Location: ${[candidate?.city, candidate?.state, candidate?.zipCode].filter(Boolean).join(', ') || '-'}`,
		`Resume Summary: ${truncateText(candidate?.summary, 2600) || '-'}`,
		`Structured Skills: ${candidateSkills.length > 0 ? candidateSkills.join(', ') : '-'}`,
		'',
		'Recent Work History',
		workHistory.length > 0 ? workHistory.join('\n') : '-',
		'',
		'Job Order',
		`Title: ${asTrimmedString(jobOrder?.title) || '-'}`,
		`Client: ${asTrimmedString(client?.name) || '-'}`,
		`Location: ${[jobOrder?.city, jobOrder?.state, jobOrder?.zipCode].filter(Boolean).join(', ') || asTrimmedString(jobOrder?.location) || '-'}`,
		`Employment Type: ${asTrimmedString(jobOrder?.employmentType) || '-'}`,
		`Internal Description: ${truncateText(jobOrder?.description, 3200) || '-'}`
	].join('\n');
}

function buildSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			whyItMatches: { type: 'string' },
			potentialGaps: { type: 'string' },
			whatToValidate: { type: 'string' },
			recommendedPositioning: { type: 'string' }
		},
		required: ['whyItMatches', 'potentialGaps', 'whatToValidate', 'recommendedPositioning']
	};
}

export async function generateMatchExplanationWithOpenAi(payload) {
	const integrationSettings = await getIntegrationSettings();
	const apiKey = integrationSettings?.openAiApiKey;
	if (!apiKey) {
		return {
			ok: false,
			error: 'OpenAI API key is not configured in Admin > Settings.'
		};
	}

	const sourceText = buildSourceText(payload);
	if (!asTrimmedString(sourceText)) {
		return {
			ok: false,
			error: 'Candidate and job order data are too limited to explain this match.'
		};
	}

	try {
		const response = await requestOpenAi('match-explanation', {
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
						name: 'match_explanation',
						strict: true,
						schema: buildSchema()
					}
				},
				messages: [
					{
						role: 'system',
						content:
							'You explain candidate-to-job matches for recruiters. Be factual and concise. Do not invent skills, years, certifications, or experience. Return short plain-text sections that explain why the match is strong, where gaps exist, what to validate, and how a recruiter could position the candidate honestly.'
					},
					{
						role: 'user',
						content: ['Explain this candidate/job match.', '', sourceText].join('\n')
					}
				]
			})
		});

		if (!response.ok) {
			return {
				ok: false,
				error: 'OpenAI match explanation request failed.'
			};
		}

		const payloadJson = await response.json().catch(() => ({}));
		const content = normalizeModelContent(payloadJson?.choices?.[0]?.message?.content || '');
		if (!content) {
			return {
				ok: false,
				error: 'OpenAI returned an empty match explanation.'
			};
		}

		const parsed = matchExplanationSchema.safeParse(JSON.parse(content));
		if (
			!parsed.success ||
			!asTrimmedString(parsed.data.whyItMatches) ||
			!asTrimmedString(parsed.data.potentialGaps) ||
			!asTrimmedString(parsed.data.whatToValidate)
		) {
			return {
				ok: false,
				error: 'OpenAI returned an invalid match explanation.'
			};
		}

		return {
			ok: true,
			explanation: {
				whyItMatches: truncateText(parsed.data.whyItMatches, 2400),
				potentialGaps: truncateText(parsed.data.potentialGaps, 2400),
				whatToValidate: truncateText(parsed.data.whatToValidate, 2400),
				recommendedPositioning: truncateText(parsed.data.recommendedPositioning, 2400)
			},
			modelName: integrationSettings.openAiResumeModel
		};
	} catch (error) {
		return {
			ok: false,
			error: aiRequestErrorMessage(error, 'OpenAI match explanation is unavailable right now.')
		};
	}
}
