# HTTP, data and storage contracts

This documents the bundled implementation, not a separate hosted API product. Neonworth currently runs one owner's USD ledger on a Vinext/Cloudflare Worker with D1 storage. The browser calls relative, same-origin endpoints; there is no configurable remote-backend URL, multi-tenant account model or automatic bank connection. See [EXTENDING.md](EXTENDING.md) for source adapters and replacement-backend requirements.

## Authentication and transport

`worker/access.ts` authenticates requests before the application or static assets run. Production requires the configured HTTPS origin and a verified Cloudflare Access application JWT with the configured issuer, audience and owner email. An email header alone is insufficient. The current gate accepts owner application identities, not Access service identities. It removes authentication headers/cookies before forwarding the request to application code. The development exception requires both `LOCAL_DEV=true` and literal HTTP loopback; a production build sets that flag false.

All data endpoints require this same boundary, including `/mcp`. Use same-origin JSON requests; cross-origin writes are rejected. Application JSON responses use `Cache-Control: private, no-store, max-age=0`, `X-Content-Type-Options: nosniff` and `Vary: Cookie`. Do not cache financial responses in a CDN or service worker. A replacement gateway must preserve authentication, request limits, these cache semantics and the security headers in `lib/security-headers.ts`; headers alone are not authentication.

## Current endpoint surface

| Endpoint | Input | Successful response and behavior |
|---|---|---|
| `GET /api/data` | None | `{dataset, overrides, settings, retirementOverrides, reviewPreferences, refresh}`. `dataset` and `refresh` may be `null`. Missing correction maps are `{}`; review preferences contain `findingResolutions` and `recurringStatuses`. Returns saved source data, not a precomputed dashboard. |
| `GET /api/status` | None | `{ready, asOf, syncedAt, accounts, transactions, updateMode, automaticBankSync, refresh}`. Dates may be `null`; counts may be zero. `ready:true` means storage was read, not that a dataset exists. `automaticBankSync:false` is intentional; `updateMode` is descriptive metadata, not proof of an installed scheduler. |
| `POST /api/import` | `{dataset, transactionOverrides?, retirementOverrides?, reviewPreferences?}` | `{success, unchanged, asOf, transactions, accounts, retirementClassifications, transactionCorrections}`. Imports a complete source snapshot; this is not an append endpoint. Optional correction maps are for an explicit restore. Routine source imports omit them. |
| `POST /api/preferences` | A discriminated preference object, below | Transaction correction: `{success:true, override, overrides}`. Review/recurring decision: `{success:true, reviewPreferences}`. Settings/retirement annotation: `{success:true}`. |
| `GET /api/budget` | Optional `includeSummary=1`, `month=YYYY-MM`, `periodMode=month\|ytd\|year` | Normally `{plan}` with a nullable plan and no initialization side effect. With summaries: `{plan, asOf, sourceRecordCount, summary, commitments}`; requires saved data and a plan. `commitments` is keyed by year. |
| `POST /api/budget` | `{action:"initialize"}` or `{plan, expectedPlan}` | `{plan}` after a verified save. Initialization preserves an existing plan. Replacement compares the full previously read plan, including `null` for no plan. |
| `GET /api/planning` | None | `{plan}`; `null` means no persisted planning, not an error. |
| `POST /api/planning` | `{plan, expectedPlan}` | `{plan}` after validation, atomic comparison and readback. Planning contains goals and explicitly selected review events. |
| `GET /api/app-version` | None | `{version}` identifying the application build. This is not a dataset or API schema version. |
| `GET /api/refresh` | None | `{version:1, endpoint, status, window, instructions, actions, limits, policy}` for the optional provider-specific refresh adapter. Requires an existing dataset. |
| `POST /api/refresh` | `action:"begin"`, `"commit"`, `"fail"` or `"schedule"`; see below | Owned-run staging, atomic source merge, failure closure, or recorded schedule metadata. No source collection or scheduler is supplied. |
| `POST /mcp` | JSON-RPC requests | Discovery, tool listing and tool calls implemented in `app/mcp/route.ts`. Tool success/error is inside the MCP result envelope; HTTP 200 alone does not mean the operation succeeded. |

There is no `/api/export` route or general HTTP `/api/summary` route. Browser exports are assembled from saved state; most report models run locally from the source snapshot and independent corrections. MCP summary tools use the same financial modules. Budget's optional summary response is the existing HTTP exception.

Preference payloads are validated by `lib/store-validation.ts`, `lib/review-preferences.ts` and `lib/retirement-preferences.ts`:

```json
{"type":"transaction","id":"synthetic-transaction-1","patch":{"category":"Groceries","flow":"expense"}}
```

Other discriminators are `settings` with `patch`, `retirement-contribution` with `id`/`patch`, `review-resolution` with `id`/`state`/applicable `evidenceKey`, and `recurring-status` with `id`/`status`/`effectiveDate`. Obtain finding/group/source IDs from current saved or derived data. Do not manufacture them. Transaction patches cannot change source amount, date, account or ID. Review decisions are resolved by `lib/transaction-review.ts`, not by trusting a submitted display label.

## Versions, shape and limits

`Dataset.version`, `BudgetPlan.version`, `PlanningState.version`, nested goal/evidence versions and the refresh contract currently use `1`. These are separate data contracts. Routes do not have an `/api/v1` prefix or a universal `apiVersion` field. An internal chunk manifest also has its own version; clients never receive it through `/api/data`. Pin a source release and run compatibility tests when upgrading.

The authoritative runtime validators are `lib/store-validation.ts`, `lib/budget.ts` and `lib/planning.ts`. TypeScript domain shapes are in `lib/finance.ts` and the corresponding report modules. A snapshot requires `version`, `syncedAt`, `asOf`, `dateRange`, `coverage`, `accounts`, `transactions`, `netWorthHistory`, `recurring` and `notes`. The generated [dataset JSON Schema](../contracts/dataset-v1.schema.json) supports structural tooling; `npm run import:validate -- <local-json-file>` accepts only an exact `{dataset}` envelope and checks runtime validation, credentials and stored-dataset size without saving or sending data. It rejects restore maps and other envelope fields: backup restoration requires verification against the destination instance. The schema cannot encode every runtime refinement or credential check. See [IMPORTING.md](IMPORTING.md) for signs, dates and optional investment evidence. Positive transaction amounts are outflows; negative amounts are inflows or expense credits. Do not convert an unknown purpose or missing valuation into zero.

The current ceilings are 8,000,000 bytes for a streamed request, 7,500,000 UTF-8 bytes for the stored dataset and 1,800,000 bytes per independent stored record. The schema caps accounts at 500, bank transactions at 50,000, recurring records at 2,000 and net-worth observations at 10,000. These are rejection limits, not performance guarantees. Unknown source fields may be preserved where the schema allows them, but every proposed write also passes the bounded credential guard. Do not send passwords, tokens, authorization headers, private keys or connector capabilities as record metadata. Pattern detection is not proof that arbitrary text contains no secret.

## Save and conflict semantics

- Budget and planning replacements compare the full `expectedPlan` with persisted state. Planning event edits additionally guard source, correction, review-preference and budget revisions in the same transaction. A future date is allowed for a target; an asset valuation date cannot be in the future.
- Transaction, settings and annotation updates merge allowed fields into separate records. They are not a universal per-field compare-and-swap API: two edits to the same field can resolve to the later write. Independent patches must not replace the entire correction map. The UI serializes saves and verifies the resulting state.
- A snapshot import guards the stored dataset revision during its database transaction, rejects older snapshots and preserves dated net-worth history. It replaces supplied source transactions; it does not automatically merge arbitrary exports. The caller cannot supply an `expectedDataset` HTTP parameter. An adapter must preserve the complete retained source history before importing and must not force a conflicting update.
- Budget, planning, refresh state, settings and correction maps are distinct records. Omitting optional restore maps preserves existing corrections. Source import does not restore every independent record; a source JSON download is not a complete database backup.
- After an uncertain write response, read persisted state before retrying. Do not automatically replay a mutation. A response that was lost may follow a durable commit.

Application failures normally return `{error}` with an appropriate non-2xx status. Recognized credential rejections also include a safe `code`; storage failures include `code` and an opaque `reference`, without raw SQL or records. Storage may return 500/503; conflict classes return 409. One current compatibility detail: the budget endpoint's initial `expectedPlan` mismatch is a generic validation error (400), while a transactional record conflict returns 409. Clients must handle every non-success response, not only 409. Read failures may advertise `Retry-After`; uncertain writes do not. Authentication rejection occurs before these handlers and can be a plain-text 403/503, so inspect status/content type before assuming JSON.

## Optional refresh protocol

This is a retained adapter for a particular raw Finances bundle, not a universal bank API. `begin` accepts optional `fullHistory` and returns `{runId, window:{start,end}, alreadyRunning}`. An active run younger than two hours returns `alreadyRunning:true`; stop instead of becoming a competing writer. The normal source window begins at the later of saved history start and saved `asOf` minus 60 days, ends on today in the configured finance timezone, and uses the full retained history on the first day of a month. New accounts require a full-history retry.

`commit` takes `{action:"commit", runId, bundle}`. The bundle has `accounts`, fully paginated `bank`, independent `inflows`, `investments`, `recurring`, a dated `netWorth` source object, and optional verified `rsuPrices`. Page envelopes are `{cursor, result}`. The exact provider fields and completeness/currency/linking checks are in `lib/refresh-model.ts`; a CSV row cannot be passed as one of these raw pages. Commit verifies the owned run and source hash, merges retained source evidence and atomically saves source plus successful run status. `fail` takes the same owned `runId` and a short non-sensitive `error`; it preserves the last good source snapshot. Never fail another writer's run or a succeeded run.

The `schedule` action records an externally verified `{id, enabled, timezone, hour, verifiedAt}` object; it does not create, enable or execute a job. Read the current validation in `lib/refresh.ts` before using it. After commit, verify persisted status, counts, source data and relevant summaries; retrieval time does not establish bank freshness.

## Storage boundary

D1 uses `finance_records(key,value,updated_at)` and `finance_sync_log` from `drizzle/`. Source lives under `dataset`, optionally through a revisioned, hash-checked chunk manifest. `overrides`, `settings`, `retirement-overrides`, `review-preferences`, `budget-plan-v1`, `planning-v1` and `refresh-status` remain independent records. Atomic D1 batches publish source revisions and guard dependent writes. These storage keys/chunks are internal details, not endpoints a source adapter should write directly. The current read path reconstructs full snapshots; it is not a partitioned transaction-query service or a globally revisioned multi-record read API.
