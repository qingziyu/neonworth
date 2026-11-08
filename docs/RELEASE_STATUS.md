# Release status

This file records **0.2.0-alpha.1**, the ChatGPT Sites workflow release. It remains an alpha; source review, synthetic acceptance and live financial-source access are separate claims.

## Shipped and checked

- A separate owner-private Sites runtime/build profile, sanitized instance export and three-way source upgrade, sharing the existing application and financial models. The standalone Access-authenticated Worker and closed public demo remain separate supported targets.
- GPT Finance collection contracts, atomic first import, owned refreshes, hash/count/period readback, and preserved independent records. The intended user already authorized Finance; missing callable tools do not imply a new bank connection is required.
- Setup, refresh, upgrade and recovery prompts; a routed skill; an instructions-only portable plugin and repository catalog. Both skills and the distribution package validate. Installation in a particular client or a universal directory listing has not been established by these source checks.
- **88/88 regression scripts**, TypeScript, generated-contract consistency, source/history secret scanning, standalone Worker build, isolated synthetic Sites build and synthetic Pages build passed. The Sites compile test never registers a Site or reads financial connections.
- The dependency audit has no high or critical findings; one moderate advisory remains in the locked tree.
- Actual `claude-opus-5-5` CLI reviews covered scoped authentication, storage, refresh and source-upgrade code. Independent integration reviews also covered the workflow package and Sites asset routing. Findings were corrected and regression cases added. Review packets contain source and synthetic examples only and remain outside the distribution.
- Source export reads reviewed Git blobs; instance manifests, credentials, databases, backups and runtime state stay out of the public template. The public archive is generated from the exact release commit. GitHub Actions must pass on that revision before release publication; successful local checks alone do not establish CI or deployment.

## Hosted acceptance

A newly created owner-private validation Site was deployed through the supported native source/package/publish workflow using synthetic records only. Native policy confirmed one owner, no other viewers/editors/groups and no automations. Anonymous and forged-identity requests were denied; authorized HTML, built JavaScript and API reads passed private-cache and security-header checks. The Sites-built asset URL namespace reaches the Worker rather than bypassing its response policy.

The Finance bootstrap contract prepared an invented 3-account, 130-transaction fixture. Hosted initial import, duplicate initial-import rejection and saved transaction correction/settings/budget/FIRE-plan readback passed. This is synthetic integration evidence, not a live financial-source read.

A complete hosted synthetic refresh passed: its owned run read back as succeeded, the persisted dataset matched the atomically saved source hash, month/YTD/year summaries reconciled, and transaction corrections/settings/budget/FIRE records stayed unchanged. This used invented source envelopes through the deployed website APIs. Native MCP and live Finance access remain separate gates below.

The three-way source upgrader and native republishing also passed on the populated instance. Before/after hashes matched for the dataset, corrections, settings, retirement/review annotations, refresh state, budget and planning. This acceptance publication changed documentation/provenance and introduced no schema migration; code-change/conflict/rollback behavior is separately exercised by filesystem/Git regression fixtures. No source import or refresh ran during publication.

## Separate gates

- **Live GPT Finance collection: not verified in this runtime.** Plugin metadata confirms installation/enablement, but callable source tools are absent from the current native tool catalog. No bank reconnection was requested and no source credential was moved into the Site.
- **Native Site MCP connection: not verified here.** The publication advertises MCP, but its provisioned tools are not exposed in this conversation. The Site's ordinary service bearer was accepted for website APIs and rejected at the OAuth MCP endpoint; that is not a substitute for native MCP authorization. Production MCP handlers and native-only proof are exercised by synthetic regression tests.
- **Scheduling: not created.** The kit ships instructions and verification, not an automatically enabled task. Actual cadence/timezone, enabled state and unattended source/writer access require their own verification when requested.
- **Desktop Chrome: pending.** Existing synthetic screenshots and HTTP tests do not replace keyboard, motion, privacy, responsive or second-account browser checks. The current change introduces no new visual theme or financial interface.

## Desktop Chrome handoff

Use the existing desktop Chrome task group and profile. The public read-only demo is **https://yaokaiy.github.io/neonworth/**; see [its checks](DEMO.md). For editable checks, run `npm run demo` and `npm run dev` with synthetic local data, then open **http://127.0.0.1:5173**. Keep the gate pending until actual observations return.

1. Visit Overview, Spending, Budget, Goals, Year in Review, Activity and Accounts & data. Expect consistent navigation, explicit synthetic data and no request for bank credentials. Reload a secondary page and check the console.
2. Change reporting dates. Expect consistent calendar scopes and card repayments outside consumption.
3. Categorize the unresolved synthetic payment with the category/accounting controls. Save and reload; expect the correction to persist.
4. Save a budget and FIRE plan with a future target date; expect exact readback and explicit assumptions.
5. Hide amounts. Inspect labels, tooltips, dialogs and chart geometry for disclosure.
6. Enable Quiet mode and system reduced motion. Expect decorative rain/motion to stop and chart geometry never to animate.
7. At 320px and 390px, expect no navigation/date-control collisions. Use Tab and Escape in dialogs; expect focus to return to the opener.

Record observations using synthetic data only. Public-demo financial writes must stay disabled.
