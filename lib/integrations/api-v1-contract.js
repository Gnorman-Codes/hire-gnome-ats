import { z } from 'zod';
import { CANDIDATE_STATUS_OPTIONS } from '@/lib/candidate-status';
import { CLIENT_STATUS_OPTIONS } from '@/lib/client-status-options';
import { isValidEmailAddress } from '@/lib/email-validation';
import { JOB_ORDER_EMPLOYMENT_TYPES, JOB_ORDER_STATUS_VALUES } from '@/lib/job-order-options';
import { isValidOptionalHttpUrl } from '@/lib/url-validation';

const text = z.string().trim().min(1).max(191);
const optionalText = text.nullable().optional();
const optionalLongText = z.string().trim().max(12000).nullable().optional();
const optionalUrl = optionalText.refine((value) => isValidOptionalHttpUrl(value), 'Use an HTTP or HTTPS URL.');
const email = text.email().refine(isValidEmailAddress).transform((value) => value.toLowerCase());
export const apiRecordId = text;

const location = { address: optionalText, city: optionalText, state: optionalText, zipCode: optionalText };
const common = {
	ownerRecordId: apiRecordId.optional(),
	customFields: z.record(z.string(), z.unknown()).optional()
};

function resource(model, entityType, moduleKey, shape, relations = {}) {
	const schema = z.object(shape).strict();
	return {
		model, entityType, moduleKey, schema, relations,
		fields: Object.keys(shape).filter((field) => field !== 'stageChangeReason' && !Object.hasOwn(relations, field))
	};
}

export const resources = {
	clients: resource('client', 'CLIENT', 'clients', {
		...common, ...location, name: text, zipCode: text, industry: optionalText, phone: optionalText,
		website: optionalUrl, description: optionalLongText,
		status: z.enum(CLIENT_STATUS_OPTIONS.map(({ value }) => value)).optional()
	}, { ownerRecordId: 'ownerUser', divisionRecordId: 'division' }),
	contacts: resource('contact', 'CONTACT', 'contacts', {
		...common, firstName: text, lastName: text, email, phone: text, source: text,
		address: optionalText, title: optionalText, department: optionalText, linkedinUrl: optionalUrl,
		clientRecordId: apiRecordId
	}, { ownerRecordId: 'ownerUser', divisionRecordId: 'division', clientRecordId: 'client' }),
	candidates: resource('candidate', 'CANDIDATE', 'candidates', {
		...common, ...location, firstName: text, lastName: text, email, mobile: text, phone: optionalText,
		source: text, currentJobTitle: text, currentEmployer: text,
		status: z.enum(CANDIDATE_STATUS_OPTIONS.map(({ value }) => value)).optional(),
		stageChangeReason: z.string().trim().min(1).max(1000).optional(),
		website: optionalUrl, linkedinUrl: optionalUrl, summary: optionalLongText, skillSet: optionalLongText,
		experienceYears: z.number().finite().nonnegative().nullable().optional()
	}, { ownerRecordId: 'ownerUser', divisionRecordId: 'division' }),
	'job-orders': resource('jobOrder', 'JOB_ORDER', 'jobOrders', {
		...common, title: text, description: optionalText, location: optionalText,
		city: optionalText, state: optionalText, zipCode: text,
		status: z.enum(JOB_ORDER_STATUS_VALUES).optional(),
		employmentType: z.enum(JOB_ORDER_EMPLOYMENT_TYPES).nullable().optional(),
		openings: z.number().int().min(1).max(2147483647).optional(),
		currency: z.enum(['USD', 'CAD']).optional(),
		salaryMin: z.number().finite().nonnegative().nullable().optional(),
		salaryMax: z.number().finite().nonnegative().nullable().optional(),
		clientRecordId: apiRecordId, contactRecordId: apiRecordId
	}, {
		ownerRecordId: 'ownerUser', divisionRecordId: 'division',
		clientRecordId: 'client', contactRecordId: 'contact'
	}),
	submissions: resource('submission', 'SUBMISSION', 'submissions', {
		candidateRecordId: apiRecordId, jobOrderRecordId: apiRecordId,
		submittedByRecordId: apiRecordId.optional(),
		status: z.enum(['submitted', 'under_review', 'qualified', 'offered', 'hired', 'rejected']).optional(),
		notes: optionalLongText, customFields: common.customFields
	}, { candidateRecordId: 'candidate', jobOrderRecordId: 'jobOrder', submittedByRecordId: 'createdByUser' })
};

export const candidateUpsertSchema = resources.candidates.schema.partial().required({ email: true });
export const apiEmail = email;
