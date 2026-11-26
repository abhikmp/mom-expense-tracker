import { describe, expect, it } from 'vitest';
import {
  formatDecimalRupeesPlain,
  formatRupees,
  parseRupeesToPaise,
} from '../../src/domain/money';

describe('parseRupeesToPaise', () => {
  it('parses comma-formatted rupee amounts into integer paise', () => {
    expect(parseRupeesToPaise('1,250.50')).toBe(125050);
  });

  it('parses zero and single-decimal amounts', () => {
    expect(parseRupeesToPaise('0')).toBe(0);
    expect(parseRupeesToPaise('45.5')).toBe(4550);
    expect(parseRupeesToPaise(' 500 ')).toBe(50000);
  });

  it('rejects more than 2 decimals, negatives, empty, and non-numeric strings', () => {
    expect(parseRupeesToPaise('12.345')).toBeNull();
    expect(parseRupeesToPaise('-10')).toBeNull();
    expect(parseRupeesToPaise('')).toBeNull();
    expect(parseRupeesToPaise('abc')).toBeNull();
    expect(parseRupeesToPaise('10.')).toBeNull();
  });

  it('avoids floating-point drift on decimal additions', () => {
    const a = parseRupeesToPaise('0.1');
    const b = parseRupeesToPaise('0.2');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a ?? 0) + (b ?? 0)).toBe(30);
    expect(parseRupeesToPaise('19.99')).toBe(1999);
  });
});

describe('formatRupees', () => {
  it('formats whole rupees in en-IN grouping without .00', () => {
    expect(formatRupees(125000)).toBe('₹1,250');
    expect(formatRupees(12500000)).toBe('₹1,25,000');
    expect(formatRupees(0)).toBe('₹0');
  });

  it('formats fractional paise with 2 decimal digits', () => {
    expect(formatRupees(124050)).toBe('₹1,240.50');
    expect(formatRupees(50)).toBe('₹0.50');
  });

  it('supports signed and negative formatting', () => {
    expect(formatRupees(-48500, { signed: true })).toBe('-₹485');
    expect(formatRupees(800000, { signed: true })).toBe('+₹8,000');
    expect(formatRupees(-500)).toBe('-₹5');
  });
});

describe('formatDecimalRupeesPlain', () => {
  it('formats paise as plain decimal rupees with 2 decimals', () => {
    expect(formatDecimalRupeesPlain(4550)).toBe('45.50');
    expect(formatDecimalRupeesPlain(125000)).toBe('1250.00');
    expect(formatDecimalRupeesPlain(-500)).toBe('-5.00');
  });
});
