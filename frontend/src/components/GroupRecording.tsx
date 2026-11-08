import React, { useEffect, useState } from 'react';
import { Video, Square, Mic, MicOff, Activity } from 'lucide-react';
import { api, errorMessage, type AudioStatus, type GroupRecordingResult } from '../api/client';
import { useCameraStore } from '../store/cameraStore';
import { isReady, notReadyReason } from './SyncBadge';

/** Start/stop all camera cars at the same moment, optionally with sound from the manager's microphone. */
export const GroupRecording: React.FC<{ onMessage: (type: 'success' | 'error', text: string) => void }> = ({ onMessage }) => {
  const cameras = useCameraStore(state => state.cameras);
  const [duration, setDuration] = useState(1); // minutes
  const [resolution, setResolution] = useState('1920x1080');
  const [withAudio, setWithAudio] = useState(true);
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const [level, setLevel] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GroupRecordingResult | null>(null);

  useEffect(() => {
    const load = () => api.getAudioStatus().then(r => setAudio(r.data)).catch(() => undefined);
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const online = cameras.filter(c => c.status === 'online' && isReady(c));
  const notReady = cameras.filter(c => c.status === 'online' && !isReady(c));
  const recording = cameras.filter(c => c.status === 'recording');
  const audioReady = !!audio?.configured;

  const startAll = async () => {
    try {
      setBusy(true);
      const r = await api.startAll({ duration: duration * 60, resolution, audio: withAudio && audioReady });
      setResult(r.data);
      const names = r.data.started.map(s => s.cameraName).join(', ');
      onMessage('success', `Gleichzeitiger Start um ${new Date(r.data.startAt).toLocaleTimeString('de-DE')}: ${names}`);
    } catch (err) {
      onMessage('error', `Start fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const stopAll = async () => {
    try {
      setBusy(true);
      const r = await api.stopAll();
      onMessage('success', `${r.data.stopped.length} Aufnahme(n) werden beendet`);
    } catch (err) {
      onMessage('error', `Stopp fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const testMic = async () => {
    setLevel('…');
    try {
      const r = await api.testAudio();
      setLevel(r.data.ok ? (r.data.maxVolumeDb !== undefined ? `Pegel ${r.data.maxVolumeDb.toFixed(1)} dB` : 'Mikrofon aktiv') : `Fehler: ${r.data.error}`);
    } catch (err) {
      setLevel(`Fehler: ${errorMessage(err)}`);
    }
  };

  return (
    <div className="card space-y-4">
      <h3 className="text-xl font-bold flex items-center gap-2">
        <Video className="w-5 h-5" /> Alle Kamerawagen
      </h3>
      <p className="text-sm text-gray-400">
        Startet alle bereiten Wagen gleichzeitig ({online.length} bereit{recording.length ? `, ${recording.length} nehmen auf` : ''}).
      </p>
      {notReady.length > 0 && (
        <ul className="text-xs text-yellow-300 space-y-0.5">
          {notReady.map(c => (
            <li key={c.id}>
              {c.name}: {notReadyReason(c)}
            </li>
          ))}
        </ul>
      )}

      <div>
        <label className="block text-sm font-medium mb-2">
          Dauer: {duration} Minute{duration > 1 ? 'n' : ''}
        </label>
        <input type="range" min="1" max="60" value={duration} onChange={e => setDuration(parseInt(e.target.value, 10))} disabled={busy} className="w-full" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Auflösung</label>
        <select value={resolution} onChange={e => setResolution(e.target.value)} disabled={busy} className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2">
          <option>1920x1080</option>
          <option>1280x720</option>
        </select>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded p-3 space-y-2">
        <label className={`flex items-center gap-2 ${audioReady ? 'cursor-pointer' : 'opacity-60'}`}>
          <input type="checkbox" checked={withAudio && audioReady} disabled={!audioReady || busy} onChange={e => setWithAudio(e.target.checked)} className="w-4 h-4" />
          {audioReady ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          <span className="text-sm">Ton vom Mikrofon des Servers</span>
        </label>
        <p className="text-xs text-gray-400 break-all">
          {audioReady ? (
            <>
              {audio?.input}
              {audio?.recording && <span className="text-red-400"> • nimmt auf</span>}
            </>
          ) : (
            'Kein Mikrofon konfiguriert (AUDIO_INPUT in .env)'
          )}
        </p>
        {audio?.lastError && <p className="text-xs text-yellow-300">{audio.lastError}</p>}
        {audioReady && (
          <button onClick={testMic} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded inline-flex items-center gap-1">
            <Activity className="w-3 h-3" /> Mikrofon testen {level && <span className="text-gray-300">– {level}</span>}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={startAll} disabled={busy || online.length === 0} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
          <Video className="w-4 h-4" /> Alle aufnehmen
        </button>
        <button
          onClick={stopAll}
          disabled={busy || recording.length === 0}
          className="btn-secondary flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50"
        >
          <Square className="w-4 h-4" /> Alle stoppen
        </button>
      </div>

      {result && result.skipped.length > 0 && (
        <ul className="text-xs text-yellow-300 space-y-1">
          {result.skipped.map(s => (
            <li key={s.cameraId}>
              {s.cameraName} übersprungen: {s.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
