import { prisma } from './prisma.js';
import { readHostedTrialConfig, hostedTrialState } from './hosted-trial-config.cjs';

// Only the immutable, persisted start is cached. Expiry is evaluated on every
// request, so cached sessions and app restarts cannot extend the trial.
let startPromise = null;
async function getPersistedStart() {
 if (!startPromise) {
  startPromise = prisma.hostedInstanceTrial.upsert({
   where: { id: 1 }, create: { id: 1 }, update: {}
  }).catch(async error => {
   if (error.code === 'P2002') return prisma.hostedInstanceTrial.findUniqueOrThrow({ where: { id: 1 } });
   throw error;
  }).then(row => row.startedAt).catch(error => { startPromise = null; throw error; });
 }
 return startPromise;
}
export async function getHostedTrialStatus() {
 const config = readHostedTrialConfig();
 if (!config.enabled || config.startedAt) return hostedTrialState(config, null);
 return hostedTrialState(config, await getPersistedStart());
}
