// Standard text-token prices, USD per million tokens, verified 2026-10-06:
// https://developers.openai.com/api/docs/models/gpt-4o-mini
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
 const custom = [env.OPENAI_INPUT_USD_PER_MILLION, env.OPENAI_CACHED_INPUT_USD_PER_MILLION, env.OPENAI_OUTPUT_USD_PER_MILLION];
 if (custom.some(v => v !== undefined && v !== '')) {
  const rates = custom.map(v => v === undefined || v === '' ? NaN : Number(v));
  if (!rates.every(v => Number.isFinite(v) && v >= 0)) throw new Error('AI model pricing is not configured.');
  return { input: rates[0], cached: rates[1], output: rates[2] };
 }
 if (['gpt-4o-mini', 'gpt-4o-mini-2024-07-18'].includes(model)) return { input: 0.15, cached: 0.075, output: 0.6 };
 throw new Error('AI model pricing is not configured. Contact your hosting provider.');
}
export function aiCost(usage, prices) {
 const input = usage?.prompt_tokens;
 const output = usage?.completion_tokens;
 const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
 if (![input, output, cached].every(v => Number.isSafeInteger(v) && v >= 0) || cached > input) return null;
 return { input, output, cached, usd: Math.ceil(((input-cached)*prices.input + cached*prices.cached + output*prices.output) * 100) / 1e8 };
}
export function aiReservation(body, prices) {
 // All current features send text only. UTF-8 byte length plus framing/schema
 // overhead is deliberately conservative; no prompt text is stored in the ledger.
 const input = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024;
 return Math.ceil((input*prices.input + body.max_completion_tokens*prices.output) * 100) / 1e8;
}
