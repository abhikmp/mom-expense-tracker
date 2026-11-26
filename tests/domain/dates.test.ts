import { describe, expect, it } from 'vitest';
import {
  formatDateShort,
  formatMonthTitle,
  getCurrentMonthYM,
  getTodayLocalISO,
  shiftLocalDateISO,
  shiftMonth,
} from '../../src/domain/dates';

describe('getTodayLocalISO', () => {
  it('returns the local calendar date, not the UTC previous day near midnight', () => {
    // Local 00:15 on Nov 26, 2026 in UTC+ timezones (e.g. IST) is Nov 25 in UTC
    expect(getTodayLocalISO(new Date(2026, 10, 26, 0, 15))).toBe('2026-11-26');
    expect(getTodayLocalISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('shiftLocalDateISO', () => {
  it('shifts ISO calendar dates across month and year boundaries', () => {
    expect(shiftLocalDateISO('2026-11-26', -1)).toBe('2026-11-25');
    expect(shiftLocalDateISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftLocalDateISO('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('formatDateShort', () => {
  it('formats Today, Yesterday, current-year dates, and other-year dates', () => {
    expect(formatDateShort('2026-11-26', '2026-11-26')).toBe('Today');
    expect(formatDateShort('2026-11-25', '2026-11-26')).toBe('Yesterday');
    expect(formatDateShort('2026-11-10', '2026-11-26')).toBe('10 Nov');
    expect(formatDateShort('2025-12-01', '2026-11-26')).toBe('1 Dec 2025');
  });
});

describe('formatMonthTitle, shiftMonth, and getCurrentMonthYM', () => {
  it('formats month titles in long Month Year format', () => {
    expect(formatMonthTitle('2026-11')).toBe('November 2026');
    expect(formatMonthTitle('2025-01')).toBe('January 2025');
  });

  it('shifts months across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 2)).toBe('2027-01');
  });

  it('returns YYYY-MM for the local calendar month', () => {
    expect(getCurrentMonthYM(new Date(2026, 10, 26, 0, 15))).toBe('2026-11');
  });
});
