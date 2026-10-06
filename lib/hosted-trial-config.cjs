const DAY_MS = 24 * 60 * 60 * 1000;

function readHostedTrialConfig(env = process.env) {
 const rawDays = String(env.HOSTED_TRIAL_DAYS ?? '0').trim();
 const days = Number(rawDays);
 if (!/^\d+$/.test(rawDays) || !Number.isInteger(days) || days < 0 || days > 3650) {
  throw new Error('HOSTED_TRIAL_DAYS must be an integer from 0 to 3650.');
 }
 const rawStart = String(env.HOSTED_TRIAL_STARTED_AT || '').trim();
 let startedAt = null;
 if (rawStart) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawStart)) {
   throw new Error('HOSTED_TRIAL_STARTED_AT must be an ISO timestamp with a timezone.');
  }
  startedAt = new Date(rawStart);
  if (!Number.isFinite(startedAt.getTime())) throw new Error('Invalid hosted trial start date.');
 }
 const contactEmail = String(env.HOSTED_TRIAL_CONTACT_EMAIL || '').trim();
 if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
  throw new Error('HOSTED_TRIAL_CONTACT_EMAIL must be a valid email address.');
 }
 return { days, enabled: days > 0, startedAt, contactEmail };
}

function hostedTrialState(config, persistedStart, now = new Date()) {
 if (!config.enabled) return { enabled: false, expired: false, days: 0, daysRemaining: null, startedAt: null, expiresAt: null, contactEmail: config.contactEmail };
 const start = config.startedAt || new Date(persistedStart);
 if (!persistedStart && !config.startedAt || !Number.isFinite(start.getTime())) throw new Error('Hosted trial start is unavailable.');
 const expiresAt = new Date(start.getTime() + config.days * DAY_MS);
 return {
  enabled: true, expired: now.getTime() >= expiresAt.getTime(), days: config.days,
  daysRemaining: Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS)),
  startedAt: start.toISOString(), expiresAt: expiresAt.toISOString(), contactEmail: config.contactEmail
 };
}
module.exports = { readHostedTrialConfig, hostedTrialState };
