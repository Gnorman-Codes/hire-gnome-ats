import { withApiLogging } from '@/lib/api-logging';
import { apiEndpoint } from '@/lib/integrations/api-v1-http';
import { readRecord, updateRecord } from '@/lib/integrations/api-v1-records';

export const GET = withApiLogging('api.v1.record.get', apiEndpoint(readRecord));
export const PATCH = withApiLogging('api.v1.record.patch', apiEndpoint(updateRecord));
