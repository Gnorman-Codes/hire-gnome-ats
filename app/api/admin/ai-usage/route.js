import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getActingUser } from '@/lib/access-control';
import { getAiUsageSummary } from '@/lib/ai-usage';
import { aiMonth } from '@/lib/ai-budget-policy';
import { DEMO_MODE } from '@/lib/demo-config';
import { logUpdate } from '@/lib/audit-log';
import { enforceMutationThrottle } from '@/lib/mutation-throttle';
import { withApiLogging } from '@/lib/api-logging';
export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'no-store' };
async function authorize(req) {
 const user = await getActingUser(req, { allowFallback: false });
 return user?.role === 'ADMINISTRATOR' ? user : null;
}
async function getHandler(req) {
 if (!await authorize(req)) return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
 try { return NextResponse.json(await getAiUsageSummary(), { headers: noStore }); }
 catch { return NextResponse.json({ error: 'AI usage tracking is unavailable.' }, { status: 503, headers: noStore }); }
}
async function patchHandler(req) {
 const throttled = await enforceMutationThrottle(req, 'ai_usage.patch');
 if (throttled) return throttled;
 const user = await authorize(req);
 if (!user) return NextResponse.json({ error: 'Administrator access required.' }, { status: 403 });
 const summary = await getAiUsageSummary();
 if (DEMO_MODE || summary.controlsManaged) return NextResponse.json({ error: 'AI controls are managed by your hosting provider.' }, { status: 403 });
 const input = await req.json().catch(() => null);
 if (!input || typeof input.budgetUsd !== 'number' || !Number.isFinite(input.budgetUsd) || input.budgetUsd < 0 || input.budgetUsd > 100000 || typeof input.enabled !== 'boolean') return NextResponse.json({ error: 'Enter a valid monthly dollar allowance and enabled state.' }, { status: 400 });
 const saved = await prisma.$transaction(async tx => {
  const rows = await tx.$queryRaw`SELECT * FROM SystemSetting ORDER BY id ASC LIMIT 1 FOR UPDATE`;
  const before = rows[0];
  if (!before) throw new Error('System settings must be configured first.');
  const after = await tx.systemSetting.update({ where: { id: before.id }, data: {
   aiMonthlyBudgetUsd: input.budgetUsd, aiEnabled: input.enabled
  } });
  // Explicit operator acknowledgement allows a retry after the provider's
  // cap/credits have been adjusted. OpenAI still enforces its own hard limit.
  if (input.retryProvider === true) await tx.aiUsageMonth.updateMany({ where: { month: aiMonth() }, data: { providerBlocked: false } });
  return { before, after };
 });
 // Audit only the changed controls, never provider credentials.
 await logUpdate({ actorUserId: user.id, entityType: 'SYSTEM_SETTING',
  before: { id: saved.before.id, recordId: saved.before.recordId, aiMonthlyBudgetUsd: String(saved.before.aiMonthlyBudgetUsd), aiEnabled: Boolean(saved.before.aiEnabled) },
  after: { id: saved.after.id, recordId: saved.after.recordId, aiMonthlyBudgetUsd: String(saved.after.aiMonthlyBudgetUsd), aiEnabled: saved.after.aiEnabled },
  metadata: { retryProvider: input.retryProvider === true }
 });
 return NextResponse.json(await getAiUsageSummary(), { headers: noStore });
}
export const GET = withApiLogging('ai_usage.get', getHandler);
export const PATCH = withApiLogging('ai_usage.patch', patchHandler);
