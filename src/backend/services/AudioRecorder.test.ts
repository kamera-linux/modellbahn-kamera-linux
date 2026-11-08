import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AudioRecorder, parseAudioInput } from './AudioRecorder.js';

describe('parseAudioInput', () => {
  it('parses pulse and alsa inputs', () => {
    expect(parseAudioInput('pulse:default')).toEqual({ format: 'pulse', device: 'default' });
    expect(parseAudioInput('alsa:hw:1,0')).toEqual({ format: 'alsa', device: 'hw:1,0' });
    expect(parseAudioInput('  ')).toBeNull();
  });
  it('rejects unknown formats', () => {
    expect(() => parseAudioInput('jack:system')).toThrow(/AUDIO_INPUT/);
    expect(() => parseAudioInput('default')).toThrow();
  });
});

describe('AudioRecorder (with a fake ffmpeg)', () => {
  let dir: string;
  let fakeOk: string;
  let fakeFail: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'audio-'));
    // Writes 96000 bytes (= 1 s of s16le mono 48 kHz) per second to the last argument.
    fakeOk = join(dir, 'ffmpeg-ok.sh');
    writeFileSync(fakeOk, '#!/bin/sh\nfor last; do :; done\nwhile true; do head -c 9600 /dev/zero >> "$last"; sleep 0.1; done\n');
    chmodSync(fakeOk, 0o755);
    fakeFail = join(dir, 'ffmpeg-fail.sh');
    writeFileSync(fakeFail, '#!/bin/sh\necho "default: No such device" >&2\nexit 1\n');
    chmodSync(fakeFail, 0o755);
  });

  it('is disabled without input', async () => {
    const rec = new AudioRecorder(null, dir);
    expect(rec.configured).toBe(false);
    await expect(rec.acquire()).rejects.toThrow(/Kein Mikrofon/);
  });

  it('shares one capture between users and stops after the last release', async () => {
    const rec = new AudioRecorder({ format: 'pulse', device: 'default' }, join(dir, 'a'), fakeOk);
    const before = Date.now() / 1000;
    const [h1, h2] = await Promise.all([rec.acquire(), rec.acquire()]);
    expect(h1).toBe(h2);
    expect(h1.startedAt).toBeGreaterThan(before - 0.5);
    expect(h1.startedAt).toBeLessThanOrEqual(Date.now() / 1000);
    expect(rec.status()).toMatchObject({ recording: true, users: 2 });

    rec.release(h1);
    expect(rec.status().recording).toBe(true);
    rec.release(h2);
    expect(rec.status()).toMatchObject({ recording: false, users: 0 });
    expect(existsSync(h1.file)).toBe(false);
  });

  it('reports ffmpeg errors', async () => {
    const rec = new AudioRecorder({ format: 'alsa', device: 'hw:9' }, join(dir, 'b'), fakeFail);
    await expect(rec.acquire()).rejects.toThrow(/No such device/);
    expect(rec.status()).toMatchObject({ recording: false, users: 0, lastError: expect.stringContaining('No such device') });
  });
});
