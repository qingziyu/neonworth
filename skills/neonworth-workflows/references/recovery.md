# Recover from the last verified stage

Use the operation receipt, current native Site state and the [finance harness](../../../integrations/gpt-finance/README.md). Recovery begins with reads. A lost response is uncertainty, not proof that nothing happened.

| Interrupted stage | Next check |
| --- | --- |
| Site registration | Resolve the retained project ID or matching creation result; do not register another while the outcome is unknown. |
| Source packaging or publication | Reopen the same Site source; inspect the returned saved-version/deployment ID and resume that operation. Do not reuse an archive for a different commit. |
| Initial population | Read persisted data and independent records. Existing data switches the task to refresh/reconciliation; it is not permission to repeat an initial import. |
| Refresh commit | Read the exact run ID. A succeeded run stays succeeded. Do not fail another writer's run; an active or unknown run requires reconciliation before a new writer starts. |
| Scheduler change | Read the actual Site-linked task before retrying. Stored schedule metadata is insufficient. |
| Backup restore | Verify destination, complete backup scope, current revisions and explicit restore authority before any writes. |

Do not convert missing source/tool access into empty financial data, reset saved decisions to remove warnings, or broaden the Site's audience to troubleshoot access. Use actual evidence to distinguish financial discrepancies from obsolete ingestion notes.

There is no universal all-record restore endpoint. Follow the deployed API and harness contracts for each supported record; budget/planning replacements require their actual current comparison values. Stop on revision mismatch rather than overwriting newer work. If exact restoration is unsupported, report the missing recovery mechanism and retain both current state and the backup; do not improvise a sequence of partial writes.

Finish with the last durable stage verified, whether existing records were preserved, the remaining specific blocker and the next safe action. Keep raw provider errors and private records out of public issue reports and summaries.
