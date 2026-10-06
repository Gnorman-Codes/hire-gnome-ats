import { NextResponse } from 'next/server';
import { getHostedTrialStatus } from '@/lib/hosted-trial';
export const dynamic = 'force-dynamic';
export async function GET() {
 try { return NextResponse.json(await getHostedTrialStatus(), { headers: { 'Cache-Control': 'no-store' } }); }
 catch { return NextResponse.json({ error: 'Instance access is unavailable. Contact your hosting provider.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
