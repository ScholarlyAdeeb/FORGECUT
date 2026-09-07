/**
 * ForgeCut MediaWorker — Off-thread file validation & metadata extraction
 * Keeps main thread responsive during heavy file imports.
 */

const MAGIC_BYTES = {
    video: {
        mp4:  [[0x00,0x00,0x00,null,0x66,0x74,0x79,0x70]], // ftyp
        webm: [[0x1A,0x45,0xDF,0xA3]],
        mkv:  [[0x1A,0x45,0xDF,0xA3]],
        avi:  [[0x52,0x49,0x46,0x46]], // RIFF
        mov:  [[0x00,0x00,0x00,null,0x66,0x74,0x79,0x70],[0x00,0x00,0x00,null,0x6D,0x6F,0x6F,0x76]]
    },
    audio: {
        mp3:  [[0xFF,0xFB],[0xFF,0xF3],[0xFF,0xF2],[0x49,0x44,0x33]], // ID3
        wav:  [[0x52,0x49,0x46,0x46]],
        flac: [[0x66,0x4C,0x61,0x43]],
        ogg:  [[0x4F,0x67,0x67,0x53]],
        aac:  [[0xFF,0xF1],[0xFF,0xF9]]
    },
    image: {
        png:  [[0x89,0x50,0x4E,0x47]],
        jpg:  [[0xFF,0xD8,0xFF]],
        webp: [[0x52,0x49,0x46,0x46]],
        gif:  [[0x47,0x49,0x46,0x38]],
        bmp:  [[0x42,0x4D]]
    },
    font: {
        ttf:  [[0x00,0x01,0x00,0x00]],
        otf:  [[0x4F,0x54,0x54,0x4F]],
        woff: [[0x77,0x4F,0x46,0x46]],
        woff2:[[0x77,0x4F,0x46,0x32]]
    }
};

function matchMagic(header, patterns) {
    for (const pattern of patterns) {
        let match = true;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] !== null && header[i] !== pattern[i]) {
                match = false;
                break;
            }
        }
        if (match) return true;
    }
    return false;
}

function detectFileType(header, extension, mimeType) {
    // Try magic bytes first
    for (const [category, formats] of Object.entries(MAGIC_BYTES)) {
        for (const [fmt, patterns] of Object.entries(formats)) {
            if (matchMagic(header, patterns)) {
                return { category, format: fmt, valid: true };
            }
        }
    }
    // Fallback to extension
    const ext = extension.toLowerCase().replace('.', '');
    const extMap = {
        mp4:'video', mov:'video', avi:'video', mkv:'video', webm:'video',
        mp3:'audio', wav:'audio', aac:'audio', flac:'audio', ogg:'audio',
        png:'image', jpg:'image', jpeg:'image', webp:'image', svg:'image', gif:'image', bmp:'image',
        ttf:'font', otf:'font', woff:'font', woff2:'font'
    };
    if (extMap[ext]) {
        return { category: extMap[ext], format: ext, valid: true };
    }
    // Fallback to MIME
    if (mimeType) {
        if (mimeType.startsWith('video/')) return { category: 'video', format: ext, valid: true };
        if (mimeType.startsWith('audio/')) return { category: 'audio', format: ext, valid: true };
        if (mimeType.startsWith('image/')) return { category: 'image', format: ext, valid: true };
        if (mimeType.includes('font')) return { category: 'font', format: ext, valid: true };
    }
    return { category: 'unknown', format: ext, valid: false };
}

function getExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop() : '';
}

// Extract EXIF orientation from JPEG
function extractExifOrientation(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0) !== 0xFFD8) return 1; // Not JPEG
    let offset = 2;
    while (offset < view.byteLength - 2) {
        const marker = view.getUint16(offset);
        if (marker === 0xFFE1) { // APP1 marker (EXIF)
            const exifOffset = offset + 4;
            // Check "Exif\0\0"
            if (view.getUint32(exifOffset) === 0x45786966 && view.getUint16(exifOffset + 4) === 0x0000) {
                const tiffOffset = exifOffset + 6;
                const isLittleEndian = view.getUint16(tiffOffset) === 0x4949;
                const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, isLittleEndian);
                const numEntries = view.getUint16(ifdOffset, isLittleEndian);
                for (let i = 0; i < numEntries; i++) {
                    const entryOffset = ifdOffset + 2 + i * 12;
                    if (entryOffset + 12 > view.byteLength) break;
                    const tag = view.getUint16(entryOffset, isLittleEndian);
                    if (tag === 0x0112) { // Orientation tag
                        return view.getUint16(entryOffset + 8, isLittleEndian);
                    }
                }
            }
            return 1;
        }
        offset += 2 + view.getUint16(offset + 2);
    }
    return 1;
}

/**
 * Reduce decoded PCM to `numSamples` normalised peaks.
 * Runs here so a multi-minute audio import does not block the UI thread.
 */
function downsample(samples, numSamples) {
    const blockSize = Math.floor(samples.length / numSamples) || 1;
    const waveform = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        let sum = 0;
        const start = i * blockSize;
        const end = Math.min(start + blockSize, samples.length);
        for (let j = start; j < end; j++) sum += Math.abs(samples[j]);
        waveform[i] = sum / blockSize;
    }
    let max = 0;
    for (let i = 0; i < waveform.length; i++) if (waveform[i] > max) max = waveform[i];
    if (max > 0) for (let i = 0; i < waveform.length; i++) waveform[i] /= max;
    return waveform;
}

self.onmessage = function(e) {
    const { id, file, arrayBuffer, op } = e.data;

    if (op === 'downsample') {
        try {
            const wf = downsample(e.data.samples, e.data.numSamples || 800);
            // Transfer the result back rather than copying it.
            self.postMessage({ id, success: true, waveform: wf }, [wf.buffer]);
        } catch (err) {
            self.postMessage({ id, success: false, error: err.message });
        }
        return;
    }

    try {
        const header = new Uint8Array(arrayBuffer.slice(0, 16));
        const extension = getExtension(file.name);
        const typeInfo = detectFileType(header, extension, file.type);
        const orientation = typeInfo.category === 'image' ? extractExifOrientation(arrayBuffer) : 1;

        self.postMessage({
            id,
            success: true,
            metadata: {
                fileName: file.name,
                fileSize: file.size,
                mimeType: file.type,
                category: typeInfo.category,
                format: typeInfo.format,
                valid: typeInfo.valid,
                extension,
                exifOrientation: orientation,
                lastModified: file.lastModified
            }
        });
    } catch (err) {
        self.postMessage({
            id,
            success: false,
            error: err.message
        });
    }
};
