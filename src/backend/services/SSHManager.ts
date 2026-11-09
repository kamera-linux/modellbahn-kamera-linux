import { NodeSSH } from 'node-ssh';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';
import { appConfig, paths } from '../config.js';
import { metrics, since } from '../metrics.js';

export interface SSHTarget {
  host: string;
  user: string;
  port: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const keyOf = (t: SSHTarget) => `${t.user}@${t.host}:${t.port}`;

/**
 * Short, readable error text from remote stderr: our scripts print "Error: …",
 * libcamera logs "… ERROR …"; INFO/WARN noise is dropped.
 */
export function summarizeStderr(stderr: string, stdout = ''): string {
  const lines = (stderr || stdout).split('\n').map(l => l.trim()).filter(Boolean);
  const own = lines.filter(l => /^Error:/.test(l));
  if (own.length) {
    const lib = lines.filter(l => / ERROR /.test(l)).map(l => l.replace(/^\[[^\]]*\]\s*\[\d+\]\s*ERROR\s+\S+\s+\S+\s*/, ''));
    return [...own, ...lib.slice(0, 2)].join(' – ');
  }
  const errors = lines.filter(l => / ERROR /.test(l) || /^(error|fatal)/i.test(l));
  return (errors.length ? errors : lines.filter(l => !/ (INFO|WARN|DEBUG) /.test(l)).slice(-3)).join(' – ') || 'unbekannter Fehler';
}

/** Pins SSH host keys on first contact and rejects changed keys afterwards (TOFU). */
class KnownHosts {
  private hosts: Record<string, string> = {};

  constructor(private file: string) {
    try {
      if (existsSync(file)) this.hosts = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      logger.warn(`Could not read ${file}, starting with empty known hosts`, err);
    }
  }

  verify(hostPort: string, key: Buffer): boolean {
    const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
    const known = this.hosts[hostPort];
    if (!known) {
      this.hosts[hostPort] = fingerprint;
      this.save();
      logger.info(`Pinned new host key for ${hostPort}: ${fingerprint}`);
      return true;
    }
    if (known !== fingerprint) {
      logger.error(
        `HOST KEY MISMATCH for ${hostPort}! expected ${known}, got ${fingerprint}. ` +
          `If the Pi was reinstalled, remove its entry from ${this.file}.`
      );
      return false;
    }
    return true;
  }

  private save() {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.hosts, null, 2));
    } catch (err) {
      logger.warn(`Could not persist known hosts to ${this.file}`, err);
    }
  }
}

export class SSHManager {
  private connections = new Map<string, NodeSSH>();
  private pending = new Map<string, Promise<NodeSSH>>();
  private knownHosts = new KnownHosts(paths.knownHostsFile);
  private privateKey: string | null = null;
  /** Metric label for a target; CameraManager maps it to the camera id. */
  labelFor: (target: SSHTarget) => string = t => t.host;

  private loadKey(): string {
    if (this.privateKey === null) {
      this.privateKey = readFileSync(appConfig.ssh.keyPath, 'utf8');
    }
    return this.privateKey;
  }

  private async getConnection(target: SSHTarget, readyTimeout = appConfig.ssh.timeoutMs): Promise<NodeSSH> {
    const key = keyOf(target);
    const existing = this.connections.get(key);
    if (existing?.isConnected()) return existing;

    // Avoid opening several connections in parallel for the same target.
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const connect = (async () => {
      const ssh = new NodeSSH();
      const hostPort = `${target.host}:${target.port}`;
      logger.debug(`SSH connecting to ${key}`);
      await ssh.connect({
        host: target.host,
        username: target.user,
        port: target.port,
        privateKey: this.loadKey(),
        readyTimeout,
        tryKeyboard: false,
        keepaliveInterval: 15000,
        ...(appConfig.ssh.hostKeyCheck === 'tofu'
          ? { hostVerifier: (hostKey: Buffer) => this.knownHosts.verify(hostPort, hostKey) }
          : {})
      } as Parameters<NodeSSH['connect']>[0]);
      this.connections.set(key, ssh);
      logger.info(`SSH connected to ${key}`);
      return ssh;
    })();

    this.pending.set(key, connect);
    try {
      return await connect;
    } finally {
      this.pending.delete(key);
    }
  }

  private drop(target: SSHTarget) {
    const key = keyOf(target);
    this.connections.get(key)?.dispose();
    this.connections.delete(key);
  }

  /** Run a command; rejects if the exit code is non-zero (unless allowFailure). */
  async exec(
    target: SSHTarget,
    command: string,
    opts: { allowFailure?: boolean; readyTimeout?: number } = {}
  ): Promise<ExecResult> {
    const start = process.hrtime.bigint();
    const observe = (outcome: 'ok' | 'failed' | 'timeout' | 'connection') =>
      metrics.sshCommandSeconds.observe({ camera: this.labelFor(target), outcome }, since(start));
    try {
      const conn = await this.getConnection(target, opts.readyTimeout);
      const result = await conn.execCommand(command);
      observe(result.code === 0 ? 'ok' : result.code === 124 ? 'timeout' : 'failed');
      if (result.code !== 0 && !opts.allowFailure) {
        const reason = result.code === 124 ? 'Zeitüberschreitung' : summarizeStderr(result.stderr, result.stdout);
        throw new Error(`Command failed (exit ${result.code}): ${reason}`);
      }
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    } catch (err) {
      // Connection-level errors: drop the cached connection so the next call reconnects.
      if (!(err instanceof Error && err.message.startsWith('Command failed'))) {
        observe('connection');
        this.drop(target);
      }
      throw err;
    }
  }

  /**
   * Clock offset of the remote host in seconds (remote - local), estimated like NTP:
   * the remote timestamp is compared with the midpoint of the round trip. The sample
   * with the shortest round trip wins.
   */
  async measureClockOffset(target: SSHTarget, samples = 3): Promise<{ offset: number; rtt: number }> {
    let best = { offset: 0, rtt: Infinity };
    for (let i = 0; i < samples; i++) {
      const t1 = Date.now() / 1000;
      const { stdout } = await this.exec(target, 'date +%s.%N');
      const t2 = Date.now() / 1000;
      const remote = parseFloat(stdout.trim());
      if (!Number.isFinite(remote)) throw new Error(`Unexpected date output: ${stdout}`);
      const rtt = t2 - t1;
      if (rtt < best.rtt) best = { offset: remote - (t1 + t2) / 2, rtt };
    }
    return best;
  }

  async downloadFile(target: SSHTarget, remoteFile: string, localFile: string): Promise<void> {
    try {
      const conn = await this.getConnection(target);
      await conn.getFile(localFile, remoteFile);
      logger.info(`Downloaded ${keyOf(target)}:${remoteFile} -> ${localFile}`);
    } catch (err) {
      this.drop(target);
      throw err;
    }
  }

  async putFile(target: SSHTarget, localFile: string, remoteFile: string): Promise<void> {
    try {
      const conn = await this.getConnection(target);
      await conn.putFile(localFile, remoteFile);
    } catch (err) {
      this.drop(target);
      throw err;
    }
  }

  async testConnection(target: SSHTarget, readyTimeout = appConfig.ssh.timeoutMs): Promise<{ success: boolean; error?: string }> {
    try {
      await this.exec(target, 'true', { readyTimeout });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  getConnectedDevices() {
    return Array.from(this.connections.entries()).map(([key, conn]) => {
      const [user, hostPort] = key.split('@');
      const [host, port] = hostPort.split(':');
      return { host, user, port: parseInt(port, 10), connected: conn.isConnected() };
    });
  }

  getStatus() {
    return {
      timestamp: new Date(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      connections: this.connections.size
    };
  }

  closeAll() {
    for (const conn of this.connections.values()) conn.dispose();
    this.connections.clear();
  }
}
