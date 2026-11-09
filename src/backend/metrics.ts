import { createServer, type Server } from 'http';
import { readdir, stat, statfs } from 'fs/promises';
import { join } from 'path';
import type { RequestHandler } from 'express';
import client from 'prom-client';
import type { Camera } from '../shared/types.js';

/**
 * Prometheus metrics. Served on a separate port (METRICS_PORT) that is only reachable
 * inside the Docker network, so the web login does not apply and nothing is exposed
 * on the host.
 */
export const register = new client.Registry();
client.collectDefaultMetrics({ register });

const MB = 1024 * 1024;

export const metrics = {
  recordings: new client.Counter({
    name: 'modellbahn_recordings_total',
    help: 'Finished recordings by camera and result (completed | failed)',
    labelNames: ['camera', 'result'] as const,
    registers: [register]
  }),
  droppedFrames: new client.Counter({
    name: 'modellbahn_recording_dropped_frames_total',
    help: 'Frames lost during recording (gaps in the video timestamps)',
    labelNames: ['camera'] as const,
    registers: [register]
  }),
  lastDroppedFrames: new client.Gauge({
    name: 'modellbahn_recording_last_dropped_frames',
    help: 'Lost frames in the most recent recording of a camera',
    labelNames: ['camera'] as const,
    registers: [register]
  }),
  vfrRecordings: new client.Counter({
    name: 'modellbahn_recordings_vfr_total',
    help: 'Recordings that kept a variable frame rate because frames were lost',
    labelNames: ['camera'] as const,
    registers: [register]
  }),
  recordedSeconds: new client.Counter({
    name: 'modellbahn_recorded_seconds_total',
    help: 'Seconds of video recorded',
    labelNames: ['camera'] as const,
    registers: [register]
  }),
  recordingBytes: new client.Histogram({
    name: 'modellbahn_recording_file_bytes',
    help: 'Size of finished video files',
    labelNames: ['camera'] as const,
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000].map(n => n * MB),
    registers: [register]
  }),
  downloadSeconds: new client.Histogram({
    name: 'modellbahn_download_seconds',
    help: 'Time to copy a photo or video from the Pi to the manager',
    labelNames: ['camera', 'kind'] as const,
    buckets: [0.5, 1, 2, 5, 10, 20, 40, 60, 120, 240, 480],
    registers: [register]
  }),
  postprocessSeconds: new client.Histogram({
    name: 'modellbahn_postprocess_seconds',
    help: 'Time for post-processing a video (constant frame rate, audio)',
    labelNames: ['camera', 'result'] as const,
    buckets: [0.5, 1, 2, 5, 10, 20, 40, 60, 120],
    registers: [register]
  }),
  captures: new client.Counter({
    name: 'modellbahn_captures_total',
    help: 'Photos by camera and result (completed | failed)',
    labelNames: ['camera', 'result'] as const,
    registers: [register]
  }),
  sshCommandSeconds: new client.Histogram({
    name: 'modellbahn_ssh_command_seconds',
    help: 'Duration of SSH commands by camera and outcome (ok | failed | timeout | connection)',
    labelNames: ['camera', 'outcome'] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300],
    registers: [register]
  }),
  statusCheckSeconds: new client.Gauge({
    name: 'modellbahn_camera_status_check_seconds',
    help: 'Round trip of the last SSH status check (only set when it succeeded)',
    labelNames: ['camera'] as const,
    registers: [register]
  }),
  statusChecks: new client.Counter({
    name: 'modellbahn_camera_status_checks_total',
    help: 'SSH status checks by camera and result (ok | failed)',
    labelNames: ['camera', 'result'] as const,
    registers: [register]
  }),
  httpRequests: new client.Histogram({
    name: 'modellbahn_http_request_seconds',
    help: 'API requests by area, method and status code',
    labelNames: ['area', 'method', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15, 30],
    registers: [register]
  })
};

/**
 * Create the per-camera series with 0 right away. Otherwise a counter first appears
 * with value 1 and Prometheus' increase() misses that first event.
 */
export function initCameraMetrics(cameraIds: string[]) {
  for (const camera of cameraIds) {
    for (const result of ['completed', 'failed']) {
      metrics.recordings.inc({ camera, result }, 0);
      metrics.captures.inc({ camera, result }, 0);
    }
    metrics.droppedFrames.inc({ camera }, 0);
    metrics.vfrRecordings.inc({ camera }, 0);
    metrics.recordedSeconds.inc({ camera }, 0);
    metrics.recordingBytes.zero({ camera });
    for (const kind of ['photo', 'video']) metrics.downloadSeconds.zero({ camera, kind });
    for (const result of ['ok', 'failed']) metrics.postprocessSeconds.zero({ camera, result });
    for (const outcome of ['ok', 'failed', 'timeout', 'connection']) metrics.sshCommandSeconds.zero({ camera, outcome });
  }
}

/** Seconds since `start` (from process.hrtime.bigint()). */
export const since = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e9;

/** Live state that is read at scrape time instead of being updated on every change. */
export interface MetricsSource {
  cameras: () => Camera[];
  activeRecordings: () => number;
  dirs: { videos: string; photos: string; data: string };
}

async function dirUsage(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.includes('.tmp')) continue;
      bytes += (await stat(join(dir, e.name))).size;
      files++;
    }
  } catch {
    // directory missing: report 0
  }
  return { bytes, files };
}

export function registerStateMetrics(src: MetricsSource) {
  const cameraGauge = (name: string, help: string, value: (c: Camera) => number | undefined) =>
    new client.Gauge({
      name,
      help,
      labelNames: ['camera', 'name'] as const,
      registers: [register],
      collect() {
        this.reset();
        for (const c of src.cameras()) {
          const v = value(c);
          if (v !== undefined) this.set({ camera: c.id, name: c.name }, v);
        }
      }
    });

  cameraGauge('modellbahn_camera_up', '1 if the camera car is reachable via SSH', c => (c.status === 'offline' ? 0 : 1));
  cameraGauge('modellbahn_camera_recording', '1 while the camera car is recording', c => (c.status === 'recording' ? 1 : 0));
  cameraGauge('modellbahn_camera_ready', '1 if the scripts on the Pi are synced and self-checked', c =>
    c.sync.state === 'ready' ? 1 : 0
  );
  cameraGauge('modellbahn_camera_last_seen_timestamp_seconds', 'Last successful status check (unix time)', c =>
    c.lastSeen ? new Date(c.lastSeen).getTime() / 1000 : undefined
  );

  new client.Gauge({
    name: 'modellbahn_active_recordings',
    help: 'Recordings currently running or being processed',
    registers: [register],
    collect() {
      this.set(src.activeRecordings());
    }
  });

  // prom-client collects metrics in parallel: both storage gauges share one directory
  // scan per scrape (cached briefly) instead of scanning twice.
  let scan: { at: number; result: Promise<Record<'videos' | 'photos', { bytes: number; files: number }>> } | null = null;
  const usage = () => {
    if (!scan || Date.now() - scan.at > 2000) {
      scan = {
        at: Date.now(),
        result: Promise.all([dirUsage(src.dirs.videos), dirUsage(src.dirs.photos)]).then(([videos, photos]) => ({ videos, photos }))
      };
    }
    return scan.result;
  };
  const storageGauge = (name: string, help: string, field: 'bytes' | 'files') =>
    new client.Gauge({
      name,
      help,
      labelNames: ['kind'] as const,
      registers: [register],
      async collect() {
        const u = await usage();
        this.set({ kind: 'videos' }, u.videos[field]);
        this.set({ kind: 'photos' }, u.photos[field]);
      }
    });
  storageGauge('modellbahn_storage_bytes', 'Size of stored media by kind (videos | photos)', 'bytes');
  storageGauge('modellbahn_storage_files', 'Number of stored media files by kind (videos | photos)', 'files');

  new client.Gauge({
    name: 'modellbahn_disk_bytes',
    help: 'Disk holding the data directory (free | total)',
    labelNames: ['type'] as const,
    registers: [register],
    async collect() {
      try {
        const s = await statfs(src.dirs.data);
        this.set({ type: 'free' }, s.bavail * s.bsize);
        this.set({ type: 'total' }, s.blocks * s.bsize);
      } catch {
        // not available on this platform
      }
    }
  });
}

/** Coarse area of an API path, keeps label cardinality small: /api/cameras/cam1/capture -> cameras */
export function apiArea(url: string): string {
  const m = /^\/api\/([a-z]+)/.exec(url);
  return m ? m[1] : 'frontend';
}

export const httpMetrics: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    metrics.httpRequests.observe(
      { area: apiArea(req.originalUrl), method: req.method, status: String(res.statusCode) },
      since(start)
    );
  });
  next();
};

/** Plain HTTP server for Prometheus: GET /metrics. */
export function startMetricsServer(port: number, onListening?: () => void): Server {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await register.metrics();
      res.writeHead(200, { 'Content-Type': register.contentType }).end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return server.listen(port, onListening);
}
