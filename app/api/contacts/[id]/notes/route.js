import { changeSyncedActivityNote } from '@/lib/synced-activity-note-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { contactNoteSchema } from '@/lib/validators';
import { AccessControlError, ensureScopedEntityAccess, getActingUser } from '@/lib/access-control';
import { logCreate } from '@/lib/audit-log';
import { parseRouteId, parseJsonBody, ValidationError } from '@/lib/request-validation';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';

import { withApiLogging } from '@/lib/api-logging';
function handleError(error, fallbackMessage) {
	if (error instanceof AccessControlError) {
		return NextResponse.json({ error: error.message }, { status: error.status });
	}
	if (error instanceof ValidationError) {
		return NextResponse.json({ error: error.message }, { status: 400 });
	}

	if (error.code === 'P2003') {
		return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function isMissingNoteAuthorColumnError(error) {
	if (!error) return false;
	if (error.code === 'P2022') return true;
	const message = `${error.message || ''}`;
	return message.includes('createdByUserId') || message.includes('createdByUser');
}

async function getContacts_id_notesHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const contactId = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req);
		await ensureScopedEntityAccess('contact', contactId, actingUser);

		let notes;
		try {
			notes = await prisma.contactNote.findMany({
				where: { contactId },
				orderBy: { createdAt: 'desc' },
				include: {
					createdByUser: {
						select: { id: true, firstName: true, lastName: true, email: true, isActive: true }
					}
				}
			});
		} catch (error) {
			if (!isMissingNoteAuthorColumnError(error)) {
				throw error;
			}

			notes = await prisma.contactNote.findMany({
				where: { contactId },
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					noteType: true,
					content: true,
					createdAt: true,
					updatedAt: true,
					contactId: true
				}
			});
		}

		return NextResponse.json(notes);
	} catch (error) {
		return handleError(error, 'Failed to load notes.');
	}
}

async function postContacts_id_notesHandler(req, { params }) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'contacts.id.notes.post');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const awaitedParams = await params;
		const contactId = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req, { allowFallback: false });
		await ensureScopedEntityAccess('contact', contactId, actingUser);

		const body = await parseJsonBody(req);
		const parsed = contactNoteSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}

		let note;
		try {
			note = await prisma.contactNote.create({
				data: {
					contactId,
					content: parsed.data.content,
					noteType: parsed.data.noteType || 'manual',
					createdByUserId: actingUser.id
				},
				include: {
					createdByUser: {
						select: { id: true, firstName: true, lastName: true, email: true, isActive: true }
					}
				}
			});
		} catch (error) {
			if (!isMissingNoteAuthorColumnError(error)) {
				throw error;
			}

			note = await prisma.contactNote.create({
				data: {
					contactId,
					content: parsed.data.content,
					noteType: parsed.data.noteType || 'manual'
				},
				select: {
					id: true,
					noteType: true,
					content: true,
					createdAt: true,
					updatedAt: true,
					contactId: true
				}
			});
			}

			await logCreate({
				actorUserId: actingUser?.id,
				entityType: 'CONTACT_NOTE',
				entity: note,
				metadata: { contactId }
			});

			return NextResponse.json(note, { status: 201 });
	} catch (error) {
		return handleError(error, 'Failed to create note.');
	}
}

export const GET = withApiLogging('contacts.id.notes.get', getContacts_id_notesHandler);
export const POST = withApiLogging('contacts.id.notes.post', postContacts_id_notesHandler);

export const PATCH = withApiLogging('contacts.id.notes.patch', changeSyncedActivityNote('contact', false));
export const DELETE = withApiLogging('contacts.id.notes.delete', changeSyncedActivityNote('contact', true));
