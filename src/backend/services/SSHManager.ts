import { NodeSSH } from 'node-ssh';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';
import { appConfig, paths } from '../config.js';

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
    try {
      const conn = await this.getConnection(target, opts.readyTimeout);
      const result = await conn.execCommand(command);
      if (result.code !== 0 && !opts.allowFailure) {
        throw new Error(`Command failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
      }
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    } catch (err) {
      // Connection-level errors: drop the cached connection so the next call reconnects.
      if (!(err instanceof Error && err.message.startsWith('Command failed'))) {
        this.drop(target);
      }
      throw err;
    }
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
