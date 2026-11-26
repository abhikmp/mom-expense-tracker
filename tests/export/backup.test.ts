import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  type BankAccount,
  type Transaction,
} from '../../src/domain/types';
import { validateBackupPayload } from '../../src/domain/validation';
import { buildBackupPayload, downloadJsonBackup } from '../../src/export/backup';

const ACCOUNTS: BankAccount[] = [
  {
    id: 'acc-sbi',
    name: 'SBI Savings',
    startingBalancePaise: 100000,
    createdAt: '2026-10-01T09:00:00Z',
    archived: false,
  },
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
    note: 'Milk',
    createdAt: '2026-11-26T08:00:00Z',
    updatedAt: '2026-11-26T08:00:00Z',
  },
];

describe('buildBackupPayload', () => {
  it('builds a schemaVersion 1 payload with _note mentioning Paise and all required fields', () => {
    const payload = buildBackupPayload({
      accounts: ACCOUNTS,
      categories: DEFAULT_CATEGORIES,
      transactions: TRANSACTIONS,
      settings: {
        ...DEFAULT_SETTINGS,
        expensePaymentModes: ['GPay', 'Cash', 'Card', 'PhonePe'],
        transferPaymentModes: ['GPay', 'Cash', 'Cheque', 'NEFT'],
      },
      exportedAt: '2026-11-26T10:00:00.000Z',
    });

    expect(payload._note).toContain('Paise');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.exportedAt).toBe('2026-11-26T10:00:00.000Z');
    expect(payload.accounts).toEqual(ACCOUNTS);
    expect(payload.categories).toEqual(DEFAULT_CATEGORIES);
    expect(payload.expensePaymentModes).toEqual(['GPay', 'Cash', 'Card', 'PhonePe']);
    expect(payload.transferPaymentModes).toEqual(['GPay', 'Cash', 'Cheque', 'NEFT']);
    expect(payload.transactions).toEqual(TRANSACTIONS);
    expect(validateBackupPayload(payload).valid).toBe(true);
  });
});

describe('downloadJsonBackup', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURLSpy = vi.fn(() => 'blob:mock-backup-url');
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
  });

  it('downloads JSON backup with expected filename and triggers Blob download', () => {
    const payload = buildBackupPayload({
      accounts: ACCOUNTS,
      categories: DEFAULT_CATEGORIES,
      transactions: TRANSACTIONS,
      settings: DEFAULT_SETTINGS,
      exportedAt: '2026-11-26T10:00:00.000Z',
    });

    const filename = downloadJsonBackup(payload, '2026-11-26');
    expect(filename).toBe('moms-expenses-backup-2026-11-26.json');
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toContain('application/json');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-backup-url');
  });
});
