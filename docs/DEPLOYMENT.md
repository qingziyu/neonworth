# Run your own Neonworth

For the managed ChatGPT installation path with already-authorized GPT Finance data, use [the Sites profile](../profiles/sites/README.md) and [setup prompt](../prompts/start.md). This page covers the independently operated Cloudflare deployment.

Neonworth is a single-owner application using Vinext, Vite, Cloudflare Workers and D1. It does not require ChatGPT Sites, a connector grant, or access to the original application's infrastructure. Each installation needs its own database and configuration. The application stores imported snapshots; it does not connect to banks or brokerages.

## Local development

Use the Node version in `.node-version` and the pinned package manager through the checked-in installer:

```sh
npm run install:ci
npm run setup:local
npm run db:migrate:local
npm run dev
```

Open `http://127.0.0.1:5173`. Setup copies `wrangler.example.jsonc` to the ignored `wrangler.jsonc` only when that file does not already exist. The example database ID is a dummy; the `--local` migration creates only local D1 state under `.wrangler/state`. No Cloudflare login or hosted database is needed for local development. `npm run demo` instead performs local setup, migrations and an invented demonstration import. It refuses to replace a database that contains non-demo data or saved settings.

Development access requires both `LOCAL_DEV=true` and a literal HTTP loopback URL (`127.0.0.1`, `localhost`, or `[::1]`). The dev script binds to `127.0.0.1`; do not expose it through a tunnel, reverse proxy or LAN listener. Forwarded-host headers do not enable local access. Browser cross-origin writes are rejected even in local mode. Local Wrangler developer tools are also local-only and are not application authentication endpoints.

To test the production bundle locally:

```sh
npm run build
npm start
```

`npm start` explicitly enables loopback development access on Wrangler's local runtime. A production build itself always writes `LOCAL_DEV=false`, regardless of the source configuration. All local tools use this checkout's state; no original deployment is contacted.

## Private Cloudflare deployment

These are configuration steps for your own Cloudflare account. They have not been performed by this repository's preparation workflow.

1. Create a D1 database in your account, then replace the dummy `database_id` and `database_name` in your ignored `wrangler.jsonc`. Keep its binding named `DB`, and keep `migrations_dir` as `drizzle`.
2. Choose a custom HTTPS hostname on your Cloudflare-managed zone. Add its Worker custom-domain route, for example `"routes": [{ "pattern": "money.example.com", "custom_domain": true }]`. Keep `workers_dev` and `preview_urls` disabled so alternate hostnames do not become extra entry points.
3. Create a **self-hosted Cloudflare Access application** covering that entire hostname, including APIs, `/mcp` and assets. Use an Allow policy for your single owner email with your chosen identity provider. Do not use a Bypass policy. Set up this Access protection before publishing the application.
4. Set the following Worker variables in `wrangler.jsonc`. They are deployment identifiers, not bank credentials, but the local configuration is ignored to avoid publishing your identity and infrastructure.

| Variable | Required value |
| --- | --- |
| `APP_ORIGIN` | Exact HTTPS origin, such as `https://money.example.com`; no trailing slash or path |
| `ACCESS_TEAM_DOMAIN` | Exact team issuer, such as `https://your-team.cloudflareaccess.com`; no trailing slash |
| `ACCESS_AUDIENCE` | The Access application's audience (AUD) tag |
| `OWNER_EMAIL` | One email matching the authenticated owner's Access identity; no comma-separated list |
| `LOCAL_DEV` | `false`; the production build forces this value |

5. Apply migrations to that new database deliberately using `wrangler d1 migrations apply DB --remote --config wrangler.jsonc`. Back up an existing database before any later migration; migrations must not be rewritten after application. Keep local and hosted databases separate.
6. Run the checks and build from the reviewed source. The secret scanner downloads a checksum-pinned public tool on first use; run it before the otherwise network-disabled regression suite.

```sh
npm run security:secrets
npm test
npm run typecheck
npm run security:audit
npm run build
npm run deploy
```

`npm run deploy` publishes the generated `dist/server/wrangler.json` using your own Wrangler authentication. The repository does not supply cloud credentials, create resources automatically, or configure an Access application on your behalf. Keep build artifacts private; they include deployment configuration. Do not copy the example dummy database ID into a real deployment.

Verify your deployed hostname in an authenticated owner session. Then independently verify that an unauthenticated request cannot read pages, static bundles, APIs or MCP, and that another identity permitted by your broader team still cannot enter this application. A successful build is not evidence that your DNS, Access policy, identity provider or deployment configuration is correct.

## Authentication and storage boundary

The Worker verifies the `Cf-Access-Jwt-Assertion` signature using the configured team's public JWKS, permits only RS256, requires the exact issuer and single application audience, enforces expiration and issued-at claims, and checks the single owner email. An unverified email header, arbitrary bearer token, Access service token or another team member is insufficient. Missing configuration fails closed. The configured HTTPS origin must also match the request origin.

Authentication runs before framework routes and bundled static files. `assets.run_worker_first` must remain true; the `ASSETS` binding delivers only the built application files after authentication. The application receives only `DB`, optional `BUCKET`, and `ASSETS` bindings. Authentication headers and cookies are removed before application handling. Error responses do not echo JWTs, claims, identity values or parser errors. Responses use private, nonshared caching rules.

Browser writes require a matching Origin and compatible Fetch Metadata when supplied. Authenticated external clients may omit browser Origin, but still need a valid single-owner Access application token. The existing `/mcp` JSON-RPC and HTTP import/refresh APIs remain available behind this same boundary. This is not a public OAuth onboarding service or a multi-user tenancy system. An external client must support your Access authentication; service-token-only clients are intentionally unsupported.

Import only the documented data format. Source collection, any scheduler, and provider authentication stay outside this application. Stored schedule metadata does not itself execute a refresh. Never put bank/brokerage passwords, source access/refresh tokens, signing keys or connector capabilities in Worker variables, D1, imports, backups, logs or review packets. The credential write guard rejects recognizable credential patterns; it is an additional boundary, not a guarantee that arbitrary text cannot contain a secret.

## Verification scope

The source includes executed synthetic JWT signature/JWKS, wrong-owner, issuer/audience, expiration, cross-origin, local-mode restriction and pre-route denial tests. Local verification covered D1 migrations, the invented demo, a standalone production build, three page routes, API reads, MCP discovery, bundled assets, private response headers, cross-origin rejection and production-default denial. Browser visual acceptance and your deployed Cloudflare/Access configuration require separate verification.

Primary references: [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [Cloudflare Vite plugin configuration](https://developers.cloudflare.com/workers/vite-plugin/reference/api/), and [jose](https://github.com/panva/jose).
