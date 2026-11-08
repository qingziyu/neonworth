# Owner-private ChatGPT Sites profile

This is a separate deployment target. The default `npm run build` and ordinary Cloudflare Worker retain their Access JWT gate. The public demo is also separate. No source Finance connector is granted to the Sites Worker.

## Prepare a separate instance

From a clean, reviewed, committed Neonworth checkout:

```sh
npm run sites:export -- /absolute/path/to/new-empty-instance
```

The exporter copies an allowlist of committed source blobs, rejects symlinks and dirty tracked changes, and reports the source revision. The destination must be outside the public checkout. It excludes Git history, node_modules, outputs, local D1 state, environment files and deployment identity. It initializes `.openai/hosting.json` with `DB`, unused R2 set to `null`, and MCP enabled, plus `.openai/template.json` containing only the upstream revision. Nothing is seeded or imported. Do not run setup against an existing instance; it refuses to replace a manifest. `npm run sites:setup` exists only for an otherwise prepared source copy without a manifest; it cannot reconstruct missing template provenance.

## Upgrade a private source checkout

Open the existing private instance using the native Sites source workflow first. Commit a reviewed clean private checkpoint. From a separate clean checkout of the reviewed new public release, run:

```sh
npm run sites:upgrade -- /absolute/private-instance
```

The helper uses the recorded upstream revision, the new committed release and the current private files for a file-level three-way comparison. The base commit must be available in the public checkout. It preserves unrelated custom files and unchanged local customizations, including reporting timezone. If both versions changed the same file differently, or a new upstream file collides with untracked work, the entire operation is rejected before source writes; the error lists paths only. Resolve those conflicts by a reviewed manual three-way merge, preserving local intent. There is no force-overwrite option. Advance the private provenance only after the manual merge has been reviewed and checked.

An uncontested upgrade changes only template source and updates `.openai/template.json` last. The hosting manifest, Git identity, local database, runtime files, backups and instance-only configuration stay untouched. The exported `.gitignore` transformation is applied to both comparison versions so the hosting manifest remains trackable. I/O failures attempt to restore changed files and prior provenance; if restoration is incomplete, keep the instance unpublished and restore its clean Git checkpoint before proceeding. The helper does not commit, build, migrate, deploy, import or write financial records. Review the resulting private diff and run the normal preservation/build/publication workflow afterward.

`npm run sites:check` is a separate CI compile gate: it requires a clean committed checkout, builds an isolated temporary instance with a synthetic identity, verifies the artifact, and removes that instance. It performs no registration or deployment and never changes an existing manifest.

## Register, open and publish through Sites

Use the installed **Sites skill**, not Wrangler deployment. Its native tools and absolute helper paths are supplied by the user's installed plugin; this repository does not include credentials or a plugin installation path.

1. Select the exported instance directory. Create one new private, unpublished Site with the native `create_site` tool, or resume that exact creation result. Never reuse another person's Site identity.
2. Immediately persist the returned ID using the Sites `set-project-id.mjs --project-id <returned-id>` helper. Omit static output settings. Confirm the Site is owner-private with the native returned access policy.
3. Open the instance using the Sites source workflow helper and the returned repository credential, passed only via its hidden stdin protocol. Retain the opening result. The new private source repository must track `.openai/hosting.json` and `.openai/template.json`; if necessary force-add exactly those files, never an ignored directory wholesale.
4. Install the pinned dependencies in the instance. Run appropriate checks, then build with the explicit profile:

   ```sh
   NEONWORTH_HOSTING_PROFILE=sites npm run build
   ```

   `npm run sites:build` selects the same build and verifier. A plain build in a Sites instance fails closed rather than silently building the standalone Worker. Native `build-site.mjs` calls `npm run build`; set `NEONWORTH_HOSTING_PROFILE=sites` on that helper's process. For the source workflow's ordered commands use `['env', 'NEONWORTH_HOSTING_PROFILE=sites', 'node', '<absolute build-site helper>']`.

5. Package through the source workflow helper, retaining the complete opening result and exact verified revision. Publish only through the native owner-private Sites deployment tool. Sites provisions D1 and applies bundled schema migrations; do not manually migrate a hosted Sites database.
6. Verify the native deployment result and separately test anonymous denial, owner access, service access, MCP discovery and synthetic readback. Unit tests cannot establish the platform access policy. Before an existing-instance upgrade, preserve its Site identity, audience, database, saved records and schedule; use the Sites opening workflow rather than rerunning the exporter/setup over it.

## Local profile checks

The instance needs a registered manifest before building or starting. Local D1 remains separate from hosted data:

```sh
npm run sites:migrate:local
npm run sites:dev
```

Development binds to HTTP loopback. The build forces `SITES_LOCAL_DEV=false`. The local D1 command uses the profile's dummy local database identity and never passes `--remote`. The generated Worker artifact contains only DB and bundled asset bindings; it carries no Finance grant or source credential.

## Authorization boundary

This entry point is supported only behind a **confirmed owner-private Sites Dispatch policy**. Sites authenticates the browser owner and authorizes MCP callers. For a shared updater, Dispatch validates and consumes the Site-scoped `OAI-Sites-Authorization` service bearer; those valid calls need not include visitor identity. The application must therefore not demand a visitor header from every service request, nor treat a supplied header or arbitrary bearer as a bypass.

The Worker does not implement a second sign-in/session system. It rejects incompatible browser origins/Fetch Metadata, strips authentication and identity headers before application processing, and forwards only DB/ASSETS with empty capability props. All source collection remains external. Do not deploy this entry point as a raw/public Worker, change the Site audience to make an updater work, or claim that a test invoking the Worker directly proves native authentication. Use the ordinary Cloudflare profile when deploying outside Sites.

The `sites()` Vite integration is vendored unchanged from the installed Sites starter's MIT-licensed `@openai/sites-vite-plugin` 0.2.0. Its adjacent license is retained; local mock identity is disabled. The profile packages the instance hosting manifest and immutable Drizzle migrations in the supported `dist/.openai` format.
