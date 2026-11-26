import { describe, expect, it } from 'vitest';
import {
  computeAccountBalancePaise,
  computeAdjustedStartingBalancePaise,
  computeMonthlyCategorySpending,
  computeNetTransactionsPaise,
  computeTotalActiveBalancePaise,
  filterTransactions,
  getSortedTransactions,
  isBackupReminderDue,
} from '../../src/domain/calculations';
import {
  AppSettings,
  BankAccount,
  Category,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  FilterState,
  Transaction,
} from '../../src/domain/types';

const accounts: BankAccount[] = [
  {
    id: 'acc-sbi',
    name: 'SBI Savings',
    startingBalancePaise: 100000, // ₹1,000
    createdAt: '2026-10-01T09:00:00Z',
    archived: false,
  },
  {
    id: 'acc-hdfc',
    name: 'HDFC Joint',
    startingBalancePaise: 50000, // ₹500
    createdAt: '2026-10-01T09:00:00Z',
    archived: false,
  },
  {
    id: 'acc-old',
    name: 'Old Bank',
    startingBalancePaise: 900000, // ₹9,000 (archived)
    createdAt: '2025-01-01T09:00:00Z',
    archived: true,
  },
];

const categories: Category[] = [
  ...DEFAULT_CATEGORIES.map((c) =>
    c.id === 'cat-groceries' ? { ...c, name: 'Kirana & Groceries' } : c
  ),
  {
    id: 'cat-hidden',
    name: 'Festival Gifts',
    hidden: true,
    sortOrder: 7,
    isDefault: false,
  },
];

const transactions: Transaction[] = [
  {
    id: 'tx-1',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 30000, // -₹300
    accountId: 'acc-sbi',
    categoryId: 'cat-groceries',
    mode: 'GPay',
    date: '2026-11-10',
    note: 'Vegetables',
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
  },
  {
    id: 'tx-2',
    type: 'deposit',
    direction: 'incoming',
    amountPaise: 50000, // +₹500
    accountId: 'acc-sbi',
    categoryId: null,
    mode: 'Cash',
    date: '2026-11-12',
    note: 'Cash deposit',
    createdAt: '2026-11-12T09:00:00Z',
    updatedAt: '2026-11-12T09:00:00Z',
  },
  {
    id: 'tx-3',
    type: 'transfer',
    direction: 'incoming',
    amountPaise: 20000, // +₹200
    accountId: 'acc-sbi',
    categoryId: null,
    mode: 'GPay',
    date: '2026-11-12',
    note: 'From daughter',
    createdAt: '2026-11-12T15:00:00Z',
    updatedAt: '2026-11-12T15:00:00Z',
  },
  {
    id: 'tx-4',
    type: 'transfer',
    direction: 'outgoing',
    amountPaise: 10000, // -₹100
    accountId: 'acc-sbi',
    categoryId: null,
    mode: 'GPay',
    date: '2026-11-15',
    note: 'Sent to Ramesh',
    createdAt: '2026-11-15T11:00:00Z',
    updatedAt: '2026-11-15T11:00:00Z',
  },
  {
    id: 'tx-5',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 10000, // -₹100
    accountId: 'acc-hdfc',
    categoryId: 'cat-hidden',
    mode: 'Cash',
    date: '2026-11-18',
    note: 'Diwali sweets',
    createdAt: '2026-11-18T12:00:00Z',
    updatedAt: '2026-11-18T12:00:00Z',
  },
  {
    id: 'tx-6',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 40000, // Oct expense
    accountId: 'acc-hdfc',
    categoryId: 'cat-medical',
    mode: 'Card',
    date: '2026-10-20',
    note: 'Clinic',
    createdAt: '2026-10-20T12:00:00Z',
    updatedAt: '2026-10-20T12:00:00Z',
  },
];

describe('account balance calculations', () => {
  it('computes net transactions and account balance adding deposits + incoming transfers and subtracting expenses + outgoing transfers', () => {
    // SBI: start 100000 - 30000 + 50000 + 20000 - 10000 = 130000 (net +30000)
    expect(computeNetTransactionsPaise('acc-sbi', transactions)).toBe(30000);
    expect(computeAccountBalancePaise(accounts[0], transactions)).toBe(130000);
    // HDFC: start 50000 - 10000 - 40000 = 0
    expect(computeAccountBalancePaise(accounts[1], transactions)).toBe(0);
  });

  it('computes total active balance excluding archived accounts', () => {
    // 130000 + 0 = 130000 (excludes acc-old's 900000)
    expect(computeTotalActiveBalancePaise(accounts, transactions)).toBe(130000);
  });

  it('computes adjusted startingBalancePaise even when negative', () => {
    // Desired balance 10000 on SBI where net transactions = +30000 => startingBalancePaise = -20000
    const adjusted = computeAdjustedStartingBalancePaise(10000, 'acc-sbi', transactions);
    expect(adjusted).toBe(-20000);
    expect(
      computeAccountBalancePaise(
        { ...accounts[0], startingBalancePaise: adjusted },
        transactions
      )
    ).toBe(10000);
  });
});

describe('computeMonthlyCategorySpending', () => {
  it('aggregates ONLY expense transactions for ym, excludes deposits and transfers, resolves renamed/hidden category names, and sorts descending', () => {
    const res = computeMonthlyCategorySpending('2026-11', transactions, categories);
    expect(res.totalPaise).toBe(40000); // 30000 (groceries) + 10000 (hidden)
    expect(res.rows).toEqual([
      {
        categoryId: 'cat-groceries',
        name: 'Kirana & Groceries',
        amountPaise: 30000,
        sharePct: 75,
      },
      {
        categoryId: 'cat-hidden',
        name: 'Festival Gifts',
        amountPaise: 10000,
        sharePct: 25,
      },
    ]);
  });

  it('returns empty rows and 0 total for a month with no expenses', () => {
    expect(computeMonthlyCategorySpending('2026-09', transactions, categories)).toEqual({
      totalPaise: 0,
      rows: [],
    });
  });
});

describe('getSortedTransactions and filterTransactions', () => {
  it('sorts newest date first and breaks ties by createdAt descending', () => {
    const sorted = getSortedTransactions(transactions);
    expect(sorted.map((t) => t.id)).toEqual([
      'tx-5',
      'tx-4',
      'tx-3',
      'tx-2',
      'tx-1',
      'tx-6',
    ]);
  });

  it('filters by date range, typeKey, and categoryId', () => {
    const baseFilter: FilterState = {
      fromDate: '',
      toDate: '',
      typeKey: 'all',
      categoryId: 'all',
    };

    expect(
      filterTransactions(transactions, {
        ...baseFilter,
        fromDate: '2026-11-11',
        toDate: '2026-11-15',
      }).map((t) => t.id)
    ).toEqual(['tx-4', 'tx-3', 'tx-2']);

    expect(
      filterTransactions(transactions, {
        ...baseFilter,
        typeKey: 'transfer-outgoing',
      }).map((t) => t.id)
    ).toEqual(['tx-4']);

    expect(
      filterTransactions(transactions, {
        ...baseFilter,
        typeKey: 'transfer-incoming',
      }).map((t) => t.id)
    ).toEqual(['tx-3']);

    expect(
      filterTransactions(transactions, {
        ...baseFilter,
        typeKey: 'deposit',
      }).map((t) => t.id)
    ).toEqual(['tx-2']);

    expect(
      filterTransactions(transactions, {
        ...baseFilter,
        categoryId: 'cat-groceries',
      }).map((t) => t.id)
    ).toEqual(['tx-1']);
  });
});

describe('isBackupReminderDue', () => {
  const now = new Date('2026-11-26T12:00:00Z');

  it('returns due: false when there are 0 active accounts', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      changesSinceLastBackup: 50,
      lastBackupOrExportAt: '2026-01-01T00:00:00Z',
    };
    const archivedOnly = accounts.filter((a) => a.archived);
    expect(isBackupReminderDue(settings, archivedOnly, transactions, now).due).toBe(false);
    expect(isBackupReminderDue(settings, [], transactions, now).due).toBe(false);
  });

  it('returns due: true when changesSinceLastBackup >= 25', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      changesSinceLastBackup: 25,
      lastBackupOrExportAt: '2026-11-25T12:00:00Z',
    };
    expect(isBackupReminderDue(settings, accounts, transactions, now)).toEqual({
      due: true,
      daysSince: 1,
    });
  });

  it('returns due: true when >= 30 days since lastBackupOrExportAt', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      changesSinceLastBackup: 2,
      lastBackupOrExportAt: '2026-10-27T12:00:00Z',
    };
    expect(isBackupReminderDue(settings, accounts, transactions, now)).toEqual({
      due: true,
      daysSince: 30,
    });
  });

  it('falls back to oldest transaction createdAt when never backed up', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      changesSinceLastBackup: 3,
      lastBackupOrExportAt: null,
    };
    // Oldest tx-6 is 2026-10-20T12:00:00Z -> 37 days before 2026-11-26T12:00:00Z
    expect(isBackupReminderDue(settings, accounts, transactions, now)).toEqual({
      due: true,
      daysSince: 37,
    });
  });

  it('returns due: false when recent backup and fewer than 25 changes', () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      changesSinceLastBackup: 24,
      lastBackupOrExportAt: '2026-11-10T12:00:00Z',
    };
    expect(isBackupReminderDue(settings, accounts, transactions, now)).toEqual({
      due: false,
      daysSince: 16,
    });
  });
});
