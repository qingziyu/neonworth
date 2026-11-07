# Data integrations

The bundled backend already stores snapshots and corrections. Most integrations need a **source adapter**, not a new backend. Keep the collector outside the Worker so Neonworth never receives bank credentials.

```text
Your export/provider → external adapter → dataset v1 → validation → authenticated import → reports
```

## Offline CSV example

Requires Python 3.10+ in addition to the application's Node toolchain. This is an explicit normalized CSV format, not an automatic parser for every bank statement. Map provider columns and signs first. Account balances must come from observed account metadata; the adapter never invents them or dated net-worth history.

```sh
mkdir -p outputs
python3 integrations/csv/convert.py \
  --transactions integrations/csv/transactions.example.csv \
  --accounts integrations/csv/accounts.example.json \
  --as-of 2026-01-05 \
  --output outputs/csv-example.json
npm run import:validate -- outputs/csv-example.json
```

The output is local only. Import it through Accounts & data after reviewing it. Repeat conversion requires a new output filename; the converter does not overwrite files. Put real exports outside the repository, use a private output directory and never paste their contents into an issue or an AI prompt.

Required CSV columns are exactly those in `csv/transactions.example.csv`. Stable source IDs are mandatory. Positive amounts mean outflows; negative amounts mean inflows. A negative expense is a refund. A payment rail or merchant string is not proof of income, a transfer or ownership. Unknown purposes use `flow=review`.

`contracts/dataset-v1.schema.json` is a machine-readable structural schema. `npm run import:validate` accepts a source-adapter envelope containing **only `{dataset}`** and also applies the actual application schema, date/ID constraints, dataset/request size limits and recognizable credential rejection. Passing JSON Schema alone is insufficient. Backup envelopes with saved correction/review/retirement maps require instance-aware restore validation and are deliberately rejected by this offline source-only CLI.

## Custom provider or backend

Read [the API contract](../docs/API.md) and [extension guide](../docs/EXTENDING.md). Preserve provenance, completeness, stable IDs, explicit corrections and atomic saves. The existing raw refresh protocol is a provider-specific paginated adapter; ordinary integrations can begin with the normalized snapshot contract.

For AI-assisted implementation, point your coding agent to `skills/neonworth-integrations/SKILL.md`. It provides a bounded workflow and acceptance criteria, not permission to access accounts or deploy changes.
