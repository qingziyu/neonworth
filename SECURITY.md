# Security

Neonworth stores financial snapshots, so confidentiality and integrity matter even though it holds no bank login capability.

## Boundaries

- Never store bank or brokerage passwords, tokens or connector grants in Neonworth, imports, browser storage, environment variables, logs or issues.
- A hosted instance is for one owner. All routes, including `/api/*` and `/mcp`, must pass the configured authentication boundary. It is not safe to share an instance among unrelated users.
- The public demo is a separate static build containing invented examples. It has no financial backend, imports or saved financial edits. Never publish a real instance's database, export or Worker build to GitHub Pages.
- Local development is bound to loopback. Local development bypasses are not production authentication.
- Amount hiding is a display preference, not anonymization or encryption. Merchant names and other evidence can still identify activity.
- Application validation rejects recognizable credential-bearing data; no pattern detector can recognize every possible secret.
- Backups and downloaded CSV/JSON contain private information. Store them outside the repository. Budget, planning and update state are separate records; a source-data export alone is not a full database backup.

## Reporting

Use this repository's Security tab to report a vulnerability privately. If private reporting is unavailable, open a nonsensitive request for a private reporting channel. Do not publish an exploit containing personal data or credentials in an issue.

Include the affected revision, synthetic reproduction steps and expected boundary. This initial release has no external security certification or availability guarantee.
