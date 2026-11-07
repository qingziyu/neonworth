# Contributing

Use the Node version in `.node-version` and the pinned package manager. Read the README and `docs/ARCHITECTURE.md` before changing storage or authentication.

Open an issue describing the problem, then keep pull requests focused. Include a synthetic example, expected behavior and relevant validation. Never attach real transactions, account identifiers, personal screenshots, credentials or databases.

Before submitting, run `npm run security:secrets` first (it caches the checksum-verified scanner), then `npm test`, `npm run typecheck` and `npm run build`. Financial changes need meaningful regression tests, including unknown/partial data and explicit corrections. UI changes need keyboard, reduced-motion, amount-hiding and narrow-screen checks at 320px and 390px.

Do not copy employer-specific accounting or personal merchant exceptions into defaults. New integrations should normalize external data into the snapshot contract; credentials stay with the external collector.

Contributions are submitted under the repository's MIT license. Retain third-party notices when adding or adapting code.
