import { requestOpenAi, aiRequestErrorMessage } from './openai-request.js';
import { z } from 'zod';
import { getIntegrationSettings } from '@/lib/system-settings';

const MAX_SECTION_CHARS = 5000;

const candidateSummarySchema = z.object({
	overview: z.string().default(''),
	strengths: z.array(z.string()).default([]),
	concerns: z.array(z.string()).default([]),
	suggestedNextStep: z.string().default('')
});

function asTrimmedString(value) {
	if (typeof value !== 'string') return '';
	return value.trim();
}

function truncateText(value, maxLength = MAX_SECTION_CHARS) {
	return asTrimmedString(String(value ?? '')).slice(0, maxLength);
}

function uniqueStrings(values) {
	const seen = new Set();
	const items = [];

	for (const rawValue of values || []) {
		const value = asTrimmedString(rawValue);
		if (!value) continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		items.push(value);
	}

	return items;
}

function normalizeModelContent(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';
	const fencedMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fencedMatch ? fencedMatch[1].trim() : raw;
}

function buildCandidateSourceText(candidate) {
	const skillNames = uniqueStrings([
		...(Array.isArray(candidate?.candidateSkills)
			? candidate.candidateSkills.map((candidateSkill) => candidateSkill?.skill?.name)
			: []),
		...String(candidate?.skillSet || '').split(/[,;\n|/]+/)
	]);

	const educationLines = Array.isArray(candidate?.candidateEducations)
		? candidate.candidateEducations.map((education) =>
				[
					asTrimmedString(education?.schoolName),
					asTrimmedString(education?.degree),
					asTrimmedString(education?.fieldOfStudy)
				]
					.filter(Boolean)
					.join(' | ')
			)
		: [];

	const workLines = Array.isArray(candidate?.candidateWorkExperiences)
		? candidate.candidateWorkExperiences.map((workExperience) =>
				[
					asTrimmedString(workExperience?.title),
					asTrimmedString(workExperience?.companyName),
					asTrimmedString(workExperience?.location),
					truncateText(workExperience?.description, 280)
				]
					.filter(Boolean)
					.join(' | ')
			)
		: [];

	const recentNoteLines = Array.isArray(candidate?.notes)
		? candidate.notes
				.slice(0, 5)
				.map((note) => truncateText(note?.content, 400))
				.filter(Boolean)
		: [];

	return [
		`Name: ${[candidate?.firstName, candidate?.lastName].filter(Boolean).join(' ') || '-'}`,
		`Email: ${asTrimmedString(candidate?.email) || '-'}`,
		`Mobile: ${asTrimmedString(candidate?.mobile || candidate?.phone) || '-'}`,
		`Status: ${asTrimmedString(candidate?.status) || '-'}`,
		`Source: ${asTrimmedString(candidate?.source) || '-'}`,
		`Current Title: ${asTrimmedString(candidate?.currentJobTitle) || '-'}`,
		`Current Employer: ${asTrimmedString(candidate?.currentEmployer) || '-'}`,
		`Location: ${[candidate?.city, candidate?.state, candidate?.zipCode].filter(Boolean).join(', ') || '-'}`,
		`Website: ${asTrimmedString(candidate?.website) || '-'}`,
		`LinkedIn: ${asTrimmedString(candidate?.linkedinUrl) || '-'}`,
		'',
		'Resume Summary:',
		truncateText(candidate?.summary, MAX_SECTION_CHARS) || 'None provided.',
		'',
		'Skills:',
		skillNames.length > 0 ? skillNames.join(', ') : 'None listed.',
		'',
		'Education:',
		educationLines.length > 0 ? educationLines.join('\n') : 'None listed.',
		'',
		'Work Experience:',
		workLines.length > 0 ? workLines.join('\n') : 'None listed.',
		'',
		'Recent Notes:',
		recentNoteLines.length > 0 ? recentNoteLines.join('\n---\n') : 'No notes.'
	].join('\n');
}

function buildSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			overview: { type: 'string' },
			strengths: { type: 'array', items: { type: 'string' } },
			concerns: { type: 'array', items: { type: 'string' } },
			suggestedNextStep: { type: 'string' }
		},
		required: ['overview', 'strengths', 'concerns', 'suggestedNextStep']
	};
}

export async function generateCandidateSummaryWithOpenAi(candidate) {
	const integrationSettings = await getIntegrationSettings();
	const apiKey = integrationSettings?.openAiApiKey;
	if (!apiKey) {
		return {
			ok: false,
			error: 'OpenAI API key is not configured in Admin > Settings.'
		};
	}

	const sourceText = buildCandidateSourceText(candidate);
	if (!asTrimmedString(sourceText)) {
		return {
			ok: false,
			error: 'Candidate data is too limited to summarize.'
		};
	}

	try {
		const response = await requestOpenAi('candidate-summary', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: integrationSettings.openAiResumeModel,
				temperature: 0.2,
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'candidate_summary',
						strict: true,
						schema: buildSchema()
					}
				},
				messages: [
					{
						role: 'system',
						content:
							'You are assisting recruiters. Produce a concise, factual candidate summary. Do not invent experience. Keep the overview to 2-4 sentences. Strengths and concerns should be short bullets. Suggested next step should be a single practical recruiter action.'
					},
					{
						role: 'user',
						content: [
							'Generate a recruiter-facing candidate summary from the following profile.',
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
				error: 'OpenAI candidate summary request failed.'
			};
		}

		const payload = await response.json().catch(() => ({}));
		const content = normalizeModelContent(payload?.choices?.[0]?.message?.content || '');
		if (!content) {
			return {
				ok: false,
				error: 'OpenAI returned an empty candidate summary.'
			};
		}

		const parsed = candidateSummarySchema.safeParse(JSON.parse(content));
		if (!parsed.success) {
			return {
				ok: false,
				error: 'OpenAI returned an invalid candidate summary.'
			};
		}

		return {
			ok: true,
			summary: {
				overview: truncateText(parsed.data.overview, 3000),
				strengths: uniqueStrings(parsed.data.strengths).slice(0, 6),
				concerns: uniqueStrings(parsed.data.concerns).slice(0, 6),
				suggestedNextStep: truncateText(parsed.data.suggestedNextStep, 1200)
			},
			modelName: integrationSettings.openAiResumeModel
		};
	} catch (error) {
		return {
			ok: false,
			error: aiRequestErrorMessage(error, 'OpenAI candidate summary is unavailable right now.')
		};
	}
}
