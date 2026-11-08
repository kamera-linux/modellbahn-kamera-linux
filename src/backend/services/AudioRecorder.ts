import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * 2; // s16le

export interface AudioInput {
  format: 'pulse' | 'alsa';
  device: string;
}

/** "pulse:default", "pulse:alsa_input.pci-…", "alsa:hw:1,0", "alsa:default" -> AudioInput; "" -> null */
export function parseAudioInput(value: string): AudioInput | null {
  const v = value.trim();
  if (!v) return null;
  const m = /^(pulse|alsa):(.+)$/.exec(v);
  if (!m) throw new Error(`AUDIO_INPUT must look like "pulse:<source>" or "alsa:<device>", got "${v}"`);
  return { format: m[1] as AudioInput['format'], device: m[2] };
}

/** One running capture that may serve several recordings at once. */
export interface AudioHandle {
  file: string; // raw PCM s16le, mono, 48 kHz
  startedAt: number; // Unix time (s) of the first sample
}

/**
 * Records the microphone of the machine the manager runs on.
 *
 * A single ffmpeg capture is shared by all concurrent recordings (an ALSA device can
 * only be opened once). It writes raw PCM, so any time range can be cut out while the
 * capture is still running: byte offset = seconds * 96000.
 * The capture starts with the first acquire() and stops when the last user releases it.
 */
export class AudioRecorder {
  private proc: ChildProcess | null = null;
  private handle: AudioHandle | null = null;
  private starting: Promise<AudioHandle> | null = null;
  private users = 0;
  private lastError: string | undefined;

  constructor(
    private input: AudioInput | null,
    private dir: string,
    private ffmpeg = 'ffmpeg'
  ) {}

  get configured() {
    return this.input !== null;
  }

  status() {
    return {
      configured: this.configured,
      input: this.input ? `${this.input.format}:${this.input.device}` : null,
      recording: this.proc !== null,
      users: this.users,
      lastError: this.lastError
    };
  }

  /** Short test capture; resolves with the peak level in dBFS. */
  async test(seconds = 1): Promise<{ ok: boolean; maxVolumeDb?: number; error?: string }> {
    if (!this.input) return { ok: false, error: 'AUDIO_INPUT ist nicht gesetzt' };
    if (this.proc) return { ok: true }; // already capturing fine
    try {
      const { stderr } = await execFileAsync(
        this.ffmpeg,
        ['-hide_banner', '-nostdin', '-f', this.input.format, '-i', this.input.device, '-t', String(seconds), '-af', 'volumedetect', '-f', 'null', '-'],
        { timeout: (seconds + 10) * 1000 }
      );
      const m = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
      return { ok: true, maxVolumeDb: m ? parseFloat(m[1]) : undefined };
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      return { ok: false, error: (e.stderr || e.message).trim().split('\n').slice(-2).join(' ') };
    }
  }

  async acquire(): Promise<AudioHandle> {
    if (!this.input) throw new Error('Kein Mikrofon konfiguriert (AUDIO_INPUT)');
    this.users++;
    try {
      if (this.handle) return this.handle;
      if (!this.starting) this.starting = this.start();
      return await this.starting;
    } catch (err) {
      this.users--;
      throw err;
    } finally {
      this.starting = null;
    }
  }

  /** Release after the user has finished reading from the file. */
  release(handle: AudioHandle) {
    if (handle !== this.handle) return;
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) this.stop();
  }

  private start(): Promise<AudioHandle> {
    const input = this.input!;
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `capture-${Date.now()}.raw`);
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-f', input.format, '-i', input.device,
      '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), '-f', 's16le', '-y', file
    ];
    logger.info(`Audio capture starting: ${input.format}:${input.device}`);
    const proc = spawn(this.ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = proc;
    let stderr = '';
    proc.stderr?.on('data', d => (stderr = (stderr + d.toString()).slice(-2000)));

    return new Promise<AudioHandle>((resolve, reject) => {
      const t0 = Date.now();
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        this.lastError = msg;
        this.cleanup();
        reject(new Error(`Mikrofon-Aufnahme fehlgeschlagen: ${msg}`));
      };
      proc.on('error', err => fail(err.message));
      proc.on('exit', code => {
        if (!settled) fail(stderr.trim() || `ffmpeg exit ${code}`);
        else if (this.proc === proc) {
          logger.warn(`Audio capture ended unexpectedly (exit ${code}): ${stderr.trim()}`);
          this.lastError = stderr.trim() || `ffmpeg exit ${code}`;
          this.proc = null;
        }
      });

      // The first sample time is derived from how much data has arrived:
      // startedAt = now - bytesWritten / bytesPerSecond (accurate to the poll interval).
      const poll = setInterval(() => {
        let size = 0;
        try {
          size = statSync(file).size;
        } catch {
          /* not created yet */
        }
        if (size > 0) {
          settled = true;
          clearInterval(poll);
          this.lastError = undefined;
          this.handle = { file, startedAt: Date.now() / 1000 - size / BYTES_PER_SECOND };
          logger.info(`Audio capture running (${file})`);
          resolve(this.handle);
        } else if (Date.now() - t0 > 5000) {
          proc.kill('SIGKILL');
          fail('keine Audiodaten nach 5 s');
        }
      }, 10);
    });
  }

  private stop() {
    if (this.proc) {
      logger.info('Audio capture stopping');
      this.proc.kill('SIGINT');
    }
    this.cleanup();
  }

  private cleanup() {
    const file = this.handle?.file;
    this.proc = null;
    this.handle = null;
    if (file && existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }

  shutdown() {
    this.users = 0;
    this.stop();
  }
}
