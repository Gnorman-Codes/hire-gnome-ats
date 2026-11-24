import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccessControlError, addScopeToWhere, getActingUser, getEntityScope } from '@/lib/access-control';
import { logDelete, logUpdate } from '@/lib/audit-log';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { prisma } from '@/lib/prisma';
import { parseJsonBody, parsePositiveInt, parseRouteId, ValidationError } from '@/lib/request-validation';
import { isSyncedActivityNote, replaceActivityNoteSummary } from '@/lib/synced-activity-note';

const summarySchema = z.string().trim().min(1).max(2000);

export function changeSyncedActivityNote(parent, remove) {
	return async (req, { params }) => {
		try {
			const throttle = await enforceMutationThrottle(req, `${parent}.synced-note.${remove ? 'delete' : 'edit'}`);
			if (throttle) return throttle;
			const parentId = parseRouteId(await params);
			const actor = await getActingUser(req, { allowFallback: false });
			const body = await parseJsonBody(req);
			const id = parsePositiveInt(body.noteId, 'Note ID');
			const parsed = summarySchema.safeParse(body.content);
			if (!remove && !parsed.success) return NextResponse.json({ error: 'Enter a note of up to 2,000 characters.' }, { status: 400 });

			const result = await prisma.$transaction(async (tx) => {
				const owningRecord = await tx[parent].findFirst({
					where: addScopeToWhere({ id: parentId }, getEntityScope(actor)), select: { id: true }
				});
				if (!owningRecord) return null;
				const notes = parent === 'client' ? tx.clientNote : tx.contactNote;
				const where = { id, [`${parent}Id`]: parentId };
				const before = await notes.findFirst({ where });
				if (!before || !isSyncedActivityNote(before.recordId, parent)) return null;
				const summary = remove ? null : parsed.data;
				let after = null;
				if (remove) await notes.delete({ where });
				else after = await notes.update({ where, data: { content: replaceActivityNoteSummary(before.content, summary) } });
				await tx.syncedActivityNoteChange.upsert({
					where: { recordId: before.recordId },
					create: { recordId: before.recordId, summary }, update: { summary }
				});
				return { before, after };
			}, { isolationLevel: 'Serializable' });

			if (!result) return NextResponse.json({ error: 'Synced note unavailable.' }, { status: 404 });
			const audit = { actorUserId: actor.id, entityType: `${parent.toUpperCase()}_NOTE`, metadata: { [`${parent}Id`]: parentId } };
			if (remove) {
				await logDelete({ ...audit, entity: result.before });
				return new Response(null, { status: 204 });
			}
			await logUpdate({ ...audit, ...result });
			return NextResponse.json(result.after);
		} catch (error) {
			if (error instanceof AccessControlError || error instanceof ValidationError) {
				return NextResponse.json({ error: error.message }, { status: error.status });
			}
			if (error.code === 'P2025' || error.code === 'P2034') {
				return NextResponse.json({ error: 'The note changed. Reload and try again.' }, { status: 409 });
			}
			throw error;
		}
	};
}
