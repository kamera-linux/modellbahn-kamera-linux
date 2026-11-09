import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, mkdirSync, renameSync, statSync } from 'fs';
import { join } from 'path';
import { SSHManager, SSHTarget } from './SSHManager.js';
import { RecordingManager } from './RecordingManager.js';
import { logger } from '../utils/logger.js';
import { buildCommand } from '../utils/shell.js';
import { appConfig, paths, thumbFor } from '../config.js';
import { HttpError } from '../validation.js';
import { AudioRecorder, AudioHandle, parseAudioInput } from './AudioRecorder.js';
import { finalizeVideo } from './videoFinalize.js';
import { ScriptSync } from './ScriptSync.js';
import { metrics, since, initCameraMetrics } from '../metrics.js';
import type {
  Camera,
  CaptureOptions,
  RecordingOptions,
  RecordingSession,
  Rotation,
  GroupRecordingRequest,
  GroupRecordingResult
} from '../../shared/types.js';

export type { Camera, CaptureOptions, RecordingOptions };

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const toRotation = (v: unknown): Rotation => (ROTATIONS.includes(v as Rotation) ? (v as Rotation) : 0);

/** File-system safe camera name for media filenames. */
export const safeName = (name: string) => name.replace(/[^A-Za-z0-9_-]+/g, '_');

/** Timestamp like 2026-05-15T17-14-02 (local time is not used on purpose: ISO/UTC). */
export const fileTimestamp = (d = new Date(), withMillis = false) => {
  const iso = d.toISOString(); // 2026-05-15T17:14:02.123Z
  const base = iso.slice(0, 19).replace(/:/g, '-');
  return withMillis ? `${base}-${iso.slice(20, 23)}` : base;
};

const target = (c: Camera): SSHTarget => ({ host: c.host, user: c.user, port: c.port });

/** Arguments understood by both Pi scripts. */
function commonArgs(options: CaptureOptions, rotation: Rotation): Array<string | number> {
  const [width, height] = (options.resolution || '1920x1080').split('x');
  const args: Array<string | number> = ['--width', width, '--height', height, '--rotate', rotation];
  if (options.autofocusMode) args.push('--autofocus-mode', options.autofocusMode);
  if (options.autofocusRange) args.push('--autofocus-range', options.autofocusRange);
  if (options.hdr) args.push('--hdr', options.hdr);
  if (options.roi) args.push('--roi', options.roi);
  return args;
}

// The program part (incl. script path from trusted config) stays unquoted so `~` expands;
// every user-influenced value goes through shellQuote via buildCommand.
// `exec` replaces the remote shell, so pkill in stopRecording only hits timeout/python.
export function buildCaptureCommand(remoteFile: string, options: CaptureOptions, rotation: Rotation, thumbFile?: string): string {
  return buildCommand(`exec timeout -k 10 30 python3 ${appConfig.remoteScriptDir}/camera-capture.py`, [
    '--output', remoteFile,
    ...(thumbFile ? ['--thumbnail', thumbFile] : []),
    '--quality', options.quality ?? 90,
    '--timeout', 25,
    ...commonArgs(options, rotation)
  ]);
}

/** `STARTED_AT=<unix time>` printed by camera-record.py when the first frame was captured. */
export function parseStartedAt(stdout: string): number | null {
  const m = /^STARTED_AT=(\d+(?:\.\d+)?)\s*$/m.exec(stdout);
  return m ? parseFloat(m[1]) : null;
}

export function buildRecordCommand(
  remoteFile: string,
  options: RecordingOptions,
  rotation: Rotation,
  thumbFile?: string,
  remoteStartAt?: number
): string {
  const duration = options.duration ?? 5;
  const wait = remoteStartAt ? Math.max(0, Math.ceil(remoteStartAt - Date.now() / 1000)) : 0;
  const timeoutSeconds = duration + 60 + wait;
  return buildCommand(`exec timeout -k 10 ${timeoutSeconds} python3 ${appConfig.remoteScriptDir}/camera-record.py`, [
    '--output', remoteFile,
    '--duration', duration,
    ...(thumbFile ? ['--thumbnail', thumbFile] : []),
    ...(remoteStartAt ? ['--start-at', remoteStartAt.toFixed(3)] : []),
    '--timeout', duration + 45,
    ...commonArgs(options, rotation)
  ]);
}

export class CameraManager {
  private ssh = new SSHManager();
  private recordings = new RecordingManager();
  private cameras = new Map<string, Camera>();
  private locks = new Map<string, Promise<void>>();
  private statusCheckRunning = false;
  readonly scripts = new ScriptSync(this.ssh, appConfig.piScriptsDir, appConfig.remoteScriptDir, undefined, appConfig.remoteWorkDir);
  private syncing = new Set<string>();
  readonly audio = new AudioRecorder(parseAudioInput(appConfig.audioInput), paths.audioTmpDir, appConfig.ffmpegPath);

  constructor() {
    mkdirSync(paths.videosDir, { recursive: true });
    mkdirSync(paths.photosDir, { recursive: true });
    mkdirSync(paths.photoThumbsDir, { recursive: true });
    mkdirSync(paths.videoThumbsDir, { recursive: true });
    this.loadCameras();
    initCameraMetrics(Array.from(this.cameras.keys()));
    this.ssh.labelFor = t =>
      Array.from(this.cameras.values()).find(c => c.host === t.host && c.port === t.port)?.id ?? t.host;
    setInterval(() => void this.updateAllCameraStatuses(), 30000).unref();
    void this.updateAllCameraStatuses();
  }

  get sshManager() {
    return this.ssh;
  }

  private loadCameras() {
    try {
      const config = JSON.parse(readFileSync(paths.devicesFile, 'utf-8'));
      for (const cam of config.cameras ?? []) {
        if (!cam.id || !cam.host || !cam.user) {
          logger.warn('Skipping camera with missing id/host/user', cam);
          continue;
        }
        this.cameras.set(cam.id, {
          id: String(cam.id),
          name: String(cam.name || cam.id),
          host: String(cam.host),
          port: Number(cam.port) || 22,
          user: String(cam.user),
          status: 'offline',
          photoRotation: toRotation(cam.photoRotation ?? cam.rotation),
          videoRotation: toRotation(cam.videoRotation ?? cam.rotation),
          sync: { state: 'unknown' }
        });
      }
      logger.info(`Loaded ${this.cameras.size} cameras from ${paths.devicesFile}`);
    } catch (err) {
      logger.error(`Failed to load cameras from ${paths.devicesFile}:`, err);
    }
  }

  /** Serialize camera access: the camera module can only be used by one process at a time. */
  private async withLock<T>(cameraId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(cameraId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(r => (release = r));
    const chained = previous.then(() => current);
    this.locks.set(cameraId, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(cameraId) === chained) this.locks.delete(cameraId);
    }
  }

  private isBusy(cameraId: string) {
    return this.locks.has(cameraId);
  }

  async updateAllCameraStatuses() {
    if (this.statusCheckRunning) return;
    this.statusCheckRunning = true;
    try {
      await Promise.all(
        Array.from(this.cameras.values()).map(async camera => {
          const start = process.hrtime.bigint();
          const result = await this.ssh.testConnection(target(camera), appConfig.ssh.statusTimeoutMs);
          metrics.statusChecks.inc({ camera: camera.id, result: result.success ? 'ok' : 'failed' });
          if (result.success) metrics.statusCheckSeconds.set({ camera: camera.id }, since(start));
          if (result.success) {
            if (camera.status !== 'recording') camera.status = 'online';
            camera.lastSeen = new Date();
            if (this.syncDue(camera)) void this.ensureSynced(camera);
          } else if (camera.status !== 'recording') {
            camera.status = 'offline';
            // Re-check scripts after the next (re)connect – the Pi may have been reinstalled.
            camera.sync = { state: 'unknown', version: this.scripts.version };
            logger.debug(`Camera ${camera.id} offline: ${result.error}`);
          }
        })
      );
    } finally {
      this.statusCheckRunning = false;
    }
  }

  listCameras(): Camera[] {
    return Array.from(this.cameras.values());
  }

  /** Sessions that are waiting, recording, stopping or being post-processed. */
  activeRecordingCount(): number {
    return this.recordings.getAllSessions().filter(s => s.status !== 'completed' && s.status !== 'failed').length;
  }

  getCamera(id: string): Camera | null {
    return this.cameras.get(id) ?? null;
  }

  /** First contact, after reconnect, periodically, and (less often) retrying errors. */
  private syncDue(camera: Camera): boolean {
    if (this.syncing.has(camera.id) || this.isBusy(camera.id)) return false;
    const { state, checkedAt } = camera.sync;
    if (state === 'unknown') return true;
    if (state === 'checking' || state === 'syncing') return false;
    const age = checkedAt ? (Date.now() - new Date(checkedAt).getTime()) / 60000 : Infinity;
    return state === 'error' ? age >= 2 : age >= appConfig.syncRecheckMinutes;
  }

  /**
   * Bring the scripts on the Pi up to date and run its self-check.
   * Holds the camera lock, so no capture/recording runs during an upload.
   */
  async ensureSynced(camera: Camera, force = false): Promise<Camera['sync']> {
    if (this.syncing.has(camera.id)) return camera.sync;
    this.syncing.add(camera.id);
    try {
      return await this.withLock(camera.id, async () => {
        const wasReady = camera.sync.state === 'ready';
        const result = await this.scripts.sync(target(camera), {
          force,
          // A ready Pi stays usable during a routine check; only an actual upload blocks it.
          onState: state => {
            if (!(wasReady && state === 'checking')) camera.sync = { ...camera.sync, state, version: this.scripts.version };
          }
        });
        camera.sync = result;
        if (result.state === 'ready') {
          if (!wasReady || result.updatedAt) {
            logger.info(`Camera ${camera.id} ready (scripts ${result.version}${result.updatedAt ? ', updated' : ''})`, {
              warnings: result.warnings
            });
          }
        } else {
          logger.warn(`Camera ${camera.id} not ready: ${result.error}`);
        }
        return result;
      });
    } finally {
      this.syncing.delete(camera.id);
    }
  }

  /** Manual re-sync from the UI. */
  async syncCamera(cameraId: string) {
    const camera = this.requireCamera(cameraId);
    if (camera.status === 'offline') throw new HttpError(409, `${camera.name} ist offline`);
    if (camera.status === 'recording' || this.isBusy(cameraId)) throw new HttpError(409, `${camera.name} ist gerade beschäftigt`);
    return this.ensureSynced(camera, true);
  }

  /** Only cameras whose scripts are synced and self-checked may capture or record. */
  private requireReady(camera: Camera) {
    if (camera.sync.state === 'ready') return;
    const reason =
      camera.sync.state === 'error'
        ? camera.sync.error
        : camera.sync.state === 'syncing'
          ? 'Skripte werden synchronisiert'
          : camera.status === 'offline'
            ? 'offline'
            : 'wird geprüft';
    throw new HttpError(409, `${camera.name} ist nicht bereit: ${reason}`);
  }

  private requireCamera(id: string): Camera {
    const camera = this.cameras.get(id);
    if (!camera) throw new HttpError(404, 'Camera not found');
    return camera;
  }

  async captureImage(cameraId: string, options: CaptureOptions = {}) {
    const camera = this.requireCamera(cameraId);
    this.requireReady(camera);
    if (camera.status === 'recording') {
      throw new HttpError(409, `${camera.name} nimmt gerade ein Video auf`);
    }

    return this.withLock(cameraId, async () => {
      const remoteFile = `${appConfig.remoteWorkDir}/kamera_${uuidv4()}.jpg`;
      const remoteThumb = `${remoteFile}.thumb.jpg`;
      const filename = `${safeName(camera.name)}_${fileTimestamp(new Date(), true)}.jpg`;
      const localFile = join(paths.photosDir, filename);

      try {
        await this.ssh.exec(target(camera), buildCaptureCommand(remoteFile, options, camera.photoRotation, remoteThumb));
        const dl = process.hrtime.bigint();
        await this.ssh.downloadFile(target(camera), remoteFile, localFile);
        metrics.downloadSeconds.observe({ camera: cameraId, kind: 'photo' }, since(dl));
        await this.downloadThumbnail(camera, remoteThumb, thumbFor(paths.photoThumbsDir, filename));
        metrics.captures.inc({ camera: cameraId, result: 'completed' });
        logger.info(`Image captured from ${cameraId}`, { file: filename });
        return { success: true, cameraId, timestamp: new Date(), file: filename, options };
      } catch (err) {
        metrics.captures.inc({ camera: cameraId, result: 'failed' });
        throw err;
      } finally {
        this.ssh.exec(target(camera), buildCommand('rm -f', [remoteFile, remoteThumb]), { allowFailure: true }).catch(() => undefined);
      }
    });
  }

  /** Previews are optional: a missing/failed thumbnail must not fail the capture. */
  private async downloadThumbnail(camera: Camera, remoteThumb: string, localThumb: string) {
    try {
      await this.ssh.downloadFile(target(camera), remoteThumb, localThumb);
    } catch (err) {
      logger.warn(`No thumbnail from ${camera.id}: ${(err as Error).message}`);
    }
  }

  async startRecording(cameraId: string, options: RecordingOptions = {}, ctx: { startAt?: number; groupId?: string } = {}) {
    const camera = this.requireCamera(cameraId);
    this.requireReady(camera);
    if (camera.status === 'recording' || this.recordings.getActiveSession(cameraId)) {
      throw new HttpError(409, `${camera.name} nimmt bereits auf`);
    }
    if (this.isBusy(cameraId)) {
      throw new HttpError(409, `${camera.name} ist gerade beschäftigt, bitte kurz warten`);
    }
    if (options.audio && !this.audio.configured) {
      throw new HttpError(400, 'Kein Mikrofon konfiguriert (AUDIO_INPUT in .env)');
    }

    const duration = options.duration ?? 5;
    const filename = `${safeName(camera.name)}_${fileTimestamp(ctx.startAt ? new Date(ctx.startAt * 1000) : new Date())}.mp4`;
    const remoteFile = `${appConfig.remoteWorkDir}/${filename}`;
    const remoteThumb = `${remoteFile}.thumb.jpg`;
    const localFile = join(paths.videosDir, filename);
    const session = this.recordings.startSession(cameraId, camera.name, duration, filename, remoteFile, {
      startTime: ctx.startAt ? new Date(ctx.startAt * 1000) : undefined,
      audio: options.audio,
      groupId: ctx.groupId
    });
    camera.status = 'recording';

    void this.runRecording(camera, session, { ...options, duration }, { remoteFile, remoteThumb, localFile, startAt: ctx.startAt });

    logger.info(`Recording started on ${cameraId}`, { sessionId: session.id, file: filename, duration, audio: !!options.audio });
    return { success: true, sessionId: session.id, cameraId, cameraName: camera.name, videoFilename: filename, duration };
  }

  /** Background part of a recording: record on the Pi, download, then add audio. */
  private async runRecording(
    camera: Camera,
    session: RecordingSession,
    options: RecordingOptions,
    f: { remoteFile: string; remoteThumb: string; localFile: string; startAt?: number }
  ) {
    let audio: AudioHandle | null = null;
    let videoStartedAt: number | null = null; // manager clock
    let ok = false;

    // Holds the camera lock until the video is on the manager.
    await this.withLock(camera.id, async () => {
      try {
        if (options.audio) {
          try {
            audio = await this.audio.acquire();
          } catch (err) {
            this.recordings.update(session.id, { warning: (err as Error).message });
          }
        }

        // Clock offset Pi - manager, so start time and audio line up regardless of NTP.
        let offset = 0;
        try {
          offset = (await this.ssh.measureClockOffset(target(camera))).offset;
        } catch (err) {
          logger.warn(`Clock offset for ${camera.id} unknown: ${(err as Error).message}`);
        }
        const remoteStartAt = f.startAt !== undefined ? f.startAt + offset : undefined;

        const result = await this.ssh.exec(
          target(camera),
          buildRecordCommand(f.remoteFile, options, camera.videoRotation, f.remoteThumb, remoteStartAt)
        );
        const remoteStarted = parseStartedAt(result.stdout);
        if (remoteStarted !== null) {
          videoStartedAt = remoteStarted - offset;
          if (f.startAt !== undefined) {
            this.recordings.update(session.id, { startOffsetMs: Math.round((videoStartedAt - f.startAt) * 1000) });
          }
        }

        const dl = process.hrtime.bigint();
        await this.ssh.downloadFile(target(camera), f.remoteFile, f.localFile);
        metrics.downloadSeconds.observe({ camera: camera.id, kind: 'video' }, since(dl));
        await this.downloadThumbnail(camera, f.remoteThumb, thumbFor(paths.videoThumbsDir, session.filename));
        ok = true;
      } catch (err) {
        metrics.recordings.inc({ camera: camera.id, result: 'failed' });
        this.recordings.failSession(session.id, (err as Error).message);
      } finally {
        camera.status = 'online';
        this.ssh.exec(target(camera), buildCommand('rm -f', [f.remoteFile, f.remoteThumb]), { allowFailure: true }).catch(() => undefined);
      }
    });

    // Post-processing runs after the camera is free again (pure manager-side work):
    // constant frame rate for video editors (Kdenlive etc.), rotation flag, audio.
    const handle = audio as AudioHandle | null;
    try {
      if (ok) {
        if (handle && videoStartedAt === null) {
          this.recordings.update(session.id, { warning: 'Startzeit des Videos unbekannt – Ton nicht hinzugefügt' });
        }
        const withAudio = handle && videoStartedAt !== null ? { handle, videoStartedAt } : undefined;
        this.recordings.update(session.id, { status: 'processing' });
        const pp = process.hrtime.bigint();
        try {
          const r = await finalizeVideo(appConfig.ffmpegPath, appConfig.ffprobePath, f.localFile, {
            fps: options.fps ?? 30,
            rotation: camera.videoRotation,
            audio: withAudio,
            reencode: appConfig.vfrReencode ? { crf: appConfig.videoCrf, preset: appConfig.videoPreset } : null
          });
          if (r.dropped > 0) {
            this.recordings.update(session.id, {
              warning: r.reencoded
                ? `${r.dropped} Bild(er) verloren – durch Wiederholen des vorherigen Bildes ausgeglichen, Video hat konstante ${options.fps ?? 30} fps`
                : `${r.dropped} Bild(er) verloren – Video behält variable Bildrate, damit Bild und Ton synchron bleiben`
            });
          }
          metrics.postprocessSeconds.observe({ camera: camera.id, result: 'ok' }, since(pp));
          metrics.droppedFrames.inc({ camera: camera.id }, r.dropped);
          metrics.lastDroppedFrames.set({ camera: camera.id }, r.dropped);
          if (!r.cfr) metrics.vfrRecordings.inc({ camera: camera.id });
          if (r.reencoded) metrics.reencodedRecordings.inc({ camera: camera.id });
          metrics.recordedSeconds.inc({ camera: camera.id }, r.durationSeconds);
          logger.info(`Finalized ${session.filename}`, { cfr: r.cfr, reencoded: r.reencoded, dropped: r.dropped, audio: !!withAudio });
        } catch (err) {
          metrics.postprocessSeconds.observe({ camera: camera.id, result: 'failed' }, since(pp));
          logger.error(`Post-processing ${session.filename} failed`, err);
          this.recordings.update(session.id, {
            warning: `Nachbearbeitung fehlgeschlagen (${withAudio ? 'ohne Ton, ' : ''}variable Bildrate): ${(err as Error).message.slice(0, 200)}`
          });
        }
      }
      if (ok) {
        try {
          metrics.recordingBytes.observe({ camera: camera.id }, statSync(f.localFile).size);
        } catch {
          // file vanished (deleted right away) – size unknown
        }
        metrics.recordings.inc({ camera: camera.id, result: 'completed' });
        this.recordings.completeSession(session.id);
        logger.info(`Recording finished: ${session.filename}`);
      }
    } finally {
      if (handle) this.audio.release(handle);
    }
  }

  /** Start all (or the given) cameras at the same moment, a few seconds from now. */
  async startAll(request: GroupRecordingRequest): Promise<GroupRecordingResult> {
    const { cameraIds, ...options } = request;
    const ids = cameraIds?.length ? cameraIds : Array.from(this.cameras.keys());
    if (options.audio && !this.audio.configured) {
      throw new HttpError(400, 'Kein Mikrofon konfiguriert (AUDIO_INPUT in .env)');
    }

    const startAt = Date.now() / 1000 + appConfig.startLeadSeconds;
    const groupId = uuidv4();
    const result: GroupRecordingResult = { groupId, startAt: new Date(startAt * 1000).toISOString(), started: [], skipped: [] };

    for (const id of ids) {
      const camera = this.cameras.get(id);
      if (!camera) {
        result.skipped.push({ cameraId: id, cameraName: id, reason: 'unbekannte Kamera' });
        continue;
      }
      if (camera.status === 'offline') {
        result.skipped.push({ cameraId: id, cameraName: camera.name, reason: 'offline' });
        continue;
      }
      try {
        const r = await this.startRecording(id, options, { startAt, groupId });
        result.started.push({ cameraId: id, cameraName: camera.name, sessionId: r.sessionId });
      } catch (err) {
        result.skipped.push({ cameraId: id, cameraName: camera.name, reason: (err as Error).message });
      }
    }

    if (result.started.length === 0) {
      throw new HttpError(409, `Keine Kamera gestartet: ${result.skipped.map(s => `${s.cameraName} (${s.reason})`).join(', ')}`);
    }
    logger.info(`Group recording ${groupId}: ${result.started.length} started, ${result.skipped.length} skipped`);
    return result;
  }

  async stopAll() {
    const active = Array.from(this.cameras.keys()).filter(id => this.recordings.getActiveSession(id));
    const results = await Promise.allSettled(active.map(id => this.stopRecording(id)));
    return {
      stopped: active.filter((_, i) => results[i].status === 'fulfilled'),
      failed: active
        .map((id, i) => ({ cameraId: id, result: results[i] }))
        .filter(r => r.result.status === 'rejected')
        .map(r => ({ cameraId: r.cameraId, reason: ((r.result as PromiseRejectedResult).reason as Error).message }))
    };
  }

  /**
   * Ask the recorder on the Pi to finish early. camera-record.py handles SIGINT by
   * closing the file cleanly; the background job then downloads it as usual.
   */
  async stopRecording(cameraId: string) {
    const camera = this.requireCamera(cameraId);
    const session = this.recordings.getActiveSession(cameraId);
    if (!session) throw new HttpError(409, `${camera.name} nimmt gerade nicht auf`);

    // "[c]amera" prevents pkill from matching the shell running this command.
    const pattern = `[c]amera-record.py --output ${session.remoteFile}`;
    const result = await this.ssh.exec(target(camera), buildCommand('pkill -INT -f', [pattern]), { allowFailure: true });
    if (result.code !== 0) {
      throw new HttpError(409, 'Kein laufender Aufnahmeprozess auf der Kamera gefunden');
    }
    this.recordings.markStopping(session.id);
    logger.info(`Stop requested for recording ${session.id} on ${cameraId}`);
    return { success: true, cameraId, sessionId: session.id };
  }

  getRecordingSessions(): RecordingSession[] {
    return this.recordings.getAllSessions();
  }

  getRecordingProgress(sessionId: string): RecordingSession | null {
    return this.recordings.getSession(sessionId);
  }

  async updateRotation(cameraId: string, photoRotation?: Rotation, videoRotation?: Rotation) {
    const camera = this.requireCamera(cameraId);

    const config = JSON.parse(readFileSync(paths.devicesFile, 'utf-8'));
    const entry = (config.cameras ?? []).find((c: { id: string }) => c.id === cameraId);
    if (!entry) throw new HttpError(404, 'Camera not found in devices.json');

    if (photoRotation !== undefined) entry.photoRotation = photoRotation;
    if (videoRotation !== undefined) entry.videoRotation = videoRotation;
    delete entry.rotation;

    // Atomic write: write temp file, then rename.
    const tmp = `${paths.devicesFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
    renameSync(tmp, paths.devicesFile);

    if (photoRotation !== undefined) camera.photoRotation = photoRotation;
    if (videoRotation !== undefined) camera.videoRotation = videoRotation;
    logger.info(`Rotation updated for ${cameraId}`, { photoRotation, videoRotation });

    return { success: true, cameraId, camera };
  }
}
