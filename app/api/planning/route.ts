import { z } from 'zod';
import { parseBoundedJSON, checkOrigin, errorResponse, json } from '@/lib/store';
import { assertCredentialFree, CredentialInputError } from '@/lib/credential-boundary';
import { isStorageError } from '@/lib/storage-errors';
import { planningInputSchema } from '@/lib/planning';
import { PlanningConflict, PlanningInputError, readPlanning, savePlanning } from '@/lib/planning-store';

export const dynamic = 'force-dynamic';
export async function GET() {
  try { return json({ plan: await readPlanning() }); }
  catch(error) { return isStorageError(error)?errorResponse(error):json({error:'Saved planning could not be loaded. Try again after storage is available.'},500); }
}
export async function POST(request: Request) {
  try {
    let body;
    try { checkOrigin(request);body=await parseBoundedJSON(request); }
    catch { return json({error:'Use a same-origin request with valid JSON within the supported size.'},400); }
    // The expected plan is comparison-only and never persisted. This allows a
    // clean replacement of legacy text; all proposed data and unknown fields
    // still pass the same credential boundary before schema/save handling.
    assertCredentialFree(body&&typeof body==='object'&&!Array.isArray(body)?{...body,expectedPlan:undefined}:body);
    const input = planningInputSchema.parse(body);
    return json({ plan: await savePlanning(input.plan, input.expectedPlan) });
  } catch (error) {
    if (error instanceof CredentialInputError) return errorResponse(error,true);
    if (error instanceof PlanningConflict) return json({ error: error.message }, 409);
    if (error instanceof PlanningInputError) return json({error:error.message},400);
    if (error instanceof z.ZodError) return json({ error: 'Enter valid goals and explicitly selected event records.' }, 400);
    if (isStorageError(error)) return errorResponse(error,true);
    return json({error:'Planning could not be saved or verified because storage is unavailable. Reload before trying again.'},500);
  }
}
