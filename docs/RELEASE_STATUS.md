# Release status

This file records 0.1.0-alpha.2. It is not a claim of production certification or financial-source completeness.

- Source: audited current snapshot with rebuilt public Git history; no production deployment identity or private operational history. The earlier prerelease distribution was withdrawn.
- Data: synthetic demo, test fixtures and README screenshots only.
- Terminal validation: 82 regression scripts, TypeScript, generated-schema consistency and the supported Worker build. GitHub Pages publication requires all CI gates to pass on the exact revision. The emitted Worker asset/auth configuration passes its fail-closed gate.
- Demo builds: actual application UI with a closed read-only adapter; default repository, renamed repository and root-domain asset paths checked. The artifact excludes server modules, production headers, build manifests and sourcemaps.
- Dependency audit: no high or critical findings; one moderate advisory remains in the locked dependency tree.
- Source review: independent privacy/license review and a precommit Gitleaks scan found no supported publication blocker. Git-history scanning is repeated after committing.
- Local HTTP smoke: the authenticated-app preview pages, APIs and JavaScript assets return successfully with private/no-store headers. This is not a browser test.
- Screenshot capture: two real synthetic views rendered in an authorized, isolated headless Chromium session without reported console or page errors. See [capture details](images/README.md).
- Browser acceptance: pending the existing desktop Chrome session. Screenshots and server-rendered tests do not replace keyboard, motion, privacy or responsive checks. The public-demo handoff is in [DEMO.md](DEMO.md).
- Hosted acceptance: the public demo has a separate static publication workflow. No owner-authenticated financial instance has been deployed or verified by this release.

## Desktop Chrome handoff

After `npm run demo` and `npm run dev`, open `http://127.0.0.1:5173` in a dedicated task tab group.

1. Visit Overview, Spending, Budget, Goals, Year in Review, Activity and Accounts & data. Expect consistent navigation, explicit synthetic data and no request to connect bank credentials.
2. Select different months and verify all report scopes change together. A card repayment remains outside consumption.
3. Edit the unresolved synthetic incoming payment using the actual category/accounting controls. Save, reload and verify the correction persists. Use only demo data.
4. Set a monthly budget and a FIRE plan with a future target date. Verify saved values reload, zero assumptions are explicit, and no personal defaults appear automatically.
5. Hide amounts. Inspect report labels, tooltips, dialogs and chart geometry for unintended monetary disclosure.
6. Enable Quiet mode and OS reduced motion. Binary rain and decorative motion must stop; chart geometry must never animate.
7. At 320px and 390px widths, verify navigation and date controls do not collide. Tab through dialogs, test Escape and confirm focus returns to the opener.
8. Reload a secondary page and check the browser console for failures.

Record actual observations and screenshots using only the synthetic fixture. Until these results return, keep the browser gate pending.

## Independent review

The public demo received an actual `claude-opus-5-5` CLI source review and an independent integration review. Follow-up changes removed remaining deployment-specific reference links and policy assumptions, corrected root/custom-domain Pages paths, limited public assets to an explicit allowlist, and expanded network/import denial checks. Main-branch publication no longer cancels an in-progress deployment. The coordinator reviewed these changes and retained the review artifacts outside the public distribution. This source review does not establish desktop browser acceptance.

Actual Claude CLI reviews used `claude-opus-5-5` on a sanitized authentication packet, followed by the updated Worker, MCP route, security headers and tests. No exploitable authentication bypass was identified in that source scope. Two concrete test gaps were addressed: signed requests now exercise the actual Worker and credential/body forwarding, and the build verifies the emitted asset/auth configuration. Mutation checks confirmed those tests detect the proposed bad changes. This source review does not certify a live Access policy or deployment.

A separate integration-skill forward review used a hypothetical mixed-currency bank export without IDs or balances. The workflow preserved uncertainty and required explicit mapping rather than inventing financial evidence. It also identified and closed source-validator size/envelope gaps with regression cases.
