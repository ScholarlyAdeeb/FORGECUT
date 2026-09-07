const path = require('path');
const express = require('express');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Required security headers for FFmpeg.wasm to use the browser's local memory.
// These also gate SharedArrayBuffer, so crossOriginIsolated must stay true.
app.use((req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    next();
});

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
        maxAge: '30d'
    }));
}

app.use(express.static(PUBLIC_DIR, {
    // Assets are not content-hashed, so they must revalidate on every load or a
    // deploy would serve stale code. ETag keeps that cheap (304, no body).
    // The transfer win here comes from compression above, not from caching.
    etag: true,
    lastModified: true,
    maxAge: 0,
    setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
}));

const server = app.listen(PORT, () => {
    console.log(`ForgeCut running at http://localhost:${PORT}`);
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
        server.close(() => process.exit(0));
    });
}
