# 📋 CHANGELOG – Modellbahn Kamera Manager

Alle Änderungen pro Version. Neue Einträge kommen unter **[Unreleased]**; beim Release
wird daraus automatisch ein Versionsabschnitt (siehe „Release“ im README).
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### 🆕 Neu
- **Gruppenaufnahme mit Ton:** alle Kamerawagen starten gleichzeitig, das Mikrofon des Servers
  (PulseAudio/PipeWire oder ALSA) wird in jedes Video gemischt
- **Automatischer Abgleich der Kamera-Skripte** mit Selbsttest; nur Wagen mit Status „bereit“ nehmen auf
- **Monitoring mit Prometheus und Grafana:** Dashboard „Modellbahn Kamera“ mit Erreichbarkeit,
  Aufnahmen, verlorenen Frames, Speicherplatz und optional den Systemwerten der Pis
- Videos mit verlorenen Frames werden auf konstante 30 fps neu kodiert (für Kdenlive & Co.)
- Oberfläche im Stil der Vogel-Kamera, Lok-Logo, Favicon, Link zu Grafana
- Automatisiertes Release-Management (CHANGELOG, Versionsnummern, Tags, GitHub-Releases, Docker-Images)

### 🔒 Sicherheit
- CSRF-Schutz: schreibende Anfragen aus dem Browser nur von derselben Adresse
- Sicherheits-Header (`nosniff`, `X-Frame-Options`, `frame-ancestors`, `Referrer-Policy`)
- Abhängigkeiten aktualisiert (vite 8, vitest 4), `uuid` durch `crypto.randomUUID` ersetzt

### 🔧 Sonstiges
- Deploy-Skript für den Raspberry Pi 5 ohne persönliche Standardwerte (`RPI5_HOST`, `RPI5_USER`)
- Screenshots der Oberfläche und des Grafana-Dashboards im README

## [1.1.0] - 2026-11-08 – Erste Version

- Zentrale Web-Oberfläche für die Kamerawagen (Raspberry Pi Zero 2 W) mit Steuerung per SSH
- Fotos und Videos pro Wagen, Zeitpläne, Rotation, Autofokus/HDR/ROI, Galerie mit Vorschaubildern
- Login per HTTP Basic Auth, Host-Key-Pinning, Docker-Image für amd64 und arm64
