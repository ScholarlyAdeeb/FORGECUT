/**
 * ForgeCut — speech-to-text worker (Whisper via transformers.js).
 *
 * Runs entirely in the browser so captions work on a static deployment
 * (Vercel) with no server. The model is fetched from the Hugging Face CDN on
 * first use and kept in the browser's Cache Storage by transformers.js, so
 * later runs start in a second or two.
 *
 * Protocol:
 *   in : { id, audio: Float32Array (16 kHz mono), quality: 'fast'|'accurate', language }
 *   out: { id, type: 'progress', loaded, total, file }
 *        { id, type: 'done', chunks, text, model }
 *        { id, type: 'error', message }
 */
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js';

// Measured on a 10 s English clip: identical transcripts; tiny is 42 MB and
// needs no GPU, base is ~200 MB and wants WebGPU.
const MODELS = {
    fast: { id: 'onnx-community/whisper-tiny_timestamped', device: 'wasm', dtype: 'q8' },
    accurate: { id: 'onnx-community/whisper-base_timestamped', device: 'webgpu',
                dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }
};

let lib = null;
const pipes = {};

async function getPipe(quality, onProgress) {
    if (!lib) lib = await import(TRANSFORMERS);
    let spec = MODELS[quality] || MODELS.fast;
    if (spec.device === 'webgpu' && !(self.navigator && navigator.gpu)) spec = MODELS.fast;
    const key = spec.id + spec.device;
    if (!pipes[key]) {
        pipes[key] = lib.pipeline('automatic-speech-recognition', spec.id, {
            device: spec.device, dtype: spec.dtype, progress_callback: onProgress
        }).catch((e) => { delete pipes[key]; throw e; });
    }
    return { asr: await pipes[key], spec };
}

self.onmessage = async (e) => {
    const { id, audio, quality, language } = e.data || {};
    const files = {};
    const onProgress = (p) => {
        if (!p || !p.file || !p.total) return;
        files[p.file] = { loaded: p.loaded || 0, total: p.total };
        let loaded = 0, total = 0;
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
        self.postMessage({ id, type: 'progress', loaded, total, file: p.file });
    };
    try {
        if (!(audio instanceof Float32Array) || audio.length === 0) throw new Error('No audio to transcribe.');
        const { asr, spec } = await getPipe(quality, onProgress);
        const opts = { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, task: 'transcribe' };
        if (language && language !== 'auto') opts.language = language;
        const r = await asr(audio, opts);
        self.postMessage({ id, type: 'done', chunks: r.chunks || [], text: r.text || '', model: spec.id });
    } catch (err) {
        self.postMessage({ id, type: 'error', message: (err && err.message) || String(err) });
    }
};
