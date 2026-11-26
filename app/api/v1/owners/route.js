import { withApiLogging } from '@/lib/api-logging';
import { apiEndpoint } from '@/lib/integrations/api-v1-http';
import { listOwners } from '@/lib/integrations/api-v1-records';

export const GET = withApiLogging('api.v1.owners.get', apiEndpoint(listOwners));
