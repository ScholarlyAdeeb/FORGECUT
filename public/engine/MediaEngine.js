/**
 * ForgeCut MediaEngine — Centralized media library, async import pipeline,
 * thumbnail generation, waveform caching, and font management.
 */
(function() {
    'use strict';

    const mediaLibrary = new Map();
    let worker = null;
    let pendingImports = new Map();
    let audioCtxForDecode = null;

    function initWorker() {
        try {
            worker = new Worker('workers/MediaWorker.js');
            worker.onmessage = handleWorkerMessage;
            worker.onerror = (e) => console.error('[MediaEngine] Worker error:', e.message);
        } catch (e) {
            console.warn('[MediaEngine] Web Worker unavailable, using main-thread fallback');
            worker = null;
        }
    }

    function handleWorkerMessage(e) {
        const { id, success, metadata, error } = e.data;
        const pending = pendingImports.get(id);
        if (!pending) return;
        pendingImports.delete(id);

        if (success) {
            pending.resolve(metadata);
        } else {
            pending.reject(new Error(error));
        }
    }

    function generateAssetId() {
        return 'asset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7);
    }

    async function extractWorkerMetadata(file) {
        return new Promise((resolve, reject) => {
            const id = generateAssetId();
            const reader = new FileReader();
            reader.onload = () => {
                if (worker) {
                    pendingImports.set(id, { resolve, reject });
                    worker.postMessage(
                        { id, file: { name: file.name, size: file.size, type: file.type, lastModified: file.lastModified }, arrayBuffer: reader.result },
                        [reader.result]
                    );
                } else {
                    // Fallback: basic metadata without worker
                    const ext = file.name.split('.').pop().toLowerCase();
                    const catMap = { mp4:'video',mov:'video',avi:'video',mkv:'video',webm:'video',
                        mp3:'audio',wav:'audio',aac:'audio',flac:'audio',ogg:'audio',
                        png:'image',jpg:'image',jpeg:'image',webp:'image',svg:'image',gif:'image',
                        ttf:'font',otf:'font' };
                    resolve({
                        fileName: file.name, fileSize: file.size, mimeType: file.type,
                        category: catMap[ext] || (file.type.split('/')[0]) || 'unknown',
                        format: ext, valid: true, extension: ext, exifOrientation: 1, lastModified: file.lastModified
                    });
                }
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
    }

    function createMediaElement(type, objectUrl) {
        let element = null;
        if (type === 'video') {
            element = document.createElement('video');
            element.src = objectUrl;
            element.muted = true;
            element.preload = 'auto';
            element.playsInline = true;
            element.crossOrigin = 'anonymous';
        } else if (type === 'audio') {
            element = document.createElement('audio');
            element.src = objectUrl;
            element.preload = 'auto';
            element.crossOrigin = 'anonymous';
        } else if (type === 'image') {
            element = document.createElement('img');
            element.src = objectUrl;
            element.crossOrigin = 'anonymous';
        }
        return element;
    }

    async function generateThumbnail(element, type) {
        return new Promise((resolve) => {
            if (type === 'video') {
                const onSeeked = () => {
                    element.removeEventListener('seeked', onSeeked);
                    try {
                        const c = document.createElement('canvas');
                        c.width = element.videoWidth || 320;
                        c.height = element.videoHeight || 180;
                        const cx = c.getContext('2d');
                        cx.drawImage(element, 0, 0, c.width, c.height);
                        resolve(c.toDataURL('image/jpeg', 0.6));
                    } catch (e) {
                        resolve(null);
                    }
                };
                element.addEventListener('seeked', onSeeked);
                element.currentTime = Math.min(1, element.duration || 1);
            } else if (type === 'image') {
                try {
                    const c = document.createElement('canvas');
                    c.width = element.naturalWidth || element.width || 320;
                    c.height = element.naturalHeight || element.height || 180;
                    const cx = c.getContext('2d');
                    cx.drawImage(element, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', 0.6));
                } catch (e) {
                    resolve(null);
                }
            } else {
                resolve(null);
            }
        });
    }

    async function generateWaveform(file, numSamples) {
        numSamples = numSamples || 800;
        if (!audioCtxForDecode) {
            audioCtxForDecode = new (window.AudioContext || window.webkitAudioContext)();
        }
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async () => {
                try {
                    const audioBuffer = await audioCtxForDecode.decodeAudioData(reader.result);
                    const channelData = audioBuffer.getChannelData(0);
                    const blockSize = Math.floor(channelData.length / numSamples);
                    const waveform = new Float32Array(numSamples);
                    for (let i = 0; i < numSamples; i++) {
                        let sum = 0;
                        const start = i * blockSize;
                        const end = Math.min(start + blockSize, channelData.length);
                        for (let j = start; j < end; j++) {
                            sum += Math.abs(channelData[j]);
                        }
                        waveform[i] = sum / blockSize;
                    }
                    // Normalize
                    let max = 0;
                    for (let i = 0; i < waveform.length; i++) {
                        if (waveform[i] > max) max = waveform[i];
                    }
                    if (max > 0) {
                        for (let i = 0; i < waveform.length; i++) {
                            waveform[i] /= max;
                        }
                    }
                    resolve(waveform);
                } catch (e) {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsArrayBuffer(file);
        });
    }

    async function loadFont(file) {
        const fontName = file.name.replace(/\.(ttf|otf|woff|woff2)$/i, '').replace(/[^a-zA-Z0-9\s-]/g, '');
        const objectUrl = URL.createObjectURL(file);
        try {
            const fontFace = new FontFace(fontName, `url(${objectUrl})`);
            await fontFace.load();
            document.fonts.add(fontFace);
            return { fontName, objectUrl, loaded: true };
        } catch (e) {
            console.error('[MediaEngine] Font load failed:', e);
            URL.revokeObjectURL(objectUrl);
            return { fontName, objectUrl: null, loaded: false };
        }
    }

    /**
     * Import a file into the media library.
     * Returns the full asset object with metadata, element, thumbnail, waveform.
     */
    async function importFile(file, forceType) {
        const assetId = generateAssetId();
        const objectUrl = URL.createObjectURL(file);

        // Extract metadata via worker
        let workerMeta;
        try {
            workerMeta = await extractWorkerMetadata(file);
        } catch (e) {
            console.warn('[MediaEngine] Metadata extraction failed, using defaults', e);
            const ext = file.name.split('.').pop().toLowerCase();
            workerMeta = { fileName: file.name, fileSize: file.size, mimeType: file.type,
                category: forceType || 'unknown', format: ext, valid: true, extension: ext,
                exifOrientation: 1, lastModified: file.lastModified };
        }

        const type = forceType || workerMeta.category;

        // Handle font files
        if (type === 'font') {
            const fontResult = await loadFont(file);
            const asset = {
                id: assetId, file, objectUrl, element: null, type: 'font',
                name: file.name, fontName: fontResult.fontName,
                metadata: workerMeta, thumbnail: null, waveform: null,
                duration: 0, fps: 0, bitrate: 0, width: 0, height: 0,
                codec: '', loaded: fontResult.loaded
            };
            mediaLibrary.set(assetId, asset);
            return asset;
        }

        // Create DOM element
        const element = createMediaElement(type, objectUrl);

        const asset = {
            id: assetId, file, objectUrl, element, type, name: file.name,
            metadata: workerMeta, thumbnail: null, waveform: null,
            duration: 0, fps: 0, bitrate: 0,
            width: 0, height: 0, codec: workerMeta.format,
            exifOrientation: workerMeta.exifOrientation || 1,
            loaded: false
        };

        // Wait for element to load metadata
        await new Promise((resolve) => {
            if (type === 'video') {
                element.onloadedmetadata = () => {
                    asset.duration = element.duration || 0;
                    asset.width = element.videoWidth || 0;
                    asset.height = element.videoHeight || 0;
                    asset.fps = 30; // Browser doesn't expose FPS directly; default to 30
                    asset.bitrate = file.size > 0 && asset.duration > 0
                        ? Math.round((file.size * 8) / asset.duration) : 0;
                    asset.loaded = true;
                    resolve();
                };
                element.onerror = () => { asset.loaded = true; resolve(); };
            } else if (type === 'audio') {
                element.onloadedmetadata = () => {
                    asset.duration = element.duration || 0;
                    asset.bitrate = file.size > 0 && asset.duration > 0
                        ? Math.round((file.size * 8) / asset.duration) : 0;
                    asset.loaded = true;
                    resolve();
                };
                element.onerror = () => { asset.loaded = true; resolve(); };
            } else if (type === 'image') {
                element.onload = () => {
                    asset.width = element.naturalWidth || element.width;
                    asset.height = element.naturalHeight || element.height;
                    asset.duration = 5.0; // Default display duration for images
                    asset.loaded = true;
                    resolve();
                };
                element.onerror = () => { asset.loaded = true; resolve(); };
            } else {
                asset.loaded = true;
                resolve();
            }
        });

        // Generate thumbnail (non-blocking)
        if (type === 'video' || type === 'image') {
            try {
                asset.thumbnail = await generateThumbnail(element, type);
            } catch (e) { /* thumbnail optional */ }
        }

        // Generate waveform for audio/video with audio (non-blocking, cached once)
        if (type === 'audio' || type === 'video') {
            try {
                asset.waveform = await generateWaveform(file);
            } catch (e) { /* waveform optional */ }
        }

        mediaLibrary.set(assetId, asset);
        return asset;
    }

    function getAsset(assetId) {
        return mediaLibrary.get(assetId) || null;
    }

    function removeAsset(assetId) {
        const asset = mediaLibrary.get(assetId);
        if (asset) {
            if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
            if (asset.element) {
                if (asset.element.pause) asset.element.pause();
                asset.element.src = '';
                asset.element.removeAttribute('src');
            }
            mediaLibrary.delete(assetId);
        }
    }

    function getAllAssets() {
        return Array.from(mediaLibrary.values());
    }

    function getAssetsByType(type) {
        return Array.from(mediaLibrary.values()).filter(a => a.type === type);
    }

    function getFontNames() {
        return Array.from(mediaLibrary.values())
            .filter(a => a.type === 'font' && a.loaded)
            .map(a => a.fontName);
    }

    function clearAll() {
        mediaLibrary.forEach(asset => {
            if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
        });
        mediaLibrary.clear();
    }

    // Initialize worker on load
    initWorker();

    // Export
    window.ForgeCut = window.ForgeCut || {};
    window.ForgeCut.MediaEngine = {
        importFile,
        getAsset,
        removeAsset,
        getAllAssets,
        getAssetsByType,
        getFontNames,
        clearAll,
        loadFont,
        generateWaveform,
        generateThumbnail,
        get library() { return mediaLibrary; }
    };
})();
