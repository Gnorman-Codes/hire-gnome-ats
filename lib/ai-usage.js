import { prisma } from './prisma.js';
import { aiMonth, aiPolicy, aiPrices, AI_FEATURE_LABELS } from './ai-budget-policy.js';
import { hostedManagedIntegrationsEnabled } from './hosted-managed-integrations.js';

export async function getAiUsageSummary() {
 const month = aiMonth();
 const [setting, usage, features] = await Promise.all([
  prisma.systemSetting.findFirst({ orderBy: { id: 'asc' } }),
  prisma.aiUsageMonth.findUnique({ where: { month } }),
  prisma.aiUsageRequest.groupBy({ by: ['feature'], where: { month }, _sum: { costUsd: true, inputTokens: true, cachedInputTokens: true, outputTokens: true }, _count: { _all: true } })
 ]);
 const policy = aiPolicy(setting);
 const spentUsd = Number(usage?.spentUsd || 0);
 const reservedUsd = Number(usage?.reservedUsd || 0);
 const model = process.env.OPENAI_RESUME_MODEL || 'gpt-4o-mini';
 let pricingConfigured = true;
 try { aiPrices(model); } catch { pricingConfigured = false; }
 const configured = Boolean(setting?.openAiApiKey?.trim());
 const status = !configured ? 'Not configured' : !policy.enabled ? 'Disabled' : !pricingConfigured ? 'Pricing required' : usage?.providerBlocked ? 'Monthly AI allowance reached' : spentUsd + reservedUsd >= policy.budgetUsd ? 'Monthly AI allowance reached' : 'Active';
 return {
  month, resetsAt: new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7)), 1)).toISOString(),
  budgetUsd: policy.budgetUsd, enabled: policy.enabled,
  spentUsd, reservedUsd, remainingUsd: Math.max(0, policy.budgetUsd - spentUsd - reservedUsd),
  status, providerBlocked: Boolean(usage?.providerBlocked),
  controlsManaged: hostedManagedIntegrationsEnabled() || ['OPENAI_MONTHLY_BUDGET_USD','OPENAI_ENABLED'].some(key => process.env[key] !== undefined),
  features: features.map(row => ({ feature: row.feature, label: AI_FEATURE_LABELS[row.feature] || row.feature, requests: row._count._all, spentUsd: Number(row._sum.costUsd || 0), inputTokens: row._sum.inputTokens || 0, cachedInputTokens: row._sum.cachedInputTokens || 0, outputTokens: row._sum.outputTokens || 0 }))
 };
}
