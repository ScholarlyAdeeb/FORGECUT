# ForgeCut cloud-staging QA agent

This is a **read-only, audit-only** browser QA runner. It runs outside the editor
and tests the deployed staging site. It does not modify application files,
deploy, merge, or repair defects.

## Current implementation

- Playwright launches headless Chromium against the staging origin.
- Smoke-checks both the Windows shell (`/`) and macOS shell
  (`/platform/macos/`).
- Verifies document responses, page titles, and required platform DOM anchors.
- Captures uncaught browser exceptions and same-origin failed requests.
- Saves screenshots, traces/videos on failure, and JSON/HTML reports.
- GitHub Actions supports manual runs and a nightly schedule.

This is the first safe foundation, **not yet a full product certification**.
Timeline editing, actual export correctness, media corpus tests, performance
budgets, and deeper security checks need staged test fixtures and additional
selectors/assertions before they can be reported as covered.

## Configure staging

1. Create a dedicated staging deployment, separate from production.
2. In GitHub repository Settings → Secrets and variables → Actions, add the
   repository secret `FORGECUT_STAGING_URL`, e.g. the staging origin only
   (no path/query). Do not use a tokenized URL.
3. Run **Actions → ForgeCut Cloud QA → Run workflow**.
4. Inspect the uploaded `forgecut-qa-report` artifact. It includes the
   Playwright HTML report, JSON results, screenshots, traces and videos where
   available.

The workflow fails clearly if the staging secret is missing. The schedule is
nightly at 02:30 UTC; use manual runs while configuring the secret.

## Local dry run

Requires Node.js 20+ and a reachable staging deployment.

```powershell
npm install --no-save --package-lock=false @playwright/test
npx playwright install chromium
$env:FORGECUT_STAGING_URL = "https://your-staging-host.example"
npx playwright test --config=qa/playwright.config.cjs
```

The QA runner only navigates and reads the page. Do not point it at production
until the staging suite has been reviewed. Future editing/export scenarios must
use generated disposable projects and must not delete or overwrite user data.

## Scope roadmap

1. **Smoke + shell integrity** (implemented): Windows/macOS boot and DOM anchors.
2. **Core editing**: fixture import, timeline add/trim, playback, undo/redo.
3. **Export verification**: export a known short fixture; inspect container,
   codecs, dimensions, duration, audio stream and decodability with FFprobe.
4. **Regression matrix**: use `test/media-import/harness.js` and a small
   checked-in/generated corpus; don't generate the existing ~2.2 GB corpus on
   every nightly run.
5. **Performance**: record startup time, import latency, export wall time,
   page errors, and resource observations against baselines; begin informational.
6. **Passive security checks**: headers, HTTPS, unexpected same-origin failures,
   and safe API error behavior. No destructive fuzzing or load testing against
   shared staging.
7. **Reporting**: deduplicate findings by route + signature, attach evidence,
   and label severity/confidence. No automated code edits or automatic bug fixes.

## Safety boundaries

- Never expose production secrets to the browser test.
- Do not test authentication bypass, perform load tests, or send destructive
  requests against production.
- No automatic source edits, commits, deployments, merges, or repairs.
- Treat a console error or flaky timeout as evidence to investigate, not
  automatically as a confirmed product defect.
