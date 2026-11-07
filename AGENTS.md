# Working on Neonworth

Neonworth is an open-source, single-user personal finance workspace. It imports snapshots; it never connects to bank or brokerage credentials.

- Keep source evidence, derived interpretations and saved corrections separate. Preserve amounts, date scopes, unknown coverage and optimistic-concurrency safeguards.
- Personal merchant exceptions, employers, budgets and planning assumptions do not belong in shared defaults. Document policy options in `lib/finance-config.ts` and test both default and optional behavior.
- Use synthetic data in source, tests, screenshots and issues. Never commit real financial exports, credentials, deployment IDs or local databases.
- Authentication must protect every hosted UI, API and MCP route. One deployment belongs to one owner; this is not a multi-tenant application.
- The separate public demo bundles invented data only. It must never import user records, contact a financial backend, or weaken the authenticated application's boundary.
- Preserve the dark neon design, readable financial text, semantic status colors and reduced-motion/quiet behavior. Do not animate financial values or chart geometry.
- Use the pinned toolchain. Run regression, type, credential-scan and build checks for releases. Record browser verification separately from terminal checks.
- Prefer bounded changes and mature installed components. Do not replace financial rules with visual shortcuts or hide unresolved accounting issues.
