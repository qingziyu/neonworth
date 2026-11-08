# Releasing Neonworth

Release reviewed source, keep private instances separate, and distinguish code publication from financial updates.

## Public repository gate

Use the pinned Node and package manager. A release requires source/history secret scanning, the dependency audit, all regression scripts, TypeScript, contract consistency, the default Worker build, the isolated Sites build, and the synthetic demo build. CI runs these checks without financial connections, real records or hosting credentials. The Sites compile gate uses a temporary synthetic identity and never registers or deploys a Site.

Publish a clean exact SHA after successful CI. The public source archive comes from `git archive <sha>`, includes only tracked template files, and excludes instance identities, databases, backups, runtime state and credentials. Version the app/plugin consistently and retain archive hashes and validation evidence outside the public distribution. GitHub Pages receives only `demo-dist`, guarded by the existing opt-in repository setting.

## Sites instance release

Follow the installed Sites skill and [profile guide](../profiles/sites/README.md). Export the reviewed template into a separate directory; persist the actual returned Site identity and template provenance only in its independent private source repository. Use the supported source helper and hidden-stdin credential protocol. Source credentials and shared Site access bearers never belong in command arguments, source, logs or files.

Build with the explicit Sites profile and package through the native helper. A plain build in a Sites instance fails rather than selecting the wrong authentication boundary. Publish the exact pushed private-instance SHA and its unchanged matching archive through the native owner-private operation. Retain saved/deployment IDs and resume uncertain attempts instead of duplicating them. Check the terminal native deployment result and verify its audience before reporting success.

For an existing instance, take a private complete recovery backup where supported and stable record evidence. Apply `sites:upgrade` from the reviewed new template checkpoint, resolve conflicts without overwriting local configuration, review/commit the private source, then build/package/publish. The helper does not run migrations or financial writes; Sites applies bundled append-only schema migrations. Compare the record evidence afterward. Never reseed, reimport or refresh financial data to make an ordinary code upgrade succeed.

## Acceptance evidence

- **Synthetic regression:** financial semantics, atomic first import, owned refreshes, native-only proof, uncertain outcomes, independent records, safe export and three-way upgrades.
- **Hosted HTTP:** native private-policy confirmation, anonymous/forged identity denial, authorized pages/assets/APIs, strict security headers, and stable source/budget/planning readback.
- **Native MCP:** actual destination tool discovery, successful permitted calls and refresh verification. Service HTTP access alone does not prove an installed native MCP connection.
- **Finance collection:** actual already-authorized source calls, complete source families and successful persisted destination verification. Synthetic records and plugin installation metadata cannot establish a live source read.
- **Browser:** keyboard, amount hiding, quiet/reduced motion and 320px/390px controls in the user's existing desktop Chrome session. Builds, HTTP tests and screenshots remain separate.
- **Scheduling:** actual saved native automation, exact cadence/timezone, enabled/paused state and verified unattended source/writer access. App metadata currently represents daily on-hour schedules only; other native cadences must not be rounded or misreported.

Record each gate as passed, blocked or not run with its actual evidence. The existing personal application's past successful workflow informs the implementation, but does not replace verification of a new distribution or another user's environment.
