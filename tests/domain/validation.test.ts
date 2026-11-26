import { describe, expect, it } from 'vitest';
import {
  slugifyAccountName,
  validateBackupPayload,
  validateTransactionAmount,
} from '../../src/domain/validation';
import { BackupPayload, DEFAULT_CATEGORIES } from '../../src/domain/types';

function makeValidPayload(): BackupPayload {
  return {
    _note: "Monetary fields ending in 'Paise' store integer paise.",
    schemaVersion: 1,
    exportedAt: '2026-11-26T10:00:00Z',
    accounts: [
      {
        id: 'acc-sbi',
        name: 'SBI Savings',
        startingBalancePaise: 100000,
        createdAt: '2026-10-01T09:00:00Z',
        archived: false,
      },
    ],
    categories: DEFAULT_CATEGORIES,
    expensePaymentModes: ['GPay', 'Cash', 'Card'],
    transferPaymentModes: ['GPay', 'Cash', 'Cheque'],
    transactions: [
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
    ],
  };
}

describe('validateTransactionAmount', () => {
  it('fails on zero with exact helpful message', () => {
    expect(validateTransactionAmount('0')).toEqual({
      valid: false,
      error: 'Please enter an amount greater than ₹0.',
    });
  });

  it('fails on empty, negative, or malformed numbers', () => {
    expect(validateTransactionAmount('').valid).toBe(false);
    expect(validateTransactionAmount('-50').valid).toBe(false);
    expect(validateTransactionAmount('12.345').valid).toBe(false);
  });

  it('returns integer paise for valid amounts', () => {
    expect(validateTransactionAmount('45.50')).toEqual({
      valid: true,
      paise: 4550,
    });
  });
});

describe('validateBackupPayload', () => {
  it('accepts a valid payload with optional payment modes', () => {
    const withModes = validateBackupPayload(makeValidPayload());
    expect(withModes.valid).toBe(true);

    const withoutModes = makeValidPayload();
    delete withoutModes.expensePaymentModes;
    delete withoutModes.transferPaymentModes;
    expect(validateBackupPayload(withoutModes).valid).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(validateBackupPayload(null).valid).toBe(false);
    expect(validateBackupPayload('hello').valid).toBe(false);
    expect(validateBackupPayload([]).valid).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    const p = { ...makeValidPayload(), schemaVersion: 2 };
    expect(validateBackupPayload(p).valid).toBe(false);
  });

  it('rejects missing arrays', () => {
    const p = makeValidPayload() as unknown as Record<string, unknown>;
    delete p.transactions;
    expect(validateBackupPayload(p).valid).toBe(false);
  });

  it('rejects negative or zero amountPaise', () => {
    const p = makeValidPayload();
    p.transactions[0].amountPaise = -100;
    expect(validateBackupPayload(p).valid).toBe(false);

    const pZero = makeValidPayload();
    pZero.transactions[0].amountPaise = 0;
    expect(validateBackupPayload(pZero).valid).toBe(false);
  });

  it('rejects non-integer startingBalancePaise (e.g. 12.5)', () => {
    const p = makeValidPayload();
    p.accounts[0].startingBalancePaise = 12.5;
    expect(validateBackupPayload(p).valid).toBe(false);
  });

  it('rejects unknown accountId in a transaction', () => {
    const p = makeValidPayload();
    p.transactions[0].accountId = 'acc-unknown';
    expect(validateBackupPayload(p).valid).toBe(false);
  });

  it('rejects invalid transaction type', () => {
    const p = makeValidPayload();
    (p.transactions[0] as unknown as Record<string, unknown>).type = 'refund';
    expect(validateBackupPayload(p).valid).toBe(false);
  });
});

describe('slugifyAccountName', () => {
  it('creates clean lowercase URL/filename slugs', () => {
    expect(slugifyAccountName('SBI Savings')).toBe('sbi-savings');
    expect(slugifyAccountName('  HDFC (Main) #1  ')).toBe('hdfc-main-1');
    expect(slugifyAccountName('---')).toBe('account');
  });
});
