'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UploadCloud, X } from 'lucide-react';
import { useToast } from '@/app/components/toast-provider';
import {
	BULK_RESUME_UPLOAD_MAX_FILES,
	CANDIDATE_ATTACHMENT_MAX_BYTES,
	isAllowedResumeUploadFileName,
	resumeUploadAcceptString
} from '@/lib/candidate-attachment-options';

const STATUS_LABELS = {
	created: 'Created',
	duplicate: 'Duplicate',
	skipped: 'Skipped',
	failed: 'Failed'
};

const STATUS_COLORS = {
	created: '#1f9d57',
	duplicate: '#c67c00',
	skipped: '#c67c00',
	failed: '#d23b3b'
};

function formatBytes(bytes) {
	if (!bytes) return '0 KB';
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${mb.toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function BulkResumeUploadPage() {
	const router = useRouter();
	const toast = useToast();
	const inputRef = useRef(null);
	const [files, setFiles] = useState([]);
	const [uploading, setUploading] = useState(false);
	const [response, setResponse] = useState(null);

	const maxMb = useMemo(
		() => Math.floor(CANDIDATE_ATTACHMENT_MAX_BYTES / (1024 * 1024)),
		[]
	);

	function addFiles(fileList) {
		const incoming = Array.from(fileList || []);
		if (incoming.length === 0) return;

		const accepted = [];
		const rejected = [];
		for (const file of incoming) {
			if (!isAllowedResumeUploadFileName(file.name)) {
				rejected.push(`${file.name} (unsupported type)`);
			} else if (file.size > CANDIDATE_ATTACHMENT_MAX_BYTES) {
				rejected.push(`${file.name} (over ${maxMb} MB)`);
			} else {
				accepted.push(file);
			}
		}

		setFiles((current) => {
			const seen = new Set(current.map((file) => `${file.name}:${file.size}`));
			const merged = [...current];
			for (const file of accepted) {
				const key = `${file.name}:${file.size}`;
				if (!seen.has(key)) {
					seen.add(key);
					merged.push(file);
				}
			}
			return merged.slice(0, BULK_RESUME_UPLOAD_MAX_FILES);
		});

		if (rejected.length > 0) {
			toast.error(`Skipped ${rejected.length} file(s): ${rejected.join(', ')}`);
		}
	}

	function onInputChange(event) {
		addFiles(event.target.files);
		if (inputRef.current) inputRef.current.value = '';
	}

	function onDrop(event) {
		event.preventDefault();
		addFiles(event.dataTransfer?.files);
	}

	function removeFile(index) {
		setFiles((current) => current.filter((_, i) => i !== index));
	}

	function reset() {
		setFiles([]);
		setResponse(null);
		if (inputRef.current) inputRef.current.value = '';
	}

	async function onUpload() {
		if (files.length === 0 || uploading) return;
		setUploading(true);
		setResponse(null);
		try {
			const formData = new FormData();
			for (const file of files) {
				formData.append('files', file);
			}
			const res = await fetch('/api/candidates/bulk-upload', {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (!res.ok) {
				toast.error(data?.error || 'Bulk upload failed.');
				return;
			}
			setResponse(data);
			setFiles([]);
			if (inputRef.current) inputRef.current.value = '';
			const created = data?.summary?.created || 0;
			if (created > 0) {
				toast.success(`Created ${created} candidate${created === 1 ? '' : 's'}.`);
			} else {
				toast.error('No new candidates were created.');
			}
		} catch (error) {
			toast.error(error?.message || 'Bulk upload failed.');
		} finally {
			setUploading(false);
		}
	}

	const summary = response?.summary;

	return (
		<section className="module-page">
			<header className="module-header">
				<div>
					<h2>Bulk Resume Upload</h2>
					<p style={{ color: 'var(--text-muted, #5b6472)', margin: '4px 0 0' }}>
						Upload up to {BULK_RESUME_UPLOAD_MAX_FILES} PDF, DOC, or DOCX resumes. Each file is
						parsed into a searchable candidate profile.
					</p>
				</div>
				<div className="module-header-actions">
					<Link href="/candidates" className="btn-secondary" title="Back to candidates">
						<ArrowLeft aria-hidden="true" width={16} height={16} /> Candidates
					</Link>
				</div>
			</header>

			<div className="panel">
				<div
					onDragOver={(event) => event.preventDefault()}
					onDrop={onDrop}
					style={{
						border: '2px dashed var(--border-color, #cbd2dd)',
						borderRadius: 12,
						padding: '28px 20px',
						textAlign: 'center',
						background: 'var(--surface-muted, #f7f9fc)'
					}}
				>
					<UploadCloud aria-hidden="true" width={28} height={28} />
					<p style={{ margin: '10px 0 4px', fontWeight: 600 }}>
						Drag &amp; drop resumes here, or
					</p>
					<button
						type="button"
						className="btn-secondary"
						onClick={() => inputRef.current?.click()}
						disabled={uploading}
					>
						Choose files
					</button>
					<input
						ref={inputRef}
						type="file"
						multiple
						accept={resumeUploadAcceptString()}
						onChange={onInputChange}
						style={{ display: 'none' }}
					/>
					<p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-muted, #5b6472)' }}>
						PDF, DOC, DOCX · up to {maxMb} MB each
					</p>
				</div>

				{files.length > 0 && (
					<div style={{ marginTop: 18 }}>
						<div
							style={{
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
								marginBottom: 8
							}}
						>
							<strong>
								{files.length} file{files.length === 1 ? '' : 's'} ready
							</strong>
							<button type="button" className="btn-link" onClick={reset} disabled={uploading}>
								Clear all
							</button>
						</div>
						<ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
							{files.map((file, index) => (
								<li
									key={`${file.name}:${file.size}:${index}`}
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										alignItems: 'center',
										padding: '8px 10px',
										borderBottom: '1px solid var(--border-color, #e6e9ef)'
									}}
								>
									<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
										{file.name}{' '}
										<span style={{ color: 'var(--text-muted, #5b6472)', fontSize: 12 }}>
											· {formatBytes(file.size)}
										</span>
									</span>
									<button
										type="button"
										className="btn-link btn-link-icon"
										aria-label={`Remove ${file.name}`}
										onClick={() => removeFile(index)}
										disabled={uploading}
									>
										<X aria-hidden="true" width={16} height={16} />
									</button>
								</li>
							))}
						</ul>
						<div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
							<button
								type="button"
								className="btn-save-action"
								onClick={onUpload}
								disabled={uploading || files.length === 0}
							>
								{uploading
									? 'Uploading…'
									: `Upload ${files.length} resume${files.length === 1 ? '' : 's'}`}
							</button>
						</div>
					</div>
				)}
			</div>

			{summary && (
				<div className="panel" style={{ marginTop: 18 }}>
					<h3 style={{ marginTop: 0 }}>Results</h3>
					<p style={{ color: 'var(--text-muted, #5b6472)', marginTop: 0 }}>
						{summary.created} created · {summary.duplicates} duplicate · {summary.skipped} skipped ·{' '}
						{summary.failed} failed (of {summary.total})
					</p>
					<ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
						{response.results.map((entry, index) => (
							<li
								key={`${entry.fileName}:${index}`}
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									gap: 12,
									padding: '8px 10px',
									borderBottom: '1px solid var(--border-color, #e6e9ef)'
								}}
							>
								<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
									{entry.status === 'created' && entry.candidateId ? (
										<Link href={`/candidates/${entry.candidateId}`}>
											{entry.candidateName || entry.fileName}
										</Link>
									) : (
										entry.fileName
									)}
									{entry.message ? (
										<span style={{ color: 'var(--text-muted, #5b6472)', fontSize: 12 }}>
											{' '}
											— {entry.message}
										</span>
									) : null}
								</span>
								<span
									style={{
										fontWeight: 700,
										fontSize: 12,
										whiteSpace: 'nowrap',
										color: STATUS_COLORS[entry.status] || '#5b6472'
									}}
								>
									{STATUS_LABELS[entry.status] || entry.status}
								</span>
							</li>
						))}
					</ul>
					<div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
						<button type="button" className="btn-save-action" onClick={() => router.push('/candidates')}>
							View candidates
						</button>
						<button type="button" className="btn-secondary" onClick={reset}>
							Upload more
						</button>
					</div>
				</div>
			)}
		</section>
	);
}
