/**
 * ForgeCut — hosted speech-to-text (Vercel serverless function).
 *
 *   GET  /api/transcribe              → { available, model, maxBytes, maxSeconds }
 *   POST /api/transcribe?language=xx  → { text, chunks: [{ text, timestamp: [s, e] }], granularity, model }
 *        body: one 16-bit PCM WAV chunk (the browser splits long audio)
 *
 * The Hugging Face token lives ONLY in the server environment (HF_TOKEN on
 * Vercel). The browser never sees it: it talks to this function, and this
 * function talks to Hugging Face. Without a token the function reports
 * itself unavailable and the app transcribes in the browser instead.
 *
 * Environment:
 *   HF_TOKEN          required — Hugging Face access token (Inference permission)
 *   HF_ASR_MODEL      default openai/whisper-large-v3
 *   HF_ASR_URL        optional — full URL of a dedicated Inference Endpoint;
 *                     overrides the serverless router URL built from the model
 *   ALLOWED_ORIGINS   optional — comma-separated extra origins allowed to call
 *   RATE_LIMIT_PER_MIN  default 20 requests per IP per minute (best effort)
 *
 * Also mounted by server.js for local development, so `npm start` behaves
 * like the Vercel deployment.
 */
'use strict';

const MAX_BYTES = 4 * 1024 * 1024;            // under Vercel's 4.5 MB request limit
const MAX_SECONDS = 120;                       // per chunk; the client splits longer audio
const DEFAULT_MODEL = 'openai/whisper-large-v3';
const LANG_RE = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;

function config(env) {
    const e = env || process.env;
    const model = e.HF_ASR_MODEL || DEFAULT_MODEL;
    return {
        token: e.HF_TOKEN || '',
        model,
        url: e.HF_ASR_URL || `https://router.huggingface.co/hf-inference/models/${model}`,
        allowedOrigins: String(e.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
        ratePerMin: Math.max(1, Number(e.RATE_LIMIT_PER_MIN) || 20)
    };
}

/* ── rate limiting ────────────────────────────────────────────────────
   In-memory, so it is per server instance: it blunts a single abusive
   client but is not a global quota. For a hard cap, put a shared store
   (e.g. Upstash/Vercel KV) behind `hit()`. */
const buckets = new Map();
function hit(key, perMin, now) {
    const t = now || Date.now();
    const b = buckets.get(key) || [];
    const recent = b.filter(x => t - x < 60000);
    if (recent.length >= perMin) { buckets.set(key, recent); return false; }
    recent.push(t);
    buckets.set(key, recent);
    if (buckets.size > 5000) buckets.clear();     // bound memory
    return true;
}

function clientIp(req) {
    const xf = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
    return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * Same-origin check: browsers always send Origin on POST. This stops other
 * websites from spending the quota through visitors' browsers; it cannot
 * stop a determined non-browser client, which is what the rate limit is for.
 */
function originAllowed(req, cfg) {
    const origin = req.headers && req.headers.origin;
    if (!origin) return false;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    try {
        const o = new URL(origin);
        if (host && o.host === host) return true;
    } catch (e) { return false; }
    return cfg.allowedOrigins.includes(origin);
}

/** Validate a 16-bit PCM WAV header; returns { sampleRate, channels, seconds } or null. */
function inspectWav(buf) {
    if (!buf || buf.length < 44) return null;
    const s = (o, n) => buf.toString('ascii', o, o + n);
    if (s(0, 4) !== 'RIFF' || s(8, 4) !== 'WAVE') return null;
    let o = 12, fmt = null, dataBytes = 0;
    while (o + 8 <= buf.length) {
        const id = s(o, 4), size = buf.readUInt32LE(o + 4);
        if (id === 'fmt ') fmt = { format: buf.readUInt16LE(o + 8), channels: buf.readUInt16LE(o + 10), sampleRate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
        if (id === 'data') { dataBytes = Math.min(size, buf.length - o - 8); break; }
        o += 8 + size + (size & 1);
    }
    if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || !fmt.channels || !fmt.sampleRate) return null;
    return { sampleRate: fmt.sampleRate, channels: fmt.channels, seconds: dataBytes / (fmt.sampleRate * fmt.channels * 2) };
}

/**
 * Normalise a Hugging Face ASR response into the shape the browser worker
 * produces, so the client has one code path for both.
 */
function normalise(json) {
    const text = String((json && json.text) || '').trim();
    const raw = Array.isArray(json && json.chunks) ? json.chunks : [];
    const chunks = raw
        .filter(c => c && Array.isArray(c.timestamp) && c.timestamp[0] != null && String(c.text || '').trim())
        .map(c => ({ text: String(c.text), timestamp: [Number(c.timestamp[0]), c.timestamp[1] == null ? null : Number(c.timestamp[1])] }));
    const words = chunks.reduce((n, c) => n + c.text.trim().split(/\s+/).length, 0);
    return { text, chunks, granularity: chunks.length && words / chunks.length <= 1.2 ? 'word' : 'segment' };
}

/**
 * Call Hugging Face. Asks for word timestamps first; providers that only
 * support segment timestamps reject that, so it retries with segments (the
 * client spreads segment timing across words).
 */
async function transcribe(wav, language, cfg, fetchImpl) {
    const f = fetchImpl || fetch;
    const call = async (ts) => {
        const parameters = { return_timestamps: ts };
        if (language && language !== 'auto') parameters.generate_kwargs = { language, task: 'transcribe' };
        const res = await f(cfg.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ inputs: wav.toString('base64'), parameters })
        });
        const body = await res.text();
        let json = null;
        try { json = JSON.parse(body); } catch (e) { /* non-JSON error page */ }
        return { status: res.status, json, body };
    };
    let r = await call('word');
    if (r.status === 400 || r.status === 422) r = await call(true);
    if (r.status === 503 && r.json && r.json.estimated_time) {
        const e = new Error('The speech model is starting up; try again in a moment.');
        e.status = 503; e.retryAfter = Math.ceil(r.json.estimated_time);
        throw e;
    }
    if (r.status === 401 || r.status === 403) { const e = new Error('Hosted transcription is misconfigured (token rejected).'); e.status = 502; throw e; }
    if (r.status === 429) { const e = new Error('Hosted transcription quota reached.'); e.status = 429; throw e; }
    if (r.status < 200 || r.status >= 300 || !r.json) {
        const e = new Error(`Hosted transcription failed (${r.status}).`); e.status = 502; throw e;
    }
    return normalise(r.json);
}

function readBody(req, limit) {
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    return new Promise((resolve, reject) => {
        const parts = []; let n = 0, done = false;
        req.on('data', (c) => {
            if (done) return;
            n += c.length;
            if (n > limit) { done = true; reject(Object.assign(new Error('Audio chunk too large.'), { status: 413 })); return; }
            parts.push(c);
        });
        req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(parts)); } });
        req.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
}

function send(res, status, obj, extra) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (extra) Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
    res.end(JSON.stringify(obj));
}

function makeHandler(deps) {
    const d = deps || {};
    return async function handler(req, res) {
        const cfg = config(d.env);
        try {
            if (req.method === 'GET' || req.method === 'HEAD') {
                return send(res, 200, { available: !!cfg.token, model: cfg.model, maxBytes: MAX_BYTES, maxSeconds: MAX_SECONDS });
            }
            if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, POST' });
            if (!cfg.token) return send(res, 503, { error: 'Hosted transcription is not configured.' });
            if (!originAllowed(req, cfg)) return send(res, 403, { error: 'Requests must come from this app.' });
            if (!hit(clientIp(req), cfg.ratePerMin, d.now && d.now())) {
                return send(res, 429, { error: 'Too many transcription requests; slow down.' }, { 'Retry-After': '60' });
            }
            const url = new URL(req.url, 'http://x');
            const language = url.searchParams.get('language') || 'auto';
            if (!LANG_RE.test(language)) return send(res, 400, { error: 'Bad language code.' });
            const ct = String(req.headers['content-type'] || '');
            if (!/^audio\/(wav|x-wav|wave)\b/.test(ct)) return send(res, 415, { error: 'Send 16-bit PCM WAV (audio/wav).' });
            const wav = await readBody(req, MAX_BYTES);
            const info = inspectWav(wav);
            if (!info) return send(res, 400, { error: 'Not a 16-bit PCM WAV file.' });
            if (info.seconds > MAX_SECONDS + 1) return send(res, 413, { error: `Chunks must be at most ${MAX_SECONDS} s.` });
            const out = await transcribe(wav, language, cfg, d.fetch);
            return send(res, 200, Object.assign(out, { model: cfg.model, seconds: Math.round(info.seconds * 100) / 100 }));
        } catch (e) {
            const status = e && e.status >= 400 && e.status < 600 ? e.status : 500;
            // Never echo upstream bodies or the token; just a safe message.
            return send(res, status, { error: (e && e.status && e.message) || 'Transcription failed.' },
                e && e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : null);
        }
    };
}

const handler = makeHandler();
module.exports = handler;
module.exports.makeHandler = makeHandler;
module.exports._internal = { inspectWav, normalise, transcribe, originAllowed, hit, buckets, config, MAX_BYTES, MAX_SECONDS };
