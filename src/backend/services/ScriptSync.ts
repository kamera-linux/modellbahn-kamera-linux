import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger.js';
import { buildCommand } from '../utils/shell.js';
import type { SSHTarget, ExecResult } from './SSHManager.js';
import type { ScriptSyncStatus } from '../../shared/types.js';

/** Scripts that run on the camera cars. */
export const PI_SCRIPTS = [
  'camera_common.py',
  'camera-capture.py',
  'camera-record.py',
  'camera-selfcheck.py',
  'setup-rpi-zero.sh',
  'test-camera.sh'
];

export interface RemoteOps {
  exec(target: SSHTarget, command: string, opts?: { allowFailure?: boolean }): Promise<ExecResult>;
  putFile(target: SSHTarget, localFile: string, remoteFile: string): Promise<void>;
}

/** Content hash over file names and contents – identical scripts give the same version everywhere. */
export function bundleVersion(dir: string, files: string[] = PI_SCRIPTS): string {
  const h = createHash('sha256');
  for (const f of [...files].sort()) {
    h.update(f).update('\0').update(readFileSync(join(dir, f))).update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * Shell paths may start with "~/" (expanded by the remote shell); SFTP paths are relative
 * to the login directory instead.
 */
export const sftpPath = (dir: string) => dir.replace(/^~\//, '');

export interface SelfCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  cameras: string[];
}

export function parseSelfCheck(stdout: string): SelfCheck {
  const line = stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{'));
  if (!line) throw new Error('Selbsttest lieferte keine Antwort');
  const r = JSON.parse(line);
  return { ok: !!r.ok, errors: r.errors ?? [], warnings: r.warnings ?? [], cameras: r.cameras ?? [] };
}

/**
 * Keeps the scripts on the Pis in sync with the manager:
 * compare ~/…/scripts/.version with the local bundle hash, upload on mismatch
 * (".new" files, then rename; .version is written last so an interrupted sync is retried),
 * then run camera-selfcheck.py. Only a successful check yields state "ready".
 */
export class ScriptSync {
  private cachedVersion: string | null = null;

  constructor(
    private ops: RemoteOps,
    private localDir: string,
    private remoteDir: string,
    private files: string[] = PI_SCRIPTS,
    private workDir?: string
  ) {}

  get version(): string {
    if (!this.cachedVersion) this.cachedVersion = bundleVersion(this.localDir, this.files);
    return this.cachedVersion;
  }

  async sync(
    target: SSHTarget,
    opts: { force?: boolean; onState?: (s: ScriptSyncStatus['state']) => void } = {}
  ): Promise<ScriptSyncStatus> {
    const version = this.version;
    const checkedAt = new Date().toISOString();
    try {
      opts.onState?.('checking');
      const mkWork = this.workDir ? `${buildCommand('mkdir -p', [this.workDir])}; ` : '';
      const current = (
        await this.ops.exec(target, `${mkWork}cat ${this.remoteDir}/.version 2>/dev/null || true`, { allowFailure: true })
      ).stdout.trim();

      let updatedAt: string | undefined;
      if (current !== version || opts.force) {
        opts.onState?.('syncing');
        logger.info(`Syncing scripts to ${target.host}: ${current || '(none)'} -> ${version}`);
        await this.ops.exec(target, `mkdir -p ${this.remoteDir}`);
        for (const f of this.files) {
          await this.ops.putFile(target, join(this.localDir, f), `${sftpPath(this.remoteDir)}/${f}.new`);
        }
        const moves = this.files.map(f => buildCommand('mv -f', [`${f}.new`, f])).join(' && ');
        await this.ops.exec(
          target,
          `cd ${this.remoteDir} && ${moves} && chmod 755 ${this.files.join(' ')} && echo ${version} > .version`
        );
        updatedAt = checkedAt;
      }

      opts.onState?.('checking');
      const check = parseSelfCheck(
        (await this.ops.exec(target, `timeout 60 python3 ${this.remoteDir}/camera-selfcheck.py`, { allowFailure: true })).stdout
      );
      return {
        state: check.ok ? 'ready' : 'error',
        version,
        checkedAt,
        updatedAt,
        error: check.ok ? undefined : check.errors.join('; '),
        warnings: check.warnings,
        cameras: check.cameras
      };
    } catch (err) {
      return { state: 'error', version, checkedAt, error: `Synchronisierung fehlgeschlagen: ${(err as Error).message}` };
    }
  }
}
