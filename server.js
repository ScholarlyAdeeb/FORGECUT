const path = require('path');
const express = require('express');
const compression = require('compression');

const exportApi = require('./server/export-api.js');
const exportService = require('./server/ffmpeg-service.js');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Required security headers for FFmpeg.wasm to use the browser's local memory.
// These also gate SharedArrayBuffer, so crossOriginIsolated must stay true.
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    // Baseline hardening for a public deployment. No CSP here: the app relies
    // on inline handlers and inline styles throughout, so a meaningful policy
    // would need those removed first rather than a permissive one that only
    // looks like protection.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

// The export API is the ONLY write-capable surface in this server, so it is
// mounted ahead of the read-only guard below and nothing else is exempt.
// Its own router restricts methods, validates the job id shape, caps upload
// size, and never accepts a filesystem path or command string from the client.
app.use('/api/export', exportApi.createRouter());

// Reject anything but safe read methods before it reaches the static handlers.
app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    res.status(405).set('Allow', 'GET, HEAD, OPTIONS').type('text/plain').send('Method Not Allowed');
});

// A malformed percent-escape (e.g. /%E0%A4%A) makes express.static throw a
// URIError while decoding, which would otherwise surface as a 500.
app.use((req, res, next) => {
    try {
        decodeURIComponent(req.path);
    } catch (e) {
        return res.status(400).type('text/plain').send('Bad Request');
    }
    next();
});

// Cheap liveness probe that does not touch the filesystem.
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// The editor ships ~1.1 MB of uncompressed JS/CSS (editor.js alone is 240 KB).
// gzip cuts that by roughly 4x and costs one line.
app.use(compression());

// FFmpeg.wasm, served from node_modules instead of unpkg so exports work
// offline and are not exposed to a third-party CDN being down or changing.
// Not copied into public/ because ffmpeg-core.wasm alone is ~32 MB; npm owns
// the version pin via package.json.
//
// The paths matter: @ffmpeg/ffmpeg resolves its worker with
// `new Worker(new URL("./worker.js", import.meta.url))`, so index.js and
// worker.js have to be served from the same directory.
const VENDOR = [
    ['/vendor/ffmpeg', '@ffmpeg/ffmpeg/dist/esm'],
    ['/vendor/ffmpeg-util', '@ffmpeg/util/dist/esm'],
    ['/vendor/ffmpeg-core', '@ffmpeg/core/dist/esm']
];
for (const [mountPath, pkgPath] of VENDOR) {
    app.use(mountPath, express.static(path.join(__dirname, 'node_modules', pkgPath), {
        // Version-pinned by package.json and never edited in place, so unlike
        // the app's own assets these are safe to cache hard.
        immutable: true,
        maxAge: '30d',
        dotfiles: 'ignore',
        fallthrough: true,
        index: false
    }));
}

app.use(express.static(PUBLIC_DIR, {
    // Assets are not content-hashed, so they must revalidate on every load or a
    // deploy would serve stale code. ETag keeps that cheap (304, no body).
    // The transfer win here comes from compression above, not from caching.
    etag: true,
    lastModified: true,
    maxAge: 0,
    // Never serve dotfiles, so a stray .env or .git in public/ cannot leak.
    dotfiles: 'ignore',
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
}));

app.use((req, res) => {
    res.status(404).type('text/plain').send('Not Found');
});

// Final error handler. Without it Express prints stack traces into the
// response in some configurations; here the detail stays in the log.
app.use((err, req, res, next) => {
    console.error('[ForgeCut] request failed:', req.method, req.originalUrl, err && err.message);
    if (res.headersSent) return next(err);
    const status = err && err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).type('text/plain').send(status === 404 ? 'Not Found' : 'Internal Server Error');
});

// A single bad request must not take the process down and log everyone out of
// their in-progress edit. Log loudly and keep serving.
process.on('uncaughtException', (err) => {
    console.error('[ForgeCut] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[ForgeCut] unhandled rejection:', reason);
});

// Reap temp directories from jobs the client abandoned, and any left behind by
// a previous process that did not shut down cleanly.
const sweepTimer = setInterval(() => {
    exportService.sweep().catch(err => console.error('[ForgeCut] export sweep failed:', err && err.message));
}, 10 * 60 * 1000);
sweepTimer.unref();

const server = app.listen(PORT, () => {
    console.log(`ForgeCut running at http://localhost:${PORT}`);
    exportService.probeCapabilities().then(caps => {
        console.log(caps.available
            ? `[ForgeCut] server encoder: ${caps.containers.join(', ')} via ${caps.version}`
            : `[ForgeCut] server encoder unavailable (${caps.reason}) - exports will use the in-browser encoder.`);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Set PORT to choose another, e.g. PORT=3001 npm start`);
    } else {
        console.error('ForgeCut server error:', err);
    }
    process.exit(1);
});

// Let nodemon/CI/container stops close connections cleanly instead of being killed.
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        // Encoders are child processes and temp dirs can be gigabytes; neither
        // should outlive the server.
        exportService.shutdownSync();
        server.close(() => process.exit(0));
    });
}
process.on('exit', () => exportService.shutdownSync());
