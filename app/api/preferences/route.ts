import { boundedJSON, checkOrigin, updatePreference, json, errorResponse } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function POST(request:Request){try{checkOrigin(request);return json(await updatePreference(await boundedJSON(request)));}catch(e){return errorResponse(e,true);}}
