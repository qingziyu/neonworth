import { z } from 'zod';
import { safeRecord } from './validation-record';
import type { Dataset } from './finance';
import { assertRecordSize } from './dataset-storage.ts';

export interface FindingResolution {state:'reviewed';evidenceKey:string;updatedAt:string}
export interface RecurringStatus {status:'ongoing'|'stopped';effectiveDate:string;updatedAt:string}
export interface ReviewPreferences {
  findingResolutions:Record<string,FindingResolution>;
  recurringStatuses:Record<string,RecurringStatus>;
}
export interface ReviewPreferencesPatch {
  findingResolutions?:Record<string,FindingResolution|null>;
  recurringStatuses?:Record<string,RecurringStatus|null>;
}
export const MAX_REVIEW_PREFERENCE_ENTRIES=2000;
export const emptyReviewPreferences=():ReviewPreferences=>({findingResolutions:{},recurringStatuses:{}});
const safeText=(max:number)=>z.string().min(1).max(max).refine(value=>value===value.trim()&&!/[<>\u0000-\u001f\u007f]/.test(value)&&!['__proto__','constructor','prototype'].includes(value),'Invalid review identifier.');
export const findingIdSchema=safeText(1000).refine(value=>value.length<=300||value.startsWith('similar:'),'Invalid finding identifier.');
export const recurringIdSchema=safeText(300);
export const evidenceKeySchema=safeText(1000);
export const reviewDateSchema=z.string().refine(value=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
},'Invalid calendar date.');
const timestamp=z.string().datetime({offset:true}).refine(value=>reviewDateSchema.safeParse(value.slice(0,10)).success&&Number.isFinite(Date.parse(value)),'Invalid review timestamp.');
const resolution=z.object({state:z.literal('reviewed'),evidenceKey:evidenceKeySchema,updatedAt:timestamp}).strict();
const recurringStatus=z.object({status:z.enum(['ongoing','stopped']),effectiveDate:reviewDateSchema,updatedAt:timestamp}).strict();
export const reviewResolutionPreferenceSchema=z.object({
  type:z.literal('review-resolution'),id:findingIdSchema,state:z.enum(['reviewed','open']),evidenceKey:evidenceKeySchema.optional(),
}).strict().superRefine((value,ctx)=>{if(value.state==='reviewed'&&!value.evidenceKey)ctx.addIssue({code:'custom',message:'The finding evidence fingerprint is required.'});});
export const recurringStatusPreferenceSchema=z.object({
  type:z.literal('recurring-status'),id:recurringIdSchema,status:z.enum(['ongoing','stopped','detected']),effectiveDate:reviewDateSchema.optional(),
}).strict().superRefine((value,ctx)=>{if(value.status!=='detected'&&!value.effectiveDate)ctx.addIssue({code:'custom',message:'A service status effective date is required.'});});
// Preserve the operation-specific refinements and strict preference shapes.
export const reviewPreferenceSchema=z.union([reviewResolutionPreferenceSchema,recurringStatusPreferenceSchema]);
export const reviewPreferencesSchema=z.object({
  findingResolutions:safeRecord(findingIdSchema,resolution).default({}),
  recurringStatuses:safeRecord(recurringIdSchema,recurringStatus).default({}),
}).strict().superRefine((value,ctx)=>{
  if(Object.keys(value.findingResolutions).length+Object.keys(value.recurringStatuses).length>MAX_REVIEW_PREFERENCE_ENTRIES)ctx.addIssue({code:'custom',message:'Too many saved review preferences.'});
  try{assertRecordSize(value);}catch{ctx.addIssue({code:'custom',message:'Saved review preferences exceed the supported size.'});}
});
export function isReviewPreference(input:unknown):boolean {
  return typeof input==='object'&&input!==null&&'type' in input&&(input.type==='review-resolution'||input.type==='recurring-status');
}
function requireDataset(dataset:Dataset|null):asserts dataset is Dataset {
  if(!dataset)throw new Error('Save financial data before recording review preferences.');
}
function assertStatusDate(date:string,dataset:Dataset) {
  if(date>dataset.asOf)throw new Error('A service status effective date cannot be after the saved reporting date.');
}
function assertRecurringId(id:string,knownRecurringIds:ReadonlySet<string>) {
  if(!knownRecurringIds.has(id))throw new Error('The recurring service was not found in the saved account activity.');
}
export function validateReviewPreference(input:unknown,dataset:Dataset|null,knownRecurringIds:ReadonlySet<string>,now=new Date().toISOString()) {
  const value=reviewPreferenceSchema.parse(input);requireDataset(dataset);
  const updatedAt=timestamp.parse(now);
  let patch:ReviewPreferencesPatch;
  if(value.type==='review-resolution') {
    patch={findingResolutions:{[value.id]:value.state==='open'?null:{state:'reviewed',evidenceKey:value.evidenceKey!,updatedAt}}};
  } else {
    assertRecurringId(value.id,knownRecurringIds);
    if(value.effectiveDate)assertStatusDate(value.effectiveDate,dataset);
    patch={recurringStatuses:{[value.id]:value.status==='detected'?null:{status:value.status,effectiveDate:value.effectiveDate!,updatedAt}}};
  }
  return {value,patch};
}
export function validateReviewPreferences(input:unknown,dataset:Dataset,knownRecurringIds:ReadonlySet<string>,now=new Date().toISOString()):ReviewPreferences {
  const preferences=reviewPreferencesSchema.parse(input);
  const latest=Date.parse(timestamp.parse(now));
  for(const row of Object.values(preferences.findingResolutions))if(Date.parse(row.updatedAt)>latest)throw new Error('A saved review timestamp cannot be in the future.');
  for(const [id,row] of Object.entries(preferences.recurringStatuses)) {
    assertRecurringId(id,knownRecurringIds);assertStatusDate(row.effectiveDate,dataset);
    if(Date.parse(row.updatedAt)>latest)throw new Error('A saved review timestamp cannot be in the future.');
  }
  return preferences;
}
export function mergeReviewPreferences(current:ReviewPreferences,patch:ReviewPreferencesPatch):ReviewPreferences {
  const result:ReviewPreferences={findingResolutions:{...current.findingResolutions},recurringStatuses:{...current.recurringStatuses}};
  for(const [id,value] of Object.entries(patch.findingResolutions||{}))if(value===null)delete result.findingResolutions[id];else result.findingResolutions[id]=value;
  for(const [id,value] of Object.entries(patch.recurringStatuses||{}))if(value===null)delete result.recurringStatuses[id];else result.recurringStatuses[id]=value;
  return reviewPreferencesSchema.parse(result);
}
