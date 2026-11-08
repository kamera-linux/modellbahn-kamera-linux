#!/usr/bin/env bash
#
# Deploy the camera scripts to all Raspberry Pis listed in config/devices.json.
#
#   scripts/deploy-cameras.sh              # copy scripts only
#   scripts/deploy-cameras.sh --setup      # also run setup-rpi-zero.sh (apt packages)
#   scripts/deploy-cameras.sh cam2         # only one camera (by id)
#
# SSH key: $SSH_KEY, otherwise SSH_KEY_FILE from .env.
# sudo asks for the password interactively on each Pi (nothing is stored here).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEVICES="$ROOT/config/devices.json"
REMOTE_DIR="modellbahn-kamera-linux/scripts"
FILES=(camera_common.py camera-capture.py camera-record.py camera-selfcheck.py test-camera.sh setup-rpi-zero.sh)

SETUP=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --setup) SETUP=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) ONLY="$arg" ;;
  esac
done

command -v jq >/dev/null || { echo "❌ jq wird benötigt (z.B. emerge app-misc/jq / apt install jq)"; exit 1; }
[[ -f "$DEVICES" ]] || { echo "❌ $DEVICES fehlt (Vorlage: config/devices.json.example)"; exit 1; }

if [[ -z "${SSH_KEY:-}" && -f "$ROOT/.env" ]]; then
  SSH_KEY="$(grep -E '^SSH_KEY_FILE=' "$ROOT/.env" | tail -1 | cut -d= -f2- || true)"
fi
SSH_OPTS=(-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS+=(-i "$SSH_KEY")

failed=0
# Read the list via fd 3 so ssh/sudo inside the loop can't swallow it from stdin.
while IFS=$'\t' read -r id name host user port <&3; do
  [[ -n "$ONLY" && "$ONLY" != "$id" ]] && continue
  target="$user@$host"
  ssh_cmd=(ssh "${SSH_OPTS[@]}" -p "$port")

  echo "━━━ $name ($id, $target:$port) ━━━"
  if ! "${ssh_cmd[@]}" "$target" true 2>/dev/null; then
    echo "❌ SSH nicht erreichbar – übersprungen"
    failed=$((failed + 1))
    continue
  fi

  "${ssh_cmd[@]}" "$target" "mkdir -p ~/$REMOTE_DIR"
  (cd "$ROOT/scripts" && rsync -az --chmod=F755 -e "ssh ${SSH_OPTS[*]} -p $port" "${FILES[@]}" "$target:~/$REMOTE_DIR/")
  echo "✅ Skripte kopiert nach ~/$REMOTE_DIR"

  if [[ "$SETUP" == 1 ]]; then
    # -t: allocate a TTY so sudo can prompt for the password
    "${ssh_cmd[@]}" -t "$target" "bash ~/$REMOTE_DIR/setup-rpi-zero.sh"
  fi
done 3< <(jq -r '.cameras[] | [.id, .name, .host, .user, (.port // 22)] | @tsv' "$DEVICES")

if [[ "$failed" -gt 0 ]]; then
  echo "⚠️  $failed Kamera(s) nicht erreichbar"
  exit 1
fi
echo "🎉 Fertig"
