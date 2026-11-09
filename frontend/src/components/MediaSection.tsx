import React, { useEffect, useMemo, useState } from 'react';
import { Download, Trash2, RefreshCw, Play, X, ChevronLeft, ChevronRight, Video, Camera as CameraIcon } from 'lucide-react';
import { api, errorMessage, type MediaFile } from '../api/client';
import { useMediaStore } from '../store/mediaStore';
import { toast } from '../store/toastStore';
import { formatSize } from './StatusCards';

type Kind = 'photo' | 'video';

const formatDate = (iso: string) => new Date(iso).toLocaleString('de-DE');
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

const dayKey = (iso: string) => new Date(iso).toLocaleDateString('sv-SE'); // YYYY-MM-DD, local time
const dayLabel = (key: string) => {
  const today = new Date().toLocaleDateString('sv-SE');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE');
  const d = new Date(`${key}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return key === today ? `Heute · ${d}` : key === yesterday ? `Gestern · ${d}` : d;
};

/** Camera name part of `Kamerawagen-1_2026-05-15T17-14-02.mp4` */
export const cameraOf = (filename: string) => filename.replace(/_\d{4}-\d{2}-\d{2}T.*$/, '').replace(/_/g, ' ');

const download = (file: MediaFile) => {
  const a = document.createElement('a');
  a.href = file.url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/** Preview tile content: server thumbnail, otherwise a fallback rendered by the browser. */
const Preview: React.FC<{ file: MediaFile; kind: Kind }> = ({ file, kind }) => {
  const [failed, setFailed] = useState(false);
  const cls = 'w-full h-full object-contain';
  if (file.thumbnailUrl && !failed) {
    return <img src={file.thumbnailUrl} alt={file.filename} loading="lazy" decoding="async" className={cls} onError={() => setFailed(true)} />;
  }
  if (kind === 'photo') return <img src={file.viewUrl} alt={file.filename} loading="lazy" decoding="async" className={cls} />;
  return <video src={`${file.viewUrl}#t=0.5`} preload="metadata" muted playsInline className={cls} />;
};

/** Full screen viewer with keyboard navigation. */
const Viewer: React.FC<{
  files: MediaFile[];
  index: number;
  kind: Kind;
  onIndex: (i: number | null) => void;
  onDelete: (f: MediaFile) => void;
}> = ({ files, index, kind, onIndex, onDelete }) => {
  const [playError, setPlayError] = useState(false);
  const open = files[index];
  useEffect(() => setPlayError(false), [index]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndex(null);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < files.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, files.length, onIndex]);
  if (!open) return null;

  const nav = (delta: number, title: string, Icon: typeof ChevronLeft, side: string) => (
    <button
      onClick={e => {
        e.stopPropagation();
        onIndex(index + delta);
      }}
      className={`absolute ${side} p-2 bg-surface/80 hover:bg-line rounded-full`}
      title={title}
    >
      <Icon className="w-6 h-6" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" role="dialog" aria-modal="true" aria-label={open.filename} onClick={() => onIndex(null)}>
      <div className="flex items-center justify-between gap-2 p-3" onClick={e => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="font-mono text-sm truncate">{open.filename}</p>
          <p className="text-xs text-muted">
            {formatDate(open.created)} · {formatSize(open.size)} · {index + 1}/{files.length}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => download(open)} className="p-2 hover:bg-line rounded" title="Herunterladen">
            <Download className="w-5 h-5" />
          </button>
          <button onClick={() => onDelete(open)} className="p-2 hover:bg-bad/40 rounded" title="Löschen">
            <Trash2 className="w-5 h-5" />
          </button>
          <button onClick={() => onIndex(null)} className="p-2 hover:bg-line rounded" title="Schließen (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-12 pb-6">
        {index > 0 && nav(-1, 'Vorheriges (←)', ChevronLeft, 'left-2')}
        {kind === 'photo' ? (
          <img key={open.filename} src={open.viewUrl} alt={open.filename} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
        ) : playError ? (
          <div className="text-center space-y-3" onClick={e => e.stopPropagation()}>
            <p>Dieses Video kann in diesem Browser nicht abgespielt werden (H.264 nicht unterstützt).</p>
            <button onClick={() => download(open)} className="btn-primary">
              <Download className="w-4 h-4" /> Herunterladen
            </button>
          </div>
        ) : (
          <video
            key={open.filename}
            onError={() => setPlayError(true)}
            src={open.viewUrl}
            poster={open.thumbnailUrl}
            controls
            autoPlay
            playsInline
            className="max-w-full max-h-full"
            onClick={e => e.stopPropagation()}
          />
        )}
        {index < files.length - 1 && nav(1, 'Nächstes (→)', ChevronRight, 'right-2')}
      </div>
    </div>
  );
};

/** Videos and photos of all cars: tabs, filter by car, grouped by day. */
export const MediaSection: React.FC = () => {
  const { videos, photos, error, refresh, removeLocal } = useMediaStore();
  const [kind, setKind] = useState<Kind>('video');
  const [camera, setCamera] = useState('');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const label = kind === 'photo' ? 'Foto' : 'Video';

  const all = kind === 'video' ? videos : photos;
  const cameraNames = useMemo(() => [...new Set([...videos, ...photos].map(f => cameraOf(f.filename)))].sort(), [videos, photos]);
  const files = useMemo(
    () => all.filter(f => !camera || cameraOf(f.filename) === camera).sort((a, b) => b.created.localeCompare(a.created)),
    [all, camera]
  );
  const days = useMemo(() => {
    const groups = new Map<string, Array<{ file: MediaFile; index: number }>>();
    files.forEach((file, index) => {
      const k = dayKey(file.created);
      groups.set(k, [...(groups.get(k) ?? []), { file, index }]);
    });
    return [...groups.entries()];
  }, [files]);

  const handleDelete = async (file: MediaFile) => {
    if (!confirm(`${label} ${file.filename} löschen?`)) return;
    try {
      setBusy(true);
      await (kind === 'video' ? api.deleteVideo(file.filename) : api.deletePhoto(file.filename));
      removeLocal(kind, file.filename);
      setOpenIndex(null);
      toast.success(`${label} gelöscht`);
    } catch (err) {
      toast.error(`Löschen fehlgeschlagen: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const switchKind = (k: Kind) => {
    setKind(k);
    setOpenIndex(null);
  };

  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="panel-title !mb-0">Aufnahmen</h2>
        <div className="flex items-center gap-2">
          <select value={camera} onChange={e => setCamera(e.target.value)} className="input !w-auto !py-1.5" aria-label="Wagen filtern">
            <option value="">Alle Wagen</option>
            {cameraNames.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button onClick={() => void refresh()} className="btn-neutral !px-2.5" title="Aktualisieren">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={kind === 'video'} onClick={() => switchKind('video')} className={kind === 'video' ? 'tab-active' : 'tab'}>
          <Video className="w-4 h-4" /> Videos <span className="text-muted">({videos.length})</span>
        </button>
        <button role="tab" aria-selected={kind === 'photo'} onClick={() => switchKind('photo')} className={kind === 'photo' ? 'tab-active' : 'tab'}>
          <CameraIcon className="w-4 h-4" /> Fotos <span className="text-muted">({photos.length})</span>
        </button>
      </div>

      {error && <div className="mb-3 p-3 rounded-lg bg-bad/10 border border-bad/40 text-sm">{error}</div>}

      {files.length === 0 ? (
        <p className="text-muted text-sm text-center py-8">{camera ? `Keine ${label}s von ${camera}` : `Noch keine ${label}s`}</p>
      ) : (
        <div className="space-y-5">
          {days.map(([day, items]) => (
            <div key={day}>
              <h3 className="text-xs font-semibold text-accent bg-accent/5 border-b border-line px-2 py-1.5 mb-3 tracking-wide">
                {dayLabel(day)} <span className="text-muted font-normal">· {items.length}</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map(({ file, index }) => (
                  <figure key={file.filename} className="group bg-bg border border-line rounded-lg overflow-hidden">
                    <button onClick={() => setOpenIndex(index)} className="relative block w-full aspect-video bg-black" title={`${label} ansehen`}>
                      <Preview file={file} kind={kind} />
                      {kind === 'video' && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="bg-black/60 rounded-full p-2 group-hover:bg-accent group-hover:text-black transition-colors">
                            <Play className="w-5 h-5" />
                          </span>
                        </span>
                      )}
                    </button>
                    <figcaption className="p-2 flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{cameraOf(file.filename)}</p>
                        <p className="text-[11px] text-muted truncate">
                          {formatTime(file.created)} · {formatSize(file.size)}
                        </p>
                      </div>
                      <div className="flex shrink-0">
                        <button onClick={() => download(file)} className="p-1 hover:bg-line rounded" title="Herunterladen">
                          <Download className="w-4 h-4 text-accent" />
                        </button>
                        <button onClick={() => handleDelete(file)} disabled={busy} className="p-1 hover:bg-line rounded disabled:opacity-50" title="Löschen">
                          <Trash2 className="w-4 h-4 text-bad" />
                        </button>
                      </div>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openIndex !== null && <Viewer files={files} index={openIndex} kind={kind} onIndex={setOpenIndex} onDelete={handleDelete} />}
    </section>
  );
};
