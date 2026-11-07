import { boundedJSON, checkOrigin, compareAndPutRecord, readRecord, readState, json, errorResponse } from '@/lib/store';
import { budgetPlanSchema, suggestBudgetPlan, summarizeBudget, summarizeBudgetCommitments } from '@/lib/budget';
import { deriveDataset } from '@/lib/classification';
import { z } from 'zod';
import { sameDatasetContent } from '@/lib/dataset-storage';

export const dynamic = 'force-dynamic';
const key = 'budget-plan-v1';
const inputSchema = z.union([
  z.object({plan: budgetPlanSchema,expectedPlan:budgetPlanSchema.nullable()}).strict(),
  z.object({action:z.literal('initialize')}).strict(),
]);
export async function GET(request?:Request) {
  try {
    const plan=await readRecord(key);
    const query=request?new URL(request.url).searchParams:null;
    if(query?.get('includeSummary')!=='1')return json({plan});
    const state=await readState();
    if(!state.dataset||!plan)throw new Error('Saved financial data and a budget plan are required.');
    const data=deriveDataset(state.dataset,state.overrides,state.reviewPreferences);
    const month=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/,'Choose a valid budget month.').parse(query.get('month')||data.asOf.slice(0,7));
    const mode=z.enum(['month','ytd','year']).parse(query.get('periodMode')||'year');
    const selectedYear=Number(month.slice(0,4));
    const years=[...new Set([selectedYear,...Object.keys(plan.annualSchedules||{}).map(Number)])];
    return json({plan,asOf:data.asOf,sourceRecordCount:data.transactions.length,summary:summarizeBudget(data,month,mode,plan),commitments:Object.fromEntries(years.map(year=>[year,summarizeBudgetCommitments(data,plan,year)]))});
  } catch(error) {return errorResponse(error);}
}
export async function POST(request:Request) {
  try {
    checkOrigin(request);
    const input = inputSchema.parse(await boundedJSON(request));
    const previous = await readRecord(key);
    if ('action' in input && previous) return json({plan:previous});
    let plan;
    if ('plan' in input) {
      if(!sameDatasetContent(previous,input.expectedPlan))throw new Error('Your budget changed in another session. Reload the saved budget before editing again.');
      plan=input.plan;
    }
    else {
      const state=await readState();
      if(!state.dataset)throw new Error('Load financial data before creating a budget.');
      plan=budgetPlanSchema.parse(suggestBudgetPlan(deriveDataset(state.dataset,state.overrides,state.reviewPreferences)));
    }
    await compareAndPutRecord(key,previous,plan);
    const saved=await readRecord(key);
    if(JSON.stringify(saved)!==JSON.stringify(plan))throw new Error('The budget changed while saving. Reload to check the saved plan.');
    return json({plan:saved});
  } catch(error) {return error instanceof z.ZodError?json({error:error.issues[0]?.message||'Enter valid budget amounts; monthly guides must total the chosen ceiling.'},400):errorResponse(error,true);}
}
