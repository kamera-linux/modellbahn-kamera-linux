import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleManager } from './ScheduleManager.js';
import { mkdtempSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const base = { name: 'Gleis 1', cameraIds: ['cam1', 'cam2'], interval: 2, enabled: false };

function setup(file: string | null = null) {
  const capture = vi.fn().mockResolvedValue({ success: true });
  const manager = new ScheduleManager({ file, capture, cameraExists: id => id.startsWith('cam') });
  return { manager, capture };
}

describe('ScheduleManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 15, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('does not capture while disabled', async () => {
    const { manager, capture } = setup();
    manager.createSchedule(base);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures immediately and then every interval while enabled', async () => {
    const { manager, capture } = setup();
    const s = manager.createSchedule(base);
    manager.updateSchedule(s.id, { enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(capture).toHaveBeenCalledTimes(2); // 2 cameras, immediate run

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(capture).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(capture).toHaveBeenCalledTimes(6);

    manager.updateSchedule(s.id, { enabled: false });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(capture).toHaveBeenCalledTimes(6);
  });

  it('respects the time window', async () => {
    const { manager, capture } = setup();
    manager.createSchedule({ ...base, enabled: true, startTime: '13:00', endTime: '14:00' });
    await vi.advanceTimersByTimeAsync(58 * 60 * 1000); // 12:58
    expect(capture).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000); // 13:00
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('restarts the timer when the interval changes', async () => {
    const { manager, capture } = setup();
    const s = manager.createSchedule({ ...base, cameraIds: ['cam1'], enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    manager.updateSchedule(s.id, { interval: 5 });
    await vi.advanceTimersByTimeAsync(0);
    const afterChange = capture.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    expect(capture).toHaveBeenCalledTimes(afterChange);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(capture).toHaveBeenCalledTimes(afterChange + 1);
  });

  it('records capture errors in the status without stopping', async () => {
    const { manager, capture } = setup();
    capture.mockRejectedValueOnce(new Error('offline'));
    const s = manager.createSchedule({ ...base, enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getScheduleStatus(s.id)?.lastError).toContain('cam1: offline');
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(manager.getScheduleStatus(s.id)?.lastError).toBeUndefined();
  });

  it('reports progress and next execution', async () => {
    const { manager } = setup();
    const s = manager.createSchedule({ ...base, enabled: true });
    await vi.advanceTimersByTimeAsync(60 * 1000);
    const status = manager.getScheduleStatus(s.id)!;
    expect(status.progress).toBe(50);
    expect(new Date(status.nextExecution!).getTime()).toBe(new Date(2026, 4, 15, 12, 2, 0).getTime());
  });

  it('rejects unknown cameras', () => {
    const { manager } = setup();
    expect(() => manager.createSchedule({ ...base, cameraIds: ['nope'] })).toThrow(/Unknown camera/);
  });

  it('persists schedules and resumes enabled ones after restart', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sched-')), 'schedules.json');
    const first = setup(file);
    first.manager.createSchedule({ ...base, enabled: true });
    first.manager.shutdown();
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1);

    const second = setup(file);
    expect(second.manager.listSchedules()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.capture).toHaveBeenCalledTimes(2);
    second.manager.shutdown();
  });
});
