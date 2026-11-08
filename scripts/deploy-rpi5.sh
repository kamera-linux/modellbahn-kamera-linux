#!/usr/bin/env bash
#
# Deploy the manager to a Raspberry Pi 5 (or any Docker host) and build there natively.
#   scripts/deploy-rpi5.sh [host] [user] [path]
#
# Local config (.env, config/devices.json) and data/ on the target are kept.

set -euo pipefail

TARGET_HOST="${1:-raspberrypi-5-ai-had}"
TARGET_USER="${2:-roimme}"
TARGET_PATH="${3:-modellbahn-kamera-linux}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "📤 Deploy nach $TARGET_USER@$TARGET_HOST:~/$TARGET_PATH"

rsync -az --delete \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=frontend/node_modules \
  --exclude=dist \
  --exclude=public \
  --exclude=data \
  --exclude=.env \
  --exclude=config/devices.json \
  "$ROOT/" "$TARGET_USER@$TARGET_HOST:~/$TARGET_PATH/"

echo "🏗️  Build & Start auf dem Ziel …"
ssh "$TARGET_USER@$TARGET_HOST" "cd ~/$TARGET_PATH && docker compose up -d --build && docker compose ps"

echo "✅ Fertig – UI: http://$TARGET_HOST:8000 (bzw. HOST_PORT aus .env)"
