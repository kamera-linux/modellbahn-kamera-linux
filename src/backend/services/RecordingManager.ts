import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import type { RecordingSession } from '../../shared/types.js';

export type { RecordingSession };

const MAX_AGE_MS = 60 * 60 * 1000; // keep finished sessions for 1h

export class RecordingManager {
  private sessions = new Map<string, RecordingSession & { startTime: Date }>();

  constructor() {
    setInterval(() => this.clearOldSessions(), 10 * 60 * 1000).unref();
  }

  startSession(
    cameraId: string,
    cameraName: string,
    duration: number,
    filename: string,
    remoteFile: string,
    extra: { startTime?: Date; audio?: boolean; groupId?: string } = {}
  ): RecordingSession {
    const startTime = extra.startTime ?? new Date();
    const session: RecordingSession & { startTime: Date } = {
      id: randomUUID(),
      cameraId,
      cameraName,
      startTime,
      duration,
      filename,
      remoteFile,
      status: startTime.getTime() > Date.now() ? 'waiting' : 'recording',
      progress: 0,
      audio: extra.audio,
      groupId: extra.groupId
    };
    this.sessions.set(session.id, session);
    logger.info(`Recording session started: ${session.id}`, { cameraName, duration });
    return session;
  }

  private withProgress(session: RecordingSession & { startTime: Date }): RecordingSession {
    const elapsed = (Date.now() - session.startTime.getTime()) / 1000;
    if (session.status === 'waiting' && elapsed >= 0) session.status = 'recording';
    if (session.status === 'recording') {
      session.progress = Math.round(Math.min(100, Math.max(0, (elapsed / session.duration) * 100)));
    }
    return session;
  }

  update(sessionId: string, changes: Partial<Pick<RecordingSession, 'status' | 'warning' | 'startOffsetMs'>>) {
    const s = this.sessions.get(sessionId);
    if (s) Object.assign(s, changes);
  }

  getActiveSession(cameraId: string): RecordingSession | null {
    for (const s of this.sessions.values()) {
      if (s.cameraId === cameraId && ['waiting', 'recording', 'stopping'].includes(s.status)) return s;
    }
    return null;
  }

  markStopping(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s && (s.status === 'recording' || s.status === 'waiting')) s.status = 'stopping';
  }

  completeSession(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.status = 'completed';
      s.progress = 100;
      logger.info(`Recording session completed: ${sessionId}`);
    }
  }

  failSession(sessionId: string, error: string) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.status = 'failed';
      s.error = error;
      logger.error(`Recording session failed: ${sessionId}`, { error });
    }
  }

  getSession(sessionId: string): RecordingSession | null {
    const s = this.sessions.get(sessionId);
    return s ? this.withProgress(s) : null;
  }

  getAllSessions(): RecordingSession[] {
    return Array.from(this.sessions.values()).map(s => this.withProgress(s));
  }

  clearOldSessions(maxAge = MAX_AGE_MS) {
    const now = Date.now();
    let removed = 0;
    for (const [id, s] of this.sessions) {
      const finished = s.status === 'completed' || s.status === 'failed';
      if (finished && now - s.startTime.getTime() > maxAge) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed) logger.info(`Cleared ${removed} old recording sessions`);
  }
}
