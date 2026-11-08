# Architektur

```mermaid
flowchart TB
    browser(["🌐 Browser"])

    subgraph manager["Manager (Docker)"]
        express["Express + Basic Auth"]
        frontend["React-Frontend"]
        mediaApi["Medien-API"]
        schedMgr["ScheduleManager"]
        camMgr["CameraManager"]
        ssh["SSHManager<br/>Host-Keys gepinnt"]
        data[("data/<br/>Fotos · Videos · Zeitpläne · Logs")]
        cfg[("config/devices.json")]
    end

    subgraph pis["Kamerawagen (Pi Zero 2 W)"]
        direction LR
        cam1["cam1"]
        cam2["cam2"]
        cam3["cam3"]
    end

    browser -- "HTTP :8000" --> express
    express --> frontend
    express --> mediaApi
    express --> schedMgr
    express --> camMgr
    schedMgr -- "Foto je Intervall" --> camMgr
    camMgr --> ssh
    camMgr --> cfg
    schedMgr --> data
    mediaApi --> data
    ssh -- "Download" --> data
    ssh -- "SSH: camera-*.py" --> cam1
    ssh --> cam2
    ssh --> cam3
```

Auf den Pis läuft kein eigener Dienst. Der Manager ruft per SSH die Python-Skripte aus `scripts/` auf und lädt die Datei danach per SFTP herunter.

## Backend (`src/backend`)

| Modul | Aufgabe |
|---|---|
| `config.ts` | Alle Einstellungen aus der Umgebung (`.env`), Pfade unter `config/` und `data/` |
| `app.ts` / `index.ts` | Express-App (Auth, Routen, SPA, Fehlerbehandlung) bzw. Serverstart und Shutdown |
| `validation.ts` | Joi-Schemas für alle Eingaben, `HttpError` |
| `middleware/auth.ts` | HTTP Basic Auth (zeitkonstanter Vergleich), `/health` bleibt frei |
| `services/SSHManager.ts` | Verbindungspool pro Ziel, parallele Verbindungsaufbauten werden zusammengeführt, TOFU-Host-Key-Prüfung (`data/known_hosts.json`) |
| `services/CameraManager.ts` | Kameras aus `devices.json`, Statusprüfung alle 30 s (parallel, 5 s Timeout), Foto/Video, Sperre pro Kamera |
| `services/RecordingManager.ts` | Aufnahme-Sessions und Fortschritt, räumt alte Sessions auf |
| `services/ScheduleManager.ts` | Zeitpläne mit echtem Intervall-Timer, persistiert in `data/schedules.json` |
| `services/timeWindow.ts` | Zeitfenster-Logik (inkl. über Mitternacht) |
| `routes/media.ts` | Gemeinsamer Router für Foto- und Video-Dateien: Liste, Inline-Ansicht, Download, Vorschaubild, Löschen |
| `utils/shell.ts` | Quoting aller Argumente für Remote-Befehle |

### Sicherheit

- **Eingaben**: Jede Route validiert ihren Body mit Joi, unbekannte Felder werden entfernt. Zusätzlich gehen alle Werte durch `shellQuote`, bevor sie in einen Remote-Befehl eingesetzt werden. Beides zusammen verhindert Command Injection.
- **Ziele**: SSH-Verbindungen gibt es nur zu Kameras aus `devices.json`. Die Diagnose nimmt eine Kamera-ID, keinen Host.
- **Dateien**: Dateinamen werden gegen ein striktes Muster und die erlaubten Endungen geprüft, das verhindert Path Traversal.
- **Container**: läuft als unprivilegierter User. Gemountet wird nur der eine private Key (read-only), nicht `~/.ssh`.
- **Login**: Basic Auth. Über ein unverschlüsseltes Netz geht das Passwort im Klartext. Im Heimnetz ist das vertretbar, für Zugriff von außen gehört ein Reverse Proxy mit TLS davor.

### Kamera-Zugriff

Ein Kameramodul kann nur von einem Prozess gleichzeitig benutzt werden. `CameraManager.withLock` serialisiert deshalb alle Zugriffe pro Kamera:

- Fotos (manuell oder per Zeitplan) warten in der Warteschlange.
- Ein Video hält die Sperre bis zum Ende des Downloads.
- Ein Foto während einer Videoaufnahme wird mit `409` abgelehnt, statt bis zu einer Stunde zu warten.

## Abläufe

### Foto

1. `POST /api/cameras/cam1/capture`: Body validieren
2. Sperre für `cam1` holen
3. SSH: `exec timeout -k 10 30 python3 …/camera-capture.py --output /tmp/kamera_<uuid>.jpg …`
4. Das Skript schreibt zusätzlich ein Vorschaubild (`--thumbnail`, 480 px, Pillow)
5. SFTP-Download nach `data/photos/<Kamera>_<UTC>.jpg` und `data/thumbnails/photos/…jpg`, danach die Remote-Dateien löschen. Fehlt das Vorschaubild, bleibt die Aufnahme trotzdem gültig

### Video und Stopp

1. `record/start` legt eine Session an, setzt den Status `recording` und startet den Remote-Befehl im Hintergrund. Die HTTP-Antwort kommt sofort.
2. `camera-record.py` nimmt `--duration` Sekunden auf.
3. `record/stop` schickt `pkill -INT -f "[c]amera-record.py --output <datei>"`. Das Skript fängt SIGINT ab und schließt die MP4-Datei sauber, der Remote-Befehl endet mit Exit-Code 0.
4. Nach der Aufnahme zieht ffmpeg bei 0,5 s ein Einzelbild als Vorschau heraus, mit Rotation
5. Der Hintergrund-Job lädt Video und Vorschau herunter, markiert die Session als `completed` und setzt den Status wieder auf `online`.

Harte Grenzen: Das Skript hat einen eigenen Alarm (`--timeout`). Zusätzlich beendet `timeout -k 10` den Prozess, falls er hängt.

### Zeitplan

- Beim Aktivieren: sofort ein Durchlauf, danach `setInterval(interval)`.
- Jeder Tick prüft das Zeitfenster und überspringt, solange der vorige Durchlauf noch läuft.
- Alle Kameras des Plans nehmen parallel auf (`Promise.allSettled`). Fehler einzelner Kameras landen in `lastError`, der Plan läuft weiter.
- Beim Serverstart werden aktive Pläne aus `data/schedules.json` wieder gestartet.

## Pi-Skripte (`scripts/`)

| Datei | Zweck |
|---|---|
| `camera_common.py` | Rotation, ROI → `ScalerCrop`, Autofokus, HDR, gemeinsame Argumente |
| `camera-capture.py` | Foto: Autofokus und Belichtung in schneller Vorschau-Auflösung, dann Umschalten in den Still-Modus nur für die Aufnahme (12 MP in ~4–8 s statt Timeout) |
| `camera-record.py` | Video H.264 → MP4 im eigenen Prozess via PyAV mit echten Zeitstempeln (Fallback: externes ffmpeg), sauberer Stopp bei SIGINT/SIGTERM |
| `setup-rpi-zero.sh` | Pakete (`python3-picamera2`, `python3-av`, `python3-pil`, `ffmpeg`, `v4l-utils`, …) und Kamera-Check |
| `test-camera.sh` | Schnelltest direkt auf dem Pi |
| `deploy-cameras.sh` | Skripte auf alle Pis aus `devices.json` kopieren, optional Setup |
| `deploy-rpi5.sh` | Manager auf den Pi 5 synchronisieren und dort bauen |

**Rotation**: 180° übernimmt der ISP (`Transform(hflip, vflip)`) ohne Rechenaufwand. 90°/270° kann der ISP nicht. Fotos dreht deshalb Pillow nach der Aufnahme. Aus 1920×1080 wird dabei ein Hochformat-Foto mit 1080×1920, denn die Auflösung bezieht sich immer auf den Sensor. Videos bekommen ein Rotations-Flag im MP4-Container (ohne Neukodierung, das ist auf dem Zero 2 W zu langsam), und der Player dreht beim Abspielen.

**ROI**: Die Angabe bezieht sich auf das fertige (gedrehte) Bild. Bei 90°/270° wird sie in Sensor-Koordinaten zurückgerechnet. Bei 180° ist das nicht nötig, weil `ScalerCrop` die Sensor-Spiegelung schon berücksichtigt (auf Camera Module 3 geprüft). `ScalerCrop` wird erst nach `configure()` gesetzt und auf das Seitenverhältnis der Ausgabe erweitert, damit das Bild nicht verzerrt.

**Autofokus/HDR**: werden nur gesetzt, wenn die Kamera sie unterstützt (Camera Module 3). Sonst schreibt das Skript eine Warnung nach stderr und macht ohne weiter.

## Frontend (`frontend/`)

Fotos und Videos zeigt die gemeinsame Komponente `MediaGallery`: Vorschaubilder im Raster, Klick öffnet die Großansicht (Foto oder Video-Player, ←/→ blättern, Esc schließt). Ältere Aufnahmen ohne Vorschaubild zeigt der Browser direkt (Foto verkleinert, Video mit dem Bild bei 0,5 s). Kann ein Browser kein H.264 abspielen, erscheint ein Hinweis mit Download-Knopf.

React 18, Vite, Tailwind, Zustand. Die Typen kommen aus `src/shared/types.ts` (Alias `@shared`, nur `import type`). Der Kamerastatus wird alle 5 s abgefragt. Die ausgewählte Kamera wird über die ID aus dem Store gelesen, damit Status wie „recording“ immer aktuell sind.

## Tests

`vitest` unter `src/**/*.test.ts`:

- Shell-Quoting (gegen eine echte Shell geprüft) und Befehlsaufbau
- Validierung
- Zeitfenster
- ScheduleManager (Fake-Timer, Persistenz)
- Basic Auth
- Media-Routen (Traversal, Löschen)

Die CI (`.github/workflows/build.yml`) führt Lint, Typecheck, Tests und Build für Node 20 und 22 aus, außerdem Python-Syntaxcheck und ShellCheck. Auf `main` baut sie das Multi-Arch-Image nach GHCR.
