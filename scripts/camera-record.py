#!/usr/bin/env python3
"""
Record an H.264 video (MP4) on a Raspberry Pi with picamera2.

Stops after --duration seconds, or earlier on SIGINT/SIGTERM (the manager sends
SIGINT for "stop recording"). The file is always closed cleanly, so a stopped
recording is still a valid MP4.

Usage:
  python3 camera-record.py --output /tmp/x.mp4 --duration 60 [--width 1920] [--height 1080]
      [--rotate 0|90|180|270] [--roi x,y,w,h] [--autofocus-mode ...] [--autofocus-range ...]
      [--hdr off|auto] [--fps 30] [--bitrate 5000000] [--timeout N]
"""

import argparse
import os
import signal
import subprocess
import sys
import time

import camera_common as cc

try:
    from picamera2 import Picamera2
    from picamera2.encoders import H264Encoder
    from picamera2.outputs import FfmpegOutput
except ImportError as e:
    print(f"Error: {e}", file=sys.stderr)
    print("Please install: sudo apt-get install -y python3-picamera2", file=sys.stderr)
    sys.exit(1)

try:
    # In-process MP4 muxing with real frame timestamps (picamera2 >= 0.3.20 + python3-av).
    from picamera2.outputs import PyavOutput
except ImportError:
    PyavOutput = None

stop_requested = False
timed_out = False


def _request_stop(signum, frame):
    global stop_requested
    stop_requested = True


def _on_alarm(signum, frame):
    global stop_requested, timed_out
    stop_requested = True
    timed_out = True


def set_rotation_flag(path, rotate):
    """Store a clockwise rotation in the MP4 container without re-encoding."""
    tmp = path + ".rot.mp4"
    attempts = [
        # ffmpeg >= 6: display rotation is counter-clockwise
        ["ffmpeg", "-y", "-loglevel", "error", "-display_rotation:v:0", str(-rotate), "-i", path, "-c", "copy", tmp],
        # older ffmpeg: rotate tag is clockwise
        ["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-c", "copy", "-metadata:s:v:0", f"rotate={rotate}", tmp],
    ]
    for cmd in attempts:
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        except (FileNotFoundError, subprocess.TimeoutExpired) as e:
            cc.warn(f"could not set rotation flag: {e}")
            return
        if res.returncode == 0:
            os.replace(tmp, path)
            return
    if os.path.exists(tmp):
        os.remove(tmp)
    cc.warn("could not set rotation flag, video stays unrotated")


def make_output(path, muxer):
    """
    PyavOutput writes the MP4 inside this process using the real frame timestamps.
    FfmpegOutput pipes into an external ffmpeg that assumes a constant frame rate:
    if that pipe stalls (slow ffmpeg start on a Pi Zero), frames are dropped and the
    video becomes shorter than the recording.
    """
    if muxer == "pyav":
        if PyavOutput is not None:
            return PyavOutput(path, format="mp4")
        cc.warn("PyavOutput not available (install python3-av), falling back to ffmpeg")
    return FfmpegOutput(path)


def record(args):
    roi = cc.parse_roi(args.roi)
    cc.set_sensor_hdr(args.hdr)

    picam2 = Picamera2()
    recording = False
    try:
        ctrl = cc.autofocus_controls(picam2, args.autofocus_mode, args.autofocus_range)
        ctrl["FrameRate"] = args.fps
        config = picam2.create_video_configuration(
            main={"size": (args.width, args.height), "format": "YUV420"},
            transform=cc.transform_for(args.rotate),
            controls=ctrl,
        )
        picam2.configure(config)
        crop = cc.scaler_crop(picam2, roi, args.rotate, args.width, args.height)
        if crop:
            picam2.set_controls({"ScalerCrop": crop})

        encoder = H264Encoder(bitrate=args.bitrate)
        picam2.start_recording(encoder, make_output(args.output, args.muxer))
        recording = True

        if args.autofocus_mode == "auto" and cc.has_autofocus(picam2):
            picam2.autofocus_cycle(wait=False)

        end = time.monotonic() + args.duration
        while not stop_requested and time.monotonic() < end:
            time.sleep(0.2)
    finally:
        try:
            if recording:
                picam2.stop_recording()
        finally:
            picam2.close()

    if cc.needs_post_rotation(args.rotate):
        set_rotation_flag(args.output, args.rotate)


def main():
    parser = argparse.ArgumentParser(description="Record video from Raspberry Pi camera")
    cc.add_common_arguments(parser)
    parser.add_argument("--duration", type=float, required=True, help="Duration in seconds")
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--bitrate", type=int, default=5_000_000)
    parser.add_argument("--timeout", type=int, default=None, help="Hard limit in seconds")
    parser.add_argument("--muxer", default="pyav", choices=["pyav", "ffmpeg"], help="MP4 writer")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _request_stop)
    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(args.timeout or int(args.duration) + 45)

    started = time.monotonic()
    try:
        record(args)
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        signal.alarm(0)

    if not os.path.exists(args.output) or os.path.getsize(args.output) == 0:
        print("Error: no video data written", file=sys.stderr)
        sys.exit(1)

    if args.thumbnail:
        cc.video_thumbnail(args.output, args.thumbnail)

    elapsed = time.monotonic() - started
    if timed_out:
        cc.warn(f"hard timeout reached, recording cut after {elapsed:.0f}s")
    note = " (stopped early)" if stop_requested and not timed_out else ""
    print(f"Video recorded: {args.output} ({elapsed:.0f}s, rotate={args.rotate}){note}")


if __name__ == "__main__":
    main()
