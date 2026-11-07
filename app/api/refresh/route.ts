import { parseBoundedJSON,checkOrigin,errorResponse,json } from '@/lib/store';
import { beginRefresh,commitRefresh,failRefresh,getRefreshContract,configureRefreshSchedule,safeRefreshFailureReason } from '@/lib/refresh';
import { assertCredentialFree } from '@/lib/credential-boundary';
export const dynamic='force-dynamic';
export async function GET(){try{return json(await getRefreshContract());}catch(error){return errorResponse(error);}}
export async function POST(request:Request){try{checkOrigin(request);const input=await parseBoundedJSON(request);if(input?.action==='fail'&&typeof input.error==='string')input.error=safeRefreshFailureReason(input.error);assertCredentialFree(input);switch(input.action){case 'begin':return json(await beginRefresh(input.fullHistory===true));case 'commit':return json(await commitRefresh(input.runId,input.bundle));case 'fail':return json(await failRefresh(input.runId,input.error));case 'schedule':return json(await configureRefreshSchedule(input.schedule));default:throw new Error('Unknown refresh action.');}}catch(error){return errorResponse(error,true);}}
