import React, { useCallback, useEffect, useState } from 'react';
import { Download, Trash2, RefreshCw, Play, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { errorMessage, type MediaFile } from '../api/client';
import type { AxiosResponse } from 'axios';

type Kind = 'photo' | 'video';

interface MediaGalleryProps {
  kind: Kind;
  title: string;
  emptyText: string;
  load: () => Promise<AxiosResponse<MediaFile[]>>;
  remove: (filename: string) => Promise<unknown>;
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Math.round((bytes / 1024 ** i) * 10) / 10} ${units[i]}`;
};

const formatDate = (iso: string) => new Date(iso).toLocaleString('de-DE');
const formatShortDate = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });

/** Camera name part of `Kamerawagen-1_2026-05-15T17-14-02.mp4` */
const cameraOf = (filename: string) => filename.replace(/_\d{4}-\d{2}-\d{2}T.*$/, '').replace(/_/g, ' ');

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
  if (kind === 'photo') {
    return <img src={file.viewUrl} alt={file.filename} loading="lazy" decoding="async" className={cls} />;
  }
  // Older videos without a thumbnail: let the browser show a frame at 0.5 s.
  return <video src={`${file.viewUrl}#t=0.5`} preload="metadata" muted playsInline className={cls} />;
};

export const MediaGallery: React.FC<MediaGalleryProps> = ({ kind, title, emptyText, load, remove }) => {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [playError, setPlayError] = useState(false);
  const label = kind === 'photo' ? 'Foto' : 'Video';

  const refresh = useCallback(async () => {
    try {
      const response = await load();
      setFiles(response.data || []);
      setError('');
    } catch (err) {
      setError(errorMessage(err, `${label}s konnten nicht geladen werden`));
    }
  }, [load, label]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleDelete = async (file: MediaFile) => {
    if (!confirm(`${label} ${file.filename} löschen?`)) return;
    try {
      setBusy(true);
      await remove(file.filename);
      setFiles(prev => prev.filter(f => f.filename !== file.filename));
      setOpenIndex(null);
    } catch (err) {
      setError(errorMessage(err, 'Löschen fehlgeschlagen'));
    } finally {
      setBusy(false);
    }
  };

  const open = openIndex !== null ? files[openIndex] : undefined;

  useEffect(() => setPlayError(false), [openIndex]);

  // Keyboard navigation in the viewer
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenIndex(null);
      if (e.key === 'ArrowLeft') setOpenIndex(i => (i !== null && i > 0 ? i - 1 : i));
      if (e.key === 'ArrowRight') setOpenIndex(i => (i !== null && i < files.length - 1 ? i + 1 : i));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, files.length]);

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold">
          {title} <span className="text-sm font-normal text-gray-400">({files.length})</span>
        </h3>
        <button onClick={refresh} disabled={busy} className="p-2 hover:bg-gray-700 rounded-lg transition-colors" title="Aktualisieren">
          <RefreshCw className={`w-5 h-5 ${busy ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="bg-red-500/20 border border-red-500 text-red-200 p-3 rounded-lg mb-4">{error}</div>}

      {files.length === 0 ? (
        <p className="text-gray-400">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[32rem] overflow-y-auto pr-1">
          {files.map((file, index) => (
            <figure key={file.filename} className="group bg-gray-700 rounded-lg overflow-hidden">
              <button
                onClick={() => setOpenIndex(index)}
                className="relative block w-full aspect-video bg-gray-900"
                title={`${label} ansehen`}
              >
                <Preview file={file} kind={kind} />
                {kind === 'video' && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-black/60 rounded-full p-2 group-hover:bg-blue-600 transition-colors">
                      <Play className="w-5 h-5 text-white" />
                    </span>
                  </span>
                )}
              </button>
              <figcaption className="p-2 flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{cameraOf(file.filename)}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {formatShortDate(file.created)} · {formatSize(file.size)}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <button onClick={() => download(file)} className="p-1 hover:bg-blue-600 rounded" title="Herunterladen">
                    <Download className="w-4 h-4 text-blue-400" />
                  </button>
                  <button onClick={() => handleDelete(file)} disabled={busy} className="p-1 hover:bg-red-600 rounded disabled:opacity-50" title="Löschen">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {open && openIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={open.filename}
          onClick={() => setOpenIndex(null)}
        >
          <div className="flex items-center justify-between gap-2 p-3 text-gray-200" onClick={e => e.stopPropagation()}>
            <div className="min-w-0">
              <p className="font-mono text-sm truncate">{open.filename}</p>
              <p className="text-xs text-gray-400">
                {formatDate(open.created)} · {formatSize(open.size)} · {openIndex + 1}/{files.length}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => download(open)} className="p-2 hover:bg-gray-700 rounded" title="Herunterladen">
                <Download className="w-5 h-5" />
              </button>
              <button onClick={() => handleDelete(open)} className="p-2 hover:bg-red-700 rounded" title="Löschen">
                <Trash2 className="w-5 h-5" />
              </button>
              <button onClick={() => setOpenIndex(null)} className="p-2 hover:bg-gray-700 rounded" title="Schließen (Esc)">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="relative flex-1 min-h-0 flex items-center justify-center px-12 pb-6">
            {openIndex > 0 && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  setOpenIndex(openIndex - 1);
                }}
                className="absolute left-2 p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full"
                title="Vorheriges (←)"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            {kind === 'photo' ? (
              <img key={open.filename} src={open.viewUrl} alt={open.filename} className="max-w-full max-h-full object-contain" onClick={e => e.stopPropagation()} />
            ) : playError ? (
              <div className="text-center text-gray-300 space-y-3" onClick={e => e.stopPropagation()}>
                <p>Dieses Video kann in diesem Browser nicht abgespielt werden (H.264 nicht unterstützt).</p>
                <button onClick={() => download(open)} className="btn-primary inline-flex items-center gap-2">
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
            {openIndex < files.length - 1 && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  setOpenIndex(openIndex + 1);
                }}
                className="absolute right-2 p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full"
                title="Nächstes (→)"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
