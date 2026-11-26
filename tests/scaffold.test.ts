import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../src/domain/types';

describe('Project scaffold and defaults', () => {
  it('defines the 6 default categories with hidden: false', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.name)).toEqual([
      'Groceries',
      'Bills',
      'Medical',
      'Household',
      'Travel',
      'Other',
    ]);
    expect(DEFAULT_CATEGORIES.every((c) => c.hidden === false)).toBe(true);
  });

  it('defines default settings payment and deposit modes', () => {
    expect(DEFAULT_SETTINGS.expensePaymentModes).toEqual(['GPay', 'Cash', 'Card']);
    expect(DEFAULT_SETTINGS.transferPaymentModes).toEqual(['GPay', 'Cash', 'Cheque']);
    expect(DEFAULT_SETTINGS.depositModes).toEqual(['Cash', 'Cheque']);
    expect(DEFAULT_SETTINGS.theme).toBe('light');
  });

  it('has zero external network URLs in index.html', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain('Mom\'s Expense Tracker');
    expect(html).toContain('icons/apple-touch-icon.png');
  });

  it('includes valid local PNG icons in public/icons/', () => {
    const iconFiles = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
    for (const file of iconFiles) {
      const buf = fs.readFileSync(path.resolve(process.cwd(), 'public/icons', file));
      expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });
});
