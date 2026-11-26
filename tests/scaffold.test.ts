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

  it('uses valid SemVer in package.json starting at 1.0.0', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).toBe('1.0.0');
  });

  it('includes GitHub issue templates with native issue types, ui/ux label, and priorities', () => {
    const templateDir = path.resolve(process.cwd(), '.github/ISSUE_TEMPLATE');
    const config = fs.readFileSync(path.join(templateDir, 'config.yml'), 'utf8');
    expect(config).toContain('blank_issues_enabled: true');
    expect(fs.existsSync(path.join(templateDir, 'polish.yml'))).toBe(false);

    const templates = [
      { file: 'bug.yml', type: 'Bug', expectedLabels: null },
      { file: 'feature.yml', type: 'Feature', expectedLabels: null },
      { file: 'ui-ux.yml', type: 'Feature', expectedLabels: 'labels: ["ui/ux"]' },
    ] as const;

    for (const tpl of templates) {
      const content = fs.readFileSync(path.join(templateDir, tpl.file), 'utf8');
      expect(content).toContain(`type: "${tpl.type}"`);
      if (tpl.expectedLabels) {
        expect(content).toContain(tpl.expectedLabels);
      } else {
        expect(content).not.toContain('labels:');
      }
      for (const priority of ['Urgent', 'High', 'Medium', 'Low']) {
        expect(content).toContain(`- ${priority}`);
      }
    }
  });
});
