import { requestOpenAi, aiRequestErrorMessage } from './openai-request.js';
import { z } from 'zod';
import { getIntegrationSettings } from '@/lib/system-settings';

const MAX_SECTION_CHARS = 5000;

const emailDraftSchema = z.object({
	subject: z.string().default(''),
	body: z.string().default('')
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

function buildSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			subject: { type: 'string' },
			body: { type: 'string' }
		},
		required: ['subject', 'body']
	};
}

function buildCandidateSourceText(candidate) {
	const skillNames = uniqueStrings([
		...(Array.isArray(candidate?.candidateSkills)
			? candidate.candidateSkills.map((candidateSkill) => candidateSkill?.skill?.name)
			: []),
		...String(candidate?.skillSet || '').split(/[,;\n|/]+/)
	]);

	const recentNoteLines = Array.isArray(candidate?.notes)
		? candidate.notes
				.slice(0, 5)
				.map((note) => truncateText(note?.content, 300))
				.filter(Boolean)
		: [];

	return [
		`Entity Type: Candidate`,
		`Name: ${[candidate?.firstName, candidate?.lastName].filter(Boolean).join(' ') || '-'}`,
		`Email: ${asTrimmedString(candidate?.email) || '-'}`,
		`Status: ${asTrimmedString(candidate?.status) || '-'}`,
		`Source: ${asTrimmedString(candidate?.source) || '-'}`,
		`Current Title: ${asTrimmedString(candidate?.currentJobTitle) || '-'}`,
		`Current Employer: ${asTrimmedString(candidate?.currentEmployer) || '-'}`,
		`Location: ${[candidate?.city, candidate?.state].filter(Boolean).join(', ') || '-'}`,
		'',
		'Summary:',
		truncateText(candidate?.summary, 2200) || 'None provided.',
		'',
		'Skills:',
		skillNames.length > 0 ? skillNames.join(', ') : 'None listed.',
		'',
		'Recent Notes:',
		recentNoteLines.length > 0 ? recentNoteLines.join('\n---\n') : 'No notes.'
	].join('\n');
}

function buildContactSourceText(contact) {
	const recentNoteLines = Array.isArray(contact?.notes)
		? contact.notes
				.slice(0, 5)
				.map((note) => truncateText(note?.content, 300))
				.filter(Boolean)
		: [];

	return [
		`Entity Type: Contact`,
		`Name: ${[contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || '-'}`,
		`Email: ${asTrimmedString(contact?.email) || '-'}`,
		`Phone: ${asTrimmedString(contact?.phone) || '-'}`,
		`Title: ${asTrimmedString(contact?.title) || '-'}`,
		`Department: ${asTrimmedString(contact?.department) || '-'}`,
		`Client: ${asTrimmedString(contact?.client?.name) || '-'}`,
		`Source: ${asTrimmedString(contact?.source) || '-'}`,
		'',
		'Recent Notes:',
		recentNoteLines.length > 0 ? recentNoteLines.join('\n---\n') : 'No notes.'
	].join('\n');
}

export async function generateEmailDraftWithOpenAi({
	entityType,
	entity,
	purpose,
	tone,
	instructions
}) {
	const integrationSettings = await getIntegrationSettings();
	const apiKey = integrationSettings?.openAiApiKey;
	if (!apiKey) {
		return {
			ok: false,
			error: 'OpenAI API key is not configured in Admin > Settings.'
		};
	}

	const sourceText =
		entityType === 'candidate' ? buildCandidateSourceText(entity) : buildContactSourceText(entity);
	if (!asTrimmedString(sourceText)) {
		return {
			ok: false,
			error: 'Record data is too limited to draft an email.'
		};
	}

	try {
		const response = await requestOpenAi('email-draft', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: integrationSettings.openAiResumeModel,
				temperature: 0.35,
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'email_draft',
						strict: true,
						schema: buildSchema()
					}
				},
				messages: [
					{
						role: 'system',
						content:
							'You draft concise professional recruiting emails. Return a JSON object with subject and body only. Do not invent facts. Keep emails practical, polished, and ready to send. Body should be plain text with short paragraphs and no markdown.'
					},
					{
						role: 'user',
						content: [
							`Draft a ${tone} recruiting email for this ${entityType}.`,
							`Purpose: ${purpose}.`,
							instructions ? `Extra instructions: ${truncateText(instructions, 1200)}` : '',
							'',
							sourceText
						]
							.filter(Boolean)
							.join('\n')
					}
				]
			})
		});

		if (!response.ok) {
			return {
				ok: false,
				error: 'OpenAI email draft request failed.'
			};
		}

		const payload = await response.json().catch(() => ({}));
		const content = normalizeModelContent(payload?.choices?.[0]?.message?.content || '');
		if (!content) {
			return {
				ok: false,
				error: 'OpenAI returned an empty email draft.'
			};
		}

		const parsed = emailDraftSchema.safeParse(JSON.parse(content));
		if (!parsed.success) {
			return {
				ok: false,
				error: 'OpenAI returned an invalid email draft.'
			};
		}

		return {
			ok: true,
			draft: {
				subject: truncateText(parsed.data.subject, 240),
				body: truncateText(parsed.data.body, 5000)
			},
			modelName: integrationSettings.openAiResumeModel
		};
	} catch (error) {
		return {
			ok: false,
			error: aiRequestErrorMessage(error, 'OpenAI email drafting is unavailable right now.')
		};
	}
}
