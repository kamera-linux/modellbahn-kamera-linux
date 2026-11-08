/** "HH:mm" -> minutes since midnight, or null if empty/invalid. */
export function parseHHmm(value?: string | null): number | null {
  if (!value) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

/**
 * Is `now` (local time) inside the window [start, end]? Both bounds inclusive at minute granularity.
 * - no start and no end: always
 * - only start: from start until midnight
 * - only end: from midnight until end
 * - start > end: window wraps around midnight (e.g. 22:00-02:00)
 */
export function isInTimeWindow(now: Date, start?: string, end?: string): boolean {
  const s = parseHHmm(start);
  const e = parseHHmm(end);
  const t = now.getHours() * 60 + now.getMinutes();

  if (s === null && e === null) return true;
  if (s !== null && e === null) return t >= s;
  if (s === null && e !== null) return t <= e;
  if (s! <= e!) return t >= s! && t <= e!;
  return t >= s! || t <= e!; // wraps midnight
}
