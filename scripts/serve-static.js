#!/usr/bin/env node
/**
 * Serve dist/ the way Vercel will: static files only, no /api, and the
 * response headers declared in vercel.json. Use it to check a static build
 * before deploying.
 *
 *   npm run build && npm run preview:static      → http://localhost:4173
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4173);
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

// vercel.json "source" patterns used here are path-to-regexp style "/(.*)":
// literal text with "(.*)" wildcards. Escape the literal parts only.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rules = (config.headers || []).map(r => ({
    re: new RegExp('^' + r.source.split('(.*)').map(escapeRe).join('(.*)') + '$'),
    headers: r.headers
}));

http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const r of rules) if (r.re.test(url)) r.headers.forEach(h => res.setHeader(h.key, h.value));
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method Not Allowed');
        return;
    }
    let file = path.join(DIST, url);
    if (!file.startsWith(DIST)) { res.writeHead(400).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!url.endsWith('/') && config.trailingSlash) {
            res.writeHead(308, { Location: url + '/' }).end();
            return;
        }
        file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
        return;
    }
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Content-Length', fs.statSync(file).size);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`static preview of dist/ on http://localhost:${PORT} (no /api, vercel.json headers)`));
