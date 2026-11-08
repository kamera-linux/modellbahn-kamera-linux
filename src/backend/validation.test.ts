import { describe, it, expect } from 'vitest';
import { schemas, validate, HttpError } from './validation.js';

describe('capture schema', () => {
  it('applies defaults', () => {
    expect(validate(schemas.capture, {})).toEqual({
      resolution: '1920x1080',
      quality: 90,
      autofocusMode: 'manual',
      autofocusRange: 'normal',
      hdr: 'off'
    });
  });

  it('strips unknown fields such as codec', () => {
    expect(validate<Record<string, unknown>>(schemas.capture, { codec: 'h265' })).not.toHaveProperty('codec');
  });

  it.each([
    { resolution: '1920x1080; reboot' },
    { resolution: '99999x1' },
    { quality: 0 },
    { quality: '90; id' },
    { hdr: 'on' },
    { roi: '"; rm -rf ~ #' },
    { roi: '0.5,0.5,0.6,0.1' },
    { roi: '0,0,0,0.5' }
  ])('rejects %j', body => {
    expect(() => validate(schemas.capture, body)).toThrow(HttpError);
  });

  it('accepts and normalizes a valid ROI', () => {
    expect(validate<{ roi: string }>(schemas.capture, { roi: ' 0.25, 0.25 ,0.5,0.5' }).roi).toBe('0.25,0.25,0.5,0.5');
  });
});

describe('recording schema', () => {
  it('limits duration', () => {
    expect(() => validate(schemas.recording, { duration: 0 })).toThrow();
    expect(() => validate(schemas.recording, { duration: 3601 })).toThrow();
    expect(validate<{ duration: number }>(schemas.recording, { duration: '60' }).duration).toBe(60);
  });
});

describe('schedule schemas', () => {
  const base = { name: 'Test', cameraIds: ['cam1'], interval: 2 };

  it('requires name, cameras and interval', () => {
    expect(() => validate(schemas.scheduleCreate, {})).toThrow();
    expect(() => validate(schemas.scheduleCreate, { ...base, cameraIds: [] })).toThrow();
    expect(() => validate(schemas.scheduleCreate, { ...base, interval: 11 })).toThrow();
    expect(validate(schemas.scheduleCreate, base)).toMatchObject({ ...base, enabled: false });
  });

  it('validates time format', () => {
    expect(() => validate(schemas.scheduleCreate, { ...base, startTime: '25:00' })).toThrow();
    expect(validate(schemas.scheduleCreate, { ...base, startTime: '', endTime: '' })).toMatchObject({ startTime: '' });
  });

  it('update needs at least one field', () => {
    expect(() => validate(schemas.scheduleUpdate, {})).toThrow();
    expect(validate(schemas.scheduleUpdate, { enabled: true })).toEqual({ enabled: true });
  });
});

describe('media filename', () => {
  it.each(['../etc/passwd', '..', '.hidden', 'a/b.jpg', 'a\\b.jpg', ''])('rejects %j', name => {
    expect(() => validate(schemas.mediaFilename, name)).toThrow();
  });
  it('accepts generated names', () => {
    expect(validate(schemas.mediaFilename, 'Kamerawagen-1_2026-05-15T17-14-02.mp4')).toBe('Kamerawagen-1_2026-05-15T17-14-02.mp4');
  });
});
