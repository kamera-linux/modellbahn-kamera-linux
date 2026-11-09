import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { apiArea, initCameraMetrics, metrics, registerStateMetrics, startMetricsServer } from './metrics.js';
import type { Camera } from '../shared/types.js';

const cam = (id: string, status: Camera['status'], ready: boolean): Camera => ({
  id,
  name: `Wagen ${id}`,
  host: '10.0.0.1',
  port: 22,
  user: 'pi',
  status,
  lastSeen: status === 'offline' ? undefined : new Date(1_700_000_000_000),
  photoRotation: 0,
  videoRotation: 0,
  sync: { state: ready ? 'ready' : 'unknown' }
});

describe('apiArea', () => {
  it('keeps only the first API segment', () => {
    expect(apiArea('/api/cameras/cam1/capture')).toBe('cameras');
    expect(apiArea('/api/videos/view/x.mp4?t=1')).toBe('videos');
    expect(apiArea('/index.html')).toBe('frontend');
  });
});

describe('metrics endpoint', () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'metrics-'));
    mkdirSync(join(dir, 'videos'));
    mkdirSync(join(dir, 'photos'));
    writeFileSync(join(dir, 'videos', 'a.mp4'), Buffer.alloc(1000));
    writeFileSync(join(dir, 'videos', 'b.final.tmp.mp4'), Buffer.alloc(500)); // ignored
    writeFileSync(join(dir, 'photos', 'p.jpg'), Buffer.alloc(200));

    registerStateMetrics({
      cameras: () => [cam('cam1', 'recording', true), cam('cam2', 'offline', false)],
      activeRecordings: () => 1,
      dirs: { videos: join(dir, 'videos'), photos: join(dir, 'photos'), data: dir }
    });
    initCameraMetrics(['cam1', 'cam2']);
    metrics.droppedFrames.inc({ camera: 'cam1' }, 5);

    server = startMetricsServer(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves camera state, recordings and storage in Prometheus format', async () => {
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();

    expect(body).toContain('modellbahn_camera_up{camera="cam1",name="Wagen cam1"} 1');
    expect(body).toContain('modellbahn_camera_up{camera="cam2",name="Wagen cam2"} 0');
    expect(body).toContain('modellbahn_camera_recording{camera="cam1",name="Wagen cam1"} 1');
    expect(body).toContain('modellbahn_camera_ready{camera="cam2",name="Wagen cam2"} 0');
    expect(body).toContain('modellbahn_camera_last_seen_timestamp_seconds{camera="cam1",name="Wagen cam1"} 1700000000');
    expect(body).not.toContain('modellbahn_camera_last_seen_timestamp_seconds{camera="cam2"');
    expect(body).toContain('modellbahn_active_recordings 1');
    expect(body).toContain('modellbahn_recording_dropped_frames_total{camera="cam1"} 5');
    // pre-created with 0 so increase() also counts the first failure
    expect(body).toContain('modellbahn_recordings_total{camera="cam2",result="failed"} 0');
    expect(body).toContain('modellbahn_download_seconds_count{camera="cam2",kind="video"} 0');
    expect(body).toContain('modellbahn_storage_bytes{kind="videos"} 1000');
    expect(body).toContain('modellbahn_storage_files{kind="photos"} 1');
    expect(body).toMatch(/modellbahn_disk_bytes\{type="free"\} \d+/);
    expect(body).toContain('process_cpu_seconds_total');
  });

  it('answers 404 for other paths', async () => {
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});
