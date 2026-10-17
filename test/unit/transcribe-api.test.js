/**
 * Tests for the hosted transcription function (api/transcribe.js) and the
 * client-side chunking it relies on. Hugging Face is mocked: these check the
 * contract, the security posture (token never leaves, origin and size and
 * rate checks), and the response normalisation — not the model.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const api = require('../../api/transcribe.js');
const C = require('../../public/engine/Captions.js');

const TOKEN = 'hf_secret_token_value';

function wav(seconds, sr) {
    const n = Math.round(seconds * (sr || 16000));
    return Buffer.from(C.encodeWav16(new Float32Array(n).map((_, i) => Math.sin(i / 10) * 0.3), sr || 16000));
}

function req({ method = 'POST', url = '/api/transcribe', headers = {}, body = Buffer.alloc(0) }) {
    const r = Readable.from(body.length ? [body] : []);
    r.method = method; r.url = url;
    r.headers = Object.assign({ host: 'forgecut.example', origin: 'https://forgecut.example', 'content-type': 'audio/wav', 'x-forwarded-for': '1.2.3.' + Math.floor(Math.random() * 250) }, headers);
    r.socket = { remoteAddress: '127.0.0.1' };
    return r;
}

function res() {
    const r = { statusCode: 200, headers: {}, body: '' };
    r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
    r.end = (b) => { r.body = b || ''; r.done = true; };
    r.json = () => JSON.parse(r.body);
    return r;
}

function hf(responder) {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); const { status, json } = responder(calls.length, JSON.parse(init.body)); return { status, text: async () => JSON.stringify(json) }; };
    fetch.calls = calls;
    return fetch;
}

const run = async (handler, r) => { const out = res(); await handler(r, out); return out; };

test('capabilities', async (t) => {
    await t.test('reports unavailable without a token, and never leaks configuration', async () => {
        const h = api.makeHandler({ env: {} });
        const out = await run(h, req({ method: 'GET' }));
        assert.strictEqual(out.statusCode, 200);
        assert.strictEqual(out.json().available, false);
    });
    await t.test('available with a token; the token is not in the response', async () => {
        const h = api.makeHandler({ env: { HF_TOKEN: TOKEN } });
        const out = await run(h, req({ method: 'GET' }));
        assert.strictEqual(out.json().available, true);
        assert.ok(!out.body.includes(TOKEN));
        assert.strictEqual(out.json().model, 'openai/whisper-large-v3');
    });
});

test('request checks', async (t) => {
    const fetch = hf(() => ({ status: 200, json: { text: 'hi', chunks: [] } }));
    const h = api.makeHandler({ env: { HF_TOKEN: TOKEN }, fetch });

    await t.test('503 when not configured', async () => {
        const out = await run(api.makeHandler({ env: {} }), req({ body: wav(1) }));
        assert.strictEqual(out.statusCode, 503);
    });
    await t.test('cross-site and origin-less POSTs are refused', async () => {
        assert.strictEqual((await run(h, req({ body: wav(1), headers: { origin: 'https://evil.example' } }))).statusCode, 403);
        const noOrigin = req({ body: wav(1) }); delete noOrigin.headers.origin;
        assert.strictEqual((await run(h, noOrigin)).statusCode, 403);
    });
    await t.test('ALLOWED_ORIGINS admits a named extra origin', async () => {
        const h2 = api.makeHandler({ env: { HF_TOKEN: TOKEN, ALLOWED_ORIGINS: 'https://preview.example' }, fetch });
        assert.strictEqual((await run(h2, req({ body: wav(1), headers: { origin: 'https://preview.example' } }))).statusCode, 200);
    });
    await t.test('wrong content type, non-WAV, bad language, oversize, too long', async () => {
        assert.strictEqual((await run(h, req({ body: wav(1), headers: { 'content-type': 'video/mp4' } }))).statusCode, 415);
        assert.strictEqual((await run(h, req({ body: Buffer.from('RIFFxxxxNOTAWAVE'.repeat(4)) }))).statusCode, 400);
        assert.strictEqual((await run(h, req({ body: wav(1), url: '/api/transcribe?language=en;rm' }))).statusCode, 400);
        assert.strictEqual((await run(h, req({ body: Buffer.alloc(api._internal.MAX_BYTES + 10) }))).statusCode, 413);
        // 125 s at 8 kHz is under the byte cap but over the duration cap.
        assert.strictEqual((await run(h, req({ body: wav(125, 8000) }))).statusCode, 413);
    });
    await t.test('only GET and POST', async () => {
        assert.strictEqual((await run(h, req({ method: 'DELETE' }))).statusCode, 405);
    });
});

test('Hugging Face call', async (t) => {
    await t.test('sends the token server-side, asks for word timestamps, passes the language', async () => {
        const fetch = hf(() => ({ status: 200, json: { text: ' Hello there', chunks: [{ text: ' Hello', timestamp: [0.1, 0.4] }, { text: ' there', timestamp: [0.4, 0.8] }] } }));
        const h = api.makeHandler({ env: { HF_TOKEN: TOKEN }, fetch });
        const out = await run(h, req({ body: wav(2), url: '/api/transcribe?language=fr' }));
        assert.strictEqual(out.statusCode, 200);
        const call = fetch.calls[0];
        assert.strictEqual(call.init.headers.Authorization, `Bearer ${TOKEN}`);
        assert.ok(call.url.endsWith('/openai/whisper-large-v3'));
        const sent = JSON.parse(call.init.body);
        assert.strictEqual(sent.parameters.return_timestamps, 'word');
        assert.strictEqual(sent.parameters.generate_kwargs.language, 'fr');
        assert.ok(Buffer.from(sent.inputs, 'base64').toString('ascii', 0, 4) === 'RIFF');
        const j = out.json();
        assert.strictEqual(j.granularity, 'word');
        assert.strictEqual(j.chunks.length, 2);
        assert.ok(!out.body.includes(TOKEN));
    });

    await t.test('falls back to segment timestamps when word timestamps are rejected', async () => {
        const fetch = hf((n, body) => n === 1
            ? { status: 400, json: { error: 'word timestamps unsupported' } }
            : { status: 200, json: { text: 'one two three. four five', chunks: [{ text: 'one two three.', timestamp: [0, 1.5] }, { text: 'four five', timestamp: [1.5, null] }] } });
        const h = api.makeHandler({ env: { HF_TOKEN: TOKEN }, fetch });
        const out = await run(h, req({ body: wav(3) }));
        assert.strictEqual(fetch.calls.length, 2);
        assert.strictEqual(JSON.parse(fetch.calls[1].init.body).parameters.return_timestamps, true);
        assert.strictEqual(out.json().granularity, 'segment');
    });

    await t.test('upstream failures map to safe statuses and never echo upstream bodies', async () => {
        const cases = [
            [{ status: 401, json: { error: `bad token ${TOKEN}` } }, 502],
            [{ status: 429, json: { error: 'rate' } }, 429],
            [{ status: 503, json: { error: 'loading', estimated_time: 12.3 } }, 503],
            [{ status: 500, json: { error: 'boom' } }, 502]
        ];
        for (const [up, want] of cases) {
            const h = api.makeHandler({ env: { HF_TOKEN: TOKEN }, fetch: hf(() => up) });
            const out = await run(h, req({ body: wav(1) }));
            assert.strictEqual(out.statusCode, want, `upstream ${up.status}`);
            assert.ok(!out.body.includes(TOKEN));
            if (up.status === 503) assert.strictEqual(out.headers['retry-after'], '13');
        }
    });

    await t.test('dedicated Inference Endpoint URL overrides the router', async () => {
        const fetch = hf(() => ({ status: 200, json: { text: '', chunks: [] } }));
        const h = api.makeHandler({ env: { HF_TOKEN: TOKEN, HF_ASR_URL: 'https://my-endpoint.example/asr' }, fetch });
        await run(h, req({ body: wav(1) }));
        assert.strictEqual(fetch.calls[0].url, 'https://my-endpoint.example/asr');
    });
});

test('rate limit', async () => {
    api._internal.buckets.clear();
    const fetch = hf(() => ({ status: 200, json: { text: '', chunks: [] } }));
    const h = api.makeHandler({ env: { HF_TOKEN: TOKEN, RATE_LIMIT_PER_MIN: '3' }, fetch, now: () => 1000 });
    const ip = { 'x-forwarded-for': '9.9.9.9' };
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await run(h, req({ body: wav(0.5), headers: ip }))).statusCode);
    assert.deepStrictEqual(codes, [200, 200, 200, 429, 429]);
    assert.strictEqual(fetch.calls.length, 3, 'rejected requests must not reach Hugging Face');
});

test('client chunking', async (t) => {
    await t.test('chunks cover everything, contiguously, within the limit', () => {
        const sr = 1000, n = 1000 * 350;
        const s = new Float32Array(n).map((_, i) => Math.sin(i));
        const plan = C.planChunks(s, sr, 100, 8);
        assert.strictEqual(plan[0].start, 0);
        assert.strictEqual(plan[plan.length - 1].end, n);
        for (let i = 1; i < plan.length; i++) assert.strictEqual(plan[i].start, plan[i - 1].end);
        assert.ok(plan.every(c => c.end - c.start <= 100 * sr));
    });
    await t.test('cuts land in the quiet gap, not mid-sound', () => {
        const sr = 1000, s = new Float32Array(250 * sr).fill(0.5);
        for (let i = 95 * sr; i < 96 * sr; i++) s[i] = 0;          // one quiet second near the limit
        const plan = C.planChunks(s, sr, 100, 8);
        assert.ok(plan[0].end >= 95 * sr && plan[0].end <= 96 * sr, `cut at ${plan[0].end}`);
    });
    await t.test('short audio is a single chunk', () => {
        assert.deepStrictEqual(C.planChunks(new Float32Array(500), 1000, 100, 8), [{ start: 0, end: 500 }]);
    });
    await t.test('WAV encoding round-trips through the server-side header check', () => {
        const info = api._internal.inspectWav(Buffer.from(C.encodeWav16(new Float32Array(16000), 16000)));
        assert.deepStrictEqual(info, { sampleRate: 16000, channels: 1, seconds: 1 });
    });
    await t.test('hosted words: word-level passes through with offset; segments are spread', () => {
        const w = C.wordsFromHosted({ granularity: 'word', chunks: [{ text: ' Hi', timestamp: [0.2, 0.4] }] }, 100);
        assert.deepStrictEqual(w.map(x => [x.text, x.start]), [['Hi', 100.2]]);
        const s = C.wordsFromHosted({ granularity: 'segment', chunks: [{ text: 'a bb', timestamp: [0, 3] }, { text: 'c', timestamp: [3, null] }] }, 10);
        assert.deepStrictEqual(s.map(x => x.text), ['a', 'bb', 'c']);
        assert.ok(Math.abs(s[0].start - 10) < 1e-9 && Math.abs(s[2].start - 13) < 1e-9 && Math.abs(s[2].end - 15) < 1e-9);
    });
});
