#!/usr/bin/env node

require('./load-env.cjs');

const { PrismaClient } = require('@prisma/client');
const crypto = require('node:crypto');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { SKILLS_TO_SEED } = require('./seed-skills');
const { buildPublicJobDescription } = require('./demo-job-description');

const RECORD_ID_PREFIX_BY_MODEL = Object.freeze({
	Division: 'DIV',
	SystemSetting: 'SYS',
	User: 'USR',
	AuditLog: 'AUD',
	BillingSeatSyncEvent: 'BIL',
	Candidate: 'CAN',
	Skill: 'SKL',
	CandidateNote: 'CNO',
	CandidateActivity: 'CAT',
	CandidateEducation: 'CED',
	CandidateWorkExperience: 'CWR',
	CandidateAttachment: 'CAF',
	ClientPortalAccess: 'CPA',
	ClientSubmissionFeedback: 'CSF',
	Client: 'CLI',
	Contact: 'CON',
	ClientNote: 'CLN',
	ContactNote: 'CTN',
	JobOrder: 'JOB',
	Submission: 'SUB',
	Interview: 'INT',
	Offer: 'PLC'
});

const RECORD_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECORD_ID_RANDOM_LENGTH = 8;

function randomRecordIdToken() {
	let token = '';
	for (let index = 0; index < RECORD_ID_RANDOM_LENGTH; index += 1) {
		token += RECORD_ID_ALPHABET[crypto.randomInt(0, RECORD_ID_ALPHABET.length)];
	}
	return token;
}

function withRecordId(data, modelName) {
	if (!data || typeof data !== 'object') return data;
	if (Array.isArray(data)) {
		return data.map((item) => withRecordId(item, modelName));
	}
	if (data.recordId) return data;

	const prefix = RECORD_ID_PREFIX_BY_MODEL[modelName];
	if (!prefix) return data;
	return {
		...data,
		recordId: `${prefix}-${randomRecordIdToken()}`
	};
}

const prisma = new PrismaClient().$extends({
	query: {
		$allModels: {
			async create({ model, args, query }) {
				return query({
					...args,
					data: withRecordId(args && args.data, model)
				});
			},
			async createMany({ model, args, query }) {
				return query({
					...args,
					data: withRecordId(args && args.data, model)
				});
			},
			async upsert({ model, args, query }) {
				return query({
					...args,
					create: withRecordId(args && args.create, model)
				});
			}
		}
	}
});

const PERSON_EMAIL_DOMAIN = 'demoats.com';
const DIVISION_PREFIX = 'HG Seed - ';
const configuredLoginPassword = String(process.env.AUTH_DEFAULT_PASSWORD || '').trim();
const DEFAULT_LOGIN_PASSWORD = configuredLoginPassword.length >= 8 ? configuredLoginPassword : 'Welcome123!';
const DEMO_SITE_NAME = 'Hire Gnome ATS';
const DEMO_THEME_KEY = 'classic_blue';

const SOURCE_OPTIONS = [
	'CareerBuilder',
	'Facebook',
	'Glassdoor',
	'Indeed',
	'Job Fair/Tradeshow',
	'LinkedIn',
	'Monster',
	'Networking',
	'Other',
	'Previously Placed',
	'Professional Association',
	'Referral',
	'The Ladders'
];

const INDUSTRY_OPTIONS = [
	'Technology',
	'Financial Services',
	'Healthcare',
	'Professional Services',
	'Manufacturing',
	'Telecommunications',
	'Logistics',
	'Energy'
];
const CLIENT_STATUSES = ['Prospect', 'Active', 'Active + Verified', 'Inactive'];

const CANDIDATE_STATUSES = ['new', 'in_review', 'qualified', 'submitted', 'interview', 'offered'];
const JOB_STATUSES = ['open', 'on_hold', 'open'];
const SUBMISSION_STATUSES = ['submitted', 'under_review', 'qualified', 'interview', 'offered'];
const INTERVIEW_STATUSES = ['scheduled', 'completed'];
const INTERVIEW_TYPES = ['phone', 'video', 'in_person'];
const EMPLOYMENT_TYPES = ['Permanent', 'Temporary - W2', 'Temporary - 1099'];

const DIVISIONS_TO_SEED = [
	{ name: `${DIVISION_PREFIX}Technology`, accessMode: 'COLLABORATIVE' },
	{ name: `${DIVISION_PREFIX}Healthcare`, accessMode: 'OWNER_ONLY' },
	{ name: `${DIVISION_PREFIX}Finance & Operations`, accessMode: 'COLLABORATIVE' }
];

const HEALTHCARE_DIVISION_INDEX = 1;
const CLIENT_DIVISION_SEQUENCE = [1, 0, 2, 1, 0, 1, 2, 1];
const CANDIDATE_DIVISION_SEQUENCE = [1, 0, 2, 1, 0, 1, 2, 0, 1, 2];
const JOB_DIVISION_SEQUENCE = [1, 0, 2, 1, 0, 1, 2, 1, 0, 2];

const USERS_TO_SEED = [
	{ firstName: 'Alicia', lastName: 'Morgan', role: 'ADMINISTRATOR', divisionIndex: 0 },
	{ firstName: 'Derek', lastName: 'Mills', role: 'DIRECTOR', divisionIndex: 0 },
	{ firstName: 'Priya', lastName: 'Shah', role: 'RECRUITER', divisionIndex: 0 },
	{ firstName: 'Noah', lastName: 'Bennett', role: 'RECRUITER', divisionIndex: 0 },
	{ firstName: 'Monica', lastName: 'Ruiz', role: 'DIRECTOR', divisionIndex: 1 },
	{ firstName: 'Ethan', lastName: 'Park', role: 'RECRUITER', divisionIndex: 1 },
	{ firstName: 'Lena', lastName: 'Foster', role: 'RECRUITER', divisionIndex: 1 },
	{ firstName: 'Victor', lastName: 'Nguyen', role: 'DIRECTOR', divisionIndex: 2 },
	{ firstName: 'Sofia', lastName: 'Klein', role: 'RECRUITER', divisionIndex: 2 },
	{ firstName: 'Marcus', lastName: 'Reed', role: 'RECRUITER', divisionIndex: 2 }
];

const CLIENTS_TO_SEED = [
	{ name: 'Northstar Health Systems', website: 'https://www.northstarhealthsystems.com', industry: 'Healthcare' },
	{ name: 'LedgerPeak Financial Group', website: 'https://www.ledgerpeakfinancial.com', industry: 'Financial Services' },
	{ name: 'Atlas Industrial Group', website: 'https://www.atlasindustrialgroup.com', industry: 'Manufacturing' },
	{ name: 'Helix BioLabs', website: 'https://www.helixbiolabs.com', industry: 'Healthcare' },
	{ name: 'Meridian Logistics', website: 'https://www.meridianlogistics.com', industry: 'Logistics' },
	{ name: 'Summit Legal Partners', website: 'https://www.summitlegalpartners.com', industry: 'Professional Services' },
	{ name: 'HarborView Energy', website: 'https://www.harborviewenergy.com', industry: 'Energy' },
	{ name: 'Pioneer Insurance Group', website: 'https://www.pioneerinsurancegroup.com', industry: 'Financial Services' },
	{ name: 'ClearPath Cloud', website: 'https://www.clearpathcloud.com', industry: 'Technology' },
	{ name: 'Stonebridge Manufacturing', website: 'https://www.stonebridgemfg.com', industry: 'Manufacturing' },
	{ name: 'Cedar Ridge Medical', website: 'https://www.cedarridgemedical.com', industry: 'Healthcare' },
	{ name: 'Brightline Telecom', website: 'https://www.brightlinetelecom.com', industry: 'Telecommunications' },
	{ name: 'Redwood Care Partners', website: 'https://www.redwoodcarepartners.com', industry: 'Healthcare' },
	{ name: 'Silverline Clinical Consulting', website: 'https://www.silverlineclinical.com', industry: 'Healthcare' },
	{ name: 'VenturePoint Capital', website: 'https://www.venturepointcapital.com', industry: 'Financial Services' },
	{ name: 'Oakwell Care Management', website: 'https://www.oakwellcare.com', industry: 'Healthcare' },
	{ name: 'Beacon Data Solutions', website: 'https://www.beacondatasolutions.com', industry: 'Technology' },
	{ name: 'Mosaic Care Network', website: 'https://www.mosaiccarenetwork.com', industry: 'Healthcare' }
];

const CONTACT_FIRST_NAMES = [
	'Emily',
	'Daniel',
	'Olivia',
	'Michael',
	'Lauren',
	'Ryan',
	'Tessa',
	'Jonathan',
	'Grace',
	'Henry',
	'Nicole',
	'Adam',
	'Katherine',
	'Benjamin',
	'Rachel',
	'Thomas',
	'Megan',
	'Kevin'
];

const CONTACT_LAST_NAMES = [
	'Carter',
	'Sullivan',
	'Brooks',
	'Price',
	'Hayes',
	'Porter',
	'Bishop',
	'Grant',
	'Fisher',
	'Powell',
	'Hughes',
	'Murphy',
	'Coleman',
	'Watkins',
	'Baxter',
	'Stevens',
	'Ross',
	'Mason'
];

const CONTACT_TITLES = [
	'Hiring Manager',
	'Talent Acquisition Manager',
	'HR Business Partner',
	'Director of Talent',
	'Department Manager'
];

const CONTACT_DEPARTMENTS = [
	'Engineering',
	'Operations',
	'Finance',
	'Clinical',
	'People Operations'
];

const CANDIDATE_FIRST_NAMES = [
	'Emma',
	'Liam',
	'Ava',
	'James',
	'Sophia',
	'Benjamin',
	'Isabella',
	'Lucas',
	'Mia',
	'Mason',
	'Amelia',
	'Elijah',
	'Charlotte',
	'Logan',
	'Harper',
	'Alexander',
	'Evelyn',
	'Jackson',
	'Abigail',
	'Sebastian',
	'Ella',
	'Carter',
	'Elizabeth',
	'Wyatt'
];

const CANDIDATE_LAST_NAMES = [
	'Parker',
	'Turner',
	'Edwards',
	'Cook',
	'Bailey',
	'Rivera',
	'Cooper',
	'Richardson',
	'Cox',
	'Howard',
	'Ward',
	'Torres',
	'Peterson',
	'Gray',
	'Ramirez',
	'James',
	'Watson',
	'Brooks',
	'Kelly',
	'Sanders',
	'Price',
	'Bennett',
	'Wood',
	'Barnes'
];

const CANDIDATE_TITLE_OPTIONS = [
	'Senior Software Engineer',
	'Cloud Platform Engineer',
	'Data Engineer',
	'Product Manager',
	'Project Manager',
	'Business Analyst',
	'Controller',
	'Staff Accountant',
	'FP&A Analyst',
	'Clinical Operations Manager',
	'Clinical Systems Analyst',
	'Revenue Cycle Analyst',
	'Healthcare Project Manager',
	'Nurse Case Manager',
	'Quality Assurance Lead',
	'Security Engineer'
];

const EMPLOYER_OPTIONS = [
	'Blue Ridge Systems',
	'Quantum Ledger',
	'Acadia Health Partners',
	'Riverline Logistics',
	'Titan Manufacturing',
	'Elevate Advisory Group',
	'BrightPath Telecom',
	'Coreline Energy',
	'Merit Financial Services',
	'Crestview Medical'
];

const JOB_ORDER_TITLES = [
	'Senior Backend Engineer',
	'Cloud Infrastructure Engineer',
	'Data Warehouse Engineer',
	'Technical Project Manager',
	'Product Owner',
	'Senior Financial Analyst',
	'Accounting Manager',
	'Clinical Systems Analyst',
	'Nurse Case Manager',
	'Medical Billing Specialist',
	'EHR Integration Analyst',
	'Security Operations Engineer',
	'QA Automation Engineer',
	'IT Support Manager',
	'Compliance Analyst',
	'Network Engineer',
	'Implementation Consultant'
];

const JOB_LOCATIONS = [
	'Remote',
	'Hybrid - Austin, TX',
	'Hybrid - Chicago, IL',
	'On-site - Denver, CO',
	'Hybrid - Atlanta, GA',
	'On-site - Charlotte, NC',
	'Hybrid - Nashville, TN',
	'Remote'
];

const MARKET_LOCATIONS = [
	{ city: 'Austin', state: 'TX', zipCode: '78701' },
	{ city: 'Dallas', state: 'TX', zipCode: '75201' },
	{ city: 'Denver', state: 'CO', zipCode: '80202' },
	{ city: 'Chicago', state: 'IL', zipCode: '60601' },
	{ city: 'Atlanta', state: 'GA', zipCode: '30303' },
	{ city: 'Nashville', state: 'TN', zipCode: '37201' },
	{ city: 'Phoenix', state: 'AZ', zipCode: '85004' },
	{ city: 'Raleigh', state: 'NC', zipCode: '27601' }
];

function pick(list, index) {
	return list[index % list.length];
}

function slug(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

function makeEmail(kind, _firstName, _lastName, index) {
	return `${kind}${index + 1}@${PERSON_EMAIL_DOMAIN}`;
}

function normalizeNameKey(firstName, lastName) {
	return `${String(firstName || '').trim().toLowerCase()}::${String(lastName || '').trim().toLowerCase()}`;
}

function claimUsedName(usedNames, firstName, lastName) {
	usedNames.add(normalizeNameKey(firstName, lastName));
}

function buildUniqueSeedName({ firstNames, lastNames, index, usedNames }) {
	const firstCount = firstNames.length;
	const lastCount = lastNames.length;
	const total = firstCount * lastCount;
	for (let offset = 0; offset < total; offset += 1) {
		const position = (index + offset) % total;
		const firstName = firstNames[position % firstCount];
		const lastName = lastNames[Math.floor(position / firstCount) % lastCount];
		const key = normalizeNameKey(firstName, lastName);
		if (!usedNames.has(key)) {
			usedNames.add(key);
			return { firstName, lastName };
		}
	}
	throw new Error('Unable to generate a unique seeded name.');
}

function buildSeedUserEmail(userSeed, index, state) {
	if (userSeed?.role === 'ADMINISTRATOR' && !state.adminAssigned) {
		state.adminAssigned = true;
		return `admin@${PERSON_EMAIL_DOMAIN}`;
	}
	if (userSeed?.role === 'RECRUITER' && !state.recruiterAssigned) {
		state.recruiterAssigned = true;
		return `recruiter@${PERSON_EMAIL_DOMAIN}`;
	}
	return makeEmail('user', userSeed?.firstName, userSeed?.lastName, index);
}

function phoneFrom(index) {
	const base = 2000000 + index;
	const str = String(base).padStart(7, '0');
	return `(555) ${str.slice(0, 3)}-${str.slice(3)}`;
}

function dateDaysFromToday(offset, hour = 10, minute = 0) {
	const d = new Date();
	d.setHours(hour, minute, 0, 0);
	d.setDate(d.getDate() + offset);
	return d;
}

function addHours(date, hours) {
	return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function subtractMinutes(date, minutes) {
	return new Date(date.getTime() - minutes * 60 * 1000);
}

function addMinutes(date, minutes) {
	return new Date(date.getTime() + minutes * 60 * 1000);
}

function latestDate(...values) {
	return values
		.map((value) => (value instanceof Date ? value : value ? new Date(value) : null))
		.filter((value) => value && !Number.isNaN(value.getTime()))
		.reduce((latest, value) => (!latest || value > latest ? value : latest), null);
}

function ensureNotBefore(value, floor, minuteOffset = 5) {
	const target = value instanceof Date ? value : new Date(value);
	const minimum = floor instanceof Date ? floor : floor ? new Date(floor) : null;
	if (!minimum || Number.isNaN(minimum.getTime())) return target;
	if (!target || Number.isNaN(target.getTime()) || target < minimum) {
		return addMinutes(minimum, minuteOffset);
	}
	return target;
}

function buildSeedPlacementCommissionSplits({
	candidateOwnerId,
	contactOwnerId,
	clientOwnerId,
	isTempPlacement = false,
	index = 0
} = {}) {
	const splits = [];
	const recruiterCommissionPercent = isTempPlacement ? 10 : 15;
	const salesCommissionPercent = isTempPlacement ? 5 : 7.5;
	const salesUserId = contactOwnerId || clientOwnerId || null;

	if (candidateOwnerId) {
		splits.push({
			recordId: `PCS-${randomRecordIdToken()}`,
			userId: candidateOwnerId,
			role: 'recruiter',
			splitPercent: 100,
			commissionPercent: recruiterCommissionPercent + ((index % 3) * 0.5)
		});
	}

	if (salesUserId) {
		splits.push({
			recordId: `PCS-${randomRecordIdToken()}`,
			userId: salesUserId,
			role: 'sales_rep',
			splitPercent: 100,
			commissionPercent: salesCommissionPercent + ((index % 2) * 0.5)
		});
	}

	return splits;
}

function cleanStorageSegment(value) {
	return String(value || '')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function normalizeResumeFileName(value) {
	const raw = String(value || '').trim();
	const parsed = path.parse(raw);
	const baseName = cleanStorageSegment(parsed.name) || 'resume';
	return `${baseName.slice(0, 80)}.pdf`;
}

function getLocalStorageRoot() {
	return process.env.LOCAL_STORAGE_ROOT || path.join(process.cwd(), '.local-storage');
}

async function writeSeedAttachment({ storageKey, body }) {
	const localRoot = path.resolve(getLocalStorageRoot());
	const normalizedKey = String(storageKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
	const absolutePath = path.resolve(localRoot, normalizedKey);
	await mkdir(path.dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, body);
}

function buildSeedResumeStorageKey(candidateRecordId, fileName) {
	const candidateSegment = cleanStorageSegment(candidateRecordId) || 'candidate';
	const safeFileName = normalizeResumeFileName(fileName);
	return `candidates/${candidateSegment}/seed/${safeFileName}`;
}

function escapePdfText(value) {
	return String(value || '')
		.replace(/\\/g, '\\\\')
		.replace(/\(/g, '\\(')
		.replace(/\)/g, '\\)');
}

function buildSimplePdfBuffer(lines) {
	const objects = [];
	function addObject(content) {
		objects.push(content);
		return objects.length;
	}

	const contentStream = `BT\n/F1 12 Tf\n72 740 Td\n${lines
		.map((line, index) => `${index === 0 ? '' : '0 -18 Td\n'}(${escapePdfText(line)}) Tj\n`)
		.join('')}ET`;
	const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
	const contentsId = addObject(`<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream`);
	const pageId = addObject(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentsId} 0 R >>`);
	const pagesId = addObject(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
	const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

	let pdf = '%PDF-1.4\n';
	const offsets = [0];
	for (let i = 0; i < objects.length; i += 1) {
		offsets.push(Buffer.byteLength(pdf, 'utf8'));
		pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(pdf, 'utf8');
	pdf += `xref\n0 ${objects.length + 1}\n`;
	pdf += '0000000000 65535 f \n';
	for (let i = 1; i < offsets.length; i += 1) {
		pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
	return Buffer.from(pdf, 'utf8');
}

function buildSeedResumePdfBuffer(candidate) {
	const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate';
	const location = [candidate.city, candidate.state].filter(Boolean).join(', ') || 'Open to relocation';
	const skillNames = Array.isArray(candidate.skillNames) ? candidate.skillNames.filter(Boolean) : [];
	return buildSimplePdfBuffer([
		`${candidateName}`,
		`${candidate.currentJobTitle || 'Professional'} | ${candidate.currentEmployer || 'Current Employer'}`,
		`${location}`,
		'',
		'Profile Summary',
		`${candidate.summary || 'Experienced professional with strong communication, delivery, and stakeholder partnership skills.'}`,
		'',
		'Core Strengths',
		'- Cross-functional collaboration',
		'- Client-facing communication',
		'- Process improvement and execution',
		...(skillNames.length > 0 ? ['', 'Skills', skillNames.join(', ')] : []),
		'',
		'Experience',
		`${candidate.currentEmployer || 'Current Employer'} - ${candidate.currentJobTitle || 'Professional'}`
	]);
}

function buildSeedResumeSearchText(candidate) {
	return [
		`${candidate.firstName || ''} ${candidate.lastName || ''}`.trim(),
		candidate.currentJobTitle || '',
		candidate.currentEmployer || '',
		[candidate.city, candidate.state].filter(Boolean).join(', '),
		candidate.summary || '',
		Array.isArray(candidate.skillNames) ? candidate.skillNames.join(' ') : '',
		candidate.skillSet || '',
		'Cross-functional collaboration client-facing communication process improvement execution'
	]
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildCandidateProfileVariant(index) {
	switch (index % 8) {
		case 0:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: true,
				summaryStyle: 'long',
				skillCount: 5,
				workHistoryCount: 2,
				includeEducation: true,
				includeOtherSkillsNote: true
			};
		case 1:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'medium',
				skillCount: 4,
				workHistoryCount: 2,
				includeEducation: true,
				includeOtherSkillsNote: false
			};
		case 2:
			return {
				includeResume: true,
				includeLinkedin: false,
				includeWebsite: false,
				summaryStyle: 'medium',
				skillCount: 2,
				workHistoryCount: 1,
				includeEducation: false,
				includeOtherSkillsNote: false
			};
		case 3:
			return {
				includeResume: false,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'short',
				skillCount: 2,
				workHistoryCount: 1,
				includeEducation: true,
				includeOtherSkillsNote: false
			};
		case 4:
			return {
				includeResume: false,
				includeLinkedin: false,
				includeWebsite: false,
				summaryStyle: 'none',
				skillCount: 1,
				workHistoryCount: 0,
				includeEducation: false,
				includeOtherSkillsNote: false
			};
		case 5:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'long',
				skillCount: 4,
				workHistoryCount: 2,
				includeEducation: false,
				includeOtherSkillsNote: false
			};
		case 6:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'short',
				skillCount: 2,
				workHistoryCount: 0,
				includeEducation: true,
				includeOtherSkillsNote: false
			};
		default:
			return {
				includeResume: false,
				includeLinkedin: false,
				includeWebsite: true,
				summaryStyle: 'medium',
				skillCount: 3,
				workHistoryCount: 1,
				includeEducation: false,
				includeOtherSkillsNote: true
			};
	}
}

function buildCandidateSeedSummary({ title, market, employer, variant }) {
	if (variant.summaryStyle === 'none') return null;
	if (variant.summaryStyle === 'short') {
		return `${title} in ${market.city}. Open to new opportunities.`;
	}
	if (variant.summaryStyle === 'medium') {
		return `${title} with delivery experience across cross-functional teams in ${market.city}. Open to hybrid and remote opportunities.`;
	}
	return `${title} with strong delivery history across cross-functional teams in ${market.city}. Currently driving results at ${employer} with a focus on stakeholder communication, execution quality, and measurable operational improvement. Open to hybrid and remote opportunities.`;
}

function dateYearsAgo(years, month = 0) {
	const d = new Date();
	d.setMonth(month, 1);
	d.setHours(9, 0, 0, 0);
	d.setFullYear(d.getFullYear() - years);
	return d;
}

function irregularPastOffset(index, windowSize, salt = 0) {
	const bucketCount = Math.max(1, Number(windowSize) || 1);
	const multipliers = [3, 5, 9, 11, 13];
	const multiplier = multipliers[Math.abs(Number(salt) || 0) % multipliers.length];
	return ((index * multiplier) + Math.floor(index / 2) + salt) % bucketCount;
}

function buildSeedTimestamp(index, {
	windowSize = 14,
	salt = 0,
	baseHour = 9,
	hourSpan = 8,
	minuteStep = 7
} = {}) {
	const offset = irregularPastOffset(index, windowSize, salt);
	const hour = baseHour + ((index * 3 + salt) % Math.max(1, hourSpan));
	const minute = ((index * minuteStep) + salt * 13) % 60;
	return dateDaysFromToday(-offset, hour, minute);
}

function buildAcceptedTimestamp(createdAt, index, salt = 0) {
	const target = buildSeedTimestamp(index, {
		windowSize: 14,
		salt,
		baseHour: 10,
		hourSpan: 7,
		minuteStep: 23
	});
	if (target >= createdAt) {
		return target;
	}
	const fallback = addHours(createdAt, 8 + ((index + salt) % 60));
	const nowCeiling = subtractMinutes(new Date(), 10 + ((index + salt) % 45));
	if (fallback > nowCeiling) {
		return nowCeiling > createdAt ? nowCeiling : addHours(createdAt, 1);
	}
	return fallback;
}

async function clearCustomFieldDefinitions() {
	try {
		await prisma.customFieldDefinition.deleteMany({});
	} catch (error) {
		if (error?.code === 'P2021' || error?.code === 'P2022') {
			console.warn('Skipping custom field definition reset: table not found in current schema.');
			return;
		}
		throw error;
	}
}

async function cleanupSeedData() {
	const { deleteObject } = await import('../lib/object-storage.js');
	const seedUsers = await prisma.user.findMany({
		where: {
			email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` }
		},
		select: { id: true }
	});
	const seedUserIds = seedUsers.map((user) => user.id);

	const seedDivisions = await prisma.division.findMany({
		where: { name: { startsWith: DIVISION_PREFIX } },
		select: { id: true }
	});
	const seedDivisionIds = seedDivisions.map((division) => division.id);
	const seedCandidateAttachmentFiles = await prisma.candidateAttachment.findMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		},
		select: {
			storageProvider: true,
			storageBucket: true,
			storageKey: true
		}
	});

	const scopedJobOrderFilter = seedDivisionIds.length > 0 ? { divisionId: { in: seedDivisionIds } } : { id: -1 };

	try {
		await prisma.clientSubmissionFeedback.deleteMany({
			where: {
				OR: [
					{ submission: { candidate: { email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } } } },
					{ submission: { jobOrder: scopedJobOrderFilter } }
				]
			}
		});
		await prisma.clientPortalAccess.deleteMany({
			where: {
				OR: [
					{ contact: { email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } } },
					{ jobOrder: scopedJobOrderFilter }
				]
			}
		});
	} catch (error) {
		if (error?.code !== 'P2021' && error?.code !== 'P2022') {
			throw error;
		}
	}

	await prisma.offer.deleteMany({
		where: {
			OR: [
				{ candidate: { email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } } },
				{ jobOrder: scopedJobOrderFilter }
			]
		}
	});

	await prisma.interview.deleteMany({
		where: {
			OR: [
				{ candidate: { email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } } },
				{ jobOrder: scopedJobOrderFilter }
			]
		}
	});

	await prisma.submission.deleteMany({
		where: {
			OR: [
				{ candidate: { email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } } },
				{ jobOrder: scopedJobOrderFilter }
			]
		}
	});

	if (seedDivisionIds.length > 0) {
		await prisma.jobOrder.deleteMany({
			where: { divisionId: { in: seedDivisionIds } }
		});
	}

	await prisma.clientNote.deleteMany({
		where: {
			client: seedDivisionIds.length > 0 ? { divisionId: { in: seedDivisionIds } } : { id: -1 }
		}
	});
	await prisma.contactNote.deleteMany({
		where: {
			contact: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	await prisma.candidateNote.deleteMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	await prisma.candidateActivity.deleteMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	await prisma.candidateEducation.deleteMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	await prisma.candidateWorkExperience.deleteMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	await prisma.candidateSkill.deleteMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	await prisma.candidateAttachment.deleteMany({
		where: {
			candidate: {
				OR: [
					{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
					...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
				]
			}
		}
	});
	for (const attachment of seedCandidateAttachmentFiles) {
		try {
			await deleteObject({
				key: attachment.storageKey,
				storageProvider: attachment.storageProvider,
				storageBucket: attachment.storageBucket
			});
		} catch {
			// Demo reseeds should keep going even if one orphaned file is already gone.
		}
	}

	await prisma.contact.deleteMany({
		where: {
			OR: [
				{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
				...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
			]
		}
	});
	if (seedDivisionIds.length > 0) {
		await prisma.client.deleteMany({
			where: { divisionId: { in: seedDivisionIds } }
		});
	}
	await prisma.candidate.deleteMany({
		where: {
			OR: [
				{ email: { endsWith: `@${PERSON_EMAIL_DOMAIN}` } },
				...(seedDivisionIds.length > 0 ? [{ divisionId: { in: seedDivisionIds } }] : [])
			]
		}
	});

	if (seedUserIds.length > 0) {
		await prisma.user.deleteMany({
			where: { id: { in: seedUserIds } }
		});
	}

	if (seedDivisionIds.length > 0) {
		await prisma.division.deleteMany({
			where: { id: { in: seedDivisionIds } }
		});
	}

	await clearCustomFieldDefinitions();
}

async function main() {
	console.log('Resetting and seeding realistic demo data...');
	await cleanupSeedData();
	const { hashPassword } = await import('../lib/password-auth.js');
	const seededPasswordHash = await hashPassword(DEFAULT_LOGIN_PASSWORD);

	const existingSystemSetting = await prisma.systemSetting.findFirst({
		orderBy: { id: 'asc' },
		select: { id: true }
	});
	if (!existingSystemSetting) {
		await prisma.systemSetting.create({
			data: {
				siteName: DEMO_SITE_NAME,
				siteTitle: DEMO_SITE_NAME,
				themeKey: DEMO_THEME_KEY,
				careerSiteEnabled: true,
				clientPortalEnabled: true,
				careerHeroTitle: 'Find your next placement opportunity.',
				careerHeroBody:
					'Explore active roles across healthcare, technology, and professional services. Apply directly through the listing in under two minutes.'
			}
		});
	}

	await prisma.skill.createMany({
		data: SKILLS_TO_SEED.map((skill) => ({
			name: skill.name,
			category: skill.category,
			isActive: true
		})),
		skipDuplicates: true
	});

	const allSkills = await prisma.skill.findMany({
		where: { isActive: true },
		orderBy: { id: 'asc' }
	});

	const divisions = [];
	for (const division of DIVISIONS_TO_SEED) {
		const created = await prisma.division.create({ data: division });
		divisions.push(created);
	}

	const users = [];
	const userEmailState = {
		adminAssigned: false,
		recruiterAssigned: false
	};
	const usedPersonNames = new Set();
	for (let i = 0; i < USERS_TO_SEED.length; i += 1) {
		const userSeed = USERS_TO_SEED[i];
		const division = divisions[userSeed.divisionIndex];
		claimUsedName(usedPersonNames, userSeed.firstName, userSeed.lastName);
		const created = await prisma.user.create({
			data: {
				firstName: userSeed.firstName,
				lastName: userSeed.lastName,
				email: buildSeedUserEmail(userSeed, i, userEmailState),
				role: userSeed.role,
				divisionId: division?.id ?? null,
				isActive: true,
				passwordHash: seededPasswordHash,
				passwordChangeRequired: false
			}
		});
		users.push(created);
	}

	const usersByDivision = new Map();
	for (const user of users) {
		const bucket = usersByDivision.get(user.divisionId) || [];
		bucket.push(user);
		usersByDivision.set(user.divisionId, bucket);
	}

	const clients = [];
	for (let i = 0; i < CLIENTS_TO_SEED.length; i += 1) {
		const clientSeed = CLIENTS_TO_SEED[i];
		const divisionIndex =
			clientSeed.industry === 'Healthcare'
				? HEALTHCARE_DIVISION_INDEX
				: CLIENT_DIVISION_SEQUENCE[i % CLIENT_DIVISION_SEQUENCE.length];
		const division = divisions[divisionIndex];
		const divisionUsers = usersByDivision.get(division.id) || [];
		const owner = divisionUsers[i % divisionUsers.length] || null;
		const market = pick(MARKET_LOCATIONS, i);

		const client = await prisma.client.create({
			data: {
				name: clientSeed.name,
				industry: clientSeed.industry || pick(INDUSTRY_OPTIONS, i),
				status: pick(CLIENT_STATUSES, i),
				phone: phoneFrom(90 + i),
				address: `${110 + i} ${pick(['Market', 'Main', 'Broadway', 'Oak', 'Lake'], i)} Street`,
				city: market.city,
				state: market.state,
				zipCode: market.zipCode,
				website: clientSeed.website,
				description: `${clientSeed.name} is a priority account with recurring hiring needs across professional and technical functions.`,
				ownerId: owner?.id ?? null,
				divisionId: division.id
			}
		});
		clients.push(client);

		await prisma.clientNote.create({
			data: {
				clientId: client.id,
				createdByUserId: owner?.id ?? null,
				content: 'Quarterly planning call complete. Hiring roadmap and interview SLAs confirmed.'
			}
		});
	}

	const contacts = [];
	for (let i = 0; i < clients.length; i += 1) {
		const client = clients[i];
		const divisionUsers = usersByDivision.get(client.divisionId) || [];

		for (let j = 0; j < 2; j += 1) {
			const idx = i * 2 + j;
			const { firstName, lastName } = buildUniqueSeedName({
				firstNames: CONTACT_FIRST_NAMES,
				lastNames: CONTACT_LAST_NAMES,
				index: idx,
				usedNames: usedPersonNames
			});
			const owner = divisionUsers[(idx + 1) % divisionUsers.length] || null;
			const title = pick(CONTACT_TITLES, idx);

			const contact = await prisma.contact.create({
				data: {
					firstName,
					lastName,
					email: makeEmail('contact', firstName, lastName, idx),
					phone: phoneFrom(300 + idx),
					title,
					department: pick(CONTACT_DEPARTMENTS, idx),
					source: pick(SOURCE_OPTIONS, idx + 4),
					linkedinUrl: `https://linkedin.com/in/${slug(firstName)}-${slug(lastName)}-${idx + 1}`,
					ownerId: owner?.id ?? null,
					divisionId: client.divisionId,
					clientId: client.id
				}
			});
			contacts.push(contact);

			await prisma.contactNote.create({
				data: {
					contactId: contact.id,
					createdByUserId: owner?.id ?? null,
					content: `${title} prefers shortlists with compensation expectations and interview availability.`
				}
			});
		}
	}

	const candidates = [];
	for (let i = 0; i < 48; i += 1) {
		const { firstName, lastName } = buildUniqueSeedName({
			firstNames: CANDIDATE_FIRST_NAMES,
			lastNames: CANDIDATE_LAST_NAMES,
			index: i * 3 + 1,
			usedNames: usedPersonNames
		});
		const division = divisions[CANDIDATE_DIVISION_SEQUENCE[i % CANDIDATE_DIVISION_SEQUENCE.length]];
		const divisionUsers = usersByDivision.get(division.id) || [];
		const owner = divisionUsers[(i + 2) % divisionUsers.length] || null;
		const market = pick(MARKET_LOCATIONS, i);
		const title = pick(CANDIDATE_TITLE_OPTIONS, i);
		const employer = pick(EMPLOYER_OPTIONS, i + 1);
		const profileVariant = buildCandidateProfileVariant(i);
		const createdAt = buildSeedTimestamp(i, {
			windowSize: 14,
			salt: 3,
			baseHour: 8,
			hourSpan: 9,
			minuteStep: 11
		});
		const updatedAt = addHours(createdAt, 4 + ((i * 5) % 36));
		const selectedSkills = [
			allSkills[i % allSkills.length],
			allSkills[(i + 2) % allSkills.length],
			allSkills[(i + 6) % allSkills.length],
			allSkills[(i + 11) % allSkills.length],
			allSkills[(i + 14) % allSkills.length]
		].filter(Boolean).slice(0, profileVariant.skillCount);
		const candidateSeed = {
			firstName,
			lastName,
			currentJobTitle: title,
			currentEmployer: employer,
			city: market.city,
			state: market.state,
			skillNames: selectedSkills.map((skill) => skill.name).filter(Boolean),
			skillSet: profileVariant.includeOtherSkillsNote ? 'Additional niche tooling available on request.' : null,
			summary: buildCandidateSeedSummary({ title, market, employer, variant: profileVariant })
		};

		const candidate = await prisma.candidate.create({
			data: {
				firstName: candidateSeed.firstName,
				lastName: candidateSeed.lastName,
				email: makeEmail('candidate', firstName, lastName, i),
				phone: phoneFrom(700 + i),
				mobile: phoneFrom(1200 + i),
				status: pick(CANDIDATE_STATUSES, i),
				source: pick(SOURCE_OPTIONS, i + 5),
				ownerId: owner?.id ?? null,
				divisionId: division.id,
				currentJobTitle: candidateSeed.currentJobTitle,
				currentEmployer: candidateSeed.currentEmployer,
				city: candidateSeed.city,
				state: candidateSeed.state,
				zipCode: market.zipCode,
				website: profileVariant.includeWebsite ? `https://portfolio.${slug(firstName)}${i + 1}.com` : null,
				linkedinUrl: profileVariant.includeLinkedin ? `https://linkedin.com/in/${slug(firstName)}-${slug(lastName)}-${i + 1}` : null,
				skillSet: candidateSeed.skillSet,
				summary: candidateSeed.summary,
				resumeSearchText: profileVariant.includeResume ? buildSeedResumeSearchText(candidateSeed) : null,
				createdAt,
				updatedAt
			}
		});
		candidates.push(candidate);

		for (const skill of selectedSkills) {
			await prisma.candidateSkill.create({
				data: {
					candidateId: candidate.id,
					skillId: skill.id
				}
			});
		}

		if (profileVariant.includeEducation) {
			await prisma.candidateEducation.create({
				data: {
					candidateId: candidate.id,
					schoolName: i % 2 === 0 ? 'State University' : 'Metro College',
					degree: i % 3 === 0 ? 'MBA' : 'Bachelor of Science',
					fieldOfStudy: i % 2 === 0 ? 'Information Systems' : 'Business Administration',
					startDate: dateYearsAgo(10 + (i % 5), 8),
					endDate: dateYearsAgo(6 + (i % 4), 4),
					description: 'Completed coursework with emphasis on analytics and stakeholder communication.'
				}
			});
		}

		if (profileVariant.workHistoryCount >= 1) {
			await prisma.candidateWorkExperience.create({
				data: {
					candidateId: candidate.id,
					companyName: pick(EMPLOYER_OPTIONS, i + 3),
					title: pick(CANDIDATE_TITLE_OPTIONS, i + 4),
					location: `${market.city}, ${market.state}`,
					startDate: dateYearsAgo(7 + (i % 4), 1),
					endDate: dateYearsAgo(3 + (i % 2), 11),
					description: 'Led delivery initiatives, partnered with client stakeholders, and improved operational metrics.'
				}
			});
		}

		if (profileVariant.workHistoryCount >= 2) {
			await prisma.candidateWorkExperience.create({
				data: {
					candidateId: candidate.id,
					companyName: employer,
					title,
					location: `${market.city}, ${market.state}`,
					startDate: dateYearsAgo(3 + (i % 2), 0),
					isCurrent: true,
					description: 'Currently leading projects with direct ownership of quality, timelines, and cross-functional communication.'
				}
			});
		}

		await prisma.candidateNote.create({
			data: {
				candidateId: candidate.id,
				createdByUserId: owner?.id ?? null,
				content: 'Initial recruiter conversation complete. Candidate is responsive and open to interview scheduling this week.'
			}
		});

		await prisma.candidateActivity.create({
			data: {
				candidateId: candidate.id,
				type: 'call',
				subject: 'Recruiter Screen',
				description: 'Validated compensation, notice period, and preferred work arrangement.',
				dueAt: dateDaysFromToday((i % 9) + 1, 11),
				status: 'open'
			}
		});

		if (profileVariant.includeResume) {
			const resumeFileName = `${firstName}-${lastName}-resume.pdf`;
			const resumeStorageKey = buildSeedResumeStorageKey(candidate.recordId, resumeFileName);
			const resumeBuffer = buildSeedResumePdfBuffer(candidate);
			await writeSeedAttachment({
				storageKey: resumeStorageKey,
				body: resumeBuffer
			});
			await prisma.candidateAttachment.create({
				data: {
					candidateId: candidate.id,
					uploadedByUserId: owner?.id ?? null,
					fileName: resumeFileName,
					isResume: true,
					contentType: 'application/pdf',
					sizeBytes: resumeBuffer.length,
					storageProvider: 'local',
					storageBucket: 'local',
					storageKey: resumeStorageKey,
					createdAt: addMinutes(createdAt, 25),
					updatedAt: addMinutes(createdAt, 25)
				}
			});
		}
	}

	const jobOrders = [];
	const clientsByDivision = new Map();
	for (const client of clients) {
		const bucket = clientsByDivision.get(client.divisionId) || [];
		bucket.push(client);
		clientsByDivision.set(client.divisionId, bucket);
	}

	for (let i = 0; i < 26; i += 1) {
		const division = divisions[JOB_DIVISION_SEQUENCE[i % JOB_DIVISION_SEQUENCE.length]];
		const divisionClients = clientsByDivision.get(division.id) || [];
		const client = divisionClients[i % divisionClients.length];
		const divisionUsers = usersByDivision.get(client.divisionId) || [];
		const owner = divisionUsers[(i + 1) % divisionUsers.length] || null;
		const relatedContacts = contacts.filter((contact) => contact.clientId === client.id);
		const hiringContact = relatedContacts[i % relatedContacts.length] || null;
		const baseTitle = pick(JOB_ORDER_TITLES, i);
		const title = baseTitle;
		const market = pick(MARKET_LOCATIONS, i);
		const location = `${market.city}, ${market.state}`;
		const publishToCareerSite = i % 3 !== 0;
		const employmentType = pick(EMPLOYMENT_TYPES, i);
		const openings = (i % 3) + 1;
		const salaryMin = 85000 + i * 3500;
		const salaryMax = 115000 + i * 3500;
		const openedAt = buildSeedTimestamp(i, {
			windowSize: 16,
			salt: 7,
			baseHour: 8,
			hourSpan: 8,
			minuteStep: 9
		});
		const createdAt = addHours(openedAt, -(6 + (i % 18)));
		const publishedAt = publishToCareerSite ? addHours(openedAt, 2 + (i % 5)) : null;
		const updatedAt = addHours(openedAt, 6 + ((i * 3) % 48));

		const jobOrder = await prisma.jobOrder.create({
			data: {
				title,
				description: `Internal brief: ${title} for ${client.name}. Prioritize candidates with strong stakeholder communication, domain familiarity, and stable tenure.`,
				publicDescription: publishToCareerSite
					? buildPublicJobDescription({
						jobTitle: baseTitle,
						clientName: client.name,
						location,
						employmentType,
						openings,
						salaryMin,
						salaryMax
					})
					: null,
				location,
				city: market.city,
				state: market.state,
				zipCode: market.zipCode,
				status: pick(JOB_STATUSES, i),
				employmentType,
				openings,
				salaryMin,
				salaryMax,
				publishToCareerSite,
				publishedAt,
				openedAt,
				createdAt,
				ownerId: owner?.id ?? null,
				divisionId: client.divisionId,
				clientId: client.id,
				contactId: hiringContact?.id ?? null,
				updatedAt
			}
		});
		jobOrders.push(jobOrder);
	}

	let submissionCount = 0;
	let interviewCount = 0;
	let placementCount = 0;
	let portalAccessCount = 0;
	let portalFeedbackCount = 0;
	const seededSubmissions = [];

	for (let i = 0; i < jobOrders.length; i += 1) {
		const jobOrder = jobOrders[i];
		const divisionUsers = usersByDivision.get(jobOrder.divisionId) || [];
		const createdByUser = divisionUsers[i % divisionUsers.length] || null;
		const divisionCandidates = candidates.filter((candidate) => candidate.divisionId === jobOrder.divisionId);

		const candidatesForJob = [
			divisionCandidates[i % divisionCandidates.length],
			divisionCandidates[(i + 5) % divisionCandidates.length],
			divisionCandidates[(i + 11) % divisionCandidates.length]
		]
			.filter(Boolean)
			.slice(0, [0, 1, 1, 2, 2, 3][i % 6]);

		for (let j = 0; j < candidatesForJob.length; j += 1) {
			const candidate = candidatesForJob[j];
			const rawSubmissionCreatedAt = buildSeedTimestamp((i * 5) + (j * 11), {
				windowSize: 14,
				salt: 17,
				baseHour: 8,
				hourSpan: 9,
				minuteStep: 5
			});
			const submissionCreatedAt = ensureNotBefore(
				rawSubmissionCreatedAt,
				latestDate(addHours(candidate.createdAt, 2), addHours(jobOrder.openedAt, 3)),
				15
			);
			const submissionUpdatedAt = addHours(submissionCreatedAt, 2 + ((i + j) % 30));
				const submission = await prisma.submission.create({
					data: {
						candidateId: candidate.id,
						jobOrderId: jobOrder.id,
						submissionPriority: j + 1,
						isClientVisible: true,
						status: pick(SUBMISSION_STATUSES, i + j),
						notes: 'Submitted with updated resume, compensation targets, and interview availability.',
						createdByUserId: createdByUser?.id ?? null,
					createdAt: submissionCreatedAt,
					updatedAt: submissionUpdatedAt
				}
			});
			submissionCount += 1;
			seededSubmissions.push({
				id: submission.id,
				recordId: submission.recordId,
				jobOrderId: jobOrder.id,
				candidateId: candidate.id,
				candidateName: `${candidate.firstName} ${candidate.lastName}`.trim(),
				submissionPriority: j + 1
			});

			if ((i + j) % 2 === 0) {
				const rawInterviewCreatedAt = buildSeedTimestamp((i * 7) + (j * 13), {
					windowSize: 14,
					salt: 23,
					baseHour: 8,
					hourSpan: 8,
					minuteStep: 17
				});
				const interviewCreatedAt = ensureNotBefore(
					rawInterviewCreatedAt,
					addHours(submissionCreatedAt, 12),
					30
				);
				const startsAt = addHours(interviewCreatedAt, 18 + ((i + j) % 48));
				const interviewUpdatedAt = addHours(interviewCreatedAt, 1 + ((i + j) % 10));
				await prisma.interview.create({
					data: {
						candidateId: candidate.id,
						jobOrderId: jobOrder.id,
						interviewMode: pick(INTERVIEW_TYPES, i + j),
						status: pick(INTERVIEW_STATUSES, i + j),
						subject: `${jobOrder.title} - ${candidate.firstName} ${candidate.lastName}`,
						interviewer: pick(CONTACT_FIRST_NAMES, i + j) + ' ' + pick(CONTACT_LAST_NAMES, i + j),
						interviewerEmail: `interviewer${i + 1}${j + 1}@${PERSON_EMAIL_DOMAIN}`,
						startsAt,
						endsAt: addMinutes(startsAt, pick([30, 45, 60, 90], i + j)),
						location: pick(['Video', 'Phone', 'Client HQ'], i + j),
						createdAt: interviewCreatedAt,
						updatedAt: interviewUpdatedAt
					}
				});
				interviewCount += 1;
			}

			if ((i + j) % 4 === 0) {
				const isTempPlacement = (i + j) % 2 === 0;
				const rawPlacementCreatedAt = buildSeedTimestamp((i * 9) + (j * 5), {
					windowSize: 14,
					salt: 31,
					baseHour: 9,
					hourSpan: 7,
					minuteStep: 19
				});
				const placementCreatedAt = ensureNotBefore(
					rawPlacementCreatedAt,
					addHours(submissionCreatedAt, 24),
					45
				);
				const offeredOn = addHours(placementCreatedAt, 4 + ((i + j) % 12));
				const expectedJoinDate = dateDaysFromToday(10 + irregularPastOffset(i + j, 9, 4), 9, 0);
				const placementUpdatedAt = buildAcceptedTimestamp(placementCreatedAt, (i * 11) + (j * 7), 41);
				const hiringContact = contacts.find((contact) => contact.id === jobOrder.contactId) || null;
				const commissionSplits = buildSeedPlacementCommissionSplits({
					candidateOwnerId: candidate.ownerId,
					contactOwnerId: hiringContact?.ownerId ?? null,
					clientOwnerId: jobOrder.clientId ? clients.find((client) => client.id === jobOrder.clientId)?.ownerId : null,
					isTempPlacement,
					index: i + j
				});
				await prisma.offer.create({
					data: {
						submissionId: submission.id,
						candidateId: candidate.id,
						jobOrderId: jobOrder.id,
						status: 'accepted',
						placementType: isTempPlacement ? 'temp' : 'perm',
						compensationType: isTempPlacement ? 'hourly' : 'salary',
						currency: 'USD',
						hourlyRtBillRate: isTempPlacement ? 98 + (i % 7) : null,
						hourlyRtPayRate: isTempPlacement ? 72 + (i % 5) : null,
						hourlyOtBillRate: isTempPlacement ? 135 + (i % 7) : null,
						hourlyOtPayRate: isTempPlacement ? 96 + (i % 5) : null,
						yearlyCompensation: isTempPlacement ? null : 132000 + i * 1800,
						offeredOn,
						expectedJoinDate,
						notes: 'Placement finalized after client panel interviews and compensation alignment.',
						commissionSplits:
							commissionSplits.length > 0
								? {
									create: commissionSplits
								}
								: undefined,
						createdAt: placementCreatedAt,
						updatedAt: placementUpdatedAt
					}
				});
				await prisma.submission.update({
					where: { id: submission.id },
					data: {
						status: 'placed',
						updatedAt: placementUpdatedAt
					}
				});
				placementCount += 1;
			}
		}
	}

	const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
	const submissionsByJobOrder = new Map();
	for (const submission of seededSubmissions) {
		const bucket = submissionsByJobOrder.get(submission.jobOrderId) || [];
		bucket.push(submission);
		submissionsByJobOrder.set(submission.jobOrderId, bucket);
	}

	for (let i = 0; i < jobOrders.length; i += 1) {
		const jobOrder = jobOrders[i];
		if (!jobOrder.contactId) continue;

		const portalContact = contactsById.get(jobOrder.contactId);
		const jobSubmissions = (submissionsByJobOrder.get(jobOrder.id) || []).sort(
			(left, right) => left.submissionPriority - right.submissionPriority
		);
		if (!portalContact || jobSubmissions.length === 0) continue;

		const accessCreatedAt = buildSeedTimestamp(240 + i, {
			windowSize: 12,
			salt: 59,
			baseHour: 9,
			hourSpan: 7,
			minuteStep: 17
		});
		const portalAccess = await prisma.clientPortalAccess.create({
			data: {
				contactId: portalContact.id,
				jobOrderId: jobOrder.id,
				createdByUserId: jobOrder.ownerId ?? null,
				lastViewedAt: addHours(accessCreatedAt, 3 + (i % 20)),
				lastEmailedAt: addHours(accessCreatedAt, 1 + (i % 10)),
				lastActionAt: i % 3 === 0 ? addHours(accessCreatedAt, 8 + (i % 12)) : null,
				createdAt: accessCreatedAt,
				updatedAt: accessCreatedAt
			}
		});
		portalAccessCount += 1;

		const latestPrimaryFeedbackAt = addHours(accessCreatedAt, 7 + (i % 12));
		await prisma.clientSubmissionFeedback.create({
			data: {
				submissionId: jobSubmissions[0].id,
				portalAccessId: portalAccess.id,
				actionType: i % 2 === 0 ? 'request_interview' : 'comment',
				comment:
					i % 2 === 0
						? 'Please coordinate the next interview round with the hiring team.'
						: 'Strong profile. We would like to review this candidate with the broader team.',
				communicationScore: 3 + (i % 3),
				technicalFitScore: 3 + ((i + 1) % 3),
				cultureFitScore: 2 + ((i + 2) % 4),
				overallRecommendationScore: i % 2 === 0 ? 4 + (i % 2) : 3 + (i % 2),
				clientNameSnapshot: `${portalContact.firstName || ''} ${portalContact.lastName || ''}`.trim(),
				clientEmailSnapshot: portalContact.email || '',
				ipAddress: '127.0.0.1',
				userAgent: 'Demo Seed',
				createdAt: latestPrimaryFeedbackAt,
				updatedAt: latestPrimaryFeedbackAt
			}
		});
		portalFeedbackCount += 1;
		await prisma.clientPortalAccess.update({
			where: { id: portalAccess.id },
			data: {
				lastActionAt: latestPrimaryFeedbackAt
			}
		});

		if (jobSubmissions[1] && i % 4 === 0) {
			const latestPassAt = addHours(accessCreatedAt, 10 + (i % 14));
			const nextPriority = (jobSubmissions[jobSubmissions.length - 1]?.submissionPriority || jobSubmissions[1].submissionPriority) + 1;
			await prisma.submission.update({
				where: { id: jobSubmissions[1].id },
				data: {
					status: 'rejected',
					submissionPriority: nextPriority
				}
			});
			await prisma.clientSubmissionFeedback.create({
				data: {
					submissionId: jobSubmissions[1].id,
					portalAccessId: portalAccess.id,
					actionType: 'pass',
					statusApplied: 'rejected',
					comment: 'Thank you. We are passing on this candidate for now.',
					communicationScore: 2,
					technicalFitScore: 2 + (i % 2),
					cultureFitScore: 2,
					overallRecommendationScore: 1,
					clientNameSnapshot: `${portalContact.firstName || ''} ${portalContact.lastName || ''}`.trim(),
					clientEmailSnapshot: portalContact.email || '',
					ipAddress: '127.0.0.1',
					userAgent: 'Demo Seed',
					createdAt: latestPassAt,
					updatedAt: latestPassAt
				}
			});
			portalFeedbackCount += 1;
			await prisma.clientPortalAccess.update({
				where: { id: portalAccess.id },
				data: {
					lastActionAt: latestPassAt
				}
			});
		}
	}

	console.log('Realistic seed completed.');
	console.log(`Divisions: ${divisions.length}`);
	console.log(`Users: ${users.length}`);
	console.log(`Clients: ${clients.length}`);
	console.log(`Contacts: ${contacts.length}`);
	console.log(`Candidates: ${candidates.length}`);
	console.log(`Job Orders: ${jobOrders.length}`);
	console.log(`Submissions: ${submissionCount}`);
	console.log(`Interviews: ${interviewCount}`);
	console.log(`Placements: ${placementCount}`);
	console.log(`Portal Links: ${portalAccessCount}`);
	console.log(`Portal Feedback Entries: ${portalFeedbackCount}`);

	const adminUser = users.find((user) => user.role === 'ADMINISTRATOR');
	const recruiterUser = users.find((user) => user.role === 'RECRUITER');
	if (adminUser) {
		console.log(`Admin login: ${adminUser.email}`);
	}
	if (recruiterUser) {
		console.log(`Recruiter login: ${recruiterUser.email}`);
	}
	console.log(`Login password for seeded users: ${DEFAULT_LOGIN_PASSWORD}`);
}

main()
	.catch((error) => {
		console.error('Realistic seed failed.');
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
