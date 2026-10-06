import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';
import { aiMonth, aiPolicy, aiPrices, aiCost, aiReservation, AI_ALLOWANCE_MESSAGE, AI_DISABLED_MESSAGE } from './ai-budget-policy.js';

export class AiRequestError extends Error {}
export function aiRequestErrorMessage(error, fallback) {
 return error instanceof AiRequestError ? error.message : fallback;
}

// Short transactions only; never hold a database lock while calling OpenAI.
async function transaction(work) {
 for (let attempt = 0; ; attempt++) {
  try { return await prisma.$transaction(work); }
  catch (error) { if (error.code !== 'P2034' || attempt >= 2) throw error; }
 }
}
async function reserve(feature, body, amount, month) {
 return transaction(async tx => {
  // Serialize policy changes with admission, across processes/containers.
  const settings = await tx.$queryRaw`SELECT * FROM SystemSetting ORDER BY id ASC LIMIT 1 FOR UPDATE`;
  const setting = settings[0];
  const policy = aiPolicy(setting, process.env, month);
  if (!policy.enabled) throw new AiRequestError(AI_DISABLED_MESSAGE);
  if (!setting?.openAiApiKey?.trim()) throw new AiRequestError('OpenAI API key is not configured.');
  await tx.aiUsageMonth.upsert({ where: { month }, create: { month }, update: {} });
  const rows = await tx.$queryRaw`SELECT * FROM AiUsageMonth WHERE month = ${month} FOR UPDATE`;
  const usage = rows[0];
  if (usage.providerBlocked) throw new AiRequestError(AI_ALLOWANCE_MESSAGE);
  if (Number(usage.spentUsd) + Number(usage.reservedUsd) + amount > policy.budgetUsd) {
   throw new AiRequestError(AI_ALLOWANCE_MESSAGE);
  }
  const request = await tx.aiUsageRequest.create({ data: { id: randomUUID(), month, feature, model: body.model, status: 'reserved', reservedUsd: amount } });
  await tx.aiUsageMonth.update({ where: { month }, data: { reservedUsd: { increment: amount } } });
  return { ...request, apiKey: setting.openAiApiKey.trim() };
 });
}
async function settle(request, cost, status, providerBlocked = false) {
 await transaction(async tx => {
  const changed = await tx.aiUsageRequest.updateMany({ where: { id: request.id, status: 'reserved' }, data: {
   status, costUsd: cost.usd, inputTokens: cost.input || 0, cachedInputTokens: cost.cached || 0,
   outputTokens: cost.output || 0, completedAt: new Date()
  } });
  if (!changed.count) return;
  await tx.aiUsageMonth.update({ where: { month: request.month }, data: {
   reservedUsd: { decrement: request.reservedUsd }, spentUsd: { increment: cost.usd },
   ...(providerBlocked ? { providerBlocked: true } : {})
  } });
 });
}
export async function requestOpenAi(feature, options) {
 if (!['resume-parser','candidate-summary','submission-write-up','email-draft','interview-question-set','match-explanation','job-posting-enhancer'].includes(feature)) throw new AiRequestError('Unknown AI feature.');
 const body = { ...JSON.parse(options.body), max_completion_tokens: 4096, service_tier: 'default' };
 let prices;
 try { prices = aiPrices(body.model); } catch (error) { throw new AiRequestError(error.message); }
 const amount = aiReservation(body, prices);
 let request;
 try { request = await reserve(feature, body, amount, aiMonth()); }
 catch (error) { if (error instanceof AiRequestError) throw error; throw new AiRequestError('AI usage tracking is unavailable. Please try again later.'); }
 let settled = false;
 try {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
   ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
   body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  const payload = await response.json().catch(() => null);
  const blocked = ['project_spend_limit_exceeded','organization_spend_limit_exceeded','organization_usage_limit_exceeded','credit_balance_exhausted','insufficient_quota'].includes(payload?.error?.code);
  // Missing usage on a successful/ambiguous response is conservatively charged
  // at the reservation amount. Explicit 4xx rejections consume no tokens.
  const actual = aiCost(payload?.usage, prices);
  const rejected = response.status >= 400 && response.status < 500;
  await settle(request, actual || { usd: rejected ? 0 : amount }, actual ? 'completed' : rejected ? 'rejected' : 'estimated', blocked);
  settled = true;
  if (blocked) throw new AiRequestError(AI_ALLOWANCE_MESSAGE);
  return { ok: response.ok, status: response.status, json: async () => payload || {} };
 } catch (error) {
  if (!settled) {
   // If accounting fails, the persisted reservation continues to protect the
   // budget. Network failures may have been billed; do not refund them blindly.
   await settle(request, { usd: amount }, 'estimated').catch(() => {});
  }
  throw error;
 }
}
