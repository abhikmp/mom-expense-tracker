import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BankAccount, Category, Transaction } from '../../src/domain/types';
import {
  buildBalancesCsv,
  buildTransactionsCsv,
  csvCell,
  exportCsvFiles,
} from '../../src/export/csv';

const ACCOUNTS: BankAccount[] = [
  {
    id: 'acc-sbi',
    name: 'SBI Savings',
    startingBalancePaise: 100000, // ₹1000.00
    createdAt: '2026-10-01T09:00:00Z',
    archived: false,
  },
  {
    id: 'acc-old',
    name: 'Old ICICI',
    startingBalancePaise: 50000, // ₹500.00
    createdAt: '2026-09-01T09:00:00Z',
    archived: true,
  },
];

const CATEGORIES: Category[] = [
  { id: 'cat-groceries', name: 'Groceries', hidden: false, sortOrder: 1, isDefault: true },
  { id: 'cat-hidden', name: 'Gifts (Old)', hidden: true, sortOrder: 7, isDefault: false },
];

const TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-1',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 4550,
    accountId: 'acc-sbi',
    categoryId: 'cat-groceries',
    mode: 'GPay',
    date: '2026-11-26',
    note: 'Milk, bread "fresh"\nmorning',
    createdAt: '2026-11-26T08:00:00Z',
    updatedAt: '2026-11-26T08:00:00Z',
  },
  {
    id: 'tx-2',
    type: 'deposit',
    direction: 'incoming',
    amountPaise: 25000,
    accountId: 'acc-sbi',
    categoryId: null,
    mode: 'Cash',
    date: '2026-11-25',
    note: 'Cash deposit',
    createdAt: '2026-11-25T10:00:00Z',
    updatedAt: '2026-11-25T10:00:00Z',
  },
  {
    id: 'tx-3',
    type: 'transfer',
    direction: 'outgoing',
    amountPaise: 10000,
    accountId: 'acc-old',
    categoryId: null,
    mode: 'GPay',
    date: '2026-11-24',
    note: '',
    createdAt: '2026-11-24T10:00:00Z',
    updatedAt: '2026-11-24T10:00:00Z',
  },
  {
    id: 'tx-4',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 15000,
    accountId: 'acc-old',
    categoryId: 'cat-hidden',
    mode: 'Cash',
    date: '2026-11-23',
    note: 'Diwali gift',
    createdAt: '2026-11-23T10:00:00Z',
    updatedAt: '2026-11-23T10:00:00Z',
  },
];

describe('csvCell', () => {
  it('escapes commas, quotes, CR, and LF according to RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('buildTransactionsCsv', () => {
  it('starts with UTF-8 BOM, uses CRLF, and has exact header', () => {
    const csv = buildTransactionsCsv(TRANSACTIONS, ACCOUNTS, CATEGORIES);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const body = csv.slice(1);
    const lines = body.split('\r\n');
    expect(lines[0]).toBe('Date,Type,Direction,Account,Category,Mode,Amount,Signed Amount,Note');
    // Line 1 has embedded newline inside quoted note, so verify raw CRLF usage and exact row prefixes
    expect(body).toContain(
      '2026-11-26,expense,outgoing,SBI Savings,Groceries,GPay,45.50,-45.50,"Milk, bread ""fresh""\nmorning"\r\n'
    );
  });

  it('leaves Category empty for deposit/transfer and preserves archived accounts & hidden categories', () => {
    const csv = buildTransactionsCsv(TRANSACTIONS, ACCOUNTS, CATEGORIES);
    expect(csv).toContain('2026-11-25,deposit,incoming,SBI Savings,,Cash,250.00,250.00,Cash deposit');
    expect(csv).toContain('2026-11-24,transfer,outgoing,Old ICICI,,GPay,100.00,-100.00,');
    expect(csv).toContain('2026-11-23,expense,outgoing,Old ICICI,Gifts (Old),Cash,150.00,-150.00,Diwali gift');
  });
});

describe('buildBalancesCsv', () => {
  it('starts with UTF-8 BOM, exact header, marks Active/Archived, and computes Current Balance', () => {
    const csv = buildBalancesCsv(ACCOUNTS, TRANSACTIONS, '2026-11-26');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toEqual([
      'Account,Status,Starting Balance,Current Balance,As Of Date',
      'SBI Savings,Active,1000.00,1204.50,2026-11-26',
      'Old ICICI,Archived,500.00,250.00,2026-11-26',
    ]);
  });
});

describe('exportCsvFiles', () => {
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURLSpy,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURLSpy,
    });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      writable: true,
      value: originalShare,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      writable: true,
      value: originalCanShare,
    });
  });

  it('builds exact filenames for all, filtered, and bank scopes', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });

    const allRes = await exportCsvFiles({
      transactions: TRANSACTIONS,
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'all',
      todayIso: '2026-11-26',
    });
    expect(allRes).toEqual({
      method: 'download',
      files: ['transactions-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });

    const filteredRes = await exportCsvFiles({
      transactions: [TRANSACTIONS[0]],
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'filtered',
      todayIso: '2026-11-26',
    });
    expect(filteredRes).toEqual({
      method: 'download',
      files: ['transactions-filtered-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });

    const bankRes = await exportCsvFiles({
      transactions: [TRANSACTIONS[0], TRANSACTIONS[1]],
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'bank',
      bankName: 'SBI Savings',
      todayIso: '2026-11-26',
    });
    expect(bankRes).toEqual({
      method: 'download',
      files: ['transactions-sbi-savings-filtered-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });
  });

  it('uses navigator.share({ files }) with 2 File objects when canShare returns true without triggering download', async () => {
    const canShareMock = vi.fn(() => true);
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShareMock });
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });

    const result = await exportCsvFiles({
      transactions: [TRANSACTIONS[0]],
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'filtered',
      todayIso: '2026-11-26',
    });

    expect(result).toEqual({
      method: 'share',
      files: ['transactions-filtered-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });
    expect(canShareMock).toHaveBeenCalledTimes(1);
    expect(shareMock).toHaveBeenCalledTimes(1);
    const shareArg = shareMock.mock.calls[0][0] as { files: File[] };
    expect(shareArg.files).toHaveLength(2);
    expect(shareArg.files[0]).toBeInstanceOf(File);
    expect(shareArg.files[1]).toBeInstanceOf(File);
    expect(shareArg.files.map((f) => f.name)).toEqual([
      'transactions-filtered-2026-11-26.csv',
      'bank-balances-2026-11-26.csv',
    ]);
    const readFileText = (file: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    const txCsvText = await readFileText(shareArg.files[0]);
    const balCsvText = await readFileText(shareArg.files[1]);
    expect(txCsvText).toContain('2026-11-26,expense,outgoing,SBI Savings,Groceries');
    expect(txCsvText).not.toContain('Cash deposit');
    expect(balCsvText).toContain('SBI Savings,Active,1000.00,1204.50,2026-11-26');
    expect(balCsvText).toContain('Old ICICI,Archived,500.00,250.00,2026-11-26');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('returns cancelled without download fallback when navigator.share rejects with AbortError', async () => {
    const canShareMock = vi.fn(() => true);
    const shareMock = vi.fn().mockRejectedValue(new DOMException('User cancelled', 'AbortError'));
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShareMock });
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });

    const result = await exportCsvFiles({
      transactions: TRANSACTIONS,
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'all',
      todayIso: '2026-11-26',
    });

    expect(result).toEqual({
      method: 'cancelled',
      files: ['transactions-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });
    expect(clickSpy).not.toHaveBeenCalled();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('falls back to Blob URL downloads when navigator.share rejects with a non-AbortError', async () => {
    vi.useFakeTimers();
    const canShareMock = vi.fn(() => true);
    const shareMock = vi.fn().mockRejectedValue(new Error('Share failed'));
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShareMock });
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });

    const result = await exportCsvFiles({
      transactions: TRANSACTIONS,
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'all',
      todayIso: '2026-11-26',
    });

    expect(result).toEqual({
      method: 'download',
      files: ['transactions-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });
    expect(createObjectURLSpy).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to Blob URL downloads when navigator.canShare returns false or is missing', async () => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => false) });
    const shareMock = vi.fn();
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });

    const result = await exportCsvFiles({
      transactions: TRANSACTIONS,
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'all',
      todayIso: '2026-11-26',
    });

    expect(result.method).toBe('download');
    expect(shareMock).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to downloads when navigator.share exists but navigator.canShare is undefined', async () => {
    const shareMock = vi.fn();
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });

    const result = await exportCsvFiles({
      transactions: TRANSACTIONS,
      allTransactions: TRANSACTIONS,
      accounts: ACCOUNTS,
      categories: CATEGORIES,
      scope: 'all',
      todayIso: '2026-11-26',
    });

    expect(result.method).toBe('download');
    expect(shareMock).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});
