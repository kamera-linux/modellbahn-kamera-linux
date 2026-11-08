import React, { useState, useEffect } from 'react';
import { api, type RecordingSession } from '../api/client';
import { RotateCw, Mic, AlertTriangle, CheckCircle2, XCircle, Timer } from 'lucide-react';

const ACTIVE: RecordingSession['status'][] = ['waiting', 'recording', 'stopping', 'processing'];
const SHOW_FINISHED_MS = 2 * 60 * 1000; // keep finished sessions visible for 2 min

const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
};

const statusText = (s: RecordingSession, secondsToStart: number) => {
  switch (s.status) {
    case 'waiting':
      return `Start in ${Math.ceil(secondsToStart)} s`;
    case 'recording':
      return 'Aufnahme läuft';
    case 'stopping':
      return 'wird beendet…';
    case 'processing':
      return s.audio ? 'Nachbearbeitung (Ton, 30 fps)…' : 'Nachbearbeitung (30 fps)…';
    case 'completed':
      return 'fertig';
    case 'failed':
      return 'fehlgeschlagen';
  }
};

export const RecordingProgress: React.FC = () => {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        setSessions((await api.getRecordingSessions()).data || []);
      } catch {
        /* next poll retries */
      }
    };
    load();
    const interval = setInterval(load, 1000);
    return () => clearInterval(interval);
  }, []);

  const now = Date.now();
  const visible = sessions.filter(s => {
    if (ACTIVE.includes(s.status)) return true;
    const end = new Date(s.startTime).getTime() + s.duration * 1000;
    return now - end < SHOW_FINISHED_MS;
  });
  if (visible.length === 0) return null;

  return (
    <div className="space-y-3">
      {visible.map(session => {
        const start = new Date(session.startTime).getTime();
        const elapsed = Math.min((now - start) / 1000, session.duration);
        const progress = session.status === 'completed' ? 100 : Math.max(0, Math.round((elapsed / session.duration) * 100));
        const active = ACTIVE.includes(session.status);
        const barColor =
          session.status === 'failed' ? 'bg-red-500' : session.status === 'completed' ? 'bg-green-500' : 'bg-orange-500';

        return (
          <div key={session.id} className="card !p-4">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {session.status === 'waiting' ? (
                  <Timer className="w-4 h-4 text-blue-400" />
                ) : active ? (
                  <RotateCw className="w-4 h-4 animate-spin text-orange-400" />
                ) : session.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className="font-semibold truncate">{session.cameraName}</span>
                {session.audio && <Mic className="w-4 h-4 text-gray-300" aria-label="mit Ton" />}
                {session.groupId && <span className="text-[10px] uppercase tracking-wide bg-gray-700 rounded px-1.5 py-0.5">alle</span>}
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {formatTime(elapsed)} / {formatTime(session.duration)}
              </span>
            </div>

            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
              <div className={`${barColor} h-full transition-all duration-300`} style={{ width: `${progress}%` }} />
            </div>

            <div className="flex justify-between items-center mt-2 gap-2 text-xs">
              <span className="text-gray-400">
                {progress}% • {statusText(session, (start - now) / 1000)}
                {session.startOffsetMs !== undefined && (
                  <span className={Math.abs(session.startOffsetMs) <= 100 ? 'text-green-400' : 'text-yellow-400'}>
                    {' '}• Start {session.startOffsetMs >= 0 ? '+' : ''}
                    {session.startOffsetMs} ms
                  </span>
                )}
              </span>
              <span className="text-gray-500">{new Date(session.startTime).toLocaleTimeString('de-DE')}</span>
            </div>

            {session.error && <p className="mt-2 text-xs text-red-300 break-words">{session.error.slice(0, 300)}</p>}
            {session.warning && (
              <p className="mt-2 text-xs text-yellow-300 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {session.warning}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
