import { withApiLogging } from '@/lib/api-logging';
import { apiEndpoint } from '@/lib/integrations/api-v1-http';
import { createRecord, listRecords } from '@/lib/integrations/api-v1-records';

export const GET = withApiLogging('api.v1.collection.get', apiEndpoint(listRecords));
export const POST = withApiLogging('api.v1.collection.post', apiEndpoint(createRecord));
