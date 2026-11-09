import { execFile } from 'child_process';
import { promisify } from 'util';
import { renameSync, unlinkSync, existsSync } from 'fs';
import { SAMPLE_RATE, type AudioHandle } from './AudioRecorder.js';
import type { Rotation } from '../../shared/types.js';

const execFileAsync = promisify(execFile);

/**
 * Frame gaps from packet timestamps (seconds). A gap counts as a lost frame when it is
 * longer than 1.5 frame periods; tiny sensor jitter is ignored.
 */
export function countDroppedFrames(pts: number[], fps: number): number {
  const t = [...pts].sort((a, b) => a - b);
  const period = 1 / fps;
  let dropped = 0;
  for (let i = 1; i < t.length; i++) {
    const gap = t[i] - t[i - 1];
    if (gap > 1.5 * period) dropped += Math.round(gap / period) - 1;
  }
  return dropped;
}

export interface FinalizeOptions {
  fps: number;
  rotation: Rotation;
  audio?: { handle: AudioHandle; videoStartedAt: number };
  /** Re-encode recordings with lost frames to a constant frame rate; null = keep them VFR. */
  reencode?: { crf: number; preset: string } | null;
}

/**
 * Wrap the raw H.264 stream into MP4 with an exact constant frame rate
 * (track timescale = fps, every frame lasts exactly 1 tick) and re-apply the
 * rotation flag. Video is never re-encoded.
 * (Audio is muxed in a separate pass: a raw H.264 input has no packet timestamps,
 * which makes -shortest cut the audio to nothing.)
 */
export function buildCfrArgs(rawH264: string, out: string, o: { fps: number; rotation: Rotation }): string[] {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  // display_rotation is counter-clockwise; our rotation is clockwise.
  if (o.rotation === 90 || o.rotation === 270) args.push('-display_rotation:v:0', String(-o.rotation));
  args.push('-framerate', String(o.fps), '-i', rawH264, '-map', '0:v:0', '-c:v', 'copy', '-video_track_timescale', String(o.fps), out);
  return args;
}

/**
 * Constant frame rate for a recording with lost frames: the fps filter repeats the
 * previous picture for every missing one, so the timeline (and the sound) stays
 * exactly as recorded. Needs a re-encode – only used when frames were lost.
 * ffmpeg's autorotate turns a 90/270 rotation flag into rotated pixels.
 */
export function buildReencodeArgs(video: string, out: string, o: { fps: number; crf: number; preset: string }): string[] {
  return [
    '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
    '-i', video, '-map', '0:v:0',
    '-vf', `fps=${o.fps}`,
    '-c:v', 'libx264', '-preset', o.preset, '-crf', String(o.crf), '-pix_fmt', 'yuv420p',
    '-video_track_timescale', String(o.fps), out
  ];
}

/**
 * Add the slice of the microphone capture that matches the video (AAC), copying the
 * video. timescale keeps the constant-frame-rate track intact.
 */
export function buildAudioMuxArgs(video: string, out: string, audio: NonNullable<FinalizeOptions['audio']>, timescale?: number): string[] {
  const offset = audio.videoStartedAt - audio.handle.startedAt;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', video, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1'];
  if (offset >= 0) args.push('-ss', offset.toFixed(3));
  args.push('-i', audio.handle.file, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k');
  if (timescale) args.push('-video_track_timescale', String(timescale));
  if (offset < 0) args.push('-af', `adelay=${Math.round(-offset * 1000)}:all=1`); // audio began after the video
  args.push('-shortest', '-movflags', '+faststart', out);
  return args;
}

/**
 * Make a recording edit-friendly (constant frame rate, e.g. for Kdenlive) and add audio.
 * Without lost frames the stream is only re-timed (no re-encode). With lost frames the
 * gaps are filled by repeating the previous picture (re-encode, `reencode` option);
 * if that is switched off the original timestamps are kept (variable frame rate),
 * because simply forcing a constant rate would shift picture against sound.
 */
export async function finalizeVideo(
  ffmpeg: string,
  ffprobe: string,
  video: string,
  o: FinalizeOptions
): Promise<{ dropped: number; cfr: boolean; reencoded: boolean; durationSeconds: number }> {
  const run = (args: string[], timeout = 10 * 60 * 1000) => execFileAsync(ffmpeg, args, { timeout });
  const { stdout } = await execFileAsync(
    ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', video],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  const pts = stdout.split('\n').map(Number).filter(n => Number.isFinite(n) && n >= 0);
  const dropped = countDroppedFrames(pts, o.fps);
  // reduce instead of Math.max(...pts): long videos have too many frames for spread arguments
  const durationSeconds = pts.length
    ? pts.reduce((a, b) => Math.max(a, b)) - pts.reduce((a, b) => Math.min(a, b)) + 1 / o.fps
    : 0;

  const raw = video.replace(/\.mp4$/, '.tmp.h264');
  const cfr = video.replace(/\.mp4$/, '.cfr.tmp.mp4');
  const out = video.replace(/\.mp4$/, '.final.tmp.mp4');
  try {
    let source = video;
    const reencoded = dropped > 0 && !!o.reencode;
    if (dropped === 0) {
      await run(['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', video, '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', raw]);
      await run(buildCfrArgs(raw, cfr, o));
      source = cfr;
    } else if (o.reencode) {
      // Slow machines (Pi 5) may need longer than real time for this.
      await run(buildReencodeArgs(video, cfr, { fps: o.fps, ...o.reencode }), Math.max(10 * 60, durationSeconds * 4) * 1000);
      source = cfr;
    }
    const constant = dropped === 0 || reencoded;
    if (o.audio) {
      await run(buildAudioMuxArgs(source, out, o.audio, constant ? o.fps : undefined));
      renameSync(out, video);
    } else if (source !== video) {
      // faststart for browser streaming in the same go
      await run(['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', source, '-c', 'copy', '-video_track_timescale', String(o.fps), '-movflags', '+faststart', out]);
      renameSync(out, video);
    }
    return { dropped, cfr: constant, reencoded, durationSeconds };
  } finally {
    for (const f of [raw, cfr, out]) if (existsSync(f)) unlinkSync(f);
  }
}
