import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { logger } from './utils/logger.js';
import { appConfig, paths } from './config.js';
import { basicAuth } from './middleware/auth.js';
import { HttpError } from './validation.js';
import { cameraRouter, sessionsRouter } from './routes/cameras.js';
import { scheduleRouter } from './routes/schedules.js';
import { systemRouter } from './routes/system.js';
import { createMediaRouter } from './routes/media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/backend -> ../../public  and  dist/backend -> ../../public
export const PUBLIC_DIR = process.env.PUBLIC_DIR || path.resolve(__dirname, '../../public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Health check stays unauthenticated for Docker's healthcheck.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(basicAuth(appConfig.auth.user, appConfig.auth.password));

  // Frontend is served from this origin, so CORS is only needed for explicitly listed origins.
  if (appConfig.corsOrigins.length) {
    app.use(cors({ origin: appConfig.corsOrigins }));
  }
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', (req, _res, next) => {
    logger.debug(`${req.method} ${req.originalUrl}`);
    next();
  });

  app.use('/api/cameras', cameraRouter);
  app.use('/api/schedules', scheduleRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/videos/sessions', sessionsRouter);
  app.use('/api/videos', createMediaRouter(paths.videosDir, ['.mp4'], '/api/videos', paths.videoThumbsDir));
  app.use('/api/photos', createMediaRouter(paths.photosDir, ['.jpg', '.jpeg', '.png'], '/api/photos', paths.photoThumbsDir));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Frontend (SPA)
  if (existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
    app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  }

  // Error handler
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    // HttpError and body-parser errors carry a status; everything else is a 500.
    const status = err instanceof HttpError ? err.status : (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    if (status >= 500) logger.error(`${req.method} ${req.originalUrl} failed`, err);
    else logger.warn(`${req.method} ${req.originalUrl}: ${status} ${message}`);
    res.status(status).json({ error: message });
  });

  return app;
}
