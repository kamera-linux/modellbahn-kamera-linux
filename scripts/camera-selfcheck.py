#!/usr/bin/env python3
"""
Self-check of a camera car, run by the manager after syncing the scripts.
Prints one JSON line: {"ok": bool, "errors": [...], "warnings": [...], "cameras": [...]}

errors   -> the Pi must not record (missing picamera2, no camera detected)
warnings -> works with reduced features (e.g. no PyAV -> ffmpeg muxer fallback)
"""

import importlib
import json
import shutil
import sys

result = {"ok": True, "errors": [], "warnings": [], "cameras": []}


def need(module, package, required=True, why=""):
    try:
        importlib.import_module(module)
        return True
    except Exception as e:  # noqa: BLE001
        msg = f"{package} fehlt ({e.__class__.__name__}){' – ' + why if why else ''} → sudo apt install {package}"
        (result["errors"] if required else result["warnings"]).append(msg)
        return False


if need("picamera2", "python3-picamera2"):
    try:
        from picamera2 import Picamera2

        result["cameras"] = [c.get("Model", "?") for c in Picamera2.global_camera_info()]
        if not result["cameras"]:
            result["errors"].append("keine Kamera erkannt – Flachbandkabel und camera_auto_detect=1 prüfen")
    except Exception as e:  # noqa: BLE001
        result["errors"].append(f"Kamera-Abfrage fehlgeschlagen: {e}")

need("PIL", "python3-pil", required=False, why="keine Vorschaubilder, keine 90°/270°-Fotos")
need("av", "python3-av", required=False, why="Videos über externes ffmpeg (kann Bilder verlieren)")

if not shutil.which("ffmpeg"):
    result["warnings"].append("ffmpeg fehlt – keine Video-Vorschaubilder, keine 90°-Rotation → sudo apt install ffmpeg")
if not shutil.which("v4l2-ctl"):
    result["warnings"].append("v4l2-ctl fehlt – HDR nicht verfügbar → sudo apt install v4l-utils")

result["ok"] = not result["errors"]
print(json.dumps(result))
sys.exit(0)
