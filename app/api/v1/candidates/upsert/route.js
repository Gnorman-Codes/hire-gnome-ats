import { withApiLogging } from '@/lib/api-logging';
import { apiEndpoint } from '@/lib/integrations/api-v1-http';
import { upsertCandidate } from '@/lib/integrations/api-v1-records';

export const POST = withApiLogging('api.v1.candidates.upsert', apiEndpoint(upsertCandidate));
