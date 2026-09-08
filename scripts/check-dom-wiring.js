#!/usr/bin/env node
/**
 * DOM wiring check — catches handlers wired to elements that do not exist.
 *
 * Almost every bug found in this project has been the same shape: something
 * wired but not actually connected, failing silently. The front end is written
 * very defensively (`if (!el) return;` appears 130+ times), and that
 * defensiveness is exactly what turns a wiring mistake into silence instead of
 * an error. A getElementById for an id that exists in no markup is the
 * signature of that bug:
 *
 *   - mediaImportBtnInput  -> the Project Media Import button did nothing
 *   - insp_shape_glow_size -> four inspector listeners that never bound
 *   - state.resolution     -> nine Quick Positioning buttons did nothing
 *
 * The codebase still has a backlog of these, so this ratchets rather than
 * failing outright: the known set lives in scripts/dom-wiring-baseline.json,
 * and the check fails only on NEW dangling references. Fix one, remove it from
 * the baseline, and it can never come back.
 *
 *   node scripts/check-dom-wiring.js           # verify
 *   node scripts/check-dom-wiring.js --update  # re-record the baseline
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const BASELINE = path.join(__dirname, 'dom-wiring-baseline.json');
const SKIP_FILES = new Set(['tailwind.js', 'jszip.js', 'papaparse.js']);
const SKIP_DIRS = new Set(['__testmedia']);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
        } else if (/\.(js|html)$/.test(entry.name) && !SKIP_FILES.has(entry.name)) {
            out.push(path.join(dir, entry.name));
        }
    }
    return out;
}

const files = walk(ROOT);
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(path.join(__dirname, '..'), p).replace(/\\/g, '/');

// Ids the app actually creates: static markup, template literals, and
// element.id assignments all count.
const declared = new Set();
for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/id=["']([A-Za-z0-9_${}.-]+)["']/g)) {
        // Skip interpolated ids (`id="clip_${c.id}"`) — they are dynamic.
        if (!m[1].includes('$')) declared.add(m[1]);
    }
    for (const m of s.matchAll(/\.id\s*=\s*["']([A-Za-z0-9_-]+)["']/g)) declared.add(m[1]);
}

// Elements the code reaches for.
const dangling = new Map();
for (const f of files) {
    const s = read(f);
    const refs = [];
    for (const m of s.matchAll(/getElementById\(["']([A-Za-z0-9_-]+)["']\)/g)) refs.push(m[1]);
    for (const m of s.matchAll(/querySelector(?:All)?\(["']#([A-Za-z0-9_-]+)["'\s,)]/g)) refs.push(m[1]);
    for (const id of new Set(refs)) {
        if (declared.has(id)) continue;
        if (!dangling.has(id)) dangling.set(id, rel(f));
    }
}

const found = [...dangling.keys()].sort();

if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify({
        note: 'Known dangling element references. Shrink this list; never grow it.',
        ids: found
    }, null, 2) + '\n');
    console.log(`Baseline updated: ${found.length} known dangling reference(s).`);
    process.exit(0);
}

let baseline = { ids: [] };
try {
    baseline = JSON.parse(read(BASELINE));
} catch (e) {
    console.error(`No baseline at ${rel(BASELINE)} — run with --update to create it.`);
    process.exit(1);
}

const known = new Set(baseline.ids);
const added = found.filter(id => !known.has(id));
const fixed = baseline.ids.filter(id => !dangling.has(id));

if (added.length) {
    console.error('New dangling element references — these will fail silently:\n');
    for (const id of added) console.error(`  ${id}  (referenced in ${dangling.get(id)})`);
    console.error('\nEither create the element, or remove the dead handler.');
    console.error(`If it is genuinely optional, record it: node scripts/check-dom-wiring.js --update`);
    process.exit(1);
}

console.log(`DOM wiring OK — ${found.length} known dangling reference(s), no new ones.`);
if (fixed.length) {
    console.log(`\n${fixed.length} previously-dangling reference(s) now resolve. Re-record with --update:`);
    for (const id of fixed) console.log(`  ${id}`);
}
