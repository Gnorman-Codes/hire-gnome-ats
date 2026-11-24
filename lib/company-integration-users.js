export function assignableIntegrationUsers(actor) {
	const where = { isActive: true, serviceKey: null };
	if (actor.role === 'ADMINISTRATOR') return where;
	if (actor.role === 'DIRECTOR' && actor.divisionId) return { ...where, divisionId: actor.divisionId };
	return { ...where, id: actor.id };
}

export const integrationDivisionFields = { recordId: true, name: true, accessMode: true };

export async function integrationSubject(prisma, actor, ref) {
	if (!ref) return actor;
	return prisma.user.findFirst({
		where: { ...assignableIntegrationUsers(actor), recordId: ref },
		select: { id: true, role: true, isActive: true, divisionId: true, division: { select: integrationDivisionFields } }
	});
}
