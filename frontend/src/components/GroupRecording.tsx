import React, { useEffect, useState } from 'react';
import { Video, Square, Mic, MicOff, Activity } from 'lucide-react';
import { api, errorMessage, type AudioStatus, type GroupRecordingResult } from '../api/client';
import { useCameraStore } from '../store/cameraStore';
import { toast } from '../store/toastStore';
import { isReady, notReadyReason } from './SyncBadge';
import { DurationPicker, formatDuration } from './DurationPicker';

/** Start/stop all camera cars at the same moment, optionally with sound from the manager's microphone. */
export const GroupRecording: React.FC = () => {
  const cameras = useCameraStore(state => state.cameras);
  const [duration, setDuration] = useState(60); // seconds
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

  const ready = cameras.filter(c => c.status === 'online' && isReady(c));
  const notReady = cameras.filter(c => c.status === 'online' && !isReady(c));
  const recording = cameras.filter(c => c.status === 'recording');
  const audioReady = !!audio?.configured;

  const startAll = async () => {
    try {
      setBusy(true);
      const r = await api.startAll({ duration, resolution, audio: withAudio && audioReady });
      setResult(r.data);
      const names = r.data.started.map(s => s.cameraName).join(', ');
      toast.success(`Gleichzeitiger Start um ${new Date(r.data.startAt).toLocaleTimeString('de-DE')} (${formatDuration(duration)}): ${names}`);
    } catch (err) {
      toast.error(`Start fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const stopAll = async () => {
    try {
      setBusy(true);
      const r = await api.stopAll();
      toast.success(`${r.data.stopped.length} Aufnahme(n) werden beendet`);
    } catch (err) {
      toast.error(`Stopp fehlgeschlagen: ${errorMessage(err)}`);
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
    <section className="panel">
      <h2 className="panel-title">Alle Kamerawagen gleichzeitig</h2>
      <p className="text-sm text-muted mb-4">
        {ready.length} von {cameras.length} Wagen bereit{recording.length ? `, ${recording.length} nehmen auf` : ''}. Alle starten im selben Moment.
      </p>
      {notReady.length > 0 && (
        <ul className="text-xs text-warn mb-3 space-y-0.5">
          {notReady.map(c => (
            <li key={c.id}>
              {c.name}: {notReadyReason(c)}
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-4">
        <DurationPicker value={duration} onChange={setDuration} disabled={busy} />
        <div className="space-y-4">
          <div>
            <label className="field-label">Auflösung</label>
            <select value={resolution} onChange={e => setResolution(e.target.value)} disabled={busy} className="input">
              <option value="1920x1080">1920×1080 (Full HD)</option>
              <option value="1280x720">1280×720</option>
            </select>
          </div>
          <div>
            <label className={`flex items-center gap-2 text-sm mb-1.5 ${audioReady ? 'cursor-pointer' : 'opacity-60'}`}>
              <input type="checkbox" checked={withAudio && audioReady} disabled={!audioReady || busy} onChange={e => setWithAudio(e.target.checked)} className="w-4 h-4" />
              {audioReady ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
              Ton vom Mikrofon des Servers
            </label>
            <p className="text-xs text-muted break-all">
              {audioReady ? (
                <>
                  {audio?.input}
                  {audio?.recording && <span className="text-bad"> • nimmt auf</span>}
                </>
              ) : (
                'Kein Mikrofon konfiguriert (AUDIO_INPUT in .env)'
              )}
            </p>
            {audio?.lastError && <p className="text-xs text-warn">{audio.lastError}</p>}
            {audioReady && (
              <button onClick={testMic} className="btn-neutral btn-sm mt-2">
                <Activity className="w-3 h-3" /> Mikrofon testen {level && <span className="text-muted">– {level}</span>}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={startAll} disabled={busy || ready.length === 0} className="btn-success">
            <Video className="w-4 h-4" /> Alle aufnehmen
          </button>
          <button onClick={stopAll} disabled={busy || recording.length === 0} className="btn-danger">
            <Square className="w-4 h-4" /> Alle stoppen
          </button>
        </div>

        {result && result.skipped.length > 0 && (
          <ul className="text-xs text-warn space-y-1">
            {result.skipped.map(s => (
              <li key={s.cameraId}>
                {s.cameraName} übersprungen: {s.reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
