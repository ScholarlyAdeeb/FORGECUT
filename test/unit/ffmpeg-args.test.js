/**
 * Tests for the FFmpeg argument vector and path guard.
 *
 * The argv IS the security boundary: FFmpeg is spawned with an argument array
 * and no shell, so nothing a caller supplies can be interpreted as a command.
 * These tests assert that property directly, and that the encoder chosen is the
 * one the configuration actually asked for rather than one inferred from a
 * filename.
 *
 * Nothing here spawns a process.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

const svc = require('../../server/ffmpeg-service.js');
const EC = require('../../public/engine/ExportConfig.js');

const argsFor = (cfg) => svc.buildArgs(EC.normalise(cfg), '/tmp/j/source.bin', '/tmp/j/out.bin');

/** Value that follows a flag, e.g. pair(args,'-c:v') -> 'libx264'. */
function pair(args, flag) {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
}

test('the muxer is named explicitly, never inferred from the extension', () => {
    assert.equal(pair(argsFor({ container: 'mp4' }), '-f'), 'mp4');
    assert.equal(pair(argsFor({ container: 'mkv' }), '-f'), 'matroska');
    assert.equal(pair(argsFor({ container: 'webm' }), '-f'), 'webm');
    assert.equal(pair(argsFor({ container: 'mov' }), '-f'), 'mov');
    assert.equal(pair(argsFor({ container: 'm4a' }), '-f'), 'ipod');
    assert.equal(pair(argsFor({ container: 'mp3' }), '-f'), 'mp3');
    assert.equal(pair(argsFor({ container: 'wav' }), '-f'), 'wav');
});

test('codecs map to the intended encoders', () => {
    assert.equal(pair(argsFor({ container: 'mp4', videoCodec: 'h264' }), '-c:v'), 'libx264');
    assert.equal(pair(argsFor({ container: 'mkv', videoCodec: 'h265' }), '-c:v'), 'libx265');
    assert.equal(pair(argsFor({ container: 'webm', videoCodec: 'vp9' }), '-c:v'), 'libvpx-vp9');
    assert.equal(pair(argsFor({ container: 'webm', videoCodec: 'vp8' }), '-c:v'), 'libvpx');
    assert.equal(pair(argsFor({ container: 'mov', videoCodec: 'prores' }), '-c:v'), 'prores_ks');
    assert.equal(pair(argsFor({ container: 'mp3' }), '-c:a'), 'libmp3lame');
    assert.equal(pair(argsFor({ container: 'wav' }), '-c:a'), 'pcm_s16le');
});

test('audio-only exports explicitly disable video', () => {
    ['mp3', 'wav', 'm4a'].forEach(c => {
        const a = argsFor({ container: c });
        assert.ok(a.includes('-vn'), `${c} should pass -vn`);
        assert.ok(!a.includes('-c:v'), `${c} should not set a video codec`);
    });
});

test('progress is requested from the encoder rather than timed', () => {
    const a = argsFor({ container: 'mp4' });
    assert.equal(pair(a, '-progress'), 'pipe:1');
    assert.ok(a.includes('-nostats'));
});

test('MP4 and MOV relocate the moov atom for streaming', () => {
    assert.equal(pair(argsFor({ container: 'mp4' }), '-movflags'), '+faststart');
    assert.equal(pair(argsFor({ container: 'mov' }), '-movflags'), '+faststart');
    assert.ok(!argsFor({ container: 'mkv' }).includes('-movflags'));
});

test('lossless audio does not get a bitrate flag', () => {
    // -b:a on pcm_s16le is meaningless and FFmpeg warns about it.
    assert.ok(!argsFor({ container: 'wav' }).includes('-b:a'));
    assert.ok(argsFor({ container: 'mp3', audioBitrate: 320 }).includes('-b:a'));
});

test('invalid configurations never reach argv', () => {
    assert.throws(() => argsFor({ container: 'webm', videoCodec: 'h264' }), /cannot carry/);
    assert.throws(() => argsFor({ container: 'nope' }), /Unknown container/);
    assert.throws(() => svc.buildArgs({ container: 'mp4', videoCodec: 'h264; rm -rf /' }, 'i', 'o'), /Unknown video codec/);
});

test('hostile configuration values cannot inject arguments', async (t) => {
    await t.test('unknown codec names are rejected outright', () => {
        assert.throws(() => svc.buildArgs({ container: 'mp4', videoCodec: '-i /etc/passwd' }, 'i', 'o'), /Unknown video codec/);
        assert.throws(() => svc.buildArgs({ container: 'mp4', audioCodec: '$(whoami)' }, 'i', 'o'), /Unknown audio codec/);
    });

    await t.test('every emitted token comes from our own tables, not the caller', () => {
        // A numeric field is the only place a caller-supplied value could reach
        // argv, and it is coerced through String() after a finite-number check.
        const a = svc.buildArgs(EC.normalise({ container: 'mp4', bitrate: 5000, frameRate: 24 }), 'in', 'out');
        assert.ok(a.includes('5000k'));
        assert.ok(a.includes('24'));
        // Nothing in the vector contains shell metacharacters.
        const suspicious = a.filter(tok => /[;&|`$><\n]/.test(String(tok)));
        assert.deepEqual(suspicious, [], 'unexpected metacharacters: ' + JSON.stringify(suspicious));
    });

    await t.test('a non-numeric bitrate is rejected rather than concatenated', () => {
        assert.throws(() => svc.buildArgs({ container: 'mp4', bitrate: '8000k -f matroska' }, 'i', 'o'), /bitrate/);
        assert.throws(() => svc.buildArgs({ container: 'mp4', frameRate: '30 -y /etc/x' }, 'i', 'o'), /Frame rate/);
    });
});

test('safeJoin refuses to escape the job directory', () => {
    const dir = path.join(os.tmpdir(), 'forgecut-export', 'job-1');
    assert.ok(svc.safeJoin(dir, 'source.bin').startsWith(path.resolve(dir)));
    assert.throws(() => svc.safeJoin(dir, '../../../etc/passwd'), /outside the job directory/);
    assert.throws(() => svc.safeJoin(dir, '..'), /outside the job directory/);
    assert.throws(() => svc.safeJoin(dir, path.join('..', '..', 'other')), /outside the job directory/);
});

test('FFmpeg failures are translated into actionable messages', () => {
    const d = svc.describeFfmpegFailure;
    assert.match(d("Unknown encoder 'libx265'", 1), /no encoder for libx265/i);
    assert.match(d('av_interleaved_write_frame(): No space left on device', 1), /disk ran out of space/i);
    assert.match(d('Error opening output: Permission denied', 1), /Permission denied/i);
    assert.match(d('moov atom not found', 1), /unreadable/i);
    assert.match(d('height not divisible by 2', 1), /odd dimensions/i);
    assert.match(d('', 1), /exited with code 1/);
});
