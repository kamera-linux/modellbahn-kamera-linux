import React, { useEffect, useState } from 'react';
import { BarChart3, HelpCircle, Wrench } from 'lucide-react';
import { api, type SystemInfo } from '../api/client';
import { useCameraStore } from '../store/cameraStore';

/** Grafana link: configured URL, or the configured port on the host this page was loaded from. */
export const grafanaLink = (g: SystemInfo['grafana']): string | null => {
  if (!g) return null;
  if (g.url) return g.url;
  if (!g.port) return null;
  return `http://${window.location.hostname}:${g.port}${g.dashboard}`;
};

export const Topbar: React.FC<{ diagnostics: boolean; onDiagnostics: () => void; onHelp: () => void }> = ({
  diagnostics,
  onDiagnostics,
  onHelp
}) => {
  const lastUpdate = useCameraStore(s => s.lastUpdate);
  const [grafana, setGrafana] = useState<string | null>(null);

  useEffect(() => {
    api.getInfo().then(r => setGrafana(grafanaLink(r.data.grafana))).catch(() => setGrafana(null));
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-surface border-b border-line">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 font-semibold text-base sm:text-lg min-w-0">
          <img src="/logo-lok.webp" alt="" width={480} height={376} className="h-8 sm:h-9 w-auto shrink-0" />
          <span className="truncate">Modellbahn Kamera</span>
          <span className="pill-gray !font-normal !text-[0.65rem] hidden sm:inline-flex">v{__APP_VERSION__}</span>
        </h1>
        <nav className="flex items-center gap-2 shrink-0">
          {lastUpdate && (
            <span className="text-xs text-muted hidden md:inline" title="Letzte Statusabfrage">
              {lastUpdate.toLocaleTimeString('de-DE')}
            </span>
          )}
          {grafana && (
            <a href={grafana} target="_blank" rel="noopener noreferrer" className="btn-neutral" title="Grafana-Dashboard (neuer Tab)">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">Monitoring</span>
            </a>
          )}
          <button onClick={onDiagnostics} className={diagnostics ? 'btn-primary' : 'btn-neutral'} title="Verbindung und Skripte der Wagen prüfen">
            <Wrench className="w-4 h-4" />
            <span className="hidden sm:inline">Diagnose</span>
          </button>
          <button onClick={onHelp} className="btn-neutral" title="Hilfe">
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Hilfe</span>
          </button>
        </nav>
      </div>
    </header>
  );
};
