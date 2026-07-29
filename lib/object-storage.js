import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getIntegrationSettings } from './system-settings.js';

let cachedClient = null;
let cachedConfigSignature = '';

function cleanPathSegment(value) {
	return String(value || '')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function normalizeFileExtension(fileName) {
	const extension = path.extname(String(fileName || '')).toLowerCase();
	if (!extension) return '.bin';
	return extension.slice(0, 10);
}

function normalizeStorageFileName(fileName) {
	const raw = String(fileName || '').trim();
	const parsed = path.parse(raw);
	const baseName = cleanPathSegment(parsed.name) || 'file';
	const extension = normalizeFileExtension(parsed.base || raw);
	return `${baseName.slice(0, 120)}${extension}`;
}

async function buildConfig() {
	const integrationSettings = await getIntegrationSettings();
	const region = integrationSettings.objectStorageRegion || 'us-east-1';
	const bucket = integrationSettings.objectStorageBucket || '';
	const accessKeyId = integrationSettings.objectStorageAccessKeyId || '';
	const secretAccessKey = integrationSettings.objectStorageSecretAccessKey || '';
	const endpoint = integrationSettings.objectStorageEndpoint || '';
	const forcePathStyle =
		typeof integrationSettings.objectStorageForcePathStyle === 'boolean'
			? integrationSettings.objectStorageForcePathStyle
			: Boolean(endpoint);
	const provider = integrationSettings.objectStorageProvider || 's3';
	const localRoot = process.env.LOCAL_STORAGE_ROOT || path.join(process.cwd(), '.local-storage');

	return {
		region,
		bucket,
		accessKeyId,
		secretAccessKey,
		endpoint,
		forcePathStyle,
		provider,
		localRoot
	};
}

function configSignature(config) {
	return [
		config.region,
		config.bucket,
		config.accessKeyId,
		config.secretAccessKey,
		config.endpoint,
		String(config.forcePathStyle),
		config.provider,
		config.localRoot
	].join('|');
}

function missingConfigKeys(config) {
	const missing = [];
	if (!config.bucket) missing.push('Object Storage Bucket');
	if (!config.accessKeyId) missing.push('Object Storage Access Key ID');
	if (!config.secretAccessKey) missing.push('Object Storage Secret Access Key');
	return missing;
}

export async function getObjectStorageConfig() {
	const config = await buildConfig();
	return {
		...config,
		mode: shouldUseS3(config) ? 's3' : 'local'
	};
}

export async function isObjectStorageConfigured() {
	const config = await buildConfig();
	return config.provider === 'local' || missingConfigKeys(config).length === 0;
}

export async function assertObjectStorageConfigured() {
	const config = await buildConfig();
	const missing = missingConfigKeys(config);
	if (missing.length > 0) {
		throw new Error(`Object storage is not configured. Missing: ${missing.join(', ')}`);
	}
	return config;
}

function shouldUseS3(config) {
	const provider = String(config.provider || 's3').trim().toLowerCase();
	if (provider === 'local') return false;
	return missingConfigKeys(config).length === 0;
}

function normalizeStorageKey(key) {
	const normalized = String(key || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/^\/+/, '');
	const segments = normalized
		.split('/')
		.map((segment) => cleanPathSegment(segment))
		.filter(Boolean);
	return segments.join('/');
}

function resolveLocalFilePath(config, key) {
	const normalizedKey = normalizeStorageKey(key);
	if (!normalizedKey) {
		throw new Error('Invalid storage key.');
	}

	const root = path.resolve(config.localRoot);
	const absolutePath = path.resolve(root, normalizedKey);
	if (!absolutePath.startsWith(`${root}${path.sep}`) && absolutePath !== root) {
		throw new Error('Invalid storage path.');
	}

	return {
		absolutePath,
		normalizedKey
	};
}

function getS3Client(config) {
	const signature = configSignature(config);
	if (cachedClient && cachedConfigSignature === signature) {
		return cachedClient;
	}

	const clientConfig = {
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey
		}
	};

	if (config.endpoint) {
		clientConfig.endpoint = config.endpoint;
		clientConfig.forcePathStyle = config.forcePathStyle;
	}

	cachedClient = new S3Client(clientConfig);
	cachedConfigSignature = signature;
	return cachedClient;
}

export function buildCandidateAttachmentStorageKey(candidateId, fileName) {
	const idSegment = cleanPathSegment(candidateId) || 'unknown';
	const uniquePrefix = `${Date.now()}-${randomUUID()}`;
	const safeFileName = normalizeStorageFileName(fileName);
	return `candidates/${idSegment}/${uniquePrefix}/${safeFileName}`;
}

export function buildCandidateInboundAttachmentStorageKey(candidateId, messageId, fileName) {
	const idSegment = cleanPathSegment(candidateId) || 'unknown';
	const messageSegment = cleanPathSegment(messageId) || randomUUID();
	const safeFileName = normalizeStorageFileName(fileName);
	return `candidates/${idSegment}/inbound-email/${messageSegment}/${safeFileName}`;
}

export async function uploadObjectBuffer({ key, body, contentType }) {
	const config = await buildConfig();
	if (shouldUseS3(config)) {
		const client = getS3Client(config);
		await client.send(
			new PutObjectCommand({
				Bucket: config.bucket,
				Key: key,
				Body: body,
				ContentType: contentType || 'application/octet-stream'
			})
		);

		return {
			storageProvider: config.provider,
			storageBucket: config.bucket,
			storageKey: key
		};
	}

	const { absolutePath, normalizedKey } = resolveLocalFilePath(config, key);
	await mkdir(path.dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, body);

	return {
		storageProvider: 'local',
		storageBucket: 'local',
		storageKey: normalizedKey
	};
}

export async function downloadObjectBuffer({ key, storageProvider, storageBucket }) {
	const config = await buildConfig();
	const provider = String(storageProvider || '').trim().toLowerCase();
	const useLocal = provider === 'local';

	if (useLocal) {
		const { absolutePath } = resolveLocalFilePath(config, key);
		return readFile(absolutePath);
	}

	const s3Config = await assertObjectStorageConfigured();
	const client = getS3Client(s3Config);
	const response = await client.send(
		new GetObjectCommand({
			Bucket: storageBucket || s3Config.bucket,
			Key: key
		})
	);

	if (!response.Body || typeof response.Body.transformToByteArray !== 'function') {
		throw new Error('Object storage response was empty.');
	}

	const bytes = await response.Body.transformToByteArray();
	return Buffer.from(bytes);
}

export async function deleteObject({ key, storageProvider, storageBucket }) {
	const config = await buildConfig();
	const provider = String(storageProvider || '').trim().toLowerCase();
	const useLocal = provider === 'local';

	if (useLocal) {
		const { absolutePath } = resolveLocalFilePath(config, key);
		await unlink(absolutePath);
		return;
	}

	const s3Config = await assertObjectStorageConfigured();
	const client = getS3Client(s3Config);
	await client.send(
		new DeleteObjectCommand({
			Bucket: storageBucket || s3Config.bucket,
			Key: key
		})
	);
}
