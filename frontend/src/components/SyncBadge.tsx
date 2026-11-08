import React from 'react';
import { CheckCircle2, Loader2, AlertTriangle, CircleDashed } from 'lucide-react';
import type { Camera } from '../api/client';

/** Ready = scripts synced and self-check passed; only then the camera may record. */
export const isReady = (c: Camera) => c.status !== 'offline' && c.sync?.state === 'ready';

export const notReadyReason = (c: Camera): string => {
  if (c.status === 'offline') return 'offline';
  switch (c.sync?.state) {
    case 'syncing':
      return 'Skripte werden synchronisiert…';
    case 'error':
      return c.sync.error || 'Fehler';
    case 'ready':
      return '';
    default:
      return 'wird geprüft…';
  }
};

export const SyncBadge: React.FC<{ camera: Camera }> = ({ camera }) => {
  if (camera.status === 'offline') return null;
  const s = camera.sync?.state ?? 'unknown';
  const title = [
    camera.sync?.version && `Skripte ${camera.sync.version}`,
    camera.sync?.error,
    ...(camera.sync?.warnings ?? [])
  ]
    .filter(Boolean)
    .join('\n');

  if (s === 'ready') {
    return (
      <span title={title} className="inline-flex items-center gap-1 text-xs text-green-400">
        <CheckCircle2 className="w-3.5 h-3.5" /> bereit
        {camera.sync.warnings?.length ? <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" /> : null}
      </span>
    );
  }
  if (s === 'error') {
    return (
      <span title={title} className="inline-flex items-center gap-1 text-xs text-red-400">
        <AlertTriangle className="w-3.5 h-3.5" /> nicht bereit
      </span>
    );
  }
  if (s === 'syncing' || s === 'checking') {
    return (
      <span title={title} className="inline-flex items-center gap-1 text-xs text-blue-300">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {s === 'syncing' ? 'synchronisiere…' : 'prüfe…'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
      <CircleDashed className="w-3.5 h-3.5" /> wartet
    </span>
  );
};
