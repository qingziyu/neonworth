import { createDemoDataset, DEMO_MARKER } from '../scripts/demo-data.mjs';
import { datasetSchema } from '../lib/store-validation';
import { budgetPlanSchema } from '../lib/budget';
import { planningSchema } from '../lib/planning';
import { assertCredentialFree } from '../lib/credential-boundary';
import { APP_VERSION } from '../lib/app-version';
import { deriveDataset } from '../lib/classification';
import { validateReviewEvents } from '../lib/year-review';
import type { Dataset } from '../lib/finance';

// This module belongs only to the separately built public demo. The private
// application never imports it, and none of these examples are product defaults.
export const CLIENT_READ_ONLY = true;
export const DEMO_MODE = true;
export const ALLOW_IMPORT = false;
export const DEMO_AS_OF = '2026-11-07';
const READ_ONLY_MESSAGE = 'This public demo uses invented records. Saving and importing are disabled; run your own Neonworth instance to use these features.';
const UNAVAILABLE_MESSAGE = 'This request is not available in the synthetic demo.';

function createExampleState() {
  const dataset = datasetSchema.parse(createDemoDataset(DEMO_AS_OF)) as Dataset;
  if (!dataset.notes.includes(DEMO_MARKER)) throw new Error('The demo requires explicitly synthetic records.');
  const budget = budgetPlanSchema.parse({
    version: 1, monthlyCap: 4000,
    monthly: { housing: 1600, utilities: 200, groceries: 500, dining: 250, transport: 200, care: 200, digital: 100, other: 150, buffer: 800 },
    annual: { travel: 3000, shopping: 3000, annual_bills: 600, gifts: 500, experiences: 500, learning: 400, occasional_care: 600 },
    baselineAsOf: DEMO_AS_OF, createdAt: `${DEMO_AS_OF}T12:00:00Z`,
  });
  const planning = planningSchema.parse({
    version: 1,
    goals: {
      version: 1,
      savings: { year: 2026, targetAmount: 10000, basis: 'cash' },
      netWorth: { targetAmount: 100000, targetDate: '2030-11-07' },
      fire: {
        annualWithdrawalNeed: 48000, withdrawalRatePct: 4, eligibleAssets: 42500,
        valuationDate: DEMO_AS_OF, targetDate: '2050-11-07', annualContribution: 18000, realReturnPct: 3,
        assetScope: 'Invented demo brokerage balance; excludes checking and home. All assumptions are illustrative.',
      },
    },
    events: [{ id: 'demo-trip', name: 'Example summer trip', transactionIds: ['demo-trip-stay', 'demo-trip-transport'], notes: 'Explicitly grouped invented travel records for this demo.' }],
  });
  validateReviewEvents(deriveDataset(dataset), budget, planning.events);
  const saved = {
    dataset, overrides: {}, settings: {}, retirementOverrides: {},
    reviewPreferences: { findingResolutions: {}, recurringStatuses: {} }, refresh: null,
  };
  assertCredentialFree({ saved, budget, planning });
  return { saved, budget, planning };
}

/** A closed local transport, not a fetch interceptor. No request reaches a network,
 * storage, connector, credential, import parser, or production runtime. */
export function createDemoTransport(origin = typeof window === 'undefined' ? 'https://neonworth-demo.invalid' : window.location.origin): typeof globalThis.fetch {
  const allowedOrigin = new URL(origin).origin;
  const state = createExampleState();
  const reply = (value: unknown, status: number, head: boolean) => new Response(head ? null : JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  return async (input, init) => {
    const request = input instanceof Request ? input : null;
    const signal = init?.signal === undefined ? request?.signal : init.signal;
    signal?.throwIfAborted();
    // An immediately canceled React effect must not receive a successful result.
    await Promise.resolve();
    signal?.throwIfAborted();
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const head = method === 'HEAD';
    if (method !== 'GET' && !head) return reply({ error: READ_ONLY_MESSAGE }, 403, false);
    let url: URL;
    try { url = new URL(request?.url ?? String(input), `${allowedOrigin}/`); }
    catch { return reply({ error: UNAVAILABLE_MESSAGE }, 404, head); }
    if (url.origin !== allowedOrigin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return reply({ error: UNAVAILABLE_MESSAGE }, 404, head);
    }
    switch (url.pathname) {
      case '/api/data': return reply(state.saved, 200, head);
      case '/api/budget': return reply({ plan: state.budget }, 200, head);
      case '/api/planning': return reply({ plan: state.planning }, 200, head);
      case '/api/status': return reply({
        ready: true, asOf: state.saved.dataset.asOf, syncedAt: state.saved.dataset.syncedAt,
        accounts: state.saved.dataset.accounts.length, transactions: state.saved.dataset.transactions.length,
        updateMode: 'synthetic-demo', automaticBankSync: false, refresh: null,
      }, 200, head);
      case '/api/app-version': return reply({ version: APP_VERSION }, 200, head);
      default: return reply({ error: UNAVAILABLE_MESSAGE }, 404, head);
    }
  };
}

export const clientFetch: typeof globalThis.fetch = createDemoTransport();
