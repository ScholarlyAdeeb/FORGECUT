/**
 * ForgeCut — GPU compositor for clip effect stacks.
 *
 *     const out = ForgeCut.Compositor.process(source, stack);
 *     ctx.drawImage(out, ...)          // same pixel size as `source`
 *
 * `source` is anything drawImage/texImage2D accepts (video, image, canvas,
 * VideoFrame). `stack` is Effects.resolveStack(...). The result has exactly
 * the source's pixel dimensions, so the caller's crop/position/scale code is
 * unchanged — the processed frame simply replaces the raw one.
 *
 * Design constraints (see the Phase 3 plan):
 *   - Export-safe: renders into an OffscreenCanvas, never needs a visible
 *     canvas or requestAnimationFrame, so it works while the tab is hidden.
 *   - No readback: the output is a WebGL canvas that 2D drawImage consumes
 *     GPU-side. Nothing here calls readPixels.
 *   - Never silently wrong: if WebGL2 is unavailable or the context is lost
 *     and cannot be restored, the CPU reference implementation in Effects.js
 *     runs instead. Slower, identical in meaning.
 *   - Colour space: sRGB-encoded values, as documented in Effects.js.
 */
(function () {
    'use strict';

    const FX = () => window.ForgeCut && window.ForgeCut.Effects;

    const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform bool u_flip;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    if (u_flip) v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

    // All passes read straight (non-premultiplied) RGBA and write straight
    // RGBA, except 'present', which premultiplies for the canvas.
    const FRAG = {
        adjust: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform float u_brightness, u_contrast;
uniform mat3 u_sat, u_hue;
void main() {
    vec4 c = texture(u_src, v_uv);
    vec3 rgb = clamp(c.rgb * u_brightness, 0.0, 1.0);
    rgb = clamp(rgb * u_contrast + (0.5 - 0.5 * u_contrast), 0.0, 1.0);
    rgb = clamp(u_sat * rgb, 0.0, 1.0);
    rgb = clamp(u_hue * rgb, 0.0, 1.0);
    o = vec4(rgb, c.a);
}`,
        matrix: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform mat3 u_m; uniform vec3 u_b;
void main() {
    vec4 c = texture(u_src, v_uv);
    o = vec4(clamp(u_m * c.rgb + u_b, 0.0, 1.0), c.a);
}`,
        vignette: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_size;
uniform float u_amount, u_radius, u_softness;
void main() {
    vec4 c = texture(u_src, v_uv);
    vec2 p = v_uv * u_size - u_size * 0.5;
    float d = length(p) / length(u_size * 0.5);
    float inner = u_radius * (1.0 - u_softness);
    float f = 1.0 - u_amount * smoothstep(inner, u_radius, d);
    o = vec4(c.rgb * f, c.a);
}`,
        // Separable Gaussian, sigma = radius, taps out to 3 sigma, edge-clamped.
        // Accumulates premultiplied colour so transparent pixels do not bleed.
        blur: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
uniform vec2 u_step;      // one texel along the blur direction
uniform float u_sigma;
uniform int u_half;
void main() {
    vec4 acc = vec4(0.0); float wsum = 0.0;
    for (int i = 0; i <= 384; i++) {
        int k = i - u_half;
        if (k > u_half) break;
        float t = float(k);
        float w = exp(-(t * t) / (2.0 * u_sigma * u_sigma));
        vec4 s = texture(u_src, v_uv + u_step * t);
        acc += vec4(s.rgb * s.a, s.a) * w;
        wsum += w;
    }
    acc /= wsum;
    o = acc.a > 0.0 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
}`,
        present: `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_src;
void main() {
    vec4 c = texture(u_src, v_uv);
    o = vec4(c.rgb * c.a, c.a);
}`
    };

    let gl = null, canvas = null, broken = false, warned = false;
    let programs = {}, quad = null, fbos = [], srcTex = null, size = { w: 0, h: 0 };
    let cpuCanvas = null;
    const stats = { gpuFrames: 0, cpuFrames: 0, contextLost: 0, lastMs: 0 };

    function makeCanvas(w, h) {
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        return c;
    }

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(s);
            gl.deleteShader(s);
            throw new Error('Shader compile failed: ' + log);
        }
        return s;
    }

    function link(fragSrc) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
        gl.bindAttribLocation(p, 0, 'a_pos');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
        const uni = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) {
            const info = gl.getActiveUniform(p, i);
            uni[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
        }
        return { p, uni };
    }

    function newTexture(w, h) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (w && h) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return t;
    }

    function init() {
        if (gl || broken) return !!gl;
        try {
            canvas = makeCanvas(2, 2);
            gl = canvas.getContext('webgl2', {
                alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
                preserveDrawingBuffer: true,      // drawImage may read after this task
                powerPreference: 'high-performance'
            });
            if (!gl) throw new Error('WebGL2 unavailable');
            if (canvas.addEventListener) {
                canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stats.contextLost++; reset(); }, false);
            }
            for (const [name, src] of Object.entries(FRAG)) programs[name] = link(src);
            quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, quad);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
            srcTex = newTexture(0, 0);
            return true;
        } catch (e) {
            if (!warned) { console.warn('[ForgeCut] GPU compositor unavailable, using CPU effects:', e && e.message); warned = true; }
            gl = null; broken = true;
            return false;
        }
    }

    /** Drop all GL state; the next process() rebuilds it. */
    function reset() {
        gl = null; programs = {}; quad = null; fbos = []; srcTex = null; size = { w: 0, h: 0 };
    }

    function ensureSize(w, h) {
        if (size.w === w && size.h === h) return;
        canvas.width = w; canvas.height = h;
        for (const f of fbos) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); }
        fbos = [0, 1].map(() => {
            const tex = newTexture(w, h);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
            return { tex, fb };
        });
        size = { w, h };
    }

    function draw(prog, inputTex, target, flip, setUniforms) {
        gl.useProgram(prog.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
        gl.viewport(0, 0, size.w, size.h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTex);
        gl.uniform1i(prog.uni.u_src, 0);
        gl.uniform1i(prog.uni.u_flip, flip ? 1 : 0);
        if (setUniforms) setUniforms(prog.uni);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // GLSL mat3 is column-major; the Effects matrices are row-major.
    const colMajor = (m) => new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);

    function passFor(fx, w, h) {
        const E = FX(), p = fx.params;
        switch (fx.type) {
            case 'adjust':
                return [['adjust', u => {
                    gl.uniform1f(u.u_brightness, p.brightness);
                    gl.uniform1f(u.u_contrast, p.contrast);
                    gl.uniformMatrix3fv(u.u_sat, false, colMajor(E.saturateMatrix(p.saturation)));
                    gl.uniformMatrix3fv(u.u_hue, false, colMajor(E.hueMatrix(p.hue)));
                }]];
            case 'grayscale': case 'sepia': case 'invert': {
                const m = fx.type === 'grayscale' ? E.grayscaleMatrix(p.amount)
                    : fx.type === 'sepia' ? E.sepiaMatrix(p.amount)
                        : [1 - 2 * p.amount, 0, 0, 0, 1 - 2 * p.amount, 0, 0, 0, 1 - 2 * p.amount];
                const b = fx.type === 'invert' ? [p.amount, p.amount, p.amount] : [0, 0, 0];
                return [['matrix', u => { gl.uniformMatrix3fv(u.u_m, false, colMajor(m)); gl.uniform3f(u.u_b, b[0], b[1], b[2]); }]];
            }
            case 'vignette':
                return [['vignette', u => {
                    gl.uniform2f(u.u_size, w, h);
                    gl.uniform1f(u.u_amount, p.amount); gl.uniform1f(u.u_radius, p.radius); gl.uniform1f(u.u_softness, p.softness);
                }]];
            case 'blur': {
                const sigma = Math.max(0.01, p.radius), half = Math.min(192, Math.ceil(sigma * 3));
                const dir = (dx, dy) => u => {
                    gl.uniform2f(u.u_step, dx / w, dy / h);
                    gl.uniform1f(u.u_sigma, sigma);
                    gl.uniform1i(u.u_half, half);
                };
                return [['blur', dir(1, 0)], ['blur', dir(0, 1)]];
            }
        }
        return [];
    }

    function processGPU(source, stack, w, h) {
        ensureSize(w, h);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);

        const passes = [];
        for (const fx of stack) passes.push(...passFor(fx, w, h));

        // Texture row 0 is the image's top row. Render-to-texture keeps that
        // convention; only the final present to the canvas flips.
        let input = srcTex, ping = 0;
        for (const [name, set] of passes) {
            draw(programs[name], input, fbos[ping], false, set);
            input = fbos[ping].tex;
            ping ^= 1;
        }
        draw(programs.present, input, null, true, null);
        return canvas;
    }

    function processCPU(source, stack, w, h) {
        if (!cpuCanvas) cpuCanvas = makeCanvas(w, h);
        if (cpuCanvas.width !== w || cpuCanvas.height !== h) { cpuCanvas.width = w; cpuCanvas.height = h; }
        const c = cpuCanvas.getContext('2d', { willReadFrequently: true });
        c.clearRect(0, 0, w, h);
        c.drawImage(source, 0, 0, w, h);
        const img = c.getImageData(0, 0, w, h);
        FX().applyReference(img.data, w, h, stack);
        c.putImageData(img, 0, 0);
        return cpuCanvas;
    }

    function sourceSize(s) {
        const w = s.videoWidth || s.naturalWidth || s.displayWidth || s.width || 0;
        const h = s.videoHeight || s.naturalHeight || s.displayHeight || s.height || 0;
        return { w, h };
    }

    /**
     * Run `stack` on `source`. Returns the source itself when there is
     * nothing to do, so the no-effects path is literally unchanged.
     */
    function process(source, stack, opts) {
        if (!source || !stack || stack.length === 0 || !FX()) return source;
        const { w, h } = sourceSize(source);
        if (!(w > 0 && h > 0)) return source;
        const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
        let out;
        let forceCPU = opts && opts.cpu;
        if (!forceCPU && init()) {
            runGateOnce();
            // A stack containing any effect this device failed parity on runs
            // wholly on the CPU, so its output never mixes two definitions.
            if (stack.some(fx => cpuOnly[fx.type])) forceCPU = true;
        }
        if (!forceCPU && gl) {
            try {
                if (gl.isContextLost && gl.isContextLost()) { reset(); broken = false; init(); }
                out = processGPU(source, stack, w, h);
                stats.gpuFrames++;
            } catch (e) {
                console.warn('[ForgeCut] GPU effect pass failed, using CPU for this frame:', e && e.message);
                out = processCPU(source, stack, w, h);
                stats.cpuFrames++;
            }
        } else {
            out = processCPU(source, stack, w, h);
            stats.cpuFrames++;
        }
        if (t0) stats.lastMs = performance.now() - t0;
        return out;
    }

    function info() {
        return {
            backend: gl ? 'webgl2' : (broken ? 'cpu' : 'uninitialised'),
            cpuOnly: Object.keys(cpuOnly),
            stats: Object.assign({}, stats)
        };
    }

    /* ── parity gate ─────────────────────────────────────────────────── */

    /**
     * Tolerance, agreed before Phase 4 builds on this: per 8-bit channel, the
     * GPU may differ from the CPU reference by at most MAX on any pixel and
     * MEAN on average. Rounding order differs (the reference rounds after each
     * stage, the GPU does not), so exact equality is not the bar; visible
     * difference is.
     */
    const TOLERANCE = { max: 3, mean: 0.75 };

    // Fixed parameter sets that exercise each effect away from identity.
    const CASES = [
        { type: 'adjust', params: { brightness: 1.3, contrast: 0.8, saturation: 1.6, hue: 40 } },
        { type: 'adjust', params: { brightness: 0.6, contrast: 1.5, saturation: 0.2, hue: -120 } },
        { type: 'grayscale', params: { amount: 0.7 } },
        { type: 'sepia', params: { amount: 1 } },
        { type: 'invert', params: { amount: 0.35 } },
        { type: 'vignette', params: { amount: 0.8, radius: 0.7, softness: 0.5 } },
        { type: 'blur', params: { radius: 3 } }
    ];

    /** Deterministic RGB test card: hue sweep × value ramp, plus grey steps. */
    function testPattern(n) {
        const img = new Uint8ClampedArray(n * n * 4);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const i = (y * n + x) * 4;
            if (y < n * 0.75) {
                const hue = x / n * 6, v = 1 - y / n * 0.9, f = hue - Math.floor(hue), k = Math.floor(hue) % 6;
                const q = v * (1 - f), t = v * f;
                const rgb = [[v, t, 0], [q, v, 0], [0, v, t], [0, q, v], [t, 0, v], [v, 0, q]][k];
                img[i] = rgb[0] * 255; img[i + 1] = rgb[1] * 255; img[i + 2] = rgb[2] * 255;
            } else {
                const g = Math.floor(x / n * 8) / 7 * 255;
                img[i] = img[i + 1] = img[i + 2] = g;
            }
            img[i + 3] = 255;
        }
        return img;
    }

    function compare(a, b) {
        let max = 0, sum = 0, n = 0;
        for (let i = 0; i < a.length; i += 4) {
            for (let c = 0; c < 3; c++) {
                const d = Math.abs(a[i + c] - b[i + c]);
                if (d > max) max = d;
                sum += d; n++;
            }
        }
        return { max, mean: Math.round(sum / n * 1000) / 1000 };
    }

    const cpuOnly = {};

    /**
     * Run every case on the GPU and on the CPU reference and compare.
     * Effects that fail are marked CPU-only on this device.
     *
     * opts.size       — test card size (default 64)
     * opts.cssFilter  — also compare 'adjust' against ctx.filter, the 2D
     *                   path clips without effects still use (golden parity
     *                   with the existing renderer)
     */
    function selfTest(opts) {
        const o = Object.assign({ size: 64, cssFilter: false }, opts || {});
        const n = o.size;
        const report = { backend: null, tolerance: TOLERANCE, cases: [], pass: true };
        if (!FX() || !init()) { report.backend = 'cpu'; return report; }
        report.backend = 'webgl2';

        const card = makeCanvas(n, n);
        const cctx = card.getContext('2d', { willReadFrequently: true });
        const pattern = testPattern(n);
        cctx.putImageData(new ImageData(pattern.slice(), n, n), 0, 0);
        const read = makeCanvas(n, n);
        const rctx = read.getContext('2d', { willReadFrequently: true });
        const grab = (surface) => { rctx.clearRect(0, 0, n, n); rctx.drawImage(surface, 0, 0); return rctx.getImageData(0, 0, n, n).data; };

        for (const c of CASES) {
            const stack = [{ id: 'selftest', type: c.type, params: c.params }];
            const gpu = grab(processGPU(card, stack, n, n));
            const ref = FX().applyReference(pattern.slice(), n, n, stack);
            const r = Object.assign({ type: c.type, params: c.params, against: 'reference' }, compare(gpu, ref));
            r.pass = r.max <= TOLERANCE.max && r.mean <= TOLERANCE.mean;
            if (!r.pass) { cpuOnly[c.type] = true; report.pass = false; }
            report.cases.push(r);

            if (o.cssFilter && c.type === 'adjust') {
                const p = c.params;
                rctx.clearRect(0, 0, n, n);
                rctx.filter = `brightness(${p.brightness}) contrast(${p.contrast}) saturate(${p.saturation}) hue-rotate(${p.hue}deg)`;
                rctx.drawImage(card, 0, 0);
                rctx.filter = 'none';
                const css = rctx.getImageData(0, 0, n, n).data;
                const k = Object.assign({ type: c.type, params: c.params, against: 'ctx.filter' }, compare(gpu, css));
                k.pass = k.max <= TOLERANCE.max && k.mean <= TOLERANCE.mean;
                if (!k.pass) report.pass = false;
                report.cases.push(k);
            }
        }
        return report;
    }

    let gateRun = false;
    function runGateOnce() {
        if (gateRun) return;
        gateRun = true;
        try {
            const r = selfTest();
            const failed = r.cases.filter(c => !c.pass).map(c => c.type);
            if (failed.length) console.warn('[ForgeCut] GPU effects outside tolerance on this device, using CPU for:', failed.join(', '));
        } catch (e) {
            console.warn('[ForgeCut] compositor self-test failed; using CPU effects:', e && e.message);
            broken = true; reset();
        }
    }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.Compositor = { process, info, selfTest, TOLERANCE, _reset: () => { reset(); broken = false; gateRun = false; } };
})();
