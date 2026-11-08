import React, { useState, useEffect, useCallback } from 'react';
import { api, errorMessage, type CaptureSchedule, type ScheduleStatus, type ScheduleInput } from '../api/client';
import { useCameraStore } from '../store/cameraStore';
import { Clock, Plus, Trash2, Play, Pause, Settings, AlertTriangle } from 'lucide-react';
import { AdvancedCaptureFields, defaultAdvanced, roiError } from './AdvancedCaptureFields';

const emptyForm = (): ScheduleInput & { roi: string; startTime: string; endTime: string } => ({
  name: '',
  cameraIds: [],
  interval: 2,
  enabled: false,
  resolution: '1920x1080',
  quality: 90,
  ...defaultAdvanced,
  startTime: '',
  endTime: ''
});

const inputClass = 'w-full bg-gray-600 border border-gray-500 rounded px-3 py-2';

const formatTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';

const windowLabel = (s: CaptureSchedule) => {
  if (!s.startTime && !s.endTime) return 'ganztägig';
  return `${s.startTime || '00:00'}–${s.endTime || '23:59'}`;
};

export const ScheduleManager: React.FC = () => {
  const cameras = useCameraStore(state => state.cameras);
  const [schedules, setSchedules] = useState<CaptureSchedule[]>([]);
  const [statuses, setStatuses] = useState<Map<string, ScheduleStatus>>(new Map());
  const [showForm, setShowForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);

  const fetchSchedules = useCallback(async () => {
    try {
      setSchedules((await api.getSchedules()).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const fetchStatuses = useCallback(async () => {
    try {
      const response = await api.getSchedulesStatus();
      setStatuses(new Map(response.data.map(s => [s.scheduleId, s])));
    } catch {
      /* transient – next poll will retry */
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
    fetchStatuses();
    const poll = setInterval(fetchStatuses, 2000);
    return () => clearInterval(poll);
  }, [fetchSchedules, fetchStatuses]);

  const toggleCamera = (cameraId: string) =>
    setForm(prev => ({
      ...prev,
      cameraIds: prev.cameraIds.includes(cameraId) ? prev.cameraIds.filter(id => id !== cameraId) : [...prev.cameraIds, cameraId]
    }));

  const handleCreate = async () => {
    if (!form.name.trim() || form.cameraIds.length === 0) {
      setError('Bitte Namen und mindestens eine Kamera auswählen');
      return;
    }
    if (roiError(form.roi)) {
      setError(`ROI ungültig: ${roiError(form.roi)}`);
      return;
    }
    try {
      setLoading(true);
      await api.createSchedule(form);
      setShowForm(false);
      setShowAdvanced(false);
      setForm(emptyForm());
      setError('');
      fetchSchedules();
    } catch (err) {
      setError(`Zeitplan konnte nicht erstellt werden: ${errorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Zeitplan wirklich löschen?')) return;
    try {
      await api.deleteSchedule(id);
      fetchSchedules();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleToggle = async (schedule: CaptureSchedule) => {
    try {
      await api.updateSchedule(schedule.id, { enabled: !schedule.enabled });
      await fetchSchedules();
      fetchStatuses();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const cameraName = (id: string) => cameras.find(c => c.id === id)?.name ?? id;

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Clock className="w-6 h-6" />
          Zeitpläne
        </h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Neu
        </button>
      </div>

      {error && (
        <div className="bg-red-900 text-red-100 p-3 rounded mb-4 flex justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-300">
            ✕
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-gray-700 p-4 rounded mb-4 space-y-3">
          <input
            type="text"
            placeholder="Name des Zeitplans"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className={inputClass}
          />

          <div>
            <label className="block text-sm font-medium mb-2">Kameras</label>
            <div className="space-y-2 bg-gray-600 p-3 rounded max-h-40 overflow-y-auto">
              {cameras.length === 0 ? (
                <p className="text-gray-400 text-sm">Keine Kameras verfügbar</p>
              ) : (
                cameras.map(camera => (
                  <label key={camera.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.cameraIds.includes(camera.id)} onChange={() => toggleCamera(camera.id)} className="w-4 h-4" />
                    <span className="text-sm">
                      {camera.name}
                      <span className={`ml-2 text-xs ${camera.status === 'online' ? 'text-green-400' : 'text-red-400'}`}>({camera.status})</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Intervall</label>
            <select value={form.interval} onChange={e => setForm({ ...form, interval: parseInt(e.target.value, 10) })} className={inputClass}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => (
                <option key={i} value={i}>
                  alle {i} Minute{i > 1 ? 'n' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-2">Von (optional)</label>
              <input type="time" value={form.startTime} onChange={e => setForm({ ...form, startTime: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Bis (optional)</label>
              <input type="time" value={form.endTime} onChange={e => setForm({ ...form, endTime: e.target.value })} className={inputClass} />
            </div>
          </div>
          <p className="text-xs text-gray-400">Leer = ganztägig. Über Mitternacht geht auch, z.B. 22:00–02:00.</p>

          <div>
            <label className="block text-sm font-medium mb-2">Qualität: {form.quality}%</label>
            <input
              type="range"
              min="50"
              max="100"
              value={form.quality}
              onChange={e => setForm({ ...form, quality: parseInt(e.target.value, 10) })}
              className="w-full"
            />
          </div>

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-center gap-2 text-sm bg-gray-600 hover:bg-gray-500 rounded px-3 py-2"
          >
            <Settings className="w-4 h-4" />
            {showAdvanced ? 'Erweitert ausblenden' : 'Erweitert'}
          </button>

          {showAdvanced && (
            <div className="space-y-3 p-3 bg-gray-800 rounded">
              <div>
                <label className="block text-sm font-medium mb-2">Auflösung</label>
                <select value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })} className={inputClass}>
                  <option>1920x1080</option>
                  <option>2560x1440</option>
                  <option>3840x2160</option>
                  <option>4608x2592</option>
                </select>
              </div>
              <AdvancedCaptureFields
                value={{ autofocusMode: form.autofocusMode!, autofocusRange: form.autofocusRange!, hdr: form.hdr!, roi: form.roi }}
                onChange={v => setForm({ ...form, ...v })}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
              Erstellen
            </button>
            <button onClick={() => setShowForm(false)} className="btn-secondary flex-1">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {schedules.length === 0 ? (
          <p className="text-gray-400">Keine Zeitpläne</p>
        ) : (
          schedules.map(schedule => {
            const status = statuses.get(schedule.id);
            return (
              <div key={schedule.id} className={`rounded-lg p-4 ${schedule.enabled ? 'bg-gray-700' : 'bg-gray-800 opacity-60'}`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold">{schedule.name}</h3>
                    <p className="text-sm text-gray-400">
                      alle {schedule.interval} min · {windowLabel(schedule)} · {schedule.cameraIds.map(cameraName).join(', ')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggle(schedule)}
                      title={schedule.enabled ? 'Pausieren' : 'Starten'}
                      className={`p-2 rounded ${schedule.enabled ? 'bg-green-600' : 'bg-gray-600'}`}
                    >
                      {schedule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleDelete(schedule.id)} title="Löschen" className="p-2 rounded bg-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {schedule.enabled && status && (
                  <div className="space-y-2">
                    <div className="h-2 bg-gray-600 rounded overflow-hidden">
                      <div
                        className={`h-full ${status.inTimeWindow ? 'bg-gradient-to-r from-blue-500 to-cyan-400' : 'bg-gray-500'}`}
                        style={{ width: `${status.progress}%`, transition: 'width 0.3s' }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>
                        {status.isRunning ? '📸 Nimmt auf…' : status.inTimeWindow ? `Zuletzt: ${formatTime(status.lastExecution)}` : '⏸ außerhalb des Zeitfensters'}
                      </span>
                      <span>Nächste: {formatTime(status.nextExecution)}</span>
                    </div>
                  </div>
                )}

                {status?.lastError && (
                  <p className="mt-2 text-xs text-red-300 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {status.lastError}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
