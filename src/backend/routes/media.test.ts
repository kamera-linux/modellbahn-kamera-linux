import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createMediaRouter, timestampFromFilename } from './media.js';
import { HttpError } from '../validation.js';

let dir: string;
let thumbs: string;
let app: express.Express;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'media-'));
  writeFileSync(join(dir, 'Cam_2026-05-15T17-14-02.mp4'), 'video');
  writeFileSync(join(dir, 'Cam_2026-05-15T18-00-00.mp4'), 'newer');
  writeFileSync(join(dir, 'notes.txt'), 'ignored');
  thumbs = join(dir, 'thumbs');
  mkdirSync(thumbs);
  writeFileSync(join(thumbs, 'Cam_2026-05-15T18-00-00.mp4.jpg'), 'thumb');
  app = express();
  app.use('/api/videos', createMediaRouter(dir, ['.mp4'], '/api/videos', thumbs));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: (err as Error).message });
  });
});

describe('timestampFromFilename', () => {
  it('parses both formats', () => {
    expect(timestampFromFilename('Kamerawagen-1_2026-05-15T17-14-02.mp4')).toBe('2026-05-15T17:14:02.000Z');
    expect(timestampFromFilename('Kamerawagen-1_2026-05-15T12-11-39-818.jpg')).toBe('2026-05-15T12:11:39.818Z');
    expect(timestampFromFilename('foo.jpg')).toBeNull();
  });
});

describe('media router', () => {
  it('lists only matching files, newest first', async () => {
    const res = await request(app).get('/api/videos').expect(200);
    expect(res.body.map((f: { filename: string }) => f.filename)).toEqual([
      'Cam_2026-05-15T18-00-00.mp4',
      'Cam_2026-05-15T17-14-02.mp4'
    ]);
  });

  it('includes view and thumbnail URLs only when a thumbnail exists', async () => {
    const res = await request(app).get('/api/videos').expect(200);
    const [newer, older] = res.body;
    expect(newer.viewUrl).toBe('/api/videos/view/Cam_2026-05-15T18-00-00.mp4');
    expect(newer.thumbnailUrl).toBe('/api/videos/thumb/Cam_2026-05-15T18-00-00.mp4');
    expect(older.thumbnailUrl).toBeUndefined();
  });

  it('serves thumbnails as JPEG and 404s when missing', async () => {
    const res = await request(app).get('/api/videos/thumb/Cam_2026-05-15T18-00-00.mp4').expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    await request(app).get('/api/videos/thumb/Cam_2026-05-15T17-14-02.mp4').expect(404);
    await request(app).get('/api/videos/thumb/..%2Fnotes.txt').expect(400);
  });

  it('serves files inline with range support', async () => {
    const res = await request(app).get('/api/videos/view/Cam_2026-05-15T17-14-02.mp4').set('Range', 'bytes=1-3').expect(206);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body.toString()).toBe('ide');
  });

  it('downloads a file', async () => {
    const res = await request(app).get('/api/videos/download/Cam_2026-05-15T17-14-02.mp4').expect(200);
    expect(res.body.toString()).toBe('video');
  });

  it('blocks traversal and wrong extensions', async () => {
    await request(app).get('/api/videos/download/..%2F..%2Fetc%2Fpasswd').expect(400);
    await request(app).get('/api/videos/download/notes.txt').expect(400);
    await request(app).delete('/api/videos/notes.txt').expect(400);
  });

  it('deletes a file and 404s afterwards', async () => {
    await request(app).delete('/api/videos/Cam_2026-05-15T18-00-00.mp4').expect(200);
    expect(existsSync(join(dir, 'Cam_2026-05-15T18-00-00.mp4'))).toBe(false);
    expect(existsSync(join(thumbs, 'Cam_2026-05-15T18-00-00.mp4.jpg'))).toBe(false);
    await request(app).delete('/api/videos/Cam_2026-05-15T18-00-00.mp4').expect(404);
  });
});
