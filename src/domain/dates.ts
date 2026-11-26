function parseISOParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function formatUTCDateISO(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the local calendar date as `YYYY-MM-DD` (never UTC-shifted).
 */
export function getTodayLocalISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Shifts a `YYYY-MM-DD` calendar date by `deltaDays` days.
 */
export function shiftLocalDateISO(iso: string, deltaDays: number): string {
  const [y, m, d] = parseISOParts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return formatUTCDateISO(dt);
}

/**
 * Formats a `YYYY-MM-DD` date relative to `todayIso` (`Today`, `Yesterday`, `10 Nov`, or `1 Dec 2025`).
 */
export function formatDateShort(iso: string, todayIso: string = getTodayLocalISO()): string {
  if (iso === todayIso) return 'Today';
  if (iso === shiftLocalDateISO(todayIso, -1)) return 'Yesterday';
  const [y, m, d] = parseISOParts(iso);
  const [todayYear] = parseISOParts(todayIso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: y !== todayYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  });
}

/**
 * Formats a `YYYY-MM` month key into a long display title (e.g. `November 2026`).
 */
export function formatMonthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Shifts a `YYYY-MM` month key by `delta` months across year boundaries.
 */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Returns the local calendar month as `YYYY-MM`.
 */
export function getCurrentMonthYM(now: Date = new Date()): string {
  return getTodayLocalISO(now).slice(0, 7);
}
