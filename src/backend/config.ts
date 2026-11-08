import { config as loadEnv } from 'dotenv';
import { join, resolve } from 'path';
import { homedir } from 'os';

loadEnv();

const root = process.cwd();

export const appConfig = {
  port: parseInt(process.env.PORT || process.env.WEB_PORT || '3000', 10),
  configDir: resolve(process.env.CONFIG_DIR || join(root, 'config')),
  dataDir: resolve(process.env.DATA_DIR || join(root, 'data')),
  logLevel: process.env.LOG_LEVEL || 'info',

  ssh: {
    keyPath: process.env.SSH_KEY_PATH || join(homedir(), '.ssh', 'id_ed25519'),
    timeoutMs: parseInt(process.env.SSH_TIMEOUT || '30000', 10),
    statusTimeoutMs: parseInt(process.env.SSH_STATUS_TIMEOUT || '5000', 10),
    // Trust-on-first-use: host keys are pinned in data/known_hosts.json.
    // Set SSH_HOST_KEY_CHECK=off to disable (not recommended).
    hostKeyCheck: (process.env.SSH_HOST_KEY_CHECK || 'tofu') as 'tofu' | 'off'
  },

  // Directory on the Pis that contains camera-capture.py / camera-record.py
  remoteScriptDir: process.env.REMOTE_SCRIPT_DIR || '~/modellbahn-kamera-linux/scripts',

  auth: {
    user: process.env.AUTH_USER || '',
    password: process.env.AUTH_PASSWORD || ''
  },

  // Comma-separated list of allowed origins for cross-origin requests.
  // Empty = same-origin only (the frontend is served by this server).
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
};

/** Preview image for a media file: <thumbsDir>/<filename>.jpg */
export const thumbFor = (thumbsDir: string, filename: string) => join(thumbsDir, `${filename}.jpg`);

export const paths = {
  devicesFile: join(appConfig.configDir, 'devices.json'),
  schedulesFile: join(appConfig.dataDir, 'schedules.json'),
  knownHostsFile: join(appConfig.dataDir, 'known_hosts.json'),
  videosDir: join(appConfig.dataDir, 'videos'),
  photosDir: join(appConfig.dataDir, 'photos'),
  photoThumbsDir: join(appConfig.dataDir, 'thumbnails', 'photos'),
  videoThumbsDir: join(appConfig.dataDir, 'thumbnails', 'videos'),
  logsDir: join(appConfig.dataDir, 'logs')
};
