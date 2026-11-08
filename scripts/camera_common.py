"""
Shared helpers for camera-capture.py and camera-record.py (runs on the Raspberry Pis).

Rotation:
  0/180 are done by the sensor/ISP via libcamera Transform (free).
  90/270 cannot be done by the ISP; photos are rotated with Pillow afterwards,
  videos get a rotation flag in the MP4 container (players rotate on playback).
  --width/--height always describe the sensor-oriented frame, so 1920x1080 with
  rotation 90 results in a 1080x1920 portrait image.

ROI ("x,y,w,h", 0.0-1.0, relative to the *final* image) is mapped to ScalerCrop
in sensor coordinates, taking rotation into account and widened to the output aspect
ratio so the image is not distorted.
"""

import glob
import subprocess
import sys

try:
    from libcamera import Transform, controls
except ImportError as e:  # pragma: no cover - only on non-Pi machines
    print(f"Error: {e}", file=sys.stderr)
    print("Please install: sudo apt-get install -y python3-picamera2", file=sys.stderr)
    sys.exit(1)


def warn(msg):
    print(f"Warning: {msg}", file=sys.stderr)


def transform_for(rotate):
    if rotate == 180:
        return Transform(hflip=1, vflip=1)
    return Transform()


def needs_post_rotation(rotate):
    return rotate in (90, 270)


def parse_roi(roi):
    if not roi:
        return None
    try:
        x, y, w, h = (float(p) for p in roi.split(","))
    except ValueError:
        raise SystemExit(f"Error: invalid ROI '{roi}', expected x,y,w,h")
    if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > 1 or y + h > 1:
        raise SystemExit(f"Error: ROI '{roi}' out of range")
    return x, y, w, h


def roi_to_sensor_space(roi, rotate):
    """Map an ROI given in final-image coordinates back to unrotated sensor coordinates."""
    x, y, w, h = roi
    # 180 is done with sensor flips (Transform); ScalerCrop then already refers to the
    # flipped image, so no mapping is needed (verified on imx708 / Camera Module 3).
    if rotate == 90:  # image rotated clockwise
        return y, 1 - x - w, h, w
    if rotate == 270:  # image rotated counter-clockwise
        return 1 - y - h, x, h, w
    return x, y, w, h


def scaler_crop(picam2, roi, rotate, out_w, out_h):
    """Compute a ScalerCrop rectangle (sensor pixels) or None."""
    if roi is None:
        return None
    # Only valid after picam2.configure() (depends on the selected sensor mode).
    max_x, max_y, max_w, max_h = picam2.camera_properties["ScalerCropMaximum"]
    if max_w <= 0 or max_h <= 0:
        raise RuntimeError("ScalerCropMaximum not available – call scaler_crop() after configure()")
    x, y, w, h = roi_to_sensor_space(roi, rotate)

    # out_w x out_h is the sensor-oriented output size (before any 90/270 post rotation)
    aspect = out_w / out_h
    cw, ch = w * max_w, h * max_h
    if cw / ch < aspect:
        cw = ch * aspect
    else:
        ch = cw / aspect
    cw, ch = min(cw, max_w), min(ch, max_h)

    cx, cy = (x + w / 2) * max_w, (y + h / 2) * max_h
    left = min(max(cx - cw / 2, 0), max_w - cw)
    top = min(max(cy - ch / 2, 0), max_h - ch)
    return (int(max_x + left), int(max_y + top), int(cw), int(ch))


def autofocus_controls(picam2, mode, af_range):
    """Return AF controls if the camera supports autofocus (e.g. Camera Module 3)."""
    if "AfMode" not in picam2.camera_controls:
        if mode and mode != "manual":
            warn("camera has no autofocus, ignoring autofocus settings")
        return {}
    ctrl = {}
    modes = {
        "manual": controls.AfModeEnum.Manual,
        "auto": controls.AfModeEnum.Auto,
        "continuous": controls.AfModeEnum.Continuous,
    }
    ranges = {
        "normal": controls.AfRangeEnum.Normal,
        "macro": controls.AfRangeEnum.Macro,
        "full": controls.AfRangeEnum.Full,
    }
    if mode in modes:
        ctrl["AfMode"] = modes[mode]
    if af_range in ranges and "AfRange" in picam2.camera_controls:
        ctrl["AfRange"] = ranges[af_range]
    return ctrl


def has_autofocus(picam2):
    return "AfMode" in picam2.camera_controls


def set_sensor_hdr(hdr):
    """
    Camera Module 3 (imx708) has sensor HDR which is switched via V4L2 *before* the
    camera is opened. The setting is sticky, so it is always set explicitly.
    Returns True if a supporting sensor was found.
    """
    value = "1" if hdr == "auto" else "0"
    found = False
    for dev in sorted(glob.glob("/dev/v4l-subdev*")):
        try:
            res = subprocess.run(
                ["v4l2-ctl", "-d", dev, "--set-ctrl", f"wide_dynamic_range={value}"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0:
                found = True
        except (FileNotFoundError, subprocess.TimeoutExpired):
            break
    if hdr == "auto" and not found:
        warn("HDR not supported by this camera (or v4l2-ctl missing), continuing without HDR")
    return found


def add_common_arguments(parser):
    parser.add_argument("--output", required=True, help="Output file path")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--rotate", type=int, default=0, choices=[0, 90, 180, 270])
    parser.add_argument("--roi", default="", help="Region of interest x,y,w,h (0.0-1.0)")
    parser.add_argument("--autofocus-mode", default="manual", choices=["manual", "auto", "continuous"])
    parser.add_argument("--autofocus-range", default="normal", choices=["normal", "macro", "full"])
    parser.add_argument("--hdr", default="off", choices=["off", "auto"])
    parser.add_argument("--thumbnail", default="", help="Also write a small JPEG preview to this path")


THUMB_SIZE = 480


def photo_thumbnail(src, dest):
    """Small JPEG preview of a photo (failures only warn – the photo itself is fine)."""
    try:
        from PIL import Image

        with Image.open(src) as im:
            im.thumbnail((THUMB_SIZE, THUMB_SIZE))
            im.convert("RGB").save(dest, format="JPEG", quality=75)
    except Exception as e:  # noqa: BLE001
        warn(f"thumbnail failed: {e}")


def video_thumbnail(src, dest):
    """Grab a frame ~0.5 s into the video. ffmpeg applies the rotation flag automatically."""
    try:
        res = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", src, "-frames:v", "1",
             "-vf", f"scale={THUMB_SIZE}:{THUMB_SIZE}:force_original_aspect_ratio=decrease", "-q:v", "5", dest],
            capture_output=True, text=True, timeout=60,
        )
        if res.returncode != 0:
            warn(f"video thumbnail failed: {res.stderr.strip()[:200]}")
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        warn(f"video thumbnail failed: {e}")
