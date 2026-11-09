import { createApp, PUBLIC_DIR } from './app.js';
import { appConfig, paths } from './config.js';
import { registerStateMetrics, startMetricsServer } from './metrics.js';
import { logger } from './utils/logger.js';
import { getCameraManager } from './services/CameraManagerSingleton.js';
import { getScheduleManager } from './services/ScheduleManagerSingleton.js';

if (!appConfig.auth.user || !appConfig.auth.password) {
  logger.warn('AUTH_USER/AUTH_PASSWORD not set – the web interface is accessible WITHOUT login!');
}

// Start background work (status checks, persisted schedules) right away.
const cameras = getCameraManager();
getScheduleManager();

registerStateMetrics({
  cameras: () => cameras.listCameras(),
  activeRecordings: () => cameras.activeRecordingCount(),
  dirs: { videos: paths.videosDir, photos: paths.photosDir, data: appConfig.dataDir }
});
const metricsServer =
  appConfig.metricsPort > 0
    ? startMetricsServer(appConfig.metricsPort, () => logger.info(`Prometheus metrics on port ${appConfig.metricsPort}/metrics`))
    : null;

const server = createApp().listen(appConfig.port, () => {
  logger.info(`Server running on port ${appConfig.port}`);
  logger.info(`Frontend served from ${PUBLIC_DIR}`);
});

const shutdown = (signal: string) => {
  logger.info(`${signal} received, shutting down`);
  getScheduleManager().shutdown();
  getCameraManager().audio.shutdown();
  getCameraManager().sshManager.closeAll();
  metricsServer?.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
