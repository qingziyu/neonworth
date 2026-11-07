# Extending Neonworth

The recommended first extension is an external source adapter that produces a validated snapshot. Keep the supplied application/backend together until a demonstrated deployment or data-volume requirement justifies replacing storage or HTTP handlers. The application is single-owner and USD-only; it does not supply bank authentication, a scheduler, a multi-user service or currency conversion.

## What exists today

| Boundary | Implemented | Appropriate extension |
|---|---|---|
| Source collection | Importable JSON snapshots; synthetic examples | A separate CSV/export/provider adapter under the owner's control |
| Financial interpretation | Shared TypeScript modules and explicit deployment policy | New tested rules with source evidence and optional user configuration |
| Frontend/backend | Same-origin routes documented in [API.md](API.md) | Preserve those response/save semantics when introducing a backend |
| Storage | D1 snapshots, independent records, atomic batches and chunk validation | A separately reviewed storage implementation with recovery/concurrency parity |
| Authentication | Cloudflare Access application JWT for one owner; explicit loopback development mode | Another verified owner boundary protecting every UI, API, asset and MCP route |

There is no implemented `BACKEND_URL` switch, PostgreSQL adapter, Docker deployment or bank connector. Framework source uses Vinext/Vite/Workers; Next-shaped filenames do not imply an unmodified Next.js server can run it.

## Build a source adapter

1. Work from a small synthetic export and the validators in `lib/store-validation.ts`. Keep the adapter's provider authentication and source retrieval outside the hosted application. No account/provider token belongs in an imported field, browser bundle, worker binding, fixture, log or AI prompt.
2. Map stable source account/transaction IDs, source dates, posting state, signed amounts and honest coverage. Keep amounts separate from interpretation. Supply `flow:"review"` when purpose is unsupported; do not infer salary from an arbitrary deposit or convert a transfer into spending. Use `sourceName`, detailed categories and location only when the source supports them.
3. Produce the complete retained snapshot, not just today's rows. Preserve previous history and independent corrections. Explicitly detect changed reviewed source evidence and duplicate/pending relationships; reject or request reconciliation rather than silently reassigning a saved decision. Do not fabricate net-worth history from a current balance.
4. Validate the source-only `{dataset}` envelope and all cross-record/account/date constraints locally with `npm run import:validate -- <local-json-file>`, then import through **Accounts & data** into an isolated local instance. The offline validator rejects restore maps and extra envelope fields; it cannot certify a backup restoration against existing instance records. A structural JSON Schema alone does not replace the runtime schema's refinements, credential checks and storage bounds.
5. Read back `/api/data` and verify source IDs, counts, dates, financial totals and unchanged independent records. Exercise the import twice to establish idempotence; test incomplete files and conflicting changes. Once verified, an owner can choose an external scheduling mechanism and compatible authenticated transport. No scheduler is created merely by writing an adapter.

Start with the [offline CSV example](../integrations/README.md) and [integration skill for coding agents](../skills/neonworth-integrations/SKILL.md). The skill supplies a bounded implementation workflow, not authorization to read accounts or deploy. See [IMPORTING.md](IMPORTING.md) for the current envelope and recovery limits. The raw Finances refresh bundle is an optional provider-specific adapter described in [API.md](API.md); do not fabricate its coverage fields to reuse it for an unrelated source. A generic staged import API would be a new feature requiring its own schema and concurrency tests.

## Change a financial rule

Keep provider evidence, derived interpretation and saved user decisions distinct. The principal entry points are `lib/classification.ts`, `lib/transaction-review.ts`, `lib/periods.ts` and the report modules. Deployment conventions live in `lib/finance-config.ts`. Personal merchant lists, employer assumptions, spending targets and tax claims do not belong in shared defaults.

A rule needs a positive synthetic example, a nearby ambiguous counterexample, explicit-correction precedence and repeated-derivation tests. Verify income, spending and movements across month, YTD and past-year scopes. A new rule must explain what evidence establishes its result, what remains unknown and when review is required. Preserve raw amount/date/account/ID; corrections must not erase the source.

## Replace the backend deliberately

The HTTP surface in [API.md](API.md) is the compatibility target for the current frontend, not a promise that arbitrary future releases are wire-compatible. Pin the source release. Keep frontend calls same-origin by serving or proxying the complete route surface under the application origin; cross-origin CORS support is not supplied.

Implement the full saved-state envelope, nullable first-run states, preference patch behavior, budget/planning comparisons, validated snapshot replacement, safe errors and private no-store responses. Port the authentication and request-size boundaries before allowing real data. If MCP clients are supported, implement their result/error envelope and reuse the same financial logic; a second set of accounting rules will drift.

A PostgreSQL or SQLite service can use different physical tables. It still needs atomic source publication, conflict detection, correction isolation, event-membership revision guards, idempotent writes and recovery that includes every independent record. Preserve or explicitly migrate data format versions. Do not turn a failed read into an empty ledger, auto-replay uncertain writes, or overwrite newer corrections during source refresh. Test both corrupted storage and a response lost after a successful commit.

The frontend currently downloads the full snapshot and calculates many reports locally. Replacing D1 alone does not remove that cost. Pagination or server-computed reports need a new revision-consistent query contract covering entire-history calculations, period boundaries, refunds and review evidence; they cannot be implemented by summarizing only the currently visible page. A public multi-tenant service also needs tenant isolation, authorization, quotas, abuse controls and recovery work beyond this project’s current single-owner boundary.

## Contributor acceptance

Use the pinned Node/package-manager versions from repository configuration and install the locked dependencies. Run:

```sh
npm run security:secrets
npm test
npm run typecheck
npm run security:audit
npm run contracts:check
npm run build
```

For adapters, include synthetic round-trip, unchanged-source retry, missing-field, duplicate-ID, incomplete-coverage and credential rejection cases. For backend replacements, add real storage transaction tests and run the existing storage resilience, backup recovery, planning, refresh, saved-state race and owner-access regressions against the replacement. Tests that only mock successful storage calls cannot establish durable save behavior.

Use synthetic browser checks for reload/navigation, an interrupted save, stale-editor conflicts, amount hiding, keyboard controls, reduced motion and 320px/390px layouts. Record browser results separately from server rendering and builds. Do not use real exports in public test fixtures or review packets. For a hosted release, verify the exact artifact's authentication and persisted-state readback in its intended deployment before declaring that deployment accepted.

## Why these boundaries

Established projects make different deployment choices. [Actual publishes a standalone sync-server package and CLI](https://actualbudget.org/docs/install/cli-tool/), giving users a concrete supported server rather than requiring them to invent a backend. [Firefly III keeps its data importer separate for security and maintenance](https://github.com/firefly-iii/data-importer), a useful precedent for externalizing provider access. [Ghostfolio ships a Docker Compose deployment](https://github.com/ghostfolio/ghostfolio/blob/main/docker/docker-compose.yml) with application and backing services, making its operational requirements explicit.

For Neonworth, the practical lesson is a working bundled backend plus a documented adapter boundary. D1 is today's implementation, not a requirement for every future contributor. An alternate backend becomes supported when its implementation, deployment instructions and compatibility/recovery tests exist—not when a diagram names it. These references inform architecture; no code from those projects is copied into Neonworth.
