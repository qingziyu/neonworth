# Public demo

The public demo presents the real Neonworth interface with invented financial records. It is a separate static build, suitable for GitHub Pages. It is not a way to host your own financial data.

Visitors can switch reports and dates, filter transactions, inspect charts and evidence, hide amounts, and change display preferences. Financial edits and imports are unavailable. The full application supports these through its authenticated backend; follow [Deployment](DEPLOYMENT.md) for your own instance.

## Build and preview

Use the pinned toolchain and locked dependencies from the README, then run:

```sh
npm run demo:build
npm run demo:preview
```

Open `http://127.0.0.1:4173/neonworth/`. Only the generated `demo-dist/` directory belongs in a static host. Do not upload the Worker build, local databases, imports, environment files or project root.

The default base path is `/neonworth/`; Actions builds derive it from the repository name, so renamed forks work too. User and organization `<owner>.github.io` repositories use `/`. For a custom domain or path, set `DEMO_BASE_PATH` when building (for example, `DEMO_BASE_PATH=/ npm run demo:build`). Use the same value when running the preview command. Query-based report links do not require a catch-all redirect.

The demo imports the synthetic fixture generator directly. It never reads your local D1 database or financial exports. Example budgets and planning assumptions belong only to the demo; they do not change the application's unset defaults. The demo transport rejects writes and has no network fallback to an API.

The public fixture has a fixed illustrative date of **November 7, 2026**. It is not a live feed. October 2026 is available as a complete sample month.

## GitHub Pages

1. In the repository's **Settings → Pages**, choose **GitHub Actions** as the publishing source.
2. Add the repository Actions variable `PUBLISH_DEMO` with value `true`.
3. Push to `main` or run the **CI** workflow manually.

For a custom domain, also set the repository Actions variable `DEMO_BASE_PATH` to `/`. The workflow passes this variable into the demo build. Leave it unset for ordinary project Pages hosting.

The workflow runs the regression, type, secret-scan, dependency-audit and Worker-build checks, builds the demo, and publishes that same checked revision. Forks still build and test the demo, but do not publish unless they enable the variable. Use your repository's Pages URL in the README and About panel after deployment succeeds.

GitHub Pages deployment follows [GitHub's custom-workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Subdirectory assets follow [Vite's Pages base-path guidance](https://vite.dev/guide/static-deploy#github-pages).

## Screenshots and browser acceptance

Capture screenshots only from the synthetic demo. Include the demo label and record the source revision and viewport. Screenshots demonstrate appearance; they do not establish keyboard, privacy, reduced-motion or responsive acceptance. Those results are tracked separately in [release status](RELEASE_STATUS.md).

In the existing desktop Chrome task group, open the local preview above and check:

- Switch Overview → Spending → Goals → Year in Review; reload and use Back/Forward. All URLs stay under the configured base path, including copied year links and links opened in new tabs.
- Select October 2026, inspect repayment evidence and switch to the transaction ledger. Repayments remain movements, and the intentionally unresolved incoming payment remains reviewable evidence.
- Visit Accounts & data and planning controls. Imports and financial saves are disabled; there is no financial API network traffic or request for credentials.
- Toggle amount hiding, Quiet mode and system reduced motion. Check labels, tooltips and dialogs for amount disclosure, and confirm decorative motion stops when requested.
- At 320px and 390px, check the demo banner, navigation, date controls and dialogs for overlap. Use keyboard navigation and Escape; focus returns to the opener.
- Reset the view. Display preferences reset; the same synthetic dataset loads again.
