import express from 'express';
import { getCameraManager } from '../services/CameraManagerSingleton.js';
import { logger } from '../utils/logger.js';
import { appConfig } from '../config.js';
import { HttpError } from '../validation.js';
import type { DiagnosticResult } from '../../shared/types.js';

export const systemRouter = express.Router();

/** Static facts for the web interface (Grafana link). */
systemRouter.get('/info', (_req, res) => {
  const { url, port } = appConfig.grafana;
  res.json({ grafana: url || port ? { url: url || undefined, port: port || undefined, dashboard: '/d/modellbahn-kamera' } : null });
});

systemRouter.get('/status', (_req, res) => {
  const manager = getCameraManager();
  res.json({ ...manager.sshManager.getStatus(), scriptVersion: manager.scripts.version });
});

// Microphone of the manager host (AUDIO_INPUT)
systemRouter.get('/audio', (_req, res) => {
  res.json(getCameraManager().audio.status());
});

systemRouter.post('/audio/test', async (_req, res, next) => {
  try {
    res.json(await getCameraManager().audio.test(1));
  } catch (err) {
    next(err);
  }
});

systemRouter.get('/devices', (_req, res) => {
  res.json(getCameraManager().sshManager.getConnectedDevices());
});

function recommendationsFor(error: string, user: string, host: string, port: number): string[] {
  const keyHint = appConfig.ssh.keyPath;
  if (/EHOSTUNREACH|No route|ENETUNREACH/.test(error)) {
    return [
      '❌ Host ist nicht erreichbar – IP-Adresse und Netzwerk prüfen',
      `💡 Prüfe: ping ${host}`,
      '💡 Ist der Pi eingeschaltet und im gleichen Netz?'
    ];
  }
  if (/ECONNREFUSED/.test(error)) {
    return [`❌ Port ${port} ist geschlossen – SSH läuft nicht`, '💡 Auf dem Pi: sudo systemctl enable --now ssh'];
  }
  if (/authentication|All configured authentication methods failed/i.test(error)) {
    return [
      '❌ SSH-Authentifizierung fehlgeschlagen – Public Key nicht hinterlegt',
      `💡 Vom Manager aus: ssh-copy-id -i <key>.pub ${user}@${host}`,
      '💡 Auf dem Pi: chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys',
      `💡 Im Container verwendeter Key: ${keyHint}`
    ];
  }
  if (/host key|Handshake failed|verification failed/i.test(error)) {
    return [
      '❌ Host-Key passt nicht zum gespeicherten Fingerprint',
      '💡 Wurde der Pi neu installiert? Dann den Eintrag in data/known_hosts.json löschen.'
    ];
  }
  if (/Timed out|timeout/i.test(error)) {
    return ['⏱️ Verbindungs-Timeout – Host antwortet nicht', `💡 Prüfe: ping -c 5 ${host}`];
  }
  if (/ENOENT/.test(error)) {
    return [`❌ SSH-Key nicht gefunden: ${keyHint}`, '💡 SSH_KEY_PATH und Volume-Mount in docker-compose.yml prüfen'];
  }
  return [];
}

// Only cameras from devices.json can be tested – no arbitrary hosts.
systemRouter.post('/cameras/:id/test', async (req, res, next) => {
  try {
    const manager = getCameraManager();
    const camera = manager.getCamera(req.params.id);
    if (!camera) throw new HttpError(404, 'Camera not found');

    const { host, user, port } = camera;
    logger.info(`Testing SSH connection to ${user}@${host}:${port}`);
    const result = await manager.sshManager.testConnection({ host, user, port });

    const response: DiagnosticResult = {
      cameraId: camera.id,
      host,
      user,
      port,
      success: result.success,
      error: result.error,
      message: result.success ? 'SSH-Verbindung erfolgreich' : undefined,
      timestamp: new Date().toISOString(),
      recommendations: result.success ? ['✅ SSH-Verbindung erfolgreich!'] : recommendationsFor(result.error ?? '', user, host, port)
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});
