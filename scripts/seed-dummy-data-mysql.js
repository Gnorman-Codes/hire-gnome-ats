#!/usr/bin/env node

require('./load-env.cjs');

const mysql = require('mysql2/promise');
const { DEFAULT_THEME_KEY } = require('../lib/theme-options.cjs');
const crypto = require('node:crypto');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { SKILLS_TO_SEED } = require('./seed-skills');
const { buildPublicJobDescription } = require('./demo-job-description');

const PERSON_EMAIL_DOMAIN = 'demoats.com';
const DIVISION_PREFIX = 'HG Demo - ';
const CLIENT_PREFIX = 'HG Demo Client ';
const DEMO_SITE_NAME = 'Hire Gnome ATS';

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
	'Telecommunications'
];
const CLIENT_STATUSES = ['Prospect', 'Active', 'Active + Verified', 'Inactive'];
const MARKET_LOCATIONS = [
	{ city: 'Austin', state: 'TX', zipCode: '78701' },
	{ city: 'Denver', state: 'CO', zipCode: '80202' },
	{ city: 'Chicago', state: 'IL', zipCode: '60601' },
	{ city: 'Atlanta', state: 'GA', zipCode: '30303' },
	{ city: 'Nashville', state: 'TN', zipCode: '37201' }
];

const CANDIDATE_STATUSES = ['new', 'in_review', 'qualified', 'submitted', 'interview', 'offered'];
const JOB_STATUSES = ['open', 'on_hold', 'open'];
const SUBMISSION_STATUSES = ['submitted', 'under_review', 'qualified', 'offered'];
const INTERVIEW_TYPES = ['phone', 'video', 'in_person'];
const INTERVIEW_STATUSES = ['scheduled', 'completed'];
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
	'IT Support Manager'
];

const RECORD_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECORD_ID_RANDOM_LENGTH = 8;

function randomRecordIdToken() {
	let token = '';
	for (let index = 0; index < RECORD_ID_RANDOM_LENGTH; index += 1) {
		token += RECORD_ID_ALPHABET[crypto.randomInt(0, RECORD_ID_ALPHABET.length)];
	}
	return token;
}

function buildSeedRecordId(prefix) {
	return `${prefix}-${randomRecordIdToken()}`;
}

function pick(list, index) {
	return list[index % list.length];
}

function phoneFrom(index) {
	const base = 1000000 + index;
	const str = String(base).padStart(7, '0');
	return `(555) ${str.slice(0, 3)}-${str.slice(3)}`;
}

function daysFromToday(offset, hour = 10) {
	const d = new Date();
	d.setHours(hour, 0, 0, 0);
	d.setDate(d.getDate() + offset);
	return d;
}

function addHours(date, hours) {
	return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date, minutes) {
	return new Date(date.getTime() + minutes * 60 * 1000);
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
	const d = new Date();
	d.setHours(hour, minute, 0, 0);
	d.setDate(d.getDate() - offset);
	return d;
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
			recordId: buildSeedRecordId('PCS'),
			userId: candidateOwnerId,
			role: 'recruiter',
			splitPercent: 100,
			commissionPercent: recruiterCommissionPercent + ((index % 3) * 0.5)
		});
	}

	if (salesUserId) {
		splits.push({
			recordId: buildSeedRecordId('PCS'),
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

function buildSeedResumeStorageKey(candidateId, fileName) {
	const candidateSegment = cleanStorageSegment(candidateId) || 'candidate';
	const safeFileName = cleanStorageSegment(path.parse(String(fileName || 'resume.pdf')).name) || 'resume';
	return `candidates/${candidateSegment}/seed/${safeFileName}.pdf`;
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
		candidateName,
		`${candidate.currentJobTitle || 'Professional'} | ${candidate.currentEmployer || 'Current Employer'}`,
		location,
		'',
		'Profile Summary',
		`${candidate.summary || 'Experienced professional with strong communication and delivery skills.'}`,
		...(skillNames.length > 0 ? ['', 'Skills', skillNames.join(', ')] : [])
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
				skillCount: 4,
				workHistoryCount: 2,
				includeEducation: true
			};
		case 1:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'medium',
				skillCount: 3,
				workHistoryCount: 2,
				includeEducation: true
			};
		case 2:
			return {
				includeResume: true,
				includeLinkedin: false,
				includeWebsite: false,
				summaryStyle: 'medium',
				skillCount: 2,
				workHistoryCount: 1,
				includeEducation: false
			};
		case 3:
			return {
				includeResume: false,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'short',
				skillCount: 2,
				workHistoryCount: 1,
				includeEducation: true
			};
		case 4:
			return {
				includeResume: false,
				includeLinkedin: false,
				includeWebsite: false,
				summaryStyle: 'none',
				skillCount: 1,
				workHistoryCount: 0,
				includeEducation: false
			};
		case 5:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'long',
				skillCount: 4,
				workHistoryCount: 2,
				includeEducation: false
			};
		case 6:
			return {
				includeResume: true,
				includeLinkedin: true,
				includeWebsite: false,
				summaryStyle: 'short',
				skillCount: 2,
				workHistoryCount: 0,
				includeEducation: true
			};
		default:
			return {
				includeResume: false,
				includeLinkedin: false,
				includeWebsite: true,
				summaryStyle: 'medium',
				skillCount: 2,
				workHistoryCount: 1,
				includeEducation: false
			};
	}
}

function buildCandidateSeedSummary({ title, city, employer, variant }) {
	if (variant.summaryStyle === 'none') return null;
	if (variant.summaryStyle === 'short') {
		return `${title} in ${city}. Open to new opportunities.`;
	}
	if (variant.summaryStyle === 'medium') {
		return `${title} with delivery experience across cross-functional teams in ${city}. Open to hybrid and remote opportunities.`;
	}
	return `${title} with strong delivery history across cross-functional teams in ${city}. Currently driving results at ${employer} with a focus on stakeholder communication, execution quality, and operational improvement.`;
}

async function tableExists(connection, tableName) {
	const [rows] = await connection.query(
		`SELECT 1
		 FROM information_schema.tables
		 WHERE table_schema = DATABASE()
		 AND table_name = ?
		 LIMIT 1`,
		[tableName]
	);
	return Array.isArray(rows) && rows.length > 0;
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
	return `user${index + 1}@${PERSON_EMAIL_DOMAIN}`;
}

function getConnectionConfig() {
	const dbUrl = process.env.DATABASE_URL || '';
	if (!dbUrl) {
		throw new Error('DATABASE_URL is missing.');
	}

	const parsed = new URL(dbUrl);
	return {
		host: parsed.hostname || 'localhost',
		port: Number(parsed.port || 3306),
		user: decodeURIComponent(parsed.username || 'root'),
		password: decodeURIComponent(parsed.password || ''),
		database: (parsed.pathname || '/ats').replace(/^\//, ''),
		multipleStatements: true
	};
}

async function cleanup(connection) {
	const emailLike = `%@${PERSON_EMAIL_DOMAIN}`;
	const clientLike = `${CLIENT_PREFIX}%`;
	const divisionLike = `${DIVISION_PREFIX}%`;
	const hasClientSubmissionFeedback = await tableExists(connection, 'ClientSubmissionFeedback');
	const hasClientPortalAccess = await tableExists(connection, 'ClientPortalAccess');

	if (hasClientSubmissionFeedback) {
		await connection.query(
			`DELETE csf FROM \`ClientSubmissionFeedback\` csf
			 LEFT JOIN \`Submission\` s ON s.id = csf.submissionId
			 LEFT JOIN \`Candidate\` c ON c.id = s.candidateId
			 LEFT JOIN \`JobOrder\` j ON j.id = s.jobOrderId
			 LEFT JOIN \`Client\` cl ON cl.id = j.clientId
			 WHERE c.email LIKE ? OR cl.name LIKE ?`,
			[emailLike, clientLike]
		);
	}

	if (hasClientPortalAccess) {
		await connection.query(
			`DELETE cpa FROM \`ClientPortalAccess\` cpa
			 LEFT JOIN \`Contact\` ct ON ct.id = cpa.contactId
			 LEFT JOIN \`JobOrder\` j ON j.id = cpa.jobOrderId
			 LEFT JOIN \`Client\` cl ON cl.id = j.clientId
			 WHERE ct.email LIKE ? OR cl.name LIKE ?`,
			[emailLike, clientLike]
		);
	}

	await connection.query(
		`DELETE o FROM \`Offer\` o
		 LEFT JOIN \`Candidate\` c ON c.id = o.candidateId
		 LEFT JOIN \`JobOrder\` j ON j.id = o.jobOrderId
		 LEFT JOIN \`Client\` cl ON cl.id = j.clientId
		 WHERE c.email LIKE ? OR cl.name LIKE ?`,
		[emailLike, clientLike]
	);

	await connection.query(
		`DELETE i FROM \`Interview\` i
		 LEFT JOIN \`Candidate\` c ON c.id = i.candidateId
		 LEFT JOIN \`JobOrder\` j ON j.id = i.jobOrderId
		 LEFT JOIN \`Client\` cl ON cl.id = j.clientId
		 WHERE c.email LIKE ? OR cl.name LIKE ?`,
		[emailLike, clientLike]
	);

	await connection.query(
		`DELETE s FROM \`Submission\` s
		 LEFT JOIN \`Candidate\` c ON c.id = s.candidateId
		 LEFT JOIN \`JobOrder\` j ON j.id = s.jobOrderId
		 LEFT JOIN \`Client\` cl ON cl.id = j.clientId
		 WHERE c.email LIKE ? OR cl.name LIKE ?`,
		[emailLike, clientLike]
	);

	await connection.query(
		'DELETE j FROM `JobOrder` j INNER JOIN `Client` c ON c.id = j.clientId WHERE c.name LIKE ?',
		[clientLike]
	);
	await connection.query(
		'DELETE cn FROM `ClientNote` cn INNER JOIN `Client` c ON c.id = cn.clientId WHERE c.name LIKE ?',
		[clientLike]
	);
	await connection.query(
		'DELETE ctn FROM `ContactNote` ctn INNER JOIN `Contact` c ON c.id = ctn.contactId WHERE c.email LIKE ?',
		[emailLike]
	);
	await connection.query(
		'DELETE can FROM `CandidateNote` can INNER JOIN `Candidate` c ON c.id = can.candidateId WHERE c.email LIKE ?',
		[emailLike]
	);
	await connection.query(
		'DELETE ca FROM `CandidateActivity` ca INNER JOIN `Candidate` c ON c.id = ca.candidateId WHERE c.email LIKE ?',
		[emailLike]
	);
	await connection.query(
		'DELETE cs FROM `CandidateSkill` cs INNER JOIN `Candidate` c ON c.id = cs.candidateId WHERE c.email LIKE ?',
		[emailLike]
	);
	await connection.query(
		'DELETE ce FROM `CandidateEducation` ce INNER JOIN `Candidate` c ON c.id = ce.candidateId WHERE c.email LIKE ?',
		[emailLike]
	);
	await connection.query(
		'DELETE cw FROM `CandidateWorkExperience` cw INNER JOIN `Candidate` c ON c.id = cw.candidateId WHERE c.email LIKE ?',
		[emailLike]
	);
	await connection.query(
		'DELETE caf FROM `CandidateAttachment` caf INNER JOIN `Candidate` c ON c.id = caf.candidateId WHERE c.email LIKE ?',
		[emailLike]
	);

	await connection.query('DELETE FROM `Contact` WHERE email LIKE ?', [emailLike]);
	await connection.query('DELETE FROM `Client` WHERE name LIKE ?', [clientLike]);
	await connection.query('DELETE FROM `Candidate` WHERE email LIKE ?', [emailLike]);
	await connection.query('DELETE FROM `User` WHERE email LIKE ?', [emailLike]);
	await connection.query('DELETE FROM `Division` WHERE name LIKE ?', [divisionLike]);

	const [customFieldDefinitionTable] = await connection.query(
		`SELECT 1
		 FROM information_schema.tables
		 WHERE table_schema = DATABASE()
		 AND table_name = 'CustomFieldDefinition'
		 LIMIT 1`
	);
	if (Array.isArray(customFieldDefinitionTable) && customFieldDefinitionTable.length > 0) {
		await connection.query('DELETE FROM `CustomFieldDefinition`');
	}
}

async function seedSkills(connection) {
	for (let i = 0; i < SKILLS_TO_SEED.length; i += 1) {
		const skill = SKILLS_TO_SEED[i];
		await connection.query(
			'INSERT IGNORE INTO `Skill` (`name`, `category`, `isActive`, `createdAt`, `updatedAt`) VALUES (?, ?, 1, NOW(), NOW())',
			[skill.name, skill.category]
		);
	}

	const [rows] = await connection.query('SELECT id, name FROM `Skill` WHERE isActive = 1 ORDER BY id ASC');
	return rows;
}

async function ensureDemoSystemSettings(connection) {
	const [rows] = await connection.query(
		'SELECT id FROM `SystemSetting` ORDER BY id ASC LIMIT 1'
	);
	if (Array.isArray(rows) && rows.length > 0) {
		return rows[0];
	}

	const [result] = await connection.query(
		`INSERT INTO \`SystemSetting\`
		(\`recordId\`, \`siteName\`, \`siteTitle\`, \`themeKey\`, \`careerSiteEnabled\`, \`clientPortalEnabled\`, \`careerHeroTitle\`, \`careerHeroBody\`, \`createdAt\`, \`updatedAt\`)
		VALUES (?, ?, ?, ?, 1, 1, ?, ?, NOW(), NOW())`,
		[
			'SYS-DEMO',
			DEMO_SITE_NAME,
			DEMO_SITE_NAME,
			DEFAULT_THEME_KEY,
			'Find your next placement opportunity.',
			'Explore active roles across healthcare, technology, and professional services. Apply directly through the listing in under two minutes.'
		]
	);
	return { id: result.insertId };
}

async function main() {
	console.log('Seeding linked demo data via mysql2...');
	const connection = await mysql.createConnection(getConnectionConfig());

	try {
		await connection.beginTransaction();
		await cleanup(connection);
		await ensureDemoSystemSettings(connection);
		const skills = await seedSkills(connection);

		const divisions = [];
		for (const row of [
			{ name: `${DIVISION_PREFIX}Technology`, accessMode: 'COLLABORATIVE' },
			{ name: `${DIVISION_PREFIX}Professional Services`, accessMode: 'OWNER_ONLY' }
		]) {
			const [result] = await connection.query(
				'INSERT INTO `Division` (`name`, `accessMode`, `createdAt`, `updatedAt`) VALUES (?, ?, NOW(), NOW())',
				[row.name, row.accessMode]
			);
			divisions.push({ id: result.insertId, ...row });
		}

		const usersSeed = [
			{ firstName: 'Alex', lastName: 'Admin', role: 'ADMINISTRATOR', divisionIdx: 0 },
			{ firstName: 'Diane', lastName: 'Director', role: 'DIRECTOR', divisionIdx: 0 },
			{ firstName: 'Riley', lastName: 'Recruiter', role: 'RECRUITER', divisionIdx: 0 },
			{ firstName: 'Sam', lastName: 'Sourcing', role: 'RECRUITER', divisionIdx: 0 },
			{ firstName: 'Pat', lastName: 'Partner', role: 'DIRECTOR', divisionIdx: 1 },
			{ firstName: 'Jordan', lastName: 'Recruiter', role: 'RECRUITER', divisionIdx: 1 },
			{ firstName: 'Taylor', lastName: 'Recruiter', role: 'RECRUITER', divisionIdx: 1 }
		];

		const users = [];
		const userEmailState = {
			adminAssigned: false,
			recruiterAssigned: false
		};
		for (const user of usersSeed) {
			const divisionId = divisions[user.divisionIdx].id;
			const email = buildSeedUserEmail(user, users.length, userEmailState);
			const [result] = await connection.query(
				`INSERT INTO \`User\`
				(\`firstName\`, \`lastName\`, \`email\`, \`role\`, \`divisionId\`, \`isActive\`, \`createdAt\`, \`updatedAt\`)
				VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
				[user.firstName, user.lastName, email, user.role, divisionId]
			);
			users.push({ id: result.insertId, ...user, divisionId });
		}

		const usersByDivision = new Map();
		for (const user of users) {
			const bucket = usersByDivision.get(user.divisionId) || [];
			bucket.push(user);
			usersByDivision.set(user.divisionId, bucket);
		}

		const clients = [];
		for (let i = 0; i < 10; i += 1) {
			const division = divisions[i % divisions.length];
			const divisionUsers = usersByDivision.get(division.id);
			const owner = divisionUsers[(i + 1) % divisionUsers.length];
			const market = pick(MARKET_LOCATIONS, i);
			const [result] = await connection.query(
				`INSERT INTO \`Client\`
				(\`name\`, \`industry\`, \`status\`, \`phone\`, \`address\`, \`city\`, \`state\`, \`zipCode\`, \`website\`, \`description\`, \`ownerId\`, \`divisionId\`, \`createdAt\`, \`updatedAt\`)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
				[
					`${CLIENT_PREFIX}${i + 1}`,
					pick(INDUSTRY_OPTIONS, i),
					pick(CLIENT_STATUSES, i),
					phoneFrom(90 + i),
					`${110 + i} ${pick(['Market', 'Main', 'Broadway', 'Oak', 'Lake'], i)} Street`,
					market.city,
					market.state,
					market.zipCode,
					`https://client${i + 1}.example.com`,
					`Demo account ${i + 1} for testing.`,
					owner.id,
					division.id
				]
			);
			clients.push({ id: result.insertId, divisionId: division.id, ownerId: owner.id });
		}

		const contacts = [];
		for (let i = 0; i < clients.length; i += 1) {
			const client = clients[i];
			const divisionUsers = usersByDivision.get(client.divisionId);
			for (let j = 0; j < 2; j += 1) {
				const idx = i * 2 + j;
				const owner = divisionUsers[(idx + 2) % divisionUsers.length];
				const [result] = await connection.query(
					`INSERT INTO \`Contact\`
					(\`firstName\`, \`lastName\`, \`email\`, \`phone\`, \`title\`, \`department\`, \`source\`, \`ownerId\`, \`divisionId\`, \`clientId\`, \`createdAt\`, \`updatedAt\`)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
					[
						`Contact${idx + 1}`,
						`Demo${idx + 1}`,
						`contact${idx + 1}@${PERSON_EMAIL_DOMAIN}`,
						phoneFrom(idx + 1),
						j === 0 ? 'Hiring Manager' : 'HR Partner',
						j === 0 ? 'Engineering' : 'People Ops',
						pick(SOURCE_OPTIONS, idx + 1),
						owner.id,
						client.divisionId,
						client.id
					]
				);

				const contactId = result.insertId;
				contacts.push({
					id: contactId,
					clientId: client.id,
					divisionId: client.divisionId,
					ownerId: owner.id,
					firstName: `Contact${idx + 1}`,
					lastName: `Demo${idx + 1}`,
					email: `contact${idx + 1}@${PERSON_EMAIL_DOMAIN}`
				});
				await connection.query(
					'INSERT INTO `ContactNote` (`content`, `contactId`, `createdByUserId`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, NOW(), NOW())',
					['Initial outreach completed.', contactId, owner.id]
				);
			}

			const noteUser = divisionUsers[0];
			await connection.query(
				'INSERT INTO `ClientNote` (`content`, `clientId`, `createdByUserId`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, NOW(), NOW())',
				['Kickoff completed and hiring plan documented.', client.id, noteUser.id]
			);
		}

		const candidates = [];
		let candidateAttachmentCount = 0;
		for (let i = 0; i < 28; i += 1) {
			const division = divisions[i % divisions.length];
			const divisionUsers = usersByDivision.get(division.id);
			const owner = divisionUsers[(i + 1) % divisionUsers.length];
			const createdAt = buildSeedTimestamp(i, {
				windowSize: 14,
				salt: 3,
				baseHour: 8,
				hourSpan: 9,
				minuteStep: 11
			});
			const updatedAt = addHours(createdAt, 4 + ((i * 5) % 36));
			const profileVariant = buildCandidateProfileVariant(i);
			const selectedSkills = [skills[i % skills.length], skills[(i + 3) % skills.length], skills[(i + 5) % skills.length], skills[(i + 7) % skills.length]]
				.filter(Boolean)
				.slice(0, profileVariant.skillCount);
			const candidateSeed = {
				firstName: `Candidate${i + 1}`,
				lastName: `Demo${i + 1}`,
				currentJobTitle: i % 2 === 0 ? 'Software Engineer' : 'Project Manager',
				currentEmployer: `Employer ${i + 1}`,
				city: i % 2 === 0 ? 'Austin' : 'Denver',
				state: i % 2 === 0 ? 'TX' : 'CO',
				skillNames: selectedSkills.map((skill) => skill.name).filter(Boolean),
				skillSet: null,
				summary: buildCandidateSeedSummary({
					title: i % 2 === 0 ? 'Software Engineer' : 'Project Manager',
					city: i % 2 === 0 ? 'Austin' : 'Denver',
					employer: `Employer ${i + 1}`,
					variant: profileVariant
				})
			};
			const [result] = await connection.query(
				`INSERT INTO \`Candidate\`
				(\`firstName\`, \`lastName\`, \`email\`, \`phone\`, \`mobile\`, \`status\`, \`source\`, \`ownerId\`, \`divisionId\`, \`currentJobTitle\`, \`currentEmployer\`, \`city\`, \`state\`, \`zipCode\`, \`website\`, \`linkedinUrl\`, \`summary\`, \`resumeSearchText\`, \`createdAt\`, \`updatedAt\`)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					candidateSeed.firstName,
					candidateSeed.lastName,
					`candidate${i + 1}@${PERSON_EMAIL_DOMAIN}`,
					phoneFrom(200 + i),
					phoneFrom(500 + i),
					pick(CANDIDATE_STATUSES, i),
					pick(SOURCE_OPTIONS, i + 1),
					owner.id,
					division.id,
					candidateSeed.currentJobTitle,
					candidateSeed.currentEmployer,
					candidateSeed.city,
					candidateSeed.state,
					i % 2 === 0 ? '78701' : '80202',
					profileVariant.includeWebsite ? `https://candidate${i + 1}.portfolio.example` : null,
					profileVariant.includeLinkedin ? `https://linkedin.com/in/candidate-demo-${i + 1}` : null,
					candidateSeed.summary,
					profileVariant.includeResume ? buildSeedResumeSearchText(candidateSeed) : null,
					createdAt,
					updatedAt
				]
			);
			const candidateId = result.insertId;
			candidates.push({ id: candidateId, divisionId: division.id, ownerId: owner.id, createdAt });

			for (const skill of selectedSkills) {
				await connection.query(
					'INSERT IGNORE INTO `CandidateSkill` (`candidateId`, `skillId`, `createdAt`) VALUES (?, ?, NOW())',
					[candidateId, skill.id]
				);
			}

			if (profileVariant.includeEducation) {
				await connection.query(
					'INSERT INTO `CandidateEducation` (`candidateId`, `schoolName`, `degree`, `fieldOfStudy`, `startDate`, `endDate`, `description`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
					[
						candidateId,
						i % 2 === 0 ? 'State University' : 'Metro College',
						i % 3 === 0 ? 'MBA' : 'Bachelor of Science',
						i % 2 === 0 ? 'Information Systems' : 'Business Administration',
						daysFromToday(-(3650 + i), 9),
						daysFromToday(-(2200 + i), 9),
						'Completed coursework with emphasis on analytics and stakeholder communication.'
					]
				);
			}

			if (profileVariant.workHistoryCount >= 1) {
				await connection.query(
					'INSERT INTO `CandidateWorkExperience` (`candidateId`, `companyName`, `title`, `location`, `startDate`, `endDate`, `isCurrent`, `description`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NOW(), NOW())',
					[
						candidateId,
						`Previous Employer ${i + 1}`,
						i % 2 === 0 ? 'Systems Analyst' : 'Project Coordinator',
						`${candidateSeed.city}, ${candidateSeed.state}`,
						daysFromToday(-(2800 + i), 9),
						daysFromToday(-(1100 + i), 9),
						'Led delivery initiatives, partnered with stakeholders, and improved operational metrics.'
					]
				);
			}

			if (profileVariant.workHistoryCount >= 2) {
				await connection.query(
					'INSERT INTO `CandidateWorkExperience` (`candidateId`, `companyName`, `title`, `location`, `startDate`, `endDate`, `isCurrent`, `description`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, NOW(), NOW())',
					[
						candidateId,
						candidateSeed.currentEmployer,
						candidateSeed.currentJobTitle,
						`${candidateSeed.city}, ${candidateSeed.state}`,
						daysFromToday(-(900 + i), 9),
						'Currently leading projects with direct ownership of quality, timelines, and cross-functional communication.'
					]
				);
			}

			await connection.query(
				'INSERT INTO `CandidateNote` (`content`, `candidateId`, `createdByUserId`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?)',
				['Intro call completed. Ready for submission.', candidateId, owner.id, addHours(createdAt, 3), addHours(createdAt, 3)]
			);
			await connection.query(
				'INSERT INTO `CandidateActivity` (`type`, `subject`, `description`, `dueAt`, `status`, `candidateId`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				['call', 'Screening Call', 'Initial screening completed.', daysFromToday((i % 6) + 1), 'open', candidateId, addHours(createdAt, 4), addHours(createdAt, 4)]
			);

			if (profileVariant.includeResume) {
				const resumeFileName = `${candidateSeed.firstName}-${candidateSeed.lastName}-resume.pdf`;
				const resumeStorageKey = buildSeedResumeStorageKey(candidateId, resumeFileName);
				const resumeBuffer = buildSeedResumePdfBuffer(candidateSeed);
				await writeSeedAttachment({
					storageKey: resumeStorageKey,
					body: resumeBuffer
				});
				await connection.query(
					`INSERT INTO \`CandidateAttachment\`
					(\`fileName\`, \`isResume\`, \`contentType\`, \`sizeBytes\`, \`storageProvider\`, \`storageBucket\`, \`storageKey\`, \`candidateId\`, \`uploadedByUserId\`, \`createdAt\`, \`updatedAt\`)
					VALUES (?, 1, 'application/pdf', ?, 'local', 'local', ?, ?, ?, ?, ?)`,
					[resumeFileName, resumeBuffer.length, resumeStorageKey, candidateId, owner.id, addMinutes(createdAt, 25), addMinutes(createdAt, 25)]
				);
				candidateAttachmentCount += 1;
			}
		}

		const jobOrders = [];
		for (let i = 0; i < 14; i += 1) {
			const client = clients[i % clients.length];
			const divisionUsers = usersByDivision.get(client.divisionId);
			const owner = divisionUsers[(i + 2) % divisionUsers.length];
			const clientContacts = contacts.filter((c) => c.clientId === client.id);
			const contact = clientContacts[i % clientContacts.length];
			const market = pick(MARKET_LOCATIONS, i);
			const baseTitle = pick(JOB_ORDER_TITLES, i);
			const employmentType = i % 3 === 0 ? 'Permanent' : i % 3 === 1 ? 'Temporary - W2' : 'Temporary - 1099';
			const salaryMin = 90000 + i * 2500;
			const salaryMax = 120000 + i * 2500;
			const publishToCareerSite = i % 2 === 0 ? 1 : 0;
			const location = `${market.city}, ${market.state}`;
			const openedAt = buildSeedTimestamp(i, {
				windowSize: 16,
				salt: 7,
				baseHour: 8,
				hourSpan: 8,
				minuteStep: 9
			});
			const createdAt = addHours(openedAt, -(6 + (i % 18)));
			const updatedAt = addHours(openedAt, 6 + ((i * 3) % 48));
			const publishedAt = publishToCareerSite ? addHours(openedAt, 2 + (i % 5)) : null;
			const [result] = await connection.query(
				`INSERT INTO \`JobOrder\`
				(\`title\`, \`description\`, \`publicDescription\`, \`location\`, \`city\`, \`state\`, \`zipCode\`, \`status\`, \`employmentType\`, \`openings\`, \`salaryMin\`, \`salaryMax\`, \`publishToCareerSite\`, \`publishedAt\`, \`ownerId\`, \`divisionId\`, \`clientId\`, \`contactId\`, \`openedAt\`, \`createdAt\`, \`updatedAt\`)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					baseTitle,
					`Internal details for ${baseTitle} supporting ${client.name}. Prioritize candidates with strong communication, dependable execution, and relevant domain exposure.`,
					publishToCareerSite
						? buildPublicJobDescription({
							jobTitle: baseTitle,
							clientName: client.name,
							location,
							employmentType,
							openings: (i % 3) + 1,
							salaryMin,
							salaryMax
						})
						: null,
					location,
					market.city,
					market.state,
					market.zipCode,
					pick(JOB_STATUSES, i),
					employmentType,
					(i % 3) + 1,
					salaryMin,
					salaryMax,
					publishToCareerSite,
					publishedAt,
					owner.id,
					client.divisionId,
					client.id,
					contact?.id || null,
					openedAt,
					createdAt,
					updatedAt
				]
			);
			jobOrders.push({
				id: result.insertId,
				divisionId: client.divisionId,
				ownerId: owner.id,
				contactId: contact?.id || null,
				openedAt
			});
		}

		const hasOfferCommissionSplit = await tableExists(connection, 'OfferCommissionSplit');

		let submissionCount = 0;
		let interviewCount = 0;
		let placementCount = 0;
		let portalAccessCount = 0;
		let portalFeedbackCount = 0;
		const seededSubmissions = [];

		for (let i = 0; i < jobOrders.length; i += 1) {
			const job = jobOrders[i];
			const divisionUsers = usersByDivision.get(job.divisionId);
			const creator = divisionUsers[i % divisionUsers.length];
			const candidatesInDivision = candidates.filter((c) => c.divisionId === job.divisionId);
			const picks = [
				candidatesInDivision[i % candidatesInDivision.length],
				candidatesInDivision[(i + 4) % candidatesInDivision.length],
				candidatesInDivision[(i + 8) % candidatesInDivision.length]
			]
				.filter(Boolean)
				.slice(0, [0, 1, 1, 2, 2, 3][i % 6]);

			for (let j = 0; j < picks.length; j += 1) {
				const candidate = picks[j];
				const rawSubmissionCreatedAt = buildSeedTimestamp((i * 5) + (j * 11), {
					windowSize: 14,
					salt: 17,
					baseHour: 8,
					hourSpan: 9,
					minuteStep: 5
				});
				const submissionCreatedAt = ensureNotBefore(
					rawSubmissionCreatedAt,
					latestDate(addHours(candidate.createdAt, 2), addHours(job.openedAt, 3)),
					15
				);
				const submissionUpdatedAt = addHours(submissionCreatedAt, 2 + ((i + j) % 30));
				const [submissionResult] = await connection.query(
					`INSERT INTO \`Submission\`
					(\`submissionPriority\`, \`status\`, \`isClientVisible\`, \`notes\`, \`createdByUserId\`, \`candidateId\`, \`jobOrderId\`, \`createdAt\`, \`updatedAt\`)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[j + 1, pick(SUBMISSION_STATUSES, i + j), true, 'Demo submission.', creator.id, candidate.id, job.id, submissionCreatedAt, submissionUpdatedAt]
				);
				const submissionId = submissionResult.insertId;
				submissionCount += 1;
				seededSubmissions.push({
					id: submissionId,
					jobOrderId: job.id,
					submissionPriority: j + 1
				});

				if ((i + j) % 2 === 0) {
					const interviewCreatedAt = ensureNotBefore(
						buildSeedTimestamp((i * 7) + (j * 13), {
							windowSize: 14,
							salt: 23,
							baseHour: 8,
							hourSpan: 8,
							minuteStep: 17
						}),
						addHours(submissionCreatedAt, 12),
						30
					);
					const startsAt = addHours(interviewCreatedAt, 18 + ((i + j) % 48));
					const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
					const interviewUpdatedAt = addHours(interviewCreatedAt, 1 + ((i + j) % 10));
					await connection.query(
						`INSERT INTO \`Interview\`
						(\`interviewMode\`, \`status\`, \`subject\`, \`interviewer\`, \`interviewerEmail\`, \`startsAt\`, \`endsAt\`, \`location\`, \`candidateId\`, \`jobOrderId\`, \`createdAt\`, \`updatedAt\`)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							pick(INTERVIEW_TYPES, i + j),
							pick(INTERVIEW_STATUSES, i + j),
							`Interview - Candidate ${candidate.id}`,
							`Interviewer ${i + j + 1}`,
							`interviewer${i + j + 1}@${PERSON_EMAIL_DOMAIN}`,
							startsAt,
							endsAt,
							(i + j) % 3 === 0 ? 'Video' : 'Client HQ',
							candidate.id,
							job.id,
							interviewCreatedAt,
							interviewUpdatedAt
						]
					);
					interviewCount += 1;
				}

				if ((i + j) % 3 === 0) {
					const isTemp = (i + j) % 2 === 0;
					const jobContact = contacts.find((contact) => contact.id === job.contactId) || null;
					const jobClient = clients.find((client) => client.id === job.clientId) || null;
					const commissionSplits = buildSeedPlacementCommissionSplits({
						candidateOwnerId: candidate.ownerId,
						contactOwnerId: jobContact?.ownerId ?? null,
						clientOwnerId: jobClient?.ownerId ?? null,
						isTempPlacement: isTemp,
						index: i + j
					});
					const placementCreatedAt = ensureNotBefore(
						buildSeedTimestamp((i * 9) + (j * 5), {
							windowSize: 14,
							salt: 31,
							baseHour: 9,
							hourSpan: 7,
							minuteStep: 19
						}),
						addHours(submissionCreatedAt, 24),
						45
					);
					const placementUpdatedAt = addHours(placementCreatedAt, 8 + ((i + j) % 24));
					const [offerResult] = await connection.query(
						`INSERT INTO \`Offer\`
						(\`recordId\`, \`status\`, \`version\`, \`placementType\`, \`compensationType\`, \`currency\`, \`hourlyRtBillRate\`, \`hourlyRtPayRate\`, \`hourlyOtBillRate\`, \`hourlyOtPayRate\`, \`yearlyCompensation\`, \`offeredOn\`, \`expectedJoinDate\`, \`notes\`, \`submissionId\`, \`candidateId\`, \`jobOrderId\`, \`createdAt\`, \`updatedAt\`)
						VALUES (?, ?, 1, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[
							buildSeedRecordId('PLC'),
							'accepted',
							isTemp ? 'temp' : 'perm',
							isTemp ? 'hourly' : 'salary',
							isTemp ? 95 : null,
							isTemp ? 70 : null,
							isTemp ? 125 : null,
							isTemp ? 95 : null,
							isTemp ? null : 145000,
							addHours(placementCreatedAt, 4 + ((i + j) % 12)),
							daysFromToday(14),
							'Demo placement from submission.',
							submissionId,
							candidate.id,
							job.id,
							placementCreatedAt,
							placementUpdatedAt
						]
					);
					const offerId = offerResult.insertId;
					if (hasOfferCommissionSplit && commissionSplits.length > 0) {
						for (const split of commissionSplits) {
							await connection.query(
								`INSERT INTO \`OfferCommissionSplit\`
								(\`recordId\`, \`offerId\`, \`userId\`, \`role\`, \`splitPercent\`, \`commissionPercent\`, \`createdAt\`, \`updatedAt\`)
								VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
								[
									split.recordId,
									offerId,
									split.userId,
									split.role,
									split.splitPercent,
									split.commissionPercent,
									placementCreatedAt,
									placementUpdatedAt
								]
							);
						}
					}
					await connection.query(
						'UPDATE `Submission` SET `status` = ?, `updatedAt` = NOW() WHERE `id` = ?',
						['placed', submissionId]
					);
					placementCount += 1;
				}
			}
		}

		const hasClientPortalAccess = await tableExists(connection, 'ClientPortalAccess');
		const hasClientSubmissionFeedback = await tableExists(connection, 'ClientSubmissionFeedback');
		if (hasClientPortalAccess && hasClientSubmissionFeedback) {
			const submissionsByJob = new Map();
			for (const submission of seededSubmissions) {
				const bucket = submissionsByJob.get(submission.jobOrderId) || [];
				bucket.push(submission);
				submissionsByJob.set(submission.jobOrderId, bucket);
			}

			for (let i = 0; i < jobOrders.length; i += 1) {
				const job = jobOrders[i];
				const jobSubmissions = (submissionsByJob.get(job.id) || []).sort(
					(left, right) => left.submissionPriority - right.submissionPriority
				);
				if (!job.contactId || jobSubmissions.length === 0) continue;
				const portalContact = contacts.find((contact) => contact.id === job.contactId);
				if (!portalContact) continue;

				const [portalResult] = await connection.query(
					`INSERT INTO \`ClientPortalAccess\`
					(\`contactId\`, \`jobOrderId\`, \`createdByUserId\`, \`isRevoked\`, \`lastViewedAt\`, \`lastActionAt\`, \`lastEmailedAt\`, \`createdAt\`, \`updatedAt\`)
					VALUES (?, ?, ?, 0, ?, ?, ?, NOW(), NOW())`,
					[
						job.contactId,
						job.id,
						job.ownerId,
						daysFromToday(-(i % 5), 9),
						daysFromToday(-(i % 4), 11),
						daysFromToday(-(i % 6), 8)
					]
				);
				const portalAccessId = portalResult.insertId;
				portalAccessCount += 1;

				await connection.query(
					`INSERT INTO \`ClientSubmissionFeedback\`
					(\`submissionId\`, \`portalAccessId\`, \`actionType\`, \`comment\`, \`communicationScore\`, \`technicalFitScore\`, \`cultureFitScore\`, \`overallRecommendationScore\`, \`statusApplied\`, \`clientNameSnapshot\`, \`clientEmailSnapshot\`, \`ipAddress\`, \`userAgent\`, \`createdAt\`, \`updatedAt\`)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '127.0.0.1', 'Demo Seed', NOW(), NOW())`,
					[
						jobSubmissions[0].id,
						portalAccessId,
						i % 2 === 0 ? 'request_interview' : 'comment',
						i % 2 === 0
							? 'Please coordinate the next interview round with the hiring team.'
							: 'Strong profile. We would like to review this candidate with the broader team.',
						3 + (i % 3),
						3 + ((i + 1) % 3),
						2 + ((i + 2) % 4),
						i % 2 === 0 ? 4 + (i % 2) : 3 + (i % 2),
						`${portalContact.firstName} ${portalContact.lastName}`,
						portalContact.email
					]
				);
				portalFeedbackCount += 1;

				if (jobSubmissions[1] && i % 4 === 0) {
					const nextPriority = (jobSubmissions[jobSubmissions.length - 1]?.submissionPriority || jobSubmissions[1].submissionPriority) + 1;
					await connection.query(
						'UPDATE `Submission` SET `status` = ?, `submissionPriority` = ?, `updatedAt` = NOW() WHERE id = ?',
						['rejected', nextPriority, jobSubmissions[1].id]
					);
					await connection.query(
						`INSERT INTO \`ClientSubmissionFeedback\`
						(\`submissionId\`, \`portalAccessId\`, \`actionType\`, \`comment\`, \`communicationScore\`, \`technicalFitScore\`, \`cultureFitScore\`, \`overallRecommendationScore\`, \`statusApplied\`, \`clientNameSnapshot\`, \`clientEmailSnapshot\`, \`ipAddress\`, \`userAgent\`, \`createdAt\`, \`updatedAt\`)
						VALUES (?, ?, 'pass', ?, ?, ?, ?, ?, 'rejected', ?, ?, '127.0.0.1', 'Demo Seed', NOW(), NOW())`,
						[
							jobSubmissions[1].id,
							portalAccessId,
							'Thank you. We are passing on this candidate for now.',
							2,
							2 + (i % 2),
							2,
							1,
							`${portalContact.firstName} ${portalContact.lastName}`,
							portalContact.email
						]
					);
					portalFeedbackCount += 1;
				}
			}
		}

		await connection.commit();
		console.log('Demo seed completed.');
		console.log(`Divisions: ${divisions.length}`);
		console.log(`Users: ${users.length}`);
		console.log(`Clients: ${clients.length}`);
		console.log(`Contacts: ${contacts.length}`);
		console.log(`Candidates: ${candidates.length}`);
		console.log(`Job Orders: ${jobOrders.length}`);
		console.log(`Submissions: ${submissionCount}`);
		console.log(`Interviews: ${interviewCount}`);
		console.log(`Placements: ${placementCount}`);
		console.log(`Primary Resumes: ${candidateAttachmentCount}`);
		console.log(`Portal Links: ${portalAccessCount}`);
		console.log(`Portal Feedback Entries: ${portalFeedbackCount}`);
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		await connection.end();
	}
}

main().catch((error) => {
	console.error('Demo seed failed.');
	console.error(error);
	process.exitCode = 1;
});
