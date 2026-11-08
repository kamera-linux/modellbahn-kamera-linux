import { describe, it, expect } from 'vitest';
import { summarizeStderr } from './SSHManager.js';

describe('summarizeStderr', () => {
  const libcamera = [
    '[0:10:08.339026483] [3091]  INFO Camera camera_manager.cpp:340 libcamera v0.7.2+rpt20261009',
    "[0:10:08.385201555] [3096]  WARN CameraSensorProperties camera_sensor_properties.cpp:626 No static properties available for 'imx708_wide'",
    '[0:10:09.965720038] [3096] ERROR RPI pipeline_base.cpp:1387 Camera frontend has timed out!',
    '[0:10:09.972768364] [3096] ERROR RPI pipeline_base.cpp:1388 Please check that your camera sensor connector is attached securely.'
  ];

  it('prefers our own "Error:" lines and adds libcamera errors', () => {
    const s = summarizeStderr([...libcamera, 'Error: no video data written'].join('\n'));
    expect(s).toBe('Error: no video data written – Camera frontend has timed out! – Please check that your camera sensor connector is attached securely.');
  });

  it('falls back to libcamera ERROR lines and drops INFO/WARN', () => {
    const s = summarizeStderr(libcamera.join('\n'));
    expect(s).not.toContain('INFO');
    expect(s).not.toContain('No static properties');
    expect(s).toContain('Camera frontend has timed out!');
  });

  it('handles empty output', () => {
    expect(summarizeStderr('')).toBe('unbekannter Fehler');
  });
});
