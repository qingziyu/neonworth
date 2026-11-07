import { readState, json, errorResponse } from '@/lib/store';
export const dynamic = 'force-dynamic';
export async function GET(){try{const s=await readState();return json({ready:true,asOf:s.dataset?.asOf||null,syncedAt:s.dataset?.syncedAt||null,accounts:s.dataset?.accounts.length||0,transactions:s.dataset?.transactions.length||0,updateMode:'snapshot-import',automaticBankSync:false,refresh:s.refresh});}catch(e){return errorResponse(e);}}
