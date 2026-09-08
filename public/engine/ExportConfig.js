/**
 * ForgeCut — Export Configuration Schema.
 *
 * The export pipeline used to be driven by a bare format string ('mp4',
 * 'webm', ...) that named a file extension and nothing else. Every real
 * encoding decision — which video codec, which audio codec, what bitrate, what
 * the container can legally carry — was either hardcoded or simply absent, so
 * asking for MP4 produced a WebM byte stream with an .mp4 name on it.
 *
 * This module is the single source of truth for what an export IS, separate
 * from any UI that collects it and any backend that fulfils it:
 *
 *     { container, videoCodec, audioCodec, resolution, frameRate,
 *       bitrate, audioBitrate, audioSampleRate }
 *
 * It knows only about formats and codecs. It performs no encoding, touches no
 * DOM, and has no opinion about which backend will run the job — see
 * CapabilityRegistry for that.
 */
(function () {
    'use strict';

    /**
     * Containers and what they are actually allowed to carry.
     *
     * `video: null` marks an audio-only container; a config that names a video
     * codec for one of those is a validation error rather than something to be
     * silently dropped, because silently dropping it is how "export to MP3"
     * used to produce a video file.
     */
    const CONTAINERS = {
        mp4: {
            ext: 'mp4', mime: 'video/mp4', label: 'MP4',
            video: ['h264', 'h265'], audio: ['aac', 'mp3'],
            defaultVideo: 'h264', defaultAudio: 'aac',
            // FFmpeg needs the moov atom relocated for a file to start playing
            // before it is fully downloaded.
            faststart: true
        },
        mkv: {
            ext: 'mkv', mime: 'video/x-matroska', label: 'MKV (Matroska)',
            video: ['h264', 'h265', 'vp8', 'vp9', 'ffv1'],
            audio: ['aac', 'mp3', 'opus', 'vorbis', 'pcm_s16le'],
            defaultVideo: 'h264', defaultAudio: 'aac'
        },
        webm: {
            ext: 'webm', mime: 'video/webm', label: 'WebM',
            video: ['vp8', 'vp9'], audio: ['opus', 'vorbis'],
            defaultVideo: 'vp9', defaultAudio: 'opus'
        },
        mov: {
            ext: 'mov', mime: 'video/quicktime', label: 'MOV (QuickTime)',
            video: ['h264', 'h265', 'prores'], audio: ['aac', 'pcm_s16le'],
            defaultVideo: 'h264', defaultAudio: 'aac',
            faststart: true
        },
        mp3: {
            ext: 'mp3', mime: 'audio/mpeg', label: 'MP3',
            video: null, audio: ['mp3'], defaultAudio: 'mp3'
        },
        wav: {
            ext: 'wav', mime: 'audio/wav', label: 'WAV',
            video: null, audio: ['pcm_s16le'], defaultAudio: 'pcm_s16le'
        },
        m4a: {
            ext: 'm4a', mime: 'audio/mp4', label: 'M4A (AAC)',
            video: null, audio: ['aac'], defaultAudio: 'aac'
        }
    };

    /** Codec identity, kept separate from the FFmpeg encoder that implements it. */
    const VIDEO_CODECS = {
        h264: { label: 'H.264 / AVC', encoder: 'libx264', pixFmt: 'yuv420p', lossless: false },
        h265: { label: 'H.265 / HEVC', encoder: 'libx265', pixFmt: 'yuv420p', lossless: false },
        vp8: { label: 'VP8', encoder: 'libvpx', pixFmt: 'yuv420p', lossless: false },
        vp9: { label: 'VP9', encoder: 'libvpx-vp9', pixFmt: 'yuv420p', lossless: false },
        prores: { label: 'Apple ProRes', encoder: 'prores_ks', pixFmt: 'yuv422p10le', lossless: true },
        ffv1: { label: 'FFV1 (lossless)', encoder: 'ffv1', pixFmt: 'yuv420p', lossless: true }
    };

    const AUDIO_CODECS = {
        aac: { label: 'AAC', encoder: 'aac', lossless: false },
        mp3: { label: 'MP3', encoder: 'libmp3lame', lossless: false },
        opus: { label: 'Opus', encoder: 'libopus', lossless: false },
        vorbis: { label: 'Vorbis', encoder: 'libvorbis', lossless: false },
        pcm_s16le: { label: 'PCM 16-bit', encoder: 'pcm_s16le', lossless: true }
    };

    const DEFAULTS = {
        frameRate: 30,
        bitrate: 8000,
        audioBitrate: 192,
        audioSampleRate: 48000
    };

    /**
     * Named starting points. These are configurations, not a second format
     * system: each one resolves to the same schema every other export uses.
     */
    const PRESETS = {
        'web-compat': {
            label: 'Web / Compatibility',
            description: 'MP4 H.264 + AAC, 1080p30. Plays essentially everywhere.',
            config: {
                container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
                resolution: { width: 1920, height: 1080 }, frameRate: 30,
                bitrate: 8000, audioBitrate: 192
            }
        },
        'high-quality': {
            label: 'High Quality',
            description: 'MP4 H.264 + AAC at source resolution and a high bitrate.',
            config: {
                container: 'mp4', videoCodec: 'h264', audioCodec: 'aac',
                resolution: 'source', frameRate: 60,
                bitrate: 20000, audioBitrate: 320
            }
        },
        'open-flexible': {
            label: 'Open / Flexible (MKV)',
            description: 'Matroska H.264 + AAC. Carries almost any stream combination.',
            config: {
                container: 'mkv', videoCodec: 'h264', audioCodec: 'aac',
                resolution: 'source', frameRate: 30,
                bitrate: 12000, audioBitrate: 256
            }
        },
        'open-web': {
            label: 'Open Web (WebM)',
            description: 'WebM VP9 + Opus. Royalty-free, good for the open web.',
            config: {
                container: 'webm', videoCodec: 'vp9', audioCodec: 'opus',
                resolution: { width: 1920, height: 1080 }, frameRate: 30,
                bitrate: 6000, audioBitrate: 160
            }
        },
        'master-lossless': {
            label: 'Master / Lossless',
            description: 'MOV ProRes + 16-bit PCM. Large files, intended for re-editing.',
            config: {
                container: 'mov', videoCodec: 'prores', audioCodec: 'pcm_s16le',
                resolution: 'source', frameRate: 'source',
                bitrate: null, audioBitrate: null
            }
        },
        'audio-mp3': {
            label: 'Audio Only — MP3',
            description: 'MP3 320 kbps.',
            config: { container: 'mp3', videoCodec: null, audioCodec: 'mp3', audioBitrate: 320 }
        },
        'audio-wav': {
            label: 'Audio Only — WAV',
            description: 'Uncompressed 16-bit PCM.',
            config: { container: 'wav', videoCodec: null, audioCodec: 'pcm_s16le', audioBitrate: null }
        },
        'audio-m4a': {
            label: 'Audio Only — M4A',
            description: 'AAC in an MP4 audio container.',
            config: { container: 'm4a', videoCodec: null, audioCodec: 'aac', audioBitrate: 256 }
        }
    };

    /**
     * Fill in whatever the caller left out, using the container's own defaults.
     * Returns a new object; the input is never mutated.
     */
    function normalise(input) {
        const cfg = Object.assign({}, input || {});
        const container = CONTAINERS[cfg.container];
        if (!container) return cfg; // validate() reports the real error

        if (container.video === null) {
            cfg.videoCodec = null;
        } else if (!cfg.videoCodec) {
            cfg.videoCodec = container.defaultVideo;
        }
        if (!cfg.audioCodec && cfg.audioCodec !== null) {
            cfg.audioCodec = container.defaultAudio;
        }

        if (cfg.videoCodec) {
            if (cfg.frameRate == null) cfg.frameRate = DEFAULTS.frameRate;
            if (cfg.bitrate === undefined) cfg.bitrate = DEFAULTS.bitrate;
            if (cfg.resolution == null) cfg.resolution = 'source';
        }
        if (cfg.audioCodec) {
            if (cfg.audioBitrate === undefined) cfg.audioBitrate = DEFAULTS.audioBitrate;
            if (cfg.audioSampleRate == null) cfg.audioSampleRate = DEFAULTS.audioSampleRate;
        }
        return cfg;
    }

    /**
     * Structural validation: is this combination legal for the container?
     *
     * This is deliberately independent of whether any backend can currently
     * produce it — that is a runtime capability question, and conflating the
     * two is what let unsupported formats be advertised in the first place.
     */
    function validate(input) {
        const errors = [];
        const cfg = normalise(input);
        const container = CONTAINERS[cfg.container];

        if (!container) {
            errors.push(`Unknown container "${cfg.container}". Known: ${Object.keys(CONTAINERS).join(', ')}.`);
            return { ok: false, errors, config: cfg };
        }

        // Checked against the RAW input, not the normalised copy: normalise()
        // clears videoCodec for audio-only containers, so testing cfg here
        // would silently accept "MP3 with H.264" instead of reporting it.
        const requestedVideo = input && input.videoCodec;
        if (container.video === null && requestedVideo) {
            errors.push(`${container.label} is an audio-only container and cannot carry video codec "${requestedVideo}".`);
        }
        if (container.video && cfg.videoCodec) {
            if (!VIDEO_CODECS[cfg.videoCodec]) {
                errors.push(`Unknown video codec "${cfg.videoCodec}".`);
            } else if (container.video.indexOf(cfg.videoCodec) === -1) {
                errors.push(`${container.label} cannot carry ${VIDEO_CODECS[cfg.videoCodec].label}. Supported: ${container.video.join(', ')}.`);
            }
        }
        if (cfg.audioCodec) {
            if (!AUDIO_CODECS[cfg.audioCodec]) {
                errors.push(`Unknown audio codec "${cfg.audioCodec}".`);
            } else if (container.audio.indexOf(cfg.audioCodec) === -1) {
                errors.push(`${container.label} cannot carry ${AUDIO_CODECS[cfg.audioCodec].label}. Supported: ${container.audio.join(', ')}.`);
            }
        }
        if (container.video !== null && !cfg.videoCodec && !cfg.audioCodec) {
            errors.push('An export must contain at least one stream.');
        }

        if (cfg.resolution && cfg.resolution !== 'source') {
            const r = cfg.resolution;
            if (!r || !isFinite(r.width) || !isFinite(r.height) || r.width < 2 || r.height < 2) {
                errors.push('Resolution must be "source" or {width, height} of at least 2x2.');
            } else if (r.width % 2 || r.height % 2) {
                // yuv420p subsamples chroma 2x2, so odd dimensions fail to encode.
                errors.push(`Resolution ${r.width}x${r.height} must have even dimensions for 4:2:0 encoding.`);
            }
        }
        if (cfg.frameRate != null && cfg.frameRate !== 'source' &&
            (!isFinite(cfg.frameRate) || cfg.frameRate <= 0 || cfg.frameRate > 240)) {
            errors.push('Frame rate must be "source" or between 1 and 240.');
        }
        if (cfg.bitrate != null && (!isFinite(cfg.bitrate) || cfg.bitrate <= 0)) {
            errors.push('Video bitrate must be a positive number of kbps, or null for codec default.');
        }
        if (cfg.audioBitrate != null && (!isFinite(cfg.audioBitrate) || cfg.audioBitrate <= 0)) {
            errors.push('Audio bitrate must be a positive number of kbps, or null for codec default.');
        }

        return { ok: errors.length === 0, errors, config: cfg };
    }

    function fromPreset(name, overrides) {
        const preset = PRESETS[name];
        if (!preset) throw new Error(`Unknown export preset "${name}".`);
        return normalise(Object.assign({}, preset.config, overrides || {}));
    }

    /**
     * Make a filename safe for a filesystem and a ZIP entry without destroying
     * what the user actually typed.
     *
     * Unicode is preserved — a Japanese or accented title stays readable — and
     * only characters that are genuinely unsafe are replaced. The display name
     * the user sees in the UI is never mutated by this; it is applied at the
     * point a file is written.
     */
    function sanitiseFilename(name, ext) {
        let base = String(name == null ? '' : name);
        base = base.normalize ? base.normalize('NFC') : base;
        base = base
            // Path separators and the Windows-reserved set. Not a blanket
            // [^a-zA-Z0-9] strip: that turned every non-Latin title into
            // underscores.
            .replace(/[\/\\:*?"<>|]/g, '-')
            // Control characters, including the NUL that truncates C strings.
            .replace(/[\u0000-\u001f\u007f]/g, '')
            // Leading dots hide the file on POSIX; leading dashes look like flags.
            .replace(/^[.\-\s]+/, '')
            .replace(/[.\s]+$/, '')
            .trim();

        // Windows refuses these names regardless of extension.
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(base)) base = '_' + base;
        if (!base) base = 'export';

        // Leave room for the extension and a de-duplication suffix within the
        // 255-byte limit most filesystems impose.
        if (base.length > 180) base = base.slice(0, 180);

        return ext ? `${base}.${ext}` : base;
    }

    /**
     * Give every name in a set a unique form, in the style a file manager does
     * ("name.mp4", "name (2).mp4"). Used for ZIP entries, where a duplicate
     * silently overwrites.
     */
    function dedupeFilenames(names) {
        const seen = Object.create(null);
        return names.map(name => {
            const dot = name.lastIndexOf('.');
            const base = dot > 0 ? name.slice(0, dot) : name;
            const ext = dot > 0 ? name.slice(dot) : '';
            const key = name.toLowerCase();
            if (!seen[key]) { seen[key] = 1; return name; }
            let n = seen[key] + 1, candidate;
            do {
                candidate = `${base} (${n})${ext}`;
                n++;
            } while (seen[candidate.toLowerCase()]);
            seen[key] = n - 1;
            seen[candidate.toLowerCase()] = 1;
            return candidate;
        });
    }

    /** A short, stable description for logs and UI. */
    function describe(cfg) {
        const c = CONTAINERS[cfg.container];
        if (!c) return String(cfg.container);
        const parts = [c.label];
        if (cfg.videoCodec && VIDEO_CODECS[cfg.videoCodec]) parts.push(VIDEO_CODECS[cfg.videoCodec].label);
        if (cfg.audioCodec && AUDIO_CODECS[cfg.audioCodec]) parts.push(AUDIO_CODECS[cfg.audioCodec].label);
        return parts.join(' · ');
    }

    const API = {
        CONTAINERS, VIDEO_CODECS, AUDIO_CODECS, PRESETS, DEFAULTS,
        normalise, validate, fromPreset, sanitiseFilename, dedupeFilenames, describe,
        isAudioOnly: (container) => !!CONTAINERS[container] && CONTAINERS[container].video === null
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = API;                       // node: unit tests, server
    }
    if (typeof window !== 'undefined') {
        window.ForgeCut = window.ForgeCut || {};
        window.ForgeCut.ExportConfig = API;
    }
})();
