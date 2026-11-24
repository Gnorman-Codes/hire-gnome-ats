import { NextResponse } from 'next/server';
import { authorizeCompanyIntegration, integrationHeaders } from '@/lib/company-integration-auth';
import { integrationDivisionFields } from '@/lib/company-integration-users';
import { prisma } from '@/lib/prisma';

export async function GET(request) {
	const actor = await authorizeCompanyIntegration(request);
	if (actor instanceof Response) return actor;
	const divisions = await prisma.division.findMany({
		where: actor.role === 'ADMINISTRATOR' ? {} : { id: actor.divisionId ?? -1 },
		select: integrationDivisionFields,
		orderBy: [{ name: 'asc' }, { id: 'asc' }]
	});
	return NextResponse.json({ divisions }, { headers: integrationHeaders });
}
