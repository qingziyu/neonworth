import { readState, json, errorResponse } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(){try{return json(await readState());}catch(e){return errorResponse(e);}}
