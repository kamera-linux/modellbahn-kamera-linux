import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { buildCaptureCommand, buildRecordCommand, safeName, fileTimestamp, parseStartedAt } from './CameraManager.js';

describe('command building', () => {
  it('builds the capture command with all options', () => {
    const cmd = buildCaptureCommand('/tmp/x.jpg', { resolution: '1280x720', quality: 80, hdr: 'auto', roi: '0.1,0.1,0.5,0.5' }, 180);
    expect(cmd).toMatch(/^exec timeout -k 10 30 python3 \S+\/camera-capture\.py /);
    expect(cmd).toContain('--width 1280 --height 720 --rotate 180');
    expect(cmd).toContain('--quality 80');
    expect(cmd).toContain('--hdr auto');
    expect(cmd).toContain('--roi 0.1,0.1,0.5,0.5');
  });

  it('passes the thumbnail path right after --output (pkill pattern stays intact)', () => {
    const cmd = buildRecordCommand('/tmp/Cam_1.mp4', { duration: 5 }, 0, '/tmp/Cam_1.mp4.thumb.jpg');
    expect(cmd).toContain('--output /tmp/Cam_1.mp4 --duration 5 --thumbnail /tmp/Cam_1.mp4.thumb.jpg');
    expect(buildCaptureCommand('/tmp/x.jpg', {}, 0, '/tmp/x.jpg.thumb.jpg')).toContain('--thumbnail /tmp/x.jpg.thumb.jpg');
  });

  it('quotes hostile values so the shell sees them as one argument', () => {
    const payload = '"; touch /tmp/pwned #';
    const cmd = buildCaptureCommand('/tmp/x.jpg', { roi: payload }, 0);
    const argsPart = cmd.slice(cmd.indexOf('--output'));
    const argv = JSON.parse(
      execFileSync('sh', ['-c', `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- ${argsPart}`]).toString()
    );
    expect(argv[argv.indexOf('--roi') + 1]).toBe(payload);
  });

  it('record command has a hard timeout above the duration and a pkill-able --output', () => {
    const cmd = buildRecordCommand('/tmp/Cam_1.mp4', { duration: 120 }, 0);
    expect(cmd).toMatch(/^exec timeout -k 10 180 python3 \S+\/camera-record\.py --output \/tmp\/Cam_1\.mp4 /);
    expect(cmd).toContain('--duration 120');
  });
});

describe('synchronised start', () => {
  it('passes --start-at and extends the hard timeout by the waiting time', () => {
    const startAt = Date.now() / 1000 + 7;
    const cmd = buildRecordCommand('/tmp/C.mp4', { duration: 10 }, 0, undefined, startAt);
    expect(cmd).toContain(`--start-at ${startAt.toFixed(3)}`);
    expect(cmd).toMatch(/^exec timeout -k 10 7[78] python3 /);
  });

  it('parses STARTED_AT from the recorder output', () => {
    expect(parseStartedAt('STARTED_AT=1794174470.284\nVideo recorded: /tmp/x.mp4 (3s)\n')).toBeCloseTo(1794174470.284, 3);
    expect(parseStartedAt('Video recorded')).toBeNull();
  });
});

describe('helpers', () => {
  it('safeName removes unsafe characters', () => {
    expect(safeName('Gleis 1 / Bahnhof')).toBe('Gleis_1_Bahnhof');
    expect(safeName('Kamerawagen-1')).toBe('Kamerawagen-1');
  });

  it('fileTimestamp matches the existing naming', () => {
    const d = new Date('2026-05-15T17:14:02.818Z');
    expect(fileTimestamp(d)).toBe('2026-05-15T17-14-02');
    expect(fileTimestamp(d, true)).toBe('2026-05-15T17-14-02-818');
  });
});
