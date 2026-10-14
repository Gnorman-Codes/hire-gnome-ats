// Standard text-token prices, USD per million tokens, verified 2026-10-14:
// https://developers.openai.com/api/docs/models/gpt-6-luna
export const AI_ALLOWANCE_MESSAGE = 'Monthly AI allowance reached.';
export const AI_DISABLED_MESSAGE = 'AI is temporarily disabled by your administrator.';
export const AI_FEATURE_LABELS = {
 'resume-parser': 'Resume parsing', 'candidate-summary': 'Candidate summaries',
 'submission-write-up': 'Submission write-ups', 'email-draft': 'Email drafts',
 'interview-question-set': 'Interview questions', 'match-explanation': 'Match explanations',
 'job-posting-enhancer': 'Job posting enhancements'
};
export function aiMonth(now = new Date()) { return now.toISOString().slice(0, 7); }
export function aiPolicy(setting, env = process.env) {
 const budget = Number(env.OPENAI_MONTHLY_BUDGET_USD ?? setting?.aiMonthlyBudgetUsd ?? 10);
 if (!Number.isFinite(budget) || budget < 0 || budget > 100000) throw new Error('Invalid AI monthly budget.');
 return {
  budgetUsd: budget,
  enabled: env.OPENAI_ENABLED === undefined ? (setting?.aiEnabled == null ? true : Boolean(setting.aiEnabled)) : ['true','1','yes','on'].includes(env.OPENAI_ENABLED.toLowerCase())
 };
}
export function aiPrices(model, env = process.env) {
 const modern = model === 'gpt-6-luna';
 const custom = [env.OPENAI_INPUT_USD_PER_MILLION, env.OPENAI_CACHED_INPUT_USD_PER_MILLION, env.OPENAI_OUTPUT_USD_PER_MILLION];
 if (custom.some(v => v !== undefined && v !== '')) {
  const rates = custom.map(v => v === undefined || v === '' ? NaN : Number(v));
  if (!rates.every(v => Number.isFinite(v) && v >= 0)) throw new Error('AI model pricing is not configured.');
  return { input: rates[0], cached: rates[1], output: rates[2], ...(modern ? { cacheWrite: rates[0] * 1.25, longContextThreshold: 272000 } : {}) };
 }
 if (modern) return { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5, longContextThreshold: 272000 };
 if (['gpt-4o-mini', 'gpt-4o-mini-2024-07-18'].includes(model)) return { input: 0.15, cached: 0.075, output: 0.6 };
 throw new Error('AI model pricing is not configured. Contact your hosting provider.');
}
function contextPrices(prices, input) {
 if (prices.longContextThreshold && input > prices.longContextThreshold) {
  return { ...prices, input: prices.input * 2, cached: prices.cached * 2, cacheWrite: (prices.cacheWrite ?? prices.input) * 2, output: prices.output * 1.5 };
 }
 return prices;
}
export function aiCost(usage, prices) {
 const input = usage?.prompt_tokens;
 const output = usage?.completion_tokens;
 const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
 const written = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
 if (![input, output, cached, written].every(v => Number.isSafeInteger(v) && v >= 0) || cached + written > input) return null;
 const rate = contextPrices(prices, input);
 return { input, output, cached, usd: Math.ceil(((input-cached-written)*rate.input + cached*rate.cached + written*(rate.cacheWrite ?? rate.input) + output*rate.output) * 100) / 1e8 };
}
export function aiReservation(body, prices) {
 // UTF-8 bytes plus framing/schema overhead conservatively bound text input.
 // Reserve for cache writes on all input and long-context rates when applicable.
 const input = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024;
 const rate = contextPrices(prices, input);
 return Math.ceil((input*Math.max(rate.input, rate.cacheWrite ?? rate.input) + body.max_completion_tokens*rate.output) * 100) / 1e8;
}
