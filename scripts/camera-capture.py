#!/usr/bin/env python3
"""
Capture a single photo on a Raspberry Pi with picamera2.

Usage:
  python3 camera-capture.py --output /tmp/x.jpg [--width 1920] [--height 1080] [--quality 90]
      [--rotate 0|90|180|270] [--roi x,y,w,h] [--autofocus-mode manual|auto|continuous]
      [--autofocus-range normal|macro|full] [--hdr off|auto] [--timeout 25]
"""

import argparse
import signal
import sys
import time

import camera_common as cc

try:
    from picamera2 import Picamera2
except ImportError as e:
    print(f"Error: {e}", file=sys.stderr)
    print("Please install: sudo apt-get install -y python3-picamera2", file=sys.stderr)
    sys.exit(1)


class CaptureTimeout(Exception):
    pass


def _on_alarm(signum, frame):
    raise CaptureTimeout()


def capture(args):
    roi = cc.parse_roi(args.roi)
    cc.set_sensor_hdr(args.hdr)

    picam2 = Picamera2()
    try:
        # Two stages: autofocus and exposure run in a fast preview mode, then we switch to
        # the still mode only for the capture itself. In full-resolution still mode the
        # sensor delivers so few frames that an autofocus cycle took >30 s and failed
        # (measured on Camera Module 3 / Pi Zero 2 W); this way a 12 MP photo takes ~4 s.
        # The lens position, exposure and white balance carry over to the still frame.
        transform = cc.transform_for(args.rotate)
        af = cc.autofocus_controls(picam2, args.autofocus_mode, args.autofocus_range)

        still = picam2.create_still_configuration(
            main={"size": (args.width, args.height)}, transform=transform, controls=dict(af)
        )
        picam2.configure(still)  # only to learn this mode's ScalerCropMaximum
        crop = cc.scaler_crop(picam2, roi, args.rotate, args.width, args.height)
        if crop:
            still["controls"]["ScalerCrop"] = crop

        pw = min(args.width, 1280)
        ph = max(2, round(pw * args.height / args.width / 2) * 2)  # same aspect ratio, even
        preview = picam2.create_preview_configuration(main={"size": (pw, ph)}, transform=transform, controls=dict(af))
        picam2.configure(preview)
        crop = cc.scaler_crop(picam2, roi, args.rotate, pw, ph)
        if crop:
            picam2.set_controls({"ScalerCrop": crop})  # focus/meter on the selected area
        picam2.options["quality"] = args.quality
        picam2.start()

        if args.autofocus_mode == "auto" and cc.has_autofocus(picam2):
            if not picam2.autofocus_cycle():
                cc.warn("autofocus cycle did not converge")
        else:
            time.sleep(1.0)  # let auto exposure / white balance settle

        if cc.needs_post_rotation(args.rotate):
            image = picam2.switch_mode_and_capture_image(still, "main")
            # PIL rotates counter-clockwise; 90 in our API means clockwise.
            image = image.rotate(-args.rotate, expand=True)
            image.convert("RGB").save(args.output, format="JPEG", quality=args.quality)
        else:
            picam2.switch_mode_and_capture_file(still, args.output)
    finally:
        try:
            picam2.stop()
        finally:
            picam2.close()


def main():
    parser = argparse.ArgumentParser(description="Capture image from Raspberry Pi camera")
    cc.add_common_arguments(parser)
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality 1-100")
    parser.add_argument("--timeout", type=int, default=25, help="Timeout in seconds")
    args = parser.parse_args()

    signal.signal(signal.SIGALRM, _on_alarm)
    signal.alarm(args.timeout)
    try:
        capture(args)
    except CaptureTimeout:
        print(f"Error: camera operation timed out after {args.timeout} seconds", file=sys.stderr)
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 - report everything to the manager
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        signal.alarm(0)

    if args.thumbnail:
        cc.photo_thumbnail(args.output, args.thumbnail)
    print(f"Image captured: {args.output}")


if __name__ == "__main__":
    main()
