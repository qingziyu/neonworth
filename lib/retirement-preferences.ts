import { z } from 'zod';
import { safeRecord } from './validation-record';
import type { Dataset } from './finance';
import { isContributionRecord } from './retirement';

const contributionId = z.string().min(1).max(200).refine(
  value => !['__proto__', 'constructor', 'prototype'].includes(value),
  'Invalid contribution identifier.',
);

// These are user-supplied statement classifications. They never replace provider
// records or infer tax treatment from an account's name, balance, or source sign.
export const retirementContributionPatchSchema = z.object({
  taxTreatment: z.enum(['pretax', 'aftertax', 'roth', 'unknown']).optional(),
  contributor: z.enum(['employee', 'employer', 'unknown']).optional(),
  note: z.string().max(2000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'A contribution classification is required.');

export const retirementContributionPreferenceSchema = z.object({
  type: z.literal('retirement-contribution'),
  id: contributionId,
  patch: retirementContributionPatchSchema,
}).strict();

export type RetirementContributionPatch = z.infer<typeof retirementContributionPatchSchema>;

export function isRetirementPreference(input: unknown): boolean {
  return typeof input === 'object' && input !== null &&
    'type' in input && input.type === 'retirement-contribution';
}

export function validateRetirementPreference(input: unknown, dataset: Dataset | null) {
  const value = retirementContributionPreferenceSchema.parse(input);
  const record = dataset?.retirementEvidence?.records.find(item => item.id === value.id);
  if (!record || !dataset?.accounts.some(account => account.id === record.accountId)) {
    throw new Error('The retirement contribution was not found in the saved source records.');
  }
  if (!isContributionRecord(record, dataset.accounts)) {
    throw new Error('Only source contribution events can receive a contribution classification. Trades, conversions, rollovers, and account transfers are excluded.');
  }
  return value;
}

const retirementOverridesSchema = safeRecord(z.string(),retirementContributionPatchSchema).superRefine((value, ctx) => {
  if (Object.keys(value).length > 5000) ctx.addIssue({code:'custom', message:'Too many saved retirement classifications.'});
  for (const key of Object.keys(value)) {
    if (!contributionId.safeParse(key).success) ctx.addIssue({code:'custom', message:'Invalid contribution identifier.', path:[key]});
  }
});

// Backup imports may restore statement annotations. Validate the entire map
// before the caller writes anything; omitted annotations preserve saved tags.
export function validateRetirementOverrides(input: unknown, dataset: Dataset) {
  const overrides = retirementOverridesSchema.parse(input);
  for (const [id,patch] of Object.entries(overrides)) {
    validateRetirementPreference({type:'retirement-contribution',id,patch}, dataset);
  }
  return overrides;
}
