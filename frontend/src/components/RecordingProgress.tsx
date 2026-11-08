import React, { useState, useEffect } from 'react';
import { api, type RecordingSession } from '../api/client';
import { RotateCw } from 'lucide-react';


export const RecordingProgress: React.FC = () => {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  
  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 1000); // Update every second
    return () => clearInterval(interval);
  }, []);

  const loadSessions = async () => {
    try {
      const response = await api.getRecordingSessions();
      setSessions(response.data || []);
    } catch (err) {
      console.error('Failed to load recording sessions:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getElapsedTime = (startTime: string | Date, duration: number): number => {
    const start = new Date(startTime).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - start) / 1000);
    return Math.min(elapsed, duration);
  };

  const activeSessions = sessions.filter(s => s.status === 'recording' || s.status === 'stopping');

  if (activeSessions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {activeSessions.map((session) => {
        const elapsed = getElapsedTime(session.startTime, session.duration);
        const progress = Math.round((elapsed / session.duration) * 100);

        return (
          <div key={session.id} className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <RotateCw className="w-4 h-4 animate-spin text-orange-400" />
                <span className="font-semibold">{session.cameraName}</span>
              </div>
              <span className="text-xs text-gray-400">
                {formatTime(elapsed)} / {formatTime(session.duration)}
              </span>
            </div>
            
            <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-orange-500 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-gray-400">
                {progress}% • {session.status === 'stopping' ? 'wird beendet…' : 'Aufnahme läuft'}
              </span>
              <span className="text-xs text-gray-500">
                {new Date(session.startTime).toLocaleTimeString('de-DE')}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
