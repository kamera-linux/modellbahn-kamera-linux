import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../utils/logger.js';
import { isInTimeWindow } from './timeWindow.js';
import { HttpError } from '../validation.js';
import type { CaptureOptions, CaptureSchedule, ScheduleStatus } from '../../shared/types.js';

export type { CaptureSchedule, ScheduleStatus };

export interface ScheduleManagerDeps {
  /** JSON file for persistence; null disables persistence (tests). */
  file: string | null;
  capture: (cameraId: string, options: CaptureOptions) => Promise<unknown>;
  cameraExists: (cameraId: string) => boolean;
  now?: () => Date;
}

interface Runtime {
  timer?: NodeJS.Timeout;
  cycleStart?: number;
  isRunning: boolean;
  lastExecution?: Date;
  lastError?: string;
}

const CAPTURE_KEYS = ['resolution', 'quality', 'autofocusMode', 'autofocusRange', 'hdr', 'roi'] as const;

export class ScheduleManager {
  private schedules = new Map<string, CaptureSchedule>();
  private runtime = new Map<string, Runtime>();
  private now: () => Date;

  constructor(private deps: ScheduleManagerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.load();
  }

  // ---------- persistence ----------

  private load() {
    if (!this.deps.file || !existsSync(this.deps.file)) return;
    try {
      const list: CaptureSchedule[] = JSON.parse(readFileSync(this.deps.file, 'utf8'));
      for (const s of list) {
        this.schedules.set(s.id, s);
        this.runtime.set(s.id, { isRunning: false });
        if (s.enabled) this.start(s.id);
      }
      logger.info(`Loaded ${list.length} schedules from ${this.deps.file}`);
    } catch (err) {
      logger.error(`Failed to load schedules from ${this.deps.file}`, err);
    }
  }

  private save() {
    if (!this.deps.file) return;
    try {
      mkdirSync(dirname(this.deps.file), { recursive: true });
      const tmp = `${this.deps.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Array.from(this.schedules.values()), null, 2));
      renameSync(tmp, this.deps.file);
    } catch (err) {
      logger.error(`Failed to save schedules to ${this.deps.file}`, err);
    }
  }

  // ---------- CRUD ----------

  listSchedules(): CaptureSchedule[] {
    return Array.from(this.schedules.values());
  }

  private checkCameras(ids: string[]) {
    const unknown = ids.filter(id => !this.deps.cameraExists(id));
    if (unknown.length) throw new HttpError(400, `Unknown camera(s): ${unknown.join(', ')}`);
  }

  createSchedule(input: Omit<CaptureSchedule, 'id' | 'createdAt'>): CaptureSchedule {
    this.checkCameras(input.cameraIds);
    const schedule: CaptureSchedule = {
      ...input,
      id: randomUUID(),
      enabled: input.enabled ?? false,
      createdAt: this.now().toISOString()
    };
    this.schedules.set(schedule.id, schedule);
    this.runtime.set(schedule.id, { isRunning: false });
    if (schedule.enabled) this.start(schedule.id);
    this.save();
    logger.info(`Schedule created: ${schedule.name}`);
    return schedule;
  }

  updateSchedule(id: string, changes: Partial<CaptureSchedule>): CaptureSchedule {
    const schedule = this.schedules.get(id);
    if (!schedule) throw new HttpError(404, 'Schedule not found');
    if (changes.cameraIds) this.checkCameras(changes.cameraIds);

    const updated: CaptureSchedule = { ...schedule, ...changes, id, createdAt: schedule.createdAt };
    this.schedules.set(id, updated);

    const timingChanged = changes.interval !== undefined && changes.interval !== schedule.interval;
    if (!updated.enabled) {
      this.stop(id);
    } else if (!schedule.enabled || timingChanged) {
      this.stop(id);
      this.start(id);
    }

    this.save();
    logger.info(`Schedule updated: ${id}`);
    return updated;
  }

  deleteSchedule(id: string): void {
    if (!this.schedules.has(id)) throw new HttpError(404, 'Schedule not found');
    this.stop(id);
    this.schedules.delete(id);
    this.runtime.delete(id);
    this.save();
    logger.info(`Schedule deleted: ${id}`);
  }

  // ---------- timers ----------

  private start(id: string) {
    const schedule = this.schedules.get(id);
    if (!schedule) return;
    const rt = this.runtime.get(id) ?? { isRunning: false };
    this.runtime.set(id, rt);

    const intervalMs = schedule.interval * 60 * 1000;
    rt.timer = setInterval(() => void this.tick(id), intervalMs);
    rt.timer.unref?.();
    void this.tick(id); // first capture right away
    logger.info(`Schedule started: ${schedule.name} (every ${schedule.interval} min)`);
  }

  private stop(id: string) {
    const rt = this.runtime.get(id);
    if (rt?.timer) {
      clearInterval(rt.timer);
      rt.timer = undefined;
      rt.cycleStart = undefined;
      logger.info(`Schedule stopped: ${id}`);
    }
  }

  /** One interval tick. Public for tests. */
  async tick(id: string): Promise<void> {
    const schedule = this.schedules.get(id);
    const rt = this.runtime.get(id);
    if (!schedule || !rt || !schedule.enabled) return;

    rt.cycleStart = this.now().getTime();

    if (!isInTimeWindow(this.now(), schedule.startTime, schedule.endTime)) {
      logger.debug(`Schedule ${schedule.name}: outside time window, skipping`);
      return;
    }
    if (rt.isRunning) {
      logger.warn(`Schedule ${schedule.name}: previous run still in progress, skipping this tick`);
      return;
    }

    rt.isRunning = true;
    try {
      const options: CaptureOptions = {};
      for (const key of CAPTURE_KEYS) {
        if (schedule[key] !== undefined && schedule[key] !== '') (options as Record<string, unknown>)[key] = schedule[key];
      }
      // Different cameras are different Pis, so capture in parallel.
      const results = await Promise.allSettled(schedule.cameraIds.map(camId => this.deps.capture(camId, options)));
      const errors = results
        .map((r, i) => (r.status === 'rejected' ? `${schedule.cameraIds[i]}: ${(r.reason as Error)?.message ?? r.reason}` : null))
        .filter((e): e is string => e !== null);
      rt.lastError = errors.length ? errors.join('; ') : undefined;
      if (errors.length) logger.error(`Schedule ${schedule.name}: ${rt.lastError}`);
      rt.lastExecution = this.now();
    } finally {
      rt.isRunning = false;
    }
  }

  // ---------- status ----------

  getScheduleStatus(id: string): ScheduleStatus | null {
    const schedule = this.schedules.get(id);
    if (!schedule) return null;
    const rt = this.runtime.get(id) ?? { isRunning: false };
    const now = this.now();

    const status: ScheduleStatus = {
      scheduleId: id,
      progress: 0,
      isRunning: rt.isRunning,
      inTimeWindow: isInTimeWindow(now, schedule.startTime, schedule.endTime),
      lastExecution: rt.lastExecution?.toISOString(),
      lastError: rt.lastError
    };

    if (schedule.enabled && rt.cycleStart !== undefined) {
      const intervalMs = schedule.interval * 60 * 1000;
      const elapsed = now.getTime() - rt.cycleStart;
      status.progress = Math.min(100, Math.max(0, Math.round((elapsed / intervalMs) * 100)));
      status.nextExecution = new Date(rt.cycleStart + intervalMs).toISOString();
    }
    return status;
  }

  getAllSchedulesStatus(): ScheduleStatus[] {
    return Array.from(this.schedules.keys())
      .map(id => this.getScheduleStatus(id))
      .filter((s): s is ScheduleStatus => s !== null);
  }

  shutdown() {
    for (const id of this.runtime.keys()) this.stop(id);
  }
}
