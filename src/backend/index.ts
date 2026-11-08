import { createApp, PUBLIC_DIR } from './app.js';
import { appConfig } from './config.js';
import { logger } from './utils/logger.js';
import { getCameraManager } from './services/CameraManagerSingleton.js';
import { getScheduleManager } from './services/ScheduleManagerSingleton.js';

if (!appConfig.auth.user || !appConfig.auth.password) {
  logger.warn('AUTH_USER/AUTH_PASSWORD not set – the web interface is accessible WITHOUT login!');
}

// Start background work (status checks, persisted schedules) right away.
getCameraManager();
getScheduleManager();

const server = createApp().listen(appConfig.port, () => {
  logger.info(`Server running on port ${appConfig.port}`);
  logger.info(`Frontend served from ${PUBLIC_DIR}`);
});

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down`);
  getScheduleManager().shutdown();
  getCameraManager().audio.shutdown();
  getCameraManager().sshManager.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
