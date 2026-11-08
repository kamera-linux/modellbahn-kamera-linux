"""Unit tests for camera_common (runs without a Pi: libcamera is stubbed).

    python3 -I scripts/test_camera_common.py
"""

import sys
import types
import unittest
from pathlib import Path

stub = types.ModuleType("libcamera")
stub.Transform = lambda **kw: kw
stub.controls = types.SimpleNamespace()
sys.modules["libcamera"] = stub
sys.path.insert(0, str(Path(__file__).resolve().parent))

import camera_common as cc  # noqa: E402


class FakeCam:
    camera_properties = {"ScalerCropMaximum": (0, 0, 4000, 2000)}
    camera_controls = {}


def close(a, b):
    return all(abs(x - y) < 1e-9 for x, y in zip(a, b))


class RoiMapping(unittest.TestCase):
    roi = (0.1, 0.2, 0.3, 0.4)

    def test_identity(self):
        self.assertEqual(cc.roi_to_sensor_space(self.roi, 0), self.roi)

    def test_180_is_identity_because_sensor_flips(self):
        self.assertEqual(cc.roi_to_sensor_space(self.roi, 180), self.roi)

    def test_90_and_270_swap_size(self):
        self.assertTrue(close(cc.roi_to_sensor_space(self.roi, 90), (0.2, 0.6, 0.4, 0.3)))
        self.assertTrue(close(cc.roi_to_sensor_space(self.roi, 270), (0.4, 0.1, 0.4, 0.3)))

    def test_90_then_270_roundtrip_of_full_frame(self):
        full = (0.0, 0.0, 1.0, 1.0)
        for r in (0, 90, 180, 270):
            self.assertTrue(close(cc.roi_to_sensor_space(full, r), full))


class ScalerCrop(unittest.TestCase):
    def test_requires_configured_camera(self):
        cam = FakeCam()
        cam.camera_properties = {"ScalerCropMaximum": (0, 0, 0, 0)}
        with self.assertRaises(RuntimeError):
            cc.scaler_crop(cam, (0.0, 0.0, 0.5, 0.5), 0, 1920, 1080)

    def test_none_without_roi(self):
        self.assertIsNone(cc.scaler_crop(FakeCam(), None, 0, 1920, 1080))

    def test_keeps_output_aspect_and_stays_inside(self):
        x, y, w, h = cc.scaler_crop(FakeCam(), (0.0, 0.0, 0.5, 0.5), 0, 1920, 1080)
        self.assertAlmostEqual(w / h, 1920 / 1080, places=2)
        self.assertGreaterEqual(x, 0)
        self.assertGreaterEqual(y, 0)
        self.assertLessEqual(x + w, 4000)
        self.assertLessEqual(y + h, 2000)

    def test_full_frame_is_clamped(self):
        x, y, w, h = cc.scaler_crop(FakeCam(), (0.0, 0.0, 1.0, 1.0), 0, 1920, 1080)
        self.assertLessEqual(w, 4000)
        self.assertLessEqual(h, 2000)


class ParseRoi(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(cc.parse_roi("0.25,0.25,0.5,0.5"), (0.25, 0.25, 0.5, 0.5))
        self.assertIsNone(cc.parse_roi(""))

    def test_invalid(self):
        for bad in ("1,2,3", "a,b,c,d", "0.6,0,0.5,0.5"):
            with self.assertRaises(SystemExit):
                cc.parse_roi(bad)


if __name__ == "__main__":
    unittest.main()
