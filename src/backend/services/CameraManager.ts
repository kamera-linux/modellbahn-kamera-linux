import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { SSHManager, SSHTarget } from './SSHManager.js';
import { RecordingManager } from './RecordingManager.js';
import { logger } from '../utils/logger.js';
import { buildCommand } from '../utils/shell.js';
import { appConfig, paths, thumbFor } from '../config.js';
import { HttpError } from '../validation.js';
import type { Camera, CaptureOptions, RecordingOptions, RecordingSession, Rotation } from '../../shared/types.js';

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

export function buildRecordCommand(remoteFile: string, options: RecordingOptions, rotation: Rotation, thumbFile?: string): string {
  const duration = options.duration ?? 5;
  const timeoutSeconds = duration + 60;
  return buildCommand(`exec timeout -k 10 ${timeoutSeconds} python3 ${appConfig.remoteScriptDir}/camera-record.py`, [
    '--output', remoteFile,
    '--duration', duration,
    ...(thumbFile ? ['--thumbnail', thumbFile] : []),
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

  constructor() {
    mkdirSync(paths.videosDir, { recursive: true });
    mkdirSync(paths.photosDir, { recursive: true });
    mkdirSync(paths.photoThumbsDir, { recursive: true });
    mkdirSync(paths.videoThumbsDir, { recursive: true });
    this.loadCameras();
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
          videoRotation: toRotation(cam.videoRotation ?? cam.rotation)
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
          const result = await this.ssh.testConnection(target(camera), appConfig.ssh.statusTimeoutMs);
          if (result.success) {
            if (camera.status !== 'recording') camera.status = 'online';
            camera.lastSeen = new Date();
          } else if (camera.status !== 'recording') {
            camera.status = 'offline';
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

  getCamera(id: string): Camera | null {
    return this.cameras.get(id) ?? null;
  }

  private requireCamera(id: string): Camera {
    const camera = this.cameras.get(id);
    if (!camera) throw new HttpError(404, 'Camera not found');
    return camera;
  }

  async captureImage(cameraId: string, options: CaptureOptions = {}) {
    const camera = this.requireCamera(cameraId);
    if (camera.status === 'recording') {
      throw new HttpError(409, `${camera.name} nimmt gerade ein Video auf`);
    }

    return this.withLock(cameraId, async () => {
      const remoteFile = `/tmp/kamera_${uuidv4()}.jpg`;
      const remoteThumb = `${remoteFile}.thumb.jpg`;
      const filename = `${safeName(camera.name)}_${fileTimestamp(new Date(), true)}.jpg`;
      const localFile = join(paths.photosDir, filename);

      try {
        await this.ssh.exec(target(camera), buildCaptureCommand(remoteFile, options, camera.photoRotation, remoteThumb));
        await this.ssh.downloadFile(target(camera), remoteFile, localFile);
        await this.downloadThumbnail(camera, remoteThumb, thumbFor(paths.photoThumbsDir, filename));
        logger.info(`Image captured from ${cameraId}`, { file: filename });
        return { success: true, cameraId, timestamp: new Date(), file: filename, options };
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

  async startRecording(cameraId: string, options: RecordingOptions = {}) {
    const camera = this.requireCamera(cameraId);
    if (camera.status === 'recording' || this.recordings.getActiveSession(cameraId)) {
      throw new HttpError(409, `${camera.name} nimmt bereits auf`);
    }
    if (this.isBusy(cameraId)) {
      throw new HttpError(409, `${camera.name} ist gerade beschäftigt, bitte kurz warten`);
    }

    const duration = options.duration ?? 5;
    const filename = `${safeName(camera.name)}_${fileTimestamp()}.mp4`;
    const remoteFile = `/tmp/${filename}`;
    const remoteThumb = `${remoteFile}.thumb.jpg`;
    const localFile = join(paths.videosDir, filename);
    const session = this.recordings.startSession(cameraId, camera.name, duration, filename, remoteFile);
    camera.status = 'recording';

    // Runs in the background and holds the camera lock until the video is downloaded.
    void this.withLock(cameraId, async () => {
      try {
        await this.ssh.exec(target(camera), buildRecordCommand(remoteFile, { ...options, duration }, camera.videoRotation, remoteThumb));
        await this.ssh.downloadFile(target(camera), remoteFile, localFile);
        await this.downloadThumbnail(camera, remoteThumb, thumbFor(paths.videoThumbsDir, filename));
        this.recordings.completeSession(session.id);
        logger.info(`Recording finished: ${filename}`);
      } catch (err) {
        this.recordings.failSession(session.id, (err as Error).message);
      } finally {
        camera.status = 'online';
        this.ssh.exec(target(camera), buildCommand('rm -f', [remoteFile, remoteThumb]), { allowFailure: true }).catch(() => undefined);
      }
    });

    logger.info(`Recording started on ${cameraId}`, { sessionId: session.id, file: filename, duration });
    return { success: true, sessionId: session.id, cameraId, cameraName: camera.name, videoFilename: filename, duration };
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
