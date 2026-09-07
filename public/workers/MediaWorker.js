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

/** ASCII tag at a fixed offset, used to read container brands. */
function readTag(header, start, len) {
    let s = '';
    for (let i = start; i < start + len && i < header.length; i++) {
        s += String.fromCharCode(header[i]);
    }
    return s;
}

/**
 * Containers that share a magic number have to be told apart by the bytes
 * that follow it. Without this the first entry in MAGIC_BYTES wins: RIFF
 * matched video/avi, so every .wav and .webp was reported as an AVI video,
 * and every ftyp file was reported as mp4 video including .m4a audio.
 */
function detectContainerBrand(header) {
    if (matchMagic(header, [[0x52, 0x49, 0x46, 0x46]])) { // "RIFF"
        const form = readTag(header, 8, 4);
        if (form === 'WAVE') return { category: 'audio', format: 'wav', valid: true };
        if (form === 'WEBP') return { category: 'image', format: 'webp', valid: true };
        if (form === 'AVI ') return { category: 'video', format: 'avi', valid: true };
        return null;
    }
    if (matchMagic(header, [[0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70]])) { // "ftyp"
        const brand = readTag(header, 8, 4);
        if (brand === 'qt  ') return { category: 'video', format: 'mov', valid: true };
        // M4A/M4B are audio-only MP4s; M4V and everything else carry video.
        if (brand === 'M4A ' || brand === 'M4B ') return { category: 'audio', format: 'm4a', valid: true };
        return { category: 'video', format: 'mp4', valid: true };
    }
    if (matchMagic(header, [[0x1A, 0x45, 0xDF, 0xA3]])) { // EBML: Matroska or WebM
        // DocType sits past the 16-byte magic window, so scan what we have.
        const head = readTag(header, 0, Math.min(header.length, 512));
        return { category: 'video', format: head.indexOf('webm') !== -1 ? 'webm' : 'mkv', valid: true };
    }
    return null;
}

function detectFileType(header, extension, mimeType) {
    // Disambiguate shared magic numbers before the generic table lookup.
    const brand = detectContainerBrand(header);
    if (brand) return brand;
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

// Extract EXIF orientation from JPEG.
//
// Every read is bounds-checked. A DataView read past the end throws, and the
// worker treats that as "metadata extraction failed" for the whole file — so a
// truncated or tiny JPEG used to lose its format detection over an optional
// orientation tag.
function extractExifOrientation(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.byteLength < 4) return 1;
    if (view.getUint16(0) !== 0xFFD8) return 1; // Not JPEG
    let offset = 2;
    while (offset + 4 <= view.byteLength) {
        const marker = view.getUint16(offset);
        const segmentSize = view.getUint16(offset + 2);
        if (marker === 0xFFE1) { // APP1 marker (EXIF)
            const exifOffset = offset + 4;
            // Check "Exif\0\0"
            if (exifOffset + 6 > view.byteLength) return 1;
            if (view.getUint32(exifOffset) === 0x45786966 && view.getUint16(exifOffset + 4) === 0x0000) {
                const tiffOffset = exifOffset + 6;
                if (tiffOffset + 8 > view.byteLength) return 1;
                const isLittleEndian = view.getUint16(tiffOffset) === 0x4949;
                const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, isLittleEndian);
                if (ifdOffset + 2 > view.byteLength) return 1;
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
        // A zero or garbage segment length would otherwise crawl the offset
        // forward two bytes at a time across the whole header window.
        if (segmentSize < 2) break;
        offset += 2 + segmentSize;
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
        // 512 bytes: 16 for magic numbers, the rest so the EBML DocType
        // (which decides mkv vs webm) is inside the window.
        const header = new Uint8Array(arrayBuffer.slice(0, 512));
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
