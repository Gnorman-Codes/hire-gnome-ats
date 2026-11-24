import { NextResponse } from 'next/server';
import { authorizeCompanyIntegration, integrationHeaders } from '@/lib/company-integration-auth';
import { assignableIntegrationUsers, integrationDivisionFields } from '@/lib/company-integration-users';
import { prisma } from '@/lib/prisma';

export async function GET(request) {
	const actor = await authorizeCompanyIntegration(request);
	if (actor instanceof Response) return actor;
	const ref = request.nextUrl.searchParams.get('recordId');
	const users = await prisma.user.findMany({
		where: { ...assignableIntegrationUsers(actor), ...(ref ? { recordId: ref } : {}) },
		select: { recordId: true, firstName: true, lastName: true, email: true, role: true, division: { select: integrationDivisionFields } },
		orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }]
	});
	return NextResponse.json({ users }, { headers: integrationHeaders });
}
