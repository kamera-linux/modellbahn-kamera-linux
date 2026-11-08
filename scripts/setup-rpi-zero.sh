#!/usr/bin/env bash
#
# One-time setup on a Raspberry Pi (Zero 2 W) camera car. Runs ON the Pi:
#   bash ~/modellbahn-kamera-linux/scripts/setup-rpi-zero.sh
# or from the manager:  scripts/deploy-cameras.sh --setup

set -euo pipefail

echo "🚀 Modellbahn Kamera – Setup auf $(hostname)"

echo "📦 Pakete installieren …"
sudo apt-get update -qq
# picamera2 + libcamera, Pillow (90/270° photo rotation), ffmpeg (MP4 muxing),
# v4l-utils (HDR switch on Camera Module 3), rpicam-apps for test-camera.sh
sudo apt-get install -y --no-install-recommends \
  python3 python3-picamera2 python3-av python3-pil ffmpeg v4l-utils rpicam-apps-lite openssh-server \
  || sudo apt-get install -y --no-install-recommends \
       python3 python3-picamera2 python3-av python3-pil ffmpeg v4l-utils libcamera-apps-lite openssh-server
sudo apt-get clean

echo "🔐 SSH aktivieren …"
sudo systemctl enable --now ssh

CONFIG=/boot/firmware/config.txt
[[ -f "$CONFIG" ]] || CONFIG=/boot/config.txt
echo "⚙️  Prüfe $CONFIG …"
if grep -qE '^\s*camera_auto_detect\s*=\s*1' "$CONFIG" || grep -qE '^\s*dtoverlay\s*=\s*(imx|ov)[0-9]+' "$CONFIG"; then
  echo "✅ Kamera-Erkennung ist konfiguriert"
else
  echo "⚠️  Weder camera_auto_detect=1 noch ein Kamera-Overlay (z.B. dtoverlay=imx708) gefunden."
  echo "   In $CONFIG ergänzen und neu starten: sudo reboot"
fi

echo "📷 Kamera-Test …"
if command -v rpicam-hello >/dev/null; then
  rpicam-hello --list-cameras || true
elif command -v libcamera-hello >/dev/null; then
  libcamera-hello --list-cameras || true
fi
python3 -c "from picamera2 import Picamera2; print('picamera2 Kameras:', Picamera2.global_camera_info())"

echo "✅ Setup abgeschlossen"
