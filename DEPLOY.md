# Deploying ForgeCut to Vercel

ForgeCut deploys as a **static site plus one optional serverless function**.
Everything heavy — editing, GPU effects, exports, captions, reframe,
tracking, proxies — runs in the visitor's browser, so there is no server to
size or scale.

## One-time setup

1. Push the repository to GitHub (all work is on one linear history; see
   "Getting the code onto `main`" below).
2. In Vercel: **Add New → Project → Import** the `FORGECUT` repository.
3. Leave the build settings alone. `vercel.json` already sets them:
   | Setting | Value (from `vercel.json`) |
   | --- | --- |
   | Framework | Other (`"framework": null`) |
   | Install | `npm ci` |
   | Build | `node scripts/build-static.js` |
   | Output | `dist` |
4. Optional — server-side captions: **Settings → Environment Variables**,
   add `HF_TOKEN` (Hugging Face token with "Make calls to Inference
   Providers" permission). Other optional variables are in `.env.example`.
   Without it, captions run in the browser.
5. **Deploy.** Production deploys from `main`; every other pushed branch gets
   a preview URL.

## What `vercel.json` does

- **Cross-origin isolation** (`COOP: same-origin`, `COEP: require-corp`) on
  every response. FFmpeg.wasm and multi-threaded WebAssembly need it. CDN
  assets the app loads at runtime (transformers.js, MediaPipe, Hugging Face
  models) all send CORS headers, so they load under it.
- **Immutable caching** for `/vendor/*` (the version-pinned FFmpeg.wasm).
- **`trailingSlash: true`**, so `/platform/macos` becomes `/platform/macos/`
  and the macOS shell's relative paths resolve.
- **`api/transcribe.js`** as a function with `maxDuration: 120`.

`.vercelignore` keeps `server.js` and `server/` (the optional self-hosted
FFmpeg server) out of the upload, so Vercel cannot mistake it for an
Express app.

## Check a build locally first

```bash
npm ci
npm run build
npm run preview:static     # dist/ with the same headers, on http://localhost:4173
```

`preview:static` serves only the static side: `/api/transcribe` returns 404
there, which the app treats as "not configured" and uses in-browser
captions. To exercise the function locally, run `npm start` with `HF_TOKEN`
set (server.js mounts the same handler).

## Getting the code onto `main`

The feature work sits on a linear chain of branches ending at
`fix/transitions-and-ribbon`, which contains everything. `main` is an
ancestor of it, so no merge is needed:

```bash
git switch main
git merge --ff-only fix/transitions-and-ribbon
git push origin main
```

## After the first deploy

- Open the site, then `/platform/macos/`. Both should load without console
  errors, and `crossOriginIsolated` should be `true` in DevTools.
- Export a short clip (MP4) to confirm FFmpeg.wasm loads from `/vendor/`.
- If `HF_TOKEN` is set: run Auto Captions and check the toast says
  "server". The first request after a quiet period can be slow while the
  model starts.

## Limits worth knowing (Vercel Hobby)

- Function request body 4.5 MB: the app sends audio in WAV chunks of up to
  110 s (~3.5 MB), cut at pauses.
- Function duration: 300 s maximum; this function is set to 120 s.
- No size cap on build output files; the 32 MB `ffmpeg-core.wasm` is created
  by `npm ci` during the build, not uploaded.
- The transcription rate limit is per function instance — a speed bump, not
  a quota. Use a shared store (Upstash / Vercel KV) for a hard cap.
