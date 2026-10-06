import { requestOpenAi, aiRequestErrorMessage } from './openai-request.js';
import { getIntegrationSettings } from '@/lib/system-settings';
import { hasMeaningfulRichTextContent, sanitizeRichTextHtml, stripRichTextToPlainText } from '@/lib/rich-text';

const MAX_SOURCE_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 6_000;

function asTrimmedString(value) {
	if (typeof value !== 'string') return '';
	return value.trim();
}

function toShortText(value, maxLength) {
	return asTrimmedString(String(value ?? '')).slice(0, maxLength);
}

function normalizeOutputHtml(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';

	const fencedMatch = raw.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
	return fencedMatch ? fencedMatch[1].trim() : raw;
}

export async function enhancePublicJobPostingWithOpenAi(input) {
	const integrationSettings = await getIntegrationSettings();
	const apiKey = integrationSettings?.openAiApiKey;
	if (!apiKey) {
		return {
			ok: false,
			error: 'OpenAI API key is not configured in Admin > Settings.'
		};
	}

	const sourceHtml = String(input?.publicDescription || '');
	if (!hasMeaningfulRichTextContent(sourceHtml)) {
		return {
			ok: false,
			error: 'Public description is required before AI enhancement.'
		};
	}

	const title = toShortText(input?.title, 200);
	const employmentType = toShortText(input?.employmentType, 120);
	const location = toShortText(input?.location, 200);
	const internalDescription = toShortText(
		stripRichTextToPlainText(input?.description || ''),
		MAX_CONTEXT_CHARS
	);
	const sourceDescription = toShortText(
		stripRichTextToPlainText(sourceHtml),
		MAX_SOURCE_CHARS
	);
	const salaryMin = asTrimmedString(input?.salaryMin);
	const salaryMax = asTrimmedString(input?.salaryMax);
	const currency = asTrimmedString(input?.currency) || 'USD';

	const contextLines = [
		`Job Title: ${title || '-'}`,
		`Employment Type: ${employmentType || '-'}`,
		`Location: ${location || '-'}`,
		`Salary Range: ${salaryMin || '-'} to ${salaryMax || '-'} ${currency}`
	];
	const internalContext = internalDescription
		? `Internal context (do not expose confidential details):\n${internalDescription}`
		: 'Internal context: none';

	try {
		const response = await requestOpenAi('job-posting-enhancer', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: integrationSettings.openAiResumeModel,
				temperature: 0.35,
				messages: [
					{
						role: 'system',
						content:
							'You improve job postings for readability and conversion while staying truthful. Return only HTML fragment content suitable for a rich text editor. Use only these tags: p, ul, ol, li, strong, em, a, br. Do not use markdown. Do not add placeholders or fabricated requirements.'
					},
					{
						role: 'user',
						content: [
							'Enhance this public job posting. Keep facts intact, improve clarity, and keep a professional tone.',
							'',
							...contextLines,
							'',
							internalContext,
							'',
							'Current public description:',
							sourceDescription
						].join('\n')
					}
				]
			})
		});

		if (!response.ok) {
			return {
				ok: false,
				error: 'OpenAI enhancement request failed.'
			};
		}

		const payload = await response.json().catch(() => ({}));
		const content = normalizeOutputHtml(payload?.choices?.[0]?.message?.content || '');
		const sanitized = sanitizeRichTextHtml(content);
		if (!sanitized || !hasMeaningfulRichTextContent(sanitized)) {
			return {
				ok: false,
				error: 'OpenAI returned an empty enhancement.'
			};
		}

		return {
			ok: true,
			enhancedHtml: sanitized
		};
	} catch (error) {
		return {
			ok: false,
			error: aiRequestErrorMessage(error, 'OpenAI enhancement is unavailable right now.')
		};
	}
}
