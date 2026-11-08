import { boundedJSON, checkOrigin, saveDataset, json, errorResponse } from '@/lib/store';
export const dynamic = 'force-dynamic';
// The authenticated single-owner Worker protects this snapshot import route.
// Provider credentials remain outside the application.
export async function POST(request:Request){try{checkOrigin(request);const b=await boundedJSON(request);return json(await saveDataset(b.dataset,b.retirementOverrides,b.reviewPreferences,b.transactionOverrides,undefined,b.initialOnly===undefined?false:b.initialOnly));}catch(e){return errorResponse(e,true);}}
