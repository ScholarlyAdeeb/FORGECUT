#!/usr/bin/env node
/**
 * Static build for Vercel (or any static host that can set headers).
 *
 *   node scripts/build-static.js      → dist/
 *
 * The Node server in server.js does two things a static host cannot: it
 * mounts FFmpeg.wasm out of node_modules under /vendor, and it runs the
 * server-side FFmpeg export/analysis API. The first is solved here by copying
 * the vendored files into the output. The second is simply absent on a
 * static deploy, and the client already falls back for every feature:
 * exports use WebCodecs + FFmpeg.wasm, scene detection and captions run in
 * the browser.
 *
 * The cross-origin isolation headers FFmpeg.wasm depends on are set by
 * vercel.json, not here.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

// Kept in step with the VENDOR table in server.js.
const VENDOR = [
    ['vendor/ffmpeg', '@ffmpeg/ffmpeg/dist/esm'],
    ['vendor/ffmpeg-util', '@ffmpeg/util/dist/esm'],
    ['vendor/ffmpeg-core', '@ffmpeg/core/dist/esm']
];

// Never shipped: the generated test corpus, and anything dot-prefixed.
const SKIP = new Set(['__testmedia']);

function copyDir(from, to) {
    let files = 0, bytes = 0;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
        const a = path.join(from, entry.name), b = path.join(to, entry.name);
        if (entry.isDirectory()) {
            const r = copyDir(a, b);
            files += r.files; bytes += r.bytes;
        } else if (entry.isFile()) {
            fs.copyFileSync(a, b);
            files++; bytes += fs.statSync(a).size;
        }
    }
    return { files, bytes };
}

function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    const app = copyDir(SRC, OUT);
    let vendor = { files: 0, bytes: 0 };
    for (const [dest, pkg] of VENDOR) {
        const from = path.join(ROOT, 'node_modules', pkg);
        if (!fs.existsSync(from)) {
            console.error(`build-static: missing ${pkg} — run npm install first.`);
            process.exit(1);
        }
        const r = copyDir(from, path.join(OUT, dest));
        vendor.files += r.files; vendor.bytes += r.bytes;
    }
    // Sanity: the two entry points must exist or the deploy is broken.
    for (const f of ['index.html', 'platform/macos/index.html', 'vendor/ffmpeg-core/ffmpeg-core.wasm']) {
        if (!fs.existsSync(path.join(OUT, f))) {
            console.error(`build-static: ${f} missing from output`);
            process.exit(1);
        }
    }
    const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
    console.log(`dist/ ready — app ${app.files} files (${mb(app.bytes)}), vendor ${vendor.files} files (${mb(vendor.bytes)})`);
}

main();
