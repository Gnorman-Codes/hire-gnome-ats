import { changeSyncedActivityNote } from '@/lib/synced-activity-note-route';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { clientNoteSchema } from '@/lib/validators';
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
		return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
	}

	return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

function isMissingNoteAuthorColumnError(error) {
	if (!error) return false;
	if (error.code === 'P2022') return true;
	const message = `${error.message || ''}`;
	return message.includes('createdByUserId') || message.includes('createdByUser');
}

async function getClients_id_notesHandler(req, { params }) {
	try {
		const awaitedParams = await params;
		const clientId = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req);
		await ensureScopedEntityAccess('client', clientId, actingUser);

		let notes;
		try {
			notes = await prisma.clientNote.findMany({
				where: { clientId },
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

			notes = await prisma.clientNote.findMany({
				where: { clientId },
				orderBy: { createdAt: 'desc' },
				select: {
					id: true,
					content: true,
					createdAt: true,
					updatedAt: true,
					clientId: true
				}
			});
		}

		return NextResponse.json(notes);
	} catch (error) {
		return handleError(error, 'Failed to load notes.');
	}
}

async function postClients_id_notesHandler(req, { params }) {
	try {
		const mutationThrottleResponse = await enforceMutationThrottle(req, 'clients.id.notes.post');
		if (mutationThrottleResponse) {
			return mutationThrottleResponse;
		}

		const awaitedParams = await params;
		const clientId = parseRouteId(awaitedParams);

		const actingUser = await getActingUser(req, { allowFallback: false });
		await ensureScopedEntityAccess('client', clientId, actingUser);

		const body = await parseJsonBody(req);
		const parsed = clientNoteSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ errors: parsed.error.flatten() }, { status: 400 });
		}

		let note;
		try {
			note = await prisma.clientNote.create({
				data: {
					clientId,
					content: parsed.data.content,
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

			note = await prisma.clientNote.create({
				data: {
					clientId,
					content: parsed.data.content
				},
				select: {
					id: true,
					content: true,
					createdAt: true,
					updatedAt: true,
					clientId: true
				}
			});
			}

			await logCreate({
				actorUserId: actingUser?.id,
				entityType: 'CLIENT_NOTE',
				entity: note,
				metadata: { clientId }
			});

			return NextResponse.json(note, { status: 201 });
	} catch (error) {
		return handleError(error, 'Failed to create note.');
	}
}

export const GET = withApiLogging('clients.id.notes.get', getClients_id_notesHandler);
export const POST = withApiLogging('clients.id.notes.post', postClients_id_notesHandler);

export const PATCH = withApiLogging('clients.id.notes.patch', changeSyncedActivityNote('client', false));
export const DELETE = withApiLogging('clients.id.notes.delete', changeSyncedActivityNote('client', true));
