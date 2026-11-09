import React from 'react';
import { Circle, Loader2 } from 'lucide-react';
import { useCameraStore } from '../store/cameraStore';
import { useMediaStore } from '../store/mediaStore';
import { isReady, notReadyReason } from './SyncBadge';
import type { Camera } from '../api/client';

export const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Math.round((bytes / 1024 ** i) * 10) / 10} ${units[i]}`;
};

const ago = (iso?: string | Date) => {
  if (!iso) return 'seit Serverstart nicht erreicht';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `vor ${h} h` : new Date(iso).toLocaleDateString('de-DE');
};

const StatusPill: React.FC<{ camera: Camera }> = ({ camera }) => {
  if (camera.status === 'recording')
    return (
      <span className="pill-blue">
        <Circle className="w-2.5 h-2.5 fill-current animate-pulse" /> nimmt auf
      </span>
    );
  if (camera.status === 'offline') return <span className="pill-red">offline</span>;
  return <span className="pill-green">online</span>;
};

const ReadyPill: React.FC<{ camera: Camera }> = ({ camera }) => {
  if (camera.status === 'offline') return null;
  if (isReady(camera)) return <span className="pill-green">bereit</span>;
  const s = camera.sync?.state;
  if (s === 'syncing' || s === 'checking')
    return (
      <span className="pill-yellow">
        <Loader2 className="w-3 h-3 animate-spin" /> {s === 'syncing' ? 'synchronisiert' : 'prüft'}
      </span>
    );
  return (
    <span className="pill-yellow" title={notReadyReason(camera)}>
      nicht bereit
    </span>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({ label, value, sub }) => (
  <div className="stat-card">
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
  </div>
);

/** Overview and one tile per camera car; clicking a tile selects the car. */
export const StatusCards: React.FC = () => {
  const { cameras, selectedCameraId, setSelectedCamera, error } = useCameraStore();
  const { videos, photos } = useMediaStore();
  const ready = cameras.filter(isReady).length;
  const recording = cameras.filter(c => c.status === 'recording').length;
  const sum = (files: { size: number }[]) => files.reduce((a, f) => a + f.size, 0);

  return (
    <section>
      <h3 className="group-label">Übersicht</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat
          label="Wagen bereit"
          value={
            <span className={ready === 0 ? 'text-bad' : ready < cameras.length ? 'text-warn' : 'text-ok'}>
              {ready}
              <span className="text-muted text-lg font-normal"> / {cameras.length}</span>
            </span>
          }
        />
        <Stat label="Aktive Aufnahmen" value={<span className={recording ? 'text-accent' : ''}>{recording}</span>} />
        <Stat label="Videos" value={videos.length} sub={formatSize(sum(videos))} />
        <Stat label="Fotos" value={photos.length} sub={formatSize(sum(photos))} />
      </div>

      <h3 className="group-label">Kamerawagen</h3>
      {error && <div className="mb-3 p-3 rounded-lg bg-bad/10 border border-bad/40 text-sm">{error}</div>}
      {cameras.length === 0 ? (
        <p className="text-muted text-sm mb-5">Keine Kameras konfiguriert (config/devices.json)</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {cameras.map(camera => {
            const selected = camera.id === selectedCameraId;
            return (
              <button
                key={camera.id}
                onClick={() => setSelectedCamera(camera)}
                aria-pressed={selected}
                className={`stat-card text-left transition-colors ${
                  selected ? '!border-accent ring-1 ring-accent' : 'hover:border-gray-500'
                } ${camera.status === 'offline' ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{camera.name}</span>
                  <StatusPill camera={camera} />
                </div>
                <div className="flex items-center justify-between gap-2 mt-3 min-h-[1.5rem]">
                  <span className="text-xs text-muted" title={`${camera.user}@${camera.host}:${camera.port}`}>
                    {camera.status === 'offline' ? camera.lastSeen ? `zuletzt ${ago(camera.lastSeen)}` : ago(camera.lastSeen) : selected ? 'ausgewählt' : 'zum Steuern anklicken'}
                  </span>
                  <ReadyPill camera={camera} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
