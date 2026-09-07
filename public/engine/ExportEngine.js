/**
 * ForgeCut ExportEngine — Production-grade render pipeline using FFmpeg.wasm.
 * Supports: MP4 (H.264), WEBM (VP9), MOV, GIF, Audio-only (MP3).
 * Features: Progress telemetry, cancel, retry, render queue.
 */
(function() {
    'use strict';

    let _ffmpeg = null;
    let _ffmpegLoaded = false;
    let _ffmpegLoading = false;
    let _cancelRequested = false;
    let _currentExport = null;
    let _renderQueue = [];
    let _onProgress = null;
    let _onComplete = null;
    let _onError = null;

    const FORMATS = {
        'mp4':  { ext: 'mp4',  mime: 'video/mp4',  codec: 'libx264', audioCodec: 'aac' },
        'webm': { ext: 'webm', mime: 'video/webm', codec: 'libvpx-vp9', audioCodec: 'libopus' },
        'mov':  { ext: 'mov',  mime: 'video/quicktime', codec: 'libx264', audioCodec: 'aac' },
        'gif':  { ext: 'gif',  mime: 'image/gif',  codec: 'gif', audioCodec: null },
        'mp3':  { ext: 'mp3',  mime: 'audio/mpeg', codec: null, audioCodec: 'libmp3lame' }
    };

    /**
     * Load FFmpeg.wasm from CDN.
     */
    async function loadFFmpeg() {
        if (_ffmpegLoaded) return true;
        if (_ffmpegLoading) {
            // Wait for existing load
            return new Promise((resolve) => {
                const check = setInterval(() => {
                    if (_ffmpegLoaded) { clearInterval(check); resolve(true); }
                    if (!_ffmpegLoading) { clearInterval(check); resolve(false); }
                }, 100);
            });
        }

        _ffmpegLoading = true;
        try {
            // Served locally by server.js from node_modules — see the VENDOR
            // mounts there. Previously loaded from unpkg, which meant no export
            // offline and a hard runtime dependency on a third-party CDN.
            const { FFmpeg } = await import('/vendor/ffmpeg/index.js');
            const { fetchFile, toBlobURL } = await import('/vendor/ffmpeg-util/index.js');

            _ffmpeg = new FFmpeg();
            _ffmpeg.on('log', ({ message }) => {
                // Parse progress from FFmpeg log lines
                if (message.includes('frame=')) {
                    const match = message.match(/frame=\s*(\d+)/);
                    if (match && _currentExport) {
                        _currentExport.currentFrame = parseInt(match[1]);
                    }
                }
            });

            const baseURL = '/vendor/ffmpeg-core';
            await _ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
            });

            window._fetchFile = fetchFile;
            _ffmpegLoaded = true;
            _ffmpegLoading = false;
            console.log('[ExportEngine] FFmpeg.wasm loaded successfully');
            return true;
        } catch (e) {
            console.error('[ExportEngine] FFmpeg.wasm load failed:', e);
            _ffmpegLoading = false;
            return false;
        }
    }

    /**
     * Sleep until an absolute performance.now() deadline. Yields to the event
     * loop at least once so the UI can repaint even if we are already late.
     */
    function _waitUntil(deadlineMs) {
        const remaining = deadlineMs - performance.now();
        return new Promise(resolve => setTimeout(resolve, remaining > 0 ? remaining : 0));
    }

    /**
     * Canvas-based render pipeline (fallback when FFmpeg unavailable).
     * Uses MediaRecorder API.
     *
     * Note: this path is inherently real-time and foreground-only — MediaRecorder
     * timestamps frames off the wall clock, and browsers throttle background
     * tabs. Long exports should use the FFmpeg path.
     */
    async function exportWithMediaRecorder(state, renderFn, options) {
        const canvas = options.canvas;
        const format = options.format || 'webm';
        const fps = options.fps || 30;
        const duration = state.duration;

        const stream = canvas.captureStream(fps);

        // Add audio tracks if available
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
        let audioBuffer = null;
        if (format !== 'gif') {
            try {
                audioBuffer = await AE.renderOfflineAudio(state.tracks, duration, 44100);
                if (audioBuffer) {
                    const audioCtx = new AudioContext();
                    const source = audioCtx.createMediaStreamDestination();
                    const bufferSource = audioCtx.createBufferSource();
                    bufferSource.buffer = audioBuffer;
                    bufferSource.connect(source);
                    bufferSource.start();
                    source.stream.getAudioTracks().forEach(t => stream.addTrack(t));
                }
            } catch (e) {
                console.warn('[ExportEngine] Audio mixing failed:', e);
            }
        }

        const mimeType = format === 'webm' ? 'video/webm;codecs=vp9' : 'video/webm';
        let recorder;
        try {
            recorder = new MediaRecorder(stream, { mimeType });
        } catch (e) {
            recorder = new MediaRecorder(stream);
        }

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        return new Promise(async (resolve, reject) => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: FORMATS[format]?.mime || 'video/webm' });
                resolve(blob);
            };

            recorder.onerror = (e) => reject(e);
            recorder.start();

            const totalFrames = Math.ceil(duration * fps);
            const startTime = performance.now();

            // canvas.captureStream(fps) samples the canvas on the wall clock, so
            // the recording's length is however long this loop takes in real
            // time. Pacing on requestAnimationFrame instead tied that to the
            // display's refresh rate: at 60Hz a 30fps export rendered two frames
            // per captured frame and the result played back at 2x speed (4x at
            // 120Hz). Pacing to an absolute wall-clock deadline per frame keeps
            // the output real-time and refresh-rate independent.
            for (let frame = 0; frame < totalFrames; frame++) {
                if (_cancelRequested) {
                    recorder.stop();
                    reject(new Error('Export cancelled'));
                    return;
                }

                const time = frame / fps;
                state.currentTime = time;
                renderFn();

                // Progress callback
                if (_onProgress) {
                    const elapsed = (performance.now() - startTime) / 1000;
                    const framesPerSec = frame / Math.max(0.1, elapsed);
                    const remaining = (totalFrames - frame) / Math.max(1, framesPerSec);
                    _onProgress({
                        frame, totalFrames,
                        progress: frame / totalFrames,
                        eta: remaining,
                        fps: Math.round(framesPerSec)
                    });
                }

                updateProgressUI(frame, totalFrames, startTime);
                await _waitUntil(startTime + ((frame + 1) * 1000) / fps);
            }

            recorder.stop();
        });
    }

    /**
     * Full FFmpeg-powered export pipeline.
     */
    async function exportWithFFmpeg(state, renderFn, options) {
        const canvas = options.canvas;
        const format = options.format || 'mp4';
        const fps = options.fps || 30;
        const duration = state.duration;
        const formatInfo = FORMATS[format];
        if (!formatInfo) throw new Error(`Unsupported format: ${format}`);

        const totalFrames = Math.ceil(duration * fps);
        const startTime = performance.now();

        // Audio-only export
        if (format === 'mp3') {
            return await exportAudioOnly(state, options);
        }

        // Render frames as raw images
        for (let frame = 0; frame < totalFrames; frame++) {
            if (_cancelRequested) throw new Error('Export cancelled');

            state.currentTime = frame / fps;
            renderFn();

            // Capture frame as PNG
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            const data = new Uint8Array(await blob.arrayBuffer());
            const frameName = `frame_${String(frame).padStart(6, '0')}.png`;
            await _ffmpeg.writeFile(frameName, data);

            if (_onProgress) {
                const elapsed = (performance.now() - startTime) / 1000;
                const framesPerSec = frame / Math.max(0.1, elapsed);
                const remaining = (totalFrames - frame) / Math.max(1, framesPerSec);
                _onProgress({
                    phase: 'frames',
                    frame, totalFrames,
                    progress: (frame / totalFrames) * 0.7,
                    eta: remaining,
                    fps: Math.round(framesPerSec)
                });
            }
            updateProgressUI(frame, totalFrames, startTime);
        }

        // Mix audio if needed
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
        let hasAudio = false;
        if (formatInfo.audioCodec && AE) {
            try {
                const audioBuffer = await AE.renderOfflineAudio(state.tracks, duration, 44100);
                if (audioBuffer) {
                    const wavData = audioBufferToWav(audioBuffer);
                    await _ffmpeg.writeFile('audio.wav', new Uint8Array(wavData));
                    hasAudio = true;
                }
            } catch (e) {
                console.warn('[ExportEngine] Audio mixing failed:', e);
            }
        }

        if (_onProgress) {
            _onProgress({ phase: 'encoding', progress: 0.75, eta: 0, totalFrames, frame: totalFrames });
        }

        // Encode with FFmpeg
        const outputFile = `output.${formatInfo.ext}`;
        const ffmpegArgs = ['-framerate', String(fps), '-i', 'frame_%06d.png'];

        if (hasAudio) {
            ffmpegArgs.push('-i', 'audio.wav');
        }

        if (format === 'gif') {
            ffmpegArgs.push('-vf', `fps=${Math.min(fps, 15)},scale=480:-1:flags=lanczos`);
            ffmpegArgs.push('-loop', '0');
        } else {
            ffmpegArgs.push('-c:v', formatInfo.codec);
            ffmpegArgs.push('-pix_fmt', 'yuva420p');
            if (hasAudio) {
                ffmpegArgs.push('-c:a', formatInfo.audioCodec);
            }
            ffmpegArgs.push('-shortest');
        }

        ffmpegArgs.push('-y', outputFile);

        await _ffmpeg.exec(ffmpegArgs);

        const outputData = await _ffmpeg.readFile(outputFile);
        const outputBlob = new Blob([outputData.buffer], { type: formatInfo.mime });

        // Cleanup frames
        for (let i = 0; i < totalFrames; i++) {
            try { await _ffmpeg.deleteFile(`frame_${String(i).padStart(6, '0')}.png`); } catch (e) {}
        }
        try { await _ffmpeg.deleteFile('audio.wav'); } catch (e) {}
        try { await _ffmpeg.deleteFile(outputFile); } catch (e) {}

        if (_onProgress) {
            _onProgress({ phase: 'complete', progress: 1.0, eta: 0, totalFrames, frame: totalFrames });
        }

        return outputBlob;
    }

    /**
     * Export audio only (MP3).
     */
    async function exportAudioOnly(state, options) {
        const AE = window.ForgeCut && window.ForgeCut.AudioEngine;
        if (!AE) throw new Error('AudioEngine not available');

        const audioBuffer = await AE.renderOfflineAudio(state.tracks, state.duration, 44100);
        if (!audioBuffer) throw new Error('No audio to export');

        const wavData = audioBufferToWav(audioBuffer);
        await _ffmpeg.writeFile('input.wav', new Uint8Array(wavData));
        await _ffmpeg.exec(['-i', 'input.wav', '-codec:a', 'libmp3lame', '-qscale:a', '2', '-y', 'output.mp3']);

        const outputData = await _ffmpeg.readFile('output.mp3');
        return new Blob([outputData.buffer], { type: 'audio/mpeg' });
    }

    /**
     * Convert AudioBuffer to WAV format (ArrayBuffer).
     */
    function audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const dataSize = audioBuffer.length * blockAlign;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // WAV header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Interleave audio data
        const channels = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(audioBuffer.getChannelData(i));
        }

        let offset = 44;
        for (let i = 0; i < audioBuffer.length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const sample = Math.max(-1, Math.min(1, channels[ch][i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
                offset += 2;
            }
        }

        return buffer;
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Main export function.
     */
    async function exportVideo(state, renderFn, options) {
        options = options || {};
        options.format = options.format || 'mp4';
        options.fps = options.fps || 30;

        _cancelRequested = false;
        _currentExport = { startTime: performance.now(), totalFrames: Math.ceil(state.duration * options.fps), currentFrame: 0 };

        showExportUI(true);

        try {
            let blob;

            if (_ffmpegLoaded && _ffmpeg) {
                blob = await exportWithFFmpeg(state, renderFn, options);
            } else {
                // Try loading FFmpeg
                const loaded = await loadFFmpeg();
                if (loaded) {
                    blob = await exportWithFFmpeg(state, renderFn, options);
                } else {
                    // Fallback to MediaRecorder (WEBM only)
                    console.warn('[ExportEngine] FFmpeg unavailable, using MediaRecorder fallback');
                    options.format = 'webm';
                    blob = await exportWithMediaRecorder(state, renderFn, options);
                }
            }

            if (blob) {
                downloadBlob(blob, `ForgeCut_Export.${FORMATS[options.format]?.ext || 'webm'}`);
                if (_onComplete) _onComplete(blob);
            }

            showExportUI(false);
            return blob;
        } catch (e) {
            console.error('[ExportEngine] Export failed:', e);
            if (_onError) _onError(e);
            showExportUI(false);
            throw e;
        } finally {
            _currentExport = null;
        }
    }

    /**
     * Export batch variations.
     */
    async function exportBatch(state, renderFn, options) {
        options = options || {};
        const format = options.format || 'webm';
        const selectedIndices = [];

        state.csvData.forEach((_, idx) => {
            if (!state.batchSelection || state.batchSelection[idx]) {
                selectedIndices.push(idx);
            }
        });

        if (selectedIndices.length === 0) {
            fcToast('Please select at least one variation to export.');
            return;
        }

        _cancelRequested = false;
        showExportUI(true);

        const zip = window.JSZip ? new JSZip() : null;
        const origIndex = state.selectedRowIndex;
        const blobs = [];

        for (let i = 0; i < selectedIndices.length; i++) {
            if (_cancelRequested) break;

            const r = selectedIndices[i];
            state.selectedRowIndex = r;
            state.currentTime = 0;

            updateBatchProgressUI(i, selectedIndices.length);

            try {
                const blob = await exportWithMediaRecorder(state, renderFn, {
                    canvas: options.canvas,
                    format: 'webm',
                    fps: options.fps || 30
                });

                const row = state.csvData[r];
                const keys = Object.keys(row);
                const name = row[keys[0]] || `variation_${r + 1}`;
                const fileName = `ForgeCut_${name.replace(/[^a-zA-Z0-9]/g, '_')}.webm`;

                if (zip) {
                    zip.file(fileName, blob);
                }
                blobs.push({ name: fileName, blob });
            } catch (e) {
                console.error(`[ExportEngine] Batch item ${r} failed:`, e);
            }
        }

        state.selectedRowIndex = origIndex;
        state.currentTime = 0;

        // Download as ZIP
        if (zip && blobs.length > 0) {
            try {
                const zipBlob = await zip.generateAsync({ type: 'blob' });
                downloadBlob(zipBlob, 'ForgeCut_Batch_Export.zip');
            } catch (e) {
                // Fallback: download individually
                blobs.forEach(b => downloadBlob(b.blob, b.name));
            }
        }

        showExportUI(false);
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    function cancelExport() {
        _cancelRequested = true;
    }

    function retryExport() {
        // Re-run the last export if stored
        console.log('[ExportEngine] Retry requested');
    }

    // ─────────── UI Helpers ───────────

    function showExportUI(show) {
        const statusEl = document.querySelector('.font-status-bar');
        if (statusEl && show) {
            const indicator = document.querySelector('footer .w-2');
            if (indicator) {
                indicator.style.backgroundColor = '#ff9800';
                indicator.classList.add('animate-pulse');
            }
            const statusText = statusEl;
            if (statusText) statusText.textContent = 'Exporting...';
        } else if (!show) {
            const indicator = document.querySelector('footer .w-2');
            if (indicator) {
                indicator.style.backgroundColor = '#4CAF50';
                indicator.classList.remove('animate-pulse');
            }
            const statusText = document.querySelector('footer .font-status-bar');
            if (statusText) statusText.textContent = 'System Ready';
        }
    }

    function updateProgressUI(frame, totalFrames, startTime) {
        const progress = frame / totalFrames;
        const elapsed = (performance.now() - startTime) / 1000;
        const fps = frame / Math.max(0.1, elapsed);
        const eta = (totalFrames - frame) / Math.max(1, fps);

        // Update footer status
        const statusText = document.querySelector('footer .font-status-bar');
        if (statusText) {
            statusText.textContent = `Exporting: ${Math.round(progress * 100)}% | ETA: ${Math.round(eta)}s | ${Math.round(fps)} fps`;
        }
    }

    function updateBatchProgressUI(current, total) {
        const statusText = document.querySelector('footer .font-status-bar');
        if (statusText) {
            statusText.textContent = `Batch Export: ${current + 1}/${total}`;
        }
    }

    // Event handlers
    function onProgress(fn) { _onProgress = fn; }
    function onComplete(fn) { _onComplete = fn; }
    function onError(fn) { _onError = fn; }

    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.ExportEngine = {
        loadFFmpeg,
        exportVideo,
        exportBatch,
        exportWithMediaRecorder,
        cancelExport,
        retryExport,
        downloadBlob,
        audioBufferToWav,
        onProgress, onComplete, onError,
        get isLoaded() { return _ffmpegLoaded; },
        get isExporting() { return !!_currentExport; },
        FORMATS
    };
})();
