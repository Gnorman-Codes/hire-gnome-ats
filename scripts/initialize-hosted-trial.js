#!/usr/bin/env node
require('./load-env.cjs');
const { PrismaClient } = require('@prisma/client');
const { readHostedTrialConfig, hostedTrialState } = require('../lib/hosted-trial-config.cjs');
async function main() {
 const config = readHostedTrialConfig();
 if (!config.enabled) { console.log('[hosted-trial] No trial expiry configured.'); return; }
 const prisma = new PrismaClient();
 try {
  const saved = await prisma.hostedInstanceTrial.upsert({ where: { id: 1 }, create: { id: 1, ...(config.startedAt ? { startedAt: config.startedAt } : {}) }, update: {} });
  const state = hostedTrialState(config, saved.startedAt);
  console.log(`[hosted-trial] ${config.days} days. Expires ${state.expiresAt}. ${state.expired ? 'Expired.' : 'Active.'}`);
 } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(`[hosted-trial] ${error.message}`); process.exitCode = 1; });
