<div align="center">

# Neonworth

**Your finances. In a different light.**

An open-source personal finance workspace for understanding your spending, tracking your progress and planning what comes next.

[![CI](https://github.com/yaokaiy/neonworth/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/yaokaiy/neonworth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-8bd5ca)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-f5b97f)](docs/RELEASE_STATUS.md)

[Live demo](https://yaokaiy.github.io/neonworth/) · [Use with ChatGPT](#use-with-chatgpt) · [Try locally](#try-it-locally) · [Data format](docs/IMPORTING.md) · [Deployment](docs/DEPLOYMENT.md) · [Contributing](CONTRIBUTING.md)

</div>

Neonworth brings spending, cash flow, budgets, goals and net worth into one neon workspace. Inspect the records behind a total, correct a transaction without losing its source, and keep repayments separate from spending. Incomplete evidence stays visible.

[![Neonworth overview with a dark neon interface, binary rain, financial summaries and monthly spending bars](docs/images/overview.png)](https://yaokaiy.github.io/neonworth/)

*Real application screenshots with invented data. Warm and cool neon accents, binary rain and consistent chart styling—[open the demo](https://yaokaiy.github.io/neonworth/) to see the motion and explore reports.*

<details>
<summary>See the spending view</summary>

![Neonworth spending view with category bars, budget-purpose totals and a neon report illustration](docs/images/spending.png)

</details>

The public demo needs no signup or bank connection. Reports, dates, filters and display preferences are interactive; imports and financial saves are disabled. [Run the full app locally](#try-it-locally) to use your own data, or read [how the demo is built](docs/DEMO.md).

## What's inside

- **Overview and spending:** consistent monthly, year-to-date and rolling-year reports, categories and dated net-worth observations.
- **Activity and review:** searchable transactions, category selection, explicit accounting decisions, supported repayment/refund reconciliation and preserved source evidence.
- **Budgets:** configurable monthly limits and annual allocations, with actual spending and coverage shown separately.
- **Goals and FIRE:** user-entered withdrawal needs, rates, eligible assets and future dates. Optional projections require explicit assumptions.
- **Year in review:** large purchases and user-defined events, with linked refunds and no duplicate memberships.
- **Income and assets:** cash and received equity shown separately; unknown prices or incomplete investment coverage stay visible.
- **Neon workspace:** shared binary rain, instrument-style bars, quiet mode, reduced-motion support and amount hiding.
- **ChatGPT workflows:** create a private Sites instance, import already-authorized GPT Finance records, refresh with verified readback, and preserve records through upgrades and interrupted operations.

## Use with ChatGPT

For ChatGPT users with **Sites available and GPT Finance already connected and authorized**, this is the recommended managed-hosting path. Each installation gets its own private Site and database. The website receives validated financial records; provider credentials and source-access capabilities stay outside it.

Start with the [copy-and-paste setup prompt](prompts/start.md). It guides ChatGPT through capability checks, a separate instance, private publication, initial population and saved-state verification. It never asks you to reconnect a bank merely because a tool is missing from the current conversation. The current data contract is USD-only.

For ongoing use, copy the [refresh](prompts/refresh.md), [upgrade](prompts/upgrade.md) or [recovery](prompts/recovery.md) prompt. Recurring updates are optional and require verified unattended access. A data refresh does not rebuild or redeploy your website.

The repository also provides an [installable workflow plugin and skill](prompts/README.md). Installation availability depends on the ChatGPT/Codex surface; this repository is not a public-directory approval claim. The [Sites deployment profile](profiles/sites/README.md), [Finance harness](integrations/gpt-finance/README.md) and [delivery contract](docs/SITES_DELIVERY.md) document the supported behavior and verification boundaries. See [release status](docs/RELEASE_STATUS.md) for actual evidence and remaining gates.

## Try it locally

Use Node **26.8.1** (see `.node-version`). The installer uses pinned **pnpm 11.25.0**.

```sh
git clone https://github.com/yaokaiy/neonworth.git
cd neonworth
npm run install:ci
npm run demo
npm run dev
```

Open **http://127.0.0.1:5173**. The demo contains invented institutions, transactions and balances. `npm run demo` generates a new demonstration relative to today's date, applies local migrations and seeds only the local D1 database. It refuses to replace non-demo data or independent saved settings. It does not access a hosted database or a financial provider.

To start empty instead, run `npm run setup:local` and `npm run db:migrate:local`, then `npm run dev`. Import your own normalized JSON through Accounts & data after reviewing the [data contract](docs/IMPORTING.md).

## Make it yours

The default policy includes explicitly classified cash income, leaves unconfirmed payment purposes unresolved, and treats supported card repayments as movements. It does not assume an employer, that every person-to-person payment is a transfer, or that an unlinked card's payments represent a particular kind of spending.

Review `lib/finance-config.ts` before changing accounting conventions. Budget amounts and planning assumptions are entered in the app. The first release uses **USD amounts with two-decimal accounting**; it does not convert currencies or consolidate foreign-currency accounts. Do not import mixed-currency data as though it were USD.

The browser and application never receive bank or brokerage credentials. Collect and normalize exports outside the app. The raw refresh protocol is an optional adapter contract, not a working bank integration or automatic scheduler.

## Deployment

The app has two deployment profiles sharing its financial models, records and UI: [owner-private ChatGPT Sites](profiles/sites/README.md), and [Cloudflare Workers/D1 with Cloudflare Access](docs/DEPLOYMENT.md). The standalone profile rejects hosted requests when authentication is missing or invalid. The Sites profile uses the platform's confirmed private access boundary.

One instance belongs to one owner. Giving another person access to the same instance shares the same datastore; there is no multi-user tenancy model.

## Extend with your own data source or AI agent

Start with the [offline CSV adapter](integrations/README.md), the generated [dataset v1 schema](contracts/dataset-v1.schema.json), and the canonical `npm run import:validate` command. The [HTTP contract](docs/API.md) and [extension guide](docs/EXTENDING.md) explain the supported backend boundary. Point your coding agent to [the integration skill](skills/neonworth-integrations/SKILL.md) for implementation with synthetic fixtures and explicit acceptance criteria. A replacement database/backend is a separate implementation, not a configuration toggle.

## Development

```sh
npm run security:secrets
npm test
npm run typecheck
npm run security:audit
npm run build
```

The CSV adapter regression tests also require Python 3.10+ (`python3` on PATH). The app and synthetic local demo run without Python.

The stack is React, TypeScript, Vinext/Vite, Cloudflare Workers and D1, with Radix, Recharts and Zod. Next-shaped routes run through Vinext, not a stock Next.js server. Read [the architecture](docs/ARCHITECTURE.md) for boundaries and current capacity limits.

This is an initial alpha release. Terminal validation and browser acceptance are recorded separately in [release status](docs/RELEASE_STATUS.md). Financial reports depend on the evidence you import; source completeness, asset eligibility and future returns are not inferred.

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). All included demo data is synthetic.
