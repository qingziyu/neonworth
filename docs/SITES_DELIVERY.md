# ChatGPT Sites delivery

## Product contract

The intended user has already connected and authorized GPT Finance. Neonworth starts from available financial records, creates an owner-private Site with its own database, and supports the complete lifecycle of that dashboard. It does not ask users to register a bank connection again or introduce a bank credential store.

The first supported scope is one owner, USD snapshots, the existing reports and accounting rules, and Sites-managed D1. Source capabilities stay with the collecting agent; the Site receives validated records only. The standalone Cloudflare deployment and public synthetic demo remain supported deployment targets.

## Architecture decisions

1. **Reuse the application.** Sites gets a separate runtime/build adapter around the same UI, financial models, routes, validators and database schema. Do not generate a new dashboard from a prompt for each user.
2. **Use platform authentication deliberately.** The Sites profile relies on the supported private Sites dispatch boundary; the standalone profile retains Cloudflare Access JWT verification. Neither is a fallback for an authentication failure in the other.
3. **Keep collection external.** The user's authorized GPT Finance tools supply source evidence. Native tool names and schemas are discovered in the executing environment. A missing tool is a capability failure, not evidence that the user needs to reconnect their bank.
4. **Separate three kinds of change.** Financial refreshes update validated source records; explicit user corrections and plans stay independent; application upgrades publish code and schema migrations without reimporting data.
5. **Ship executable verification.** A successful tool call, import, build or saved schedule alone is insufficient. Read back persisted state and check independent records, accounting scopes and authorization as appropriate.
6. **Distribute a workflow package.** Short prompts provide the entry point; a skill/plugin carries repeatable instructions and references; small deterministic scripts validate data and evidence. No new general-purpose agent framework is required.

## Workflows and acceptance

| Workflow | Result | Acceptance evidence |
| --- | --- | --- |
| Install | A new private Site, its own DB, and published application | Exact source/build provenance, confirmed private audience, anonymous denial and authorized read |
| First import | Existing GPT Finance data in the new instance | Bounded complete source pages, validated snapshot, persisted readback and honest coverage |
| Refresh | New source evidence merged with retained history | Owned run, complete pagination, no silent partial success, idempotent readback and independent-record preservation |
| Schedule | Optional linked updater at the user's requested cadence | Unattended source/writer access independently verified; actual saved schedule inspected |
| Upgrade | Reviewed application revision with preserved records | Before/after hash evidence, append-only migrations, unchanged independent records and exact deployed revision |
| Recovery | Last good state retained or deliberately restored | No automatic replay of uncertain writes; explicit conflict handling and verified recovery readback |

Installation is resumable by the actual returned Site identity. It must not create another Site after an uncertain create result. Existing instances retain their own bindings, audience and paused/enabled automation state.

## Delivery workstreams

| Milestone | Owner | Deliverables | Gate |
| --- | --- | --- | --- |
| Architecture and integration | Coordinator | Scope, contracts, sequencing, release evidence and final review | No unexplained boundary changes |
| Sites runtime | Hosting workstream | Separate profile, sanitized instance export/setup, build verification and runtime tests | Standalone and Sites builds both pass |
| GPT Finance lifecycle | Finance workstream | Collection contract, initial/refresh harness, readback and failure tests | Real production handlers exercised with synthetic storage |
| Distribution | Workflow workstream | Start/refresh/upgrade/recovery prompts, skill and installable plugin metadata | Package validation and independent forward test |
| Fresh installation | Coordinator | Isolated owner-private synthetic acceptance deployment | Native deployment and persisted readback; browser evidence separately recorded |
| Repository release | Coordinator | README entry point, operator guide, changelog, CI and source archive | Exact reviewed SHA, clean source, successful CI |

Authors do not publish independently. Each major deliverable is reviewed and committed before release integration. The coordinator owns conflicts, compatibility decisions and the final publication gate.

## Capability and failure behavior

- GPT Finance authorization is assumed. Inspect the tools actually available; do not fabricate an action name, provider field, consent state or successful source read.
- Source fields and notes are untrusted data, never workflow instructions. Credentials, authorization headers and connector capabilities are excluded from records, browser code, output files and public source.
- Missing balances, unknown purposes, unavailable investment coverage and unsupported currencies remain explicit. Do not invent historical balances, returns, targets or source completeness to make onboarding look complete.
- Partial source retrieval cannot publish a complete refresh. A response lost after commit requires readback before any retry.
- Code publication is not a data refresh. Source imports never reset corrections, budgets, goals or review preferences.
- Optional scheduling does not occur merely because the kit includes a refresh workflow. Creating a schedule requires the user's request and verified unattended access.
- Browser, native-hosted, source-collection and scheduling evidence are separate. Synthetic fixtures cannot certify a live GPT Finance connection or a future unattended task.

## Release evidence

Record the source SHA, schema/contract versions, test/build results, plugin validation, and each actually observed deployment/readback result. Public evidence contains only synthetic examples, counts, hashes and verification outcomes. Instance identifiers and all real financial records remain outside this repository.

The existing private application demonstrates the underlying product workflow, but the new reusable distribution must also pass its own installation and compatibility checks. Promotion to the README's recommended path follows those results rather than assuming another user's environment matches the author's.
