# Changelog

## 0.2.0-alpha.1

- Added a separate owner-private ChatGPT Sites runtime and build profile, sanitized instance export/setup, and native-hosting instructions without changing standalone Access authentication.
- Added a GPT Finance collection contract and deterministic initial/refresh/readback harness around the existing financial models, storage and MCP operations.
- Added atomic first-import protection and high-confidence source salary/interest normalization without employer assumptions.
- Added setup, refresh, upgrade and recovery prompts, a routed skill, an instructions-only plugin and a repository plugin catalog.
- Added private Site HTTP verification and saved-record hash comparisons; code publication, financial refresh and scheduling remain distinct operations.
- Routed Sites-built JavaScript and CSS through the private Worker response boundary, with artifact checks for initial and lazy-loaded chunks.

## 0.1.0-alpha.2

- Put spending, budgets and financial goals first in the README and package description, with deployment instructions kept in the technical guide.
- Added CI, MIT license and alpha status badges to the README.
- Added a separate read-only GitHub Pages demo that reuses the real interface with synthetic records, isolated transport and subdirectory-safe links.
- Added opt-in demo publication after CI checks, plus concise bug report and pull request templates.
- Generalized remaining deployment-specific UI references and made optional spending-policy descriptions accurate for ordinary datasets.
- Added actual synthetic Overview and Spending screenshots and a direct demo link to the README.
- Rebuilt public Git history from the audited current source and withdrew the earlier prerelease distribution.

## 0.1.0-alpha.1

- Introduced Neonworth as an open-source, single-user finance workspace under the MIT license.
- Retained the neon interface, reports, transaction review, budget, planning, FIRE and year-review features.
- Replaced personal accounting assumptions with explicit general defaults and configurable policies.
- Added owner authentication, a synthetic local demo and public development documentation.
- Removed private deployment bindings, personal case records and private operational history from the distribution.
- Added a generated dataset schema, canonical source validator, offline CSV adapter, API/extension contracts and a portable AI integration skill.
- Validation: 80 regression suites, types, schema/skill checks, source scanning and a fail-closed production build passed.
- Browser and hosted deployment acceptance are tracked separately in `docs/RELEASE_STATUS.md`.
