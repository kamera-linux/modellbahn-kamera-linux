import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ScriptSync, bundleVersion, parseSelfCheck, sftpPath, PI_SCRIPTS, type RemoteOps } from './ScriptSync.js';
import type { SSHTarget } from './SSHManager.js';

const target: SSHTarget = { host: 'pi', user: 'u', port: 22 };
const OK = '{"ok": true, "errors": [], "warnings": ["v4l2-ctl fehlt"], "cameras": ["imx708_wide"]}';

/** In-memory Pi: tracks uploads, the version file and the self-check answer. */
class FakePi implements RemoteOps {
  version = '';
  uploads: string[] = [];
  commands: string[] = [];
  selfcheck = OK;
  failUpload = false;

  async exec(_t: SSHTarget, cmd: string) {
    this.commands.push(cmd);
    if (/(^|; )cat /.test(cmd)) return { stdout: this.version, stderr: '', code: 0 };
    const m = /echo (\w+) > \.version/.exec(cmd);
    if (m) this.version = m[1];
    if (cmd.includes('camera-selfcheck.py')) return { stdout: `libcamera noise\n${this.selfcheck}\n`, stderr: '', code: 0 };
    return { stdout: '', stderr: '', code: 0 };
  }
  async putFile(_t: SSHTarget, _local: string, remote: string) {
    if (this.failUpload) throw new Error('No space left on device');
    this.uploads.push(remote);
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scripts-'));
  for (const f of PI_SCRIPTS) writeFileSync(join(dir, f), `# ${f}\n`);
});

describe('helpers', () => {
  it('version depends on content', () => {
    const v1 = bundleVersion(dir);
    expect(v1).toMatch(/^[0-9a-f]{12}$/);
    writeFileSync(join(dir, 'camera-record.py'), '# changed\n');
    expect(bundleVersion(dir)).not.toBe(v1);
  });
  it('sftp paths are relative to home', () => {
    expect(sftpPath('~/modellbahn-kamera-linux/scripts')).toBe('modellbahn-kamera-linux/scripts');
    expect(sftpPath('/opt/kamera')).toBe('/opt/kamera');
  });
  it('parses the last JSON line of the self-check', () => {
    expect(parseSelfCheck(`noise\n${OK}`)).toMatchObject({ ok: true, cameras: ['imx708_wide'] });
    expect(() => parseSelfCheck('Traceback …')).toThrow(/keine Antwort/);
  });
});

describe('ScriptSync', () => {
  it('uploads all scripts on first contact, writes the version last, then is ready', async () => {
    const pi = new FakePi();
    const states: string[] = [];
    const sync = new ScriptSync(pi, dir, '~/k/scripts');
    const r = await sync.sync(target, { onState: s => states.push(s) });

    expect(r).toMatchObject({ state: 'ready', version: sync.version, warnings: ['v4l2-ctl fehlt'], cameras: ['imx708_wide'] });
    expect(r.updatedAt).toBeDefined();
    expect(pi.uploads).toEqual(PI_SCRIPTS.map(f => `k/scripts/${f}.new`));
    expect(pi.version).toBe(sync.version);
    const install = pi.commands.find(c => c.includes('.version') && c.startsWith('cd '))!;
    expect(install.indexOf('mv -f')).toBeLessThan(install.indexOf('echo'));
    expect(states).toEqual(['checking', 'syncing', 'checking']);
  });

  it('creates the recording work dir on the SD card', async () => {
    const pi = new FakePi();
    await new ScriptSync(pi, dir, '~/k/scripts', PI_SCRIPTS, 'k/tmp').sync(target);
    expect(pi.commands[0]).toMatch(/^mkdir -p k\/tmp; cat /);
  });

  it('does not upload when the version matches', async () => {
    const pi = new FakePi();
    const sync = new ScriptSync(pi, dir, '~/k/scripts');
    pi.version = sync.version;
    const r = await sync.sync(target);
    expect(r.state).toBe('ready');
    expect(r.updatedAt).toBeUndefined();
    expect(pi.uploads).toHaveLength(0);
  });

  it('force re-uploads even when up to date', async () => {
    const pi = new FakePi();
    const sync = new ScriptSync(pi, dir, '~/k/scripts');
    pi.version = sync.version;
    await sync.sync(target, { force: true });
    expect(pi.uploads).toHaveLength(PI_SCRIPTS.length);
  });

  it('is not ready when the self-check reports errors', async () => {
    const pi = new FakePi();
    pi.selfcheck = '{"ok": false, "errors": ["python3-picamera2 fehlt"], "warnings": [], "cameras": []}';
    const r = await new ScriptSync(pi, dir, '~/k/scripts').sync(target);
    expect(r).toMatchObject({ state: 'error', error: 'python3-picamera2 fehlt' });
  });

  it('a failed upload leaves the old version, so the next check retries', async () => {
    const pi = new FakePi();
    pi.version = 'old';
    pi.failUpload = true;
    const sync = new ScriptSync(pi, dir, '~/k/scripts');
    const r = await sync.sync(target);
    expect(r.state).toBe('error');
    expect(r.error).toContain('No space left');
    expect(pi.version).toBe('old');
  });
});
