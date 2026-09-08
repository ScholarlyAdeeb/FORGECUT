#!/usr/bin/env node
/**
 * Platform boundary check.
 *
 * The shared editor engine must not know about any platform's presentation,
 * and no platform layer may reach into another's. This is easy to violate by
 * accident — a single getElementById on a Ribbon button inside PlaybackEngine
 * is all it takes — so the rule is enforced rather than documented.
 *
 *   node scripts/check-platform-boundaries.js
 *
 * Exits non-zero on violation, so it can gate a commit or CI run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const ENGINE = path.join(ROOT, 'engine');
const PLATFORM = path.join(ROOT, 'platform');
const SHELL = path.join(ROOT, 'index.html');

function walk(dir, out) {
    out = out || [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p, out);
        else if (/\.(js|html)$/.test(entry.name)) out.push(p);
    }
    return out;
}

const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/');

/**
 * Comments are documentation, not coupling: an engine file may legitimately
 * explain which platform element it used to touch. Strip them before scanning.
 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function idsDeclaredIn(files) {
    const ids = new Set();
    for (const f of files) {
        const s = read(f);
        for (const m of s.matchAll(/id=["']([A-Za-z0-9_-]+)["']/g)) ids.add(m[1]);
        for (const m of s.matchAll(/\.id\s*=\s*["']([A-Za-z0-9_-]+)["']/g)) ids.add(m[1]);
    }
    return ids;
}

function idsReferencedIn(src) {
    const refs = [];
    const clean = stripComments(src);
    for (const m of clean.matchAll(/getElementById\(["']([A-Za-z0-9_-]+)["']\)/g)) refs.push(m[1]);
    for (const m of clean.matchAll(/querySelector(?:All)?\(["']#([A-Za-z0-9_-]+)/g)) refs.push(m[1]);
    return refs;
}

const platforms = fs.existsSync(PLATFORM)
    ? fs.readdirSync(PLATFORM, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [];

// Every platform owns the ids it declares. index.html is the Windows shell.
const owned = {};
for (const p of platforms) owned[p] = idsDeclaredIn(walk(path.join(PLATFORM, p)));
if (owned.windows && fs.existsSync(SHELL)) {
    for (const id of idsDeclaredIn([SHELL])) owned.windows.add(id);
}

const violations = [];

// Rule 1 — the shared engine must not reference platform-owned ids.
for (const f of walk(ENGINE)) {
    const refs = idsReferencedIn(read(f));
    for (const id of new Set(refs)) {
        for (const p of platforms) {
            if (owned[p] && owned[p].has(id)) {
                violations.push(`${rel(f)} references '${id}', owned by platform/${p}`);
            }
        }
    }
}

// Rule 2 — a platform layer must not load or reference another platform's files.
for (const p of platforms) {
    for (const f of walk(path.join(PLATFORM, p))) {
        const clean = stripComments(read(f));
        for (const other of platforms) {
            if (other === p) continue;
            if (clean.includes(`platform/${other}/`)) {
                violations.push(`${rel(f)} reaches into platform/${other}/`);
            }
        }
    }
}

const engineFiles = walk(ENGINE).length;
const platformSummary = platforms.map(p => `${p}:${walk(path.join(PLATFORM, p)).length}`).join(' ');

if (violations.length) {
    console.error('Platform boundary violations:\n');
    for (const v of violations) console.error('  ' + v);
    console.error(`\n${violations.length} violation(s). Shared engine: ${engineFiles} files. Platforms: ${platformSummary}`);
    process.exit(1);
}

console.log(`Platform boundaries OK — shared engine: ${engineFiles} files, platforms: ${platformSummary}`);
