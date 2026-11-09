import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { countDroppedFrames, buildCfrArgs, buildAudioMuxArgs, buildReencodeArgs, finalizeVideo } from './videoFinalize.js';
import { SAMPLE_RATE } from './AudioRecorder.js';

const frames = (n: number, fps = 30, jitterMs = 0.04) =>
  Array.from({ length: n }, (_, i) => i / fps + (i % 2 ? jitterMs : -jitterMs) / 1000);

describe('countDroppedFrames', () => {
  it('ignores sensor jitter', () => {
    expect(countDroppedFrames(frames(450), 30)).toBe(0);
  });
  it('counts gaps of lost frames', () => {
    const t = frames(100).filter((_, i) => i !== 10 && i !== 50 && i !== 51);
    expect(countDroppedFrames(t, 30)).toBe(3);
  });
  it('handles unsorted input (B-frames / packet order)', () => {
    expect(countDroppedFrames([0.1, 0, 0.0333, 0.0667], 30)).toBe(0);
  });
});

describe('buildCfrArgs', () => {
  it('wraps the raw stream with an exact constant frame rate', () => {
    const a = buildCfrArgs('/v.h264', '/o.mp4', { fps: 30, rotation: 0 }).join(' ');
    expect(a).toContain('-framerate 30 -i /v.h264');
    expect(a).toContain('-c:v copy -video_track_timescale 30 /o.mp4');
    expect(a).not.toContain('display_rotation');
  });

  it('re-applies 90/270 rotation (display rotation is counter-clockwise)', () => {
    expect(buildCfrArgs('/v.h264', '/o.mp4', { fps: 30, rotation: 90 }).join(' ')).toContain('-display_rotation:v:0 -90 -framerate 30');
    expect(buildCfrArgs('/v.h264', '/o.mp4', { fps: 30, rotation: 180 }).join(' ')).not.toContain('display_rotation');
  });
});

describe('buildAudioMuxArgs', () => {
  const audio = { handle: { file: '/a.raw', startedAt: 1000 }, videoStartedAt: 1002.5 };

  it('adds the audio slice starting at the video start and keeps the CFR timescale', () => {
    const a = buildAudioMuxArgs('/v.mp4', '/o.mp4', audio, 30).join(' ');
    expect(a).toContain(`-f s16le -ar ${SAMPLE_RATE} -ac 1 -ss 2.500 -i /a.raw`);
    expect(a).toContain('-c:v copy -c:a aac');
    expect(a).toContain('-video_track_timescale 30');
    expect(a).toContain('-shortest');
  });

  it('pads with silence when the audio started after the video', () => {
    const args = buildAudioMuxArgs('/v.mp4', '/o.mp4', { ...audio, videoStartedAt: 999.75 });
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('-video_track_timescale');
    expect(args[args.indexOf('-af') + 1]).toBe('adelay=250:all=1');
  });
});

describe('buildReencodeArgs', () => {
  it('fills gaps with the fps filter and re-encodes with x264', () => {
    const a = buildReencodeArgs('/v.mp4', '/o.mp4', { fps: 30, crf: 18, preset: 'veryfast' }).join(' ');
    expect(a).toContain('-i /v.mp4 -map 0:v:0 -vf fps=30');
    expect(a).toContain('-c:v libx264 -preset veryfast -crf 18');
    expect(a).toContain('-video_track_timescale 30 /o.mp4');
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { stdio: 'pipe' }).toString().includes('libx264');
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)('finalizeVideo with real ffmpeg', () => {
  const probe = (f: string, entries: string, stream = 'v:0') =>
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', entries, '-of', 'csv=p=0', f]).toString().trim();

  /** 2 s test video at 30 fps with frames 20-24 missing (timestamps kept), rotation flag 90°. */
  const makeVfr = (dir: string) => {
    const f = join(dir, 'vfr.mp4');
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2',
      '-vf', "select='not(between(n,20,24))'", '-fps_mode', 'passthrough',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-video_track_timescale', '90000', join(dir, 'tmp.mp4')
    ]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-display_rotation:v:0', '-90', '-i', join(dir, 'tmp.mp4'), '-c', 'copy', f]);
    return f;
  };

  it('re-encodes a recording with lost frames to a constant frame rate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'finalize-'));
    try {
      const f = makeVfr(dir);
      const r = await finalizeVideo('ffmpeg', 'ffprobe', f, { fps: 30, rotation: 90, reencode: { crf: 23, preset: 'ultrafast' } });
      expect(r).toMatchObject({ dropped: 5, cfr: true, reencoded: true });
      expect(r.durationSeconds).toBeCloseTo(2, 1);

      const pts = probe(f, 'packet=pts_time').split('\n').map(Number).sort((a, b) => a - b);
      expect(pts).toHaveLength(60); // gaps filled
      expect(countDroppedFrames(pts, 30)).toBe(0);
      expect(probe(f, 'stream=avg_frame_rate')).toBe('30/1');
      // rotation flag turned into rotated pixels
      expect(probe(f, 'stream=width,height')).toBe('240,320');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it('keeps the variable frame rate when re-encoding is off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'finalize-'));
    try {
      const f = makeVfr(dir);
      const r = await finalizeVideo('ffmpeg', 'ffprobe', f, { fps: 30, rotation: 90, reencode: null });
      expect(r).toMatchObject({ dropped: 5, cfr: false, reencoded: false });
      expect(probe(f, 'packet=pts_time').split('\n')).toHaveLength(55);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
