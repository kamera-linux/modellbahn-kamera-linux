import express, { Request, Response, NextFunction } from 'express';
import { readdir, unlink, stat, access } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { schemas, validate, HttpError } from '../validation.js';
import type { MediaFile } from '../../shared/types.js';

/** Extract the capture time from names like `Cam_2026-05-15T17-14-02[-818].mp4` (UTC). */
export function timestampFromFilename(filename: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?/.exec(filename);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] ?? '000'}Z`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

const exists = (p: string) => access(p).then(() => true, () => false);

/**
 * Router for a directory of media files: list, view (inline), download, thumbnail, delete.
 * Mounted at e.g. /api/photos with dir=data/photos and thumbsDir=data/thumbnails/photos.
 */
export function createMediaRouter(dir: string, extensions: string[], urlBase: string, thumbsDir: string) {
  const router = express.Router();
  const thumbPath = (filename: string) => join(thumbsDir, `${filename}.jpg`);

  const resolveFile = (raw: string): { filename: string; path: string } => {
    const filename = validate<string>(schemas.mediaFilename, raw);
    if (!extensions.some(ext => filename.toLowerCase().endsWith(ext))) {
      throw new HttpError(400, 'Invalid file type');
    }
    return { filename, path: join(dir, filename) };
  };

  router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const names = (await readdir(dir)).filter(f => extensions.some(ext => f.toLowerCase().endsWith(ext)));
      const files = await Promise.all(
        names.map(async (filename): Promise<MediaFile | null> => {
          try {
            const s = await stat(join(dir, filename));
            const name = encodeURIComponent(filename);
            return {
              filename,
              size: s.size,
              created: timestampFromFilename(filename) ?? s.mtime.toISOString(),
              url: `${urlBase}/download/${name}`,
              viewUrl: `${urlBase}/view/${name}`,
              thumbnailUrl: (await exists(thumbPath(filename))) ? `${urlBase}/thumb/${name}` : undefined
            };
          } catch {
            return null;
          }
        })
      );
      const list = files.filter((f): f is MediaFile => f !== null).sort((a, b) => b.created.localeCompare(a.created));
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  router.get('/download/:filename', (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = resolveFile(req.params.filename);
      // res.download supports HTTP Range requests, so videos can be streamed/seeked.
      res.download(file.path, file.filename, err => {
        if (err && !res.headersSent) {
          res.status((err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500).json({ error: 'Download failed' });
        }
      });
    } catch (err) {
      next(err);
    }
  });

  // Inline (for <img>/<video>); sendFile supports Range requests for seeking in videos.
  router.get('/view/:filename', (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = resolveFile(req.params.filename);
      res.sendFile(file.path, { maxAge: '1h' }, err => {
        if (err && !res.headersSent) next(new HttpError((err as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500, 'File not found'));
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/thumb/:filename', (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = resolveFile(req.params.filename);
      res.sendFile(thumbPath(file.filename), { maxAge: '1d', headers: { 'Content-Type': 'image/jpeg' } }, err => {
        if (err && !res.headersSent) next(new HttpError(404, 'No thumbnail'));
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:filename', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = resolveFile(req.params.filename);
      await unlink(file.path);
      await unlink(thumbPath(file.filename)).catch(() => undefined);
      logger.info(`Deleted ${file.path}`);
      res.json({ success: true, deleted: file.filename });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return next(new HttpError(404, 'File not found'));
      next(err);
    }
  });

  return router;
}
