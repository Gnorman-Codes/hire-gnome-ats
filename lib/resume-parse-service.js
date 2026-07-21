import { parseResumeToDraft } from '@/lib/resume-parser';
import { parseResumeToDraftWithOpenAi } from '@/lib/openai-resume-parser';
import { buildResumeSummaryText } from '@/lib/resume-summary';

/**
 * Turn raw resume text into a normalized candidate draft.
 *
 * Prefers the OpenAI parser when an API key is configured and falls back to the
 * deterministic regex parser otherwise, so it works with or without AI. Shared
 * by the single resume-parse endpoint and the bulk resume upload flow so both
 * produce identical draft shapes.
 *
 * @param {string} resumeText
 * @returns {Promise<{
 *   draft: object,
 *   warnings: string[],
 *   parsedSkills: string[],
 *   educationRecords: object[],
 *   workExperienceRecords: object[],
 *   parser: 'openai' | 'fallback'
 * }>}
 */
export async function parseResumeDraft(resumeText) {
	const openAiResult = await parseResumeToDraftWithOpenAi(resumeText);
	if (openAiResult.ok) {
		const draft = {
			...openAiResult.draft,
			summary: buildResumeSummaryText({
				rawResumeText: resumeText,
				draft: openAiResult.draft,
				parsedSkills: openAiResult.parsedSkills || [],
				educationRecords: openAiResult.educationRecords || [],
				workExperienceRecords: openAiResult.workExperienceRecords || []
			})
		};

		return {
			draft,
			warnings: openAiResult.warnings,
			parsedSkills: openAiResult.parsedSkills || [],
			educationRecords: openAiResult.educationRecords || [],
			workExperienceRecords: openAiResult.workExperienceRecords || [],
			parser: 'openai'
		};
	}

	const fallbackResult = parseResumeToDraft(resumeText);
	const warnings = [
		...(openAiResult.warning ? [openAiResult.warning] : []),
		...(Array.isArray(fallbackResult.warnings) ? fallbackResult.warnings : [])
	];
	const draft = {
		...fallbackResult.draft,
		summary: buildResumeSummaryText({
			rawResumeText: resumeText,
			draft: fallbackResult.draft,
			parsedSkills: fallbackResult.parsedSkills || [],
			educationRecords: fallbackResult.educationRecords || [],
			workExperienceRecords: fallbackResult.workExperienceRecords || []
		})
	};

	return {
		draft,
		warnings,
		parsedSkills: fallbackResult.parsedSkills || [],
		educationRecords: fallbackResult.educationRecords || [],
		workExperienceRecords: fallbackResult.workExperienceRecords || [],
		parser: 'fallback'
	};
}
