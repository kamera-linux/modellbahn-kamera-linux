import { describe, it, expect } from 'vitest';
import { isInTimeWindow, parseHHmm } from './timeWindow.js';

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 4, 15, h, m, 30);
};

describe('parseHHmm', () => {
  it('parses valid times', () => {
    expect(parseHHmm('00:00')).toBe(0);
    expect(parseHHmm('23:59')).toBe(23 * 60 + 59);
  });
  it('rejects invalid/empty', () => {
    expect(parseHHmm('')).toBeNull();
    expect(parseHHmm(undefined)).toBeNull();
    expect(parseHHmm('24:00')).toBeNull();
    expect(parseHHmm('7:00')).toBeNull();
  });
});

describe('isInTimeWindow', () => {
  it('no window = always', () => {
    expect(isInTimeWindow(at('03:00'))).toBe(true);
    expect(isInTimeWindow(at('03:00'), '', '')).toBe(true);
  });

  it('normal window, bounds inclusive', () => {
    expect(isInTimeWindow(at('07:59'), '08:00', '18:00')).toBe(false);
    expect(isInTimeWindow(at('08:00'), '08:00', '18:00')).toBe(true);
    expect(isInTimeWindow(at('18:00'), '08:00', '18:00')).toBe(true);
    expect(isInTimeWindow(at('18:01'), '08:00', '18:00')).toBe(false);
  });

  it('window across midnight', () => {
    expect(isInTimeWindow(at('23:00'), '22:00', '02:00')).toBe(true);
    expect(isInTimeWindow(at('01:30'), '22:00', '02:00')).toBe(true);
    expect(isInTimeWindow(at('12:00'), '22:00', '02:00')).toBe(false);
  });

  it('only start or only end', () => {
    expect(isInTimeWindow(at('09:00'), '10:00')).toBe(false);
    expect(isInTimeWindow(at('11:00'), '10:00')).toBe(true);
    expect(isInTimeWindow(at('11:00'), undefined, '10:00')).toBe(false);
    expect(isInTimeWindow(at('09:00'), undefined, '10:00')).toBe(true);
  });
});
