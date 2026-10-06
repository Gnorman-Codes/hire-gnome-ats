import { requestOpenAi, aiRequestErrorMessage } from './openai-request.js';
import { z } from 'zod';
import { normalizePhoneNumber } from '@/lib/phone';
import {
	CANDIDATE_SOURCE_OPTIONS,
	normalizeCandidateSourceValue
} from '@/app/constants/candidate-source-options';
import { isValidHttpUrl, normalizeHttpUrl } from '@/lib/url-validation';
import { getIntegrationSettings } from '@/lib/system-settings';

const sourceValues = CANDIDATE_SOURCE_OPTIONS.map((option) => option.value);
const sourceValuesText = sourceValues.join(', ');

const stringField = z.union([z.string(), z.null(), z.undefined()]).optional();
const stringArrayField = z.array(z.string()).optional();

const openAiDraftResponseSchema = z.object({
	draft: z
		.object({
			firstName: stringField,
			lastName: stringField,
			email: stringField,
			mobile: stringField,
			status: stringField,
			source: stringField,
			currentJobTitle: stringField,
			currentEmployer: stringField,
			experienceYears: stringField,
			city: stringField,
			state: stringField,
			zipCode: stringField,
			website: stringField,
			linkedinUrl: stringField,
			skillSet: stringField,
			summary: stringField
		})
		.passthrough(),
	skills: stringArrayField,
	educationHistory: z
		.array(
			z.object({
				schoolName: stringField,
				degree: stringField,
				fieldOfStudy: stringField,
				startDate: stringField,
				endDate: stringField,
				isCurrent: z.union([z.boolean(), z.null(), z.undefined()]).optional(),
				description: stringField
			})
		)
		.optional(),
	workExperienceHistory: z
		.array(
			z.object({
				companyName: stringField,
				title: stringField,
				location: stringField,
				startDate: stringField,
				endDate: stringField,
				isCurrent: z.union([z.boolean(), z.null(), z.undefined()]).optional(),
				description: stringField
			})
		)
		.optional(),
	warnings: z.array(z.string()).optional()
});

function asTrimmedString(value) {
	if (typeof value !== 'string') return '';
	return value.trim();
}

function uniqueStrings(values) {
	const seen = new Set();
	const items = [];

	for (const rawValue of values) {
		const value = asTrimmedString(rawValue);
		if (!value) continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		items.push(value);
	}

	return items;
}

function parseDateToken(token) {
	const cleaned = asTrimmedString(token)
		.replace(/[–—]/g, '-')
		.replace(/\./g, '');
	if (!cleaned) return '';
	if (/present|current|now/i.test(cleaned)) return '';

	const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
	if (!yearMatch) return '';

	const monthMap = {
		jan: '01',
		feb: '02',
		mar: '03',
		apr: '04',
		may: '05',
		jun: '06',
		jul: '07',
		aug: '08',
		sep: '09',
		oct: '10',
		nov: '11',
		dec: '12'
	};
	const monthMatch = cleaned.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i);
	const month = monthMatch ? monthMap[monthMatch[1].toLowerCase()] : '01';

	return `${yearMatch[0]}-${month}-01`;
}

function normalizeDraft(draftInput) {
	const draft = draftInput || {};
	const rawPhone = asTrimmedString(draft.phone);
	const rawMobile = asTrimmedString(draft.mobile);
	const normalizedPhone = normalizePhoneNumber(rawPhone) || rawPhone;
	const normalizedMobile = normalizePhoneNumber(rawMobile) || rawMobile;
	const normalizedWebsite = normalizeHttpUrl(asTrimmedString(draft.website));
	const normalizedLinkedinUrl = normalizeHttpUrl(asTrimmedString(draft.linkedinUrl));
	const source = normalizeCandidateSourceValue(asTrimmedString(draft.source) || 'Other');

	return {
		firstName: asTrimmedString(draft.firstName),
		lastName: asTrimmedString(draft.lastName),
		email: asTrimmedString(draft.email),
		mobile: normalizedMobile || normalizedPhone,
		status: asTrimmedString(draft.status) || 'new',
		source: source || 'Other',
		owner: 'Recruiter',
		currentJobTitle: asTrimmedString(draft.currentJobTitle),
		currentEmployer: asTrimmedString(draft.currentEmployer),
		experienceYears: asTrimmedString(draft.experienceYears),
		city: asTrimmedString(draft.city),
		state: asTrimmedString(draft.state),
		zipCode: asTrimmedString(draft.zipCode),
		website: isValidHttpUrl(normalizedWebsite) ? normalizedWebsite : '',
		linkedinUrl: isValidHttpUrl(normalizedLinkedinUrl) ? normalizedLinkedinUrl : '',
		skillSet: asTrimmedString(draft.skillSet),
		summary: asTrimmedString(draft.summary)
	};
}

function normalizeParsedSkills(skillsInput, fallbackSkillSet) {
	const inlineFallbackSkills = asTrimmedString(fallbackSkillSet).split(/[,;\n|/]+/);
	const values = Array.isArray(skillsInput) ? skillsInput : [];
	return uniqueStrings([...values, ...inlineFallbackSkills]);
}

function normalizeEducationHistory(recordsInput) {
	if (!Array.isArray(recordsInput)) return [];

	return recordsInput
		.map((record) => {
			const schoolName = asTrimmedString(record?.schoolName);
			if (!schoolName) return null;

			const isCurrent = Boolean(record?.isCurrent);
			const endDate = isCurrent ? '' : parseDateToken(record?.endDate);

			return {
				schoolName,
				degree: asTrimmedString(record?.degree),
				fieldOfStudy: asTrimmedString(record?.fieldOfStudy),
				startDate: parseDateToken(record?.startDate),
				endDate,
				isCurrent,
				description: asTrimmedString(record?.description)
			};
		})
		.filter(Boolean)
		.slice(0, 12);
}

function normalizeWorkExperienceHistory(recordsInput) {
	if (!Array.isArray(recordsInput)) return [];

	return recordsInput
		.map((record) => {
			const companyName = asTrimmedString(record?.companyName);
			if (!companyName) return null;

			const isCurrent = Boolean(record?.isCurrent);
			const endDate = isCurrent ? '' : parseDateToken(record?.endDate);

			return {
				companyName,
				title: asTrimmedString(record?.title),
				location: asTrimmedString(record?.location),
				startDate: parseDateToken(record?.startDate),
				endDate,
				isCurrent,
				description: asTrimmedString(record?.description)
			};
		})
		.filter(Boolean)
		.slice(0, 20);
}

function getSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		properties: {
			draft: {
				type: 'object',
				additionalProperties: false,
				properties: {
					firstName: { type: 'string' },
					lastName: { type: 'string' },
					email: { type: 'string' },
					mobile: { type: 'string' },
					status: { type: 'string' },
					source: { type: 'string', enum: sourceValues },
					currentJobTitle: { type: 'string' },
					currentEmployer: { type: 'string' },
					experienceYears: { type: 'string' },
					city: { type: 'string' },
					state: { type: 'string' },
					zipCode: { type: 'string' },
					website: { type: 'string' },
					linkedinUrl: { type: 'string' },
					skillSet: { type: 'string' },
					summary: { type: 'string' }
				},
				required: [
					'firstName',
					'lastName',
					'email',
					'mobile',
					'status',
					'source',
					'currentJobTitle',
					'currentEmployer',
					'experienceYears',
					'city',
					'state',
					'zipCode',
					'website',
					'linkedinUrl',
					'skillSet',
					'summary'
				]
			},
			skills: {
				type: 'array',
				items: { type: 'string' }
			},
			educationHistory: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						schoolName: { type: 'string' },
						degree: { type: 'string' },
						fieldOfStudy: { type: 'string' },
						startDate: { type: 'string' },
						endDate: { type: 'string' },
						isCurrent: { type: 'boolean' },
						description: { type: 'string' }
					},
					required: ['schoolName', 'degree', 'fieldOfStudy', 'startDate', 'endDate', 'isCurrent', 'description']
				}
			},
			workExperienceHistory: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					properties: {
						companyName: { type: 'string' },
						title: { type: 'string' },
						location: { type: 'string' },
						startDate: { type: 'string' },
						endDate: { type: 'string' },
						isCurrent: { type: 'boolean' },
						description: { type: 'string' }
					},
					required: ['companyName', 'title', 'location', 'startDate', 'endDate', 'isCurrent', 'description']
				}
			},
			warnings: {
				type: 'array',
				items: { type: 'string' }
			}
		},
		required: ['draft', 'skills', 'educationHistory', 'workExperienceHistory', 'warnings']
	};
}

function fallbackWarning(message) {
	return {
		ok: false,
		warning: message
	};
}

export async function parseResumeToDraftWithOpenAi(resumeText) {
	const integrationSettings = await getIntegrationSettings();
	const apiKey = integrationSettings.openAiApiKey;
	if (!apiKey) {
		return fallbackWarning('OpenAI API key is not configured. Used built-in resume parser.');
	}

	try {
		const response = await requestOpenAi('resume-parser', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: integrationSettings.openAiResumeModel,
				temperature: 0.1,
				response_format: {
					type: 'json_schema',
					json_schema: {
						name: 'candidate_resume_draft',
						schema: getSchema(),
						strict: true
					}
				},
				messages: [
					{
						role: 'system',
						content:
							'You parse resumes into ATS candidate drafts. Be conservative. Do not invent data. Return empty strings for missing values. Source must be one of: ' +
							sourceValuesText +
							'. Return skills as an array of plain skill names. Return education and work history arrays with normalized start/end dates in YYYY-MM-DD where possible; otherwise return empty string.'
					},
					{
						role: 'user',
						content:
							'Parse this resume into candidate draft fields for an ATS:\n\n' +
							String(resumeText || '')
					}
				]
			})
		});

		if (!response.ok) {
			return fallbackWarning('OpenAI resume parsing failed. Used built-in resume parser.');
		}

		const payload = await response.json();
		const content = payload?.choices?.[0]?.message?.content;
		if (typeof content !== 'string' || !content.trim()) {
			return fallbackWarning('OpenAI resume parsing returned no content. Used built-in resume parser.');
		}

		const parsedJson = JSON.parse(content);
		const parsed = openAiDraftResponseSchema.safeParse(parsedJson);
		if (!parsed.success) {
			return fallbackWarning('OpenAI resume parsing returned an invalid draft. Used built-in resume parser.');
		}

		return {
			ok: true,
			draft: normalizeDraft(parsed.data.draft),
			warnings: Array.isArray(parsed.data.warnings)
				? parsed.data.warnings.map((warning) => asTrimmedString(warning)).filter(Boolean)
				: [],
			parsedSkills: normalizeParsedSkills(parsed.data.skills, parsed.data.draft?.skillSet),
			educationRecords: normalizeEducationHistory(parsed.data.educationHistory),
			workExperienceRecords: normalizeWorkExperienceHistory(parsed.data.workExperienceHistory)
		};
	} catch (error) {
		return fallbackWarning(aiRequestErrorMessage(error, 'OpenAI resume parsing was unavailable.') + ' Used built-in resume parser.');
	}
}
