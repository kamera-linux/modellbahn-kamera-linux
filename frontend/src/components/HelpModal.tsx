import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const H: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-xs font-semibold text-accent uppercase tracking-wider mt-5 mb-2">{children}</h3>
);

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/65 flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Hilfe"
        className="relative bg-surface border border-line rounded-lg p-6 w-full max-w-2xl text-sm text-muted leading-relaxed"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-muted hover:text-fg" title="Schließen (Esc)">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-semibold text-fg mb-2">Hilfe – Modellbahn Kamera</h2>

        <H>Kamerawagen</H>
        <p>
          Jede Kachel zeigt einen Wagen. <span className="pill-green">online</span> heißt per SSH erreichbar,{' '}
          <span className="pill-green">bereit</span> heißt Skripte aktuell und Selbsttest bestanden – nur dann sind Fotos und Videos möglich. Ein
          Klick auf die Kachel wählt den Wagen für die Steuerung darunter aus.
        </p>

        <H>Alle Kamerawagen</H>
        <p>
          Startet alle bereiten Wagen exakt gleichzeitig (einige Sekunden Vorlauf). Mit Haken bei „Ton“ wird das Mikrofon des Servers dazu
          aufgenommen und in jedes Video gemischt. „Mikrofon testen“ zeigt den Pegel; 0 dB heißt übersteuert.
        </p>

        <H>Einzelner Wagen</H>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-fg">Foto</strong>: Auflösung bis 4608×2592, Qualität, Voreinstellungen. Unter „Erweitert“ Autofokus, HDR und
            Bildausschnitt (ROI).
          </li>
          <li>
            <strong className="text-fg">Video</strong>: Dauer, Auflösung, optional Ton. „Stopp“ beendet die Aufnahme vorzeitig, die Datei bleibt
            vollständig.
          </li>
          <li>
            <strong className="text-fg">Einstellungen</strong>: Drehung für Fotos und Videos, falls die Kamera kopfüber oder seitlich eingebaut ist.
          </li>
        </ul>

        <H>Nach der Aufnahme</H>
        <p>
          Der Server lädt das Video vom Wagen und bringt es auf konstante 30 fps (wichtig für Schnittprogramme wie Kdenlive). Gingen dabei Bilder
          verloren, wird das vorherige Bild wiederholt und neu kodiert, damit Bild und Ton synchron bleiben – das zeigt ein gelber Hinweis.
        </p>

        <H>Zeitpläne</H>
        <p>Fotos in festen Abständen von einem oder mehreren Wagen, optional nur in einem Zeitfenster (auch über Mitternacht).</p>

        <H>Aufnahmen</H>
        <p>Videos und Fotos nach Tag sortiert, filterbar nach Wagen. Klick öffnet die Ansicht; dort mit ← → blättern, Esc schließt.</p>

        <H>Monitoring &amp; Diagnose</H>
        <p>
          <strong className="text-fg">Monitoring</strong> öffnet das Grafana-Dashboard: Erreichbarkeit der Wagen, verlorene Bilder, Dauer von
          Download und Nachbearbeitung, Speicherplatz. <strong className="text-fg">Diagnose</strong> testet die SSH-Verbindung jedes Wagens und
          synchronisiert die Skripte von Hand.
        </p>
      </div>
    </div>
  );
};
