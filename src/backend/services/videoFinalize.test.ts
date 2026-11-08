import { describe, it, expect } from 'vitest';
import { countDroppedFrames, buildCfrArgs, buildAudioMuxArgs } from './videoFinalize.js';
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
