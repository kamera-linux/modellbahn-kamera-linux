import { config as loadEnv } from 'dotenv';
import { join, resolve } from 'path';
import { homedir } from 'os';

loadEnv();

const root = process.cwd();

export const appConfig = {
  port: parseInt(process.env.PORT || process.env.WEB_PORT || '3000', 10),
  // Link to Grafana in the web interface: full URL, or only the port (the browser then
  // uses the host name it reached the manager with). Both empty = no link.
  grafana: {
    url: process.env.GRAFANA_URL || '',
    port: parseInt(process.env.GRAFANA_PORT || '0', 10) || 0
  },
  // Prometheus endpoint (GET /metrics) on its own port, without login. 0 = off.
  // In Docker this port is only reachable inside the compose network.
  metricsPort: parseInt(process.env.METRICS_PORT ?? '9464', 10),
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
  // Working directory for recordings on the Pis, relative to the login home (SD card).
  // Not /tmp: on Debian trixie that is RAM (tmpfs, ~200 MB on a Pi Zero 2 W).
  remoteWorkDir: process.env.REMOTE_WORK_DIR || 'modellbahn-kamera-linux/tmp',
  // Local copy of the Pi scripts that is synced to every car (bundled into the Docker image)
  piScriptsDir: resolve(process.env.PI_SCRIPTS_DIR || join(root, 'scripts')),
  // Re-check interval for script versions (minutes)
  syncRecheckMinutes: parseFloat(process.env.SYNC_RECHECK_MINUTES || '10'),

  // Microphone of the machine the manager runs on, e.g. "pulse:default" or "alsa:hw:1,0".
  // Empty = no audio.
  audioInput: process.env.AUDIO_INPUT || '',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  // Recordings with lost frames: re-encode on the manager to a constant frame rate
  // (missing pictures are repeated). "off" keeps them with a variable frame rate.
  vfrReencode: (process.env.VFR_REENCODE || 'on') !== 'off',
  videoCrf: parseInt(process.env.VIDEO_CRF || '18', 10),
  videoPreset: process.env.VIDEO_PRESET || 'veryfast',
  // Lead time for a synchronised start of all cars (Python + camera init on a cold Pi Zero ~3-5 s)
  startLeadSeconds: parseFloat(process.env.START_LEAD_SECONDS || '7'),

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
  logsDir: join(appConfig.dataDir, 'logs'),
  audioTmpDir: join(appConfig.dataDir, 'audio-tmp')
};
