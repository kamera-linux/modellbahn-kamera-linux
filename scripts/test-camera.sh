#!/bin/bash

# Schneller Kamera-Test für Raspberry Pi
# Speichert ein Testfoto in ~/camera-captures/

set -e

OUTPUT_DIR="$HOME/camera-captures"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="$OUTPUT_DIR/test_${TIMESTAMP}.jpg"

mkdir -p "$OUTPUT_DIR"

echo "📷 Kamera-Test auf $(hostname)"
echo "================================"
echo ""

# Test 1: Kamera-Liste
echo "🔍 Verfügbare Kameras:"
rpicam-hello --list-cameras 2>&1 | head -10
echo ""

# Test 2: Foto aufnehmen
echo "📸 Foto wird aufgenommen..."
rpicam-jpeg -o "$OUTPUT_FILE" --width 1920 --height 1080 -t 2000

echo "✅ Foto gespeichert: $OUTPUT_FILE"
echo ""
echo "📊 Foto-Info:"
ls -lh "$OUTPUT_FILE"
file "$OUTPUT_FILE"
echo ""
echo "✅ Kamera funktioniert!"
