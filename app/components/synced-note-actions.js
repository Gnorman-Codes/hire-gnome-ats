'use client';

import { useState } from 'react';
import { useConfirmDialog } from '@/app/components/confirm-dialog';
import { activityNoteSummary } from '@/lib/synced-activity-note';

export default function SyncedNoteActions({ note, url, onChange }) {
	const { requestConfirm } = useConfirmDialog();
	const [draft, setDraft] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	async function save(remove) {
		if (remove && !(await requestConfirm({
			title: 'Delete synced activity',
			message: 'This removes the activity from Closer Gnome and deletes its company and contact notes in Hire Gnome.',
			confirmLabel: 'Delete Activity',
			isDanger: true
		}))) return;
		setBusy(true);
		setError('');
		try {
			const response = await fetch(url, {
				method: remove ? 'DELETE' : 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ noteId: note.id, content: draft })
			});
			if (!response.ok) {
				const result = await response.json().catch(() => ({}));
				setError(result.error || 'Could not save the note change.');
				return;
			}
			onChange(note.id, remove ? null : await response.json());
			setDraft(null);
		} catch {
			setError('Could not save the note change.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="synced-note-actions">
			{draft === null ? (
				<>
					<button className="btn-secondary" type="button" disabled={busy} onClick={() => setDraft(activityNoteSummary(note.content))}>Edit</button>{' '}
					<button className="btn-secondary" type="button" disabled={busy} onClick={() => void save(true)}>Delete</button>
				</>
			) : (
				<form onSubmit={(event) => { event.preventDefault(); void save(false); }}>
					<label>
						Activity summary
						<textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} maxLength={2000} required disabled={busy} />
					</label>
					<button className="btn-secondary" type="submit" disabled={busy || !draft.trim()}>Save Changes</button>{' '}
					<button className="btn-secondary" type="button" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Cancel</button>
				</form>
			)}
			{error ? <p role="alert">{error}</p> : null}
		</div>
	);
}
