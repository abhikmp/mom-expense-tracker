import { parseRupeesToPaise } from './money';
import type {
  BackupPayload,
  BankAccount,
  Category,
  Transaction,
  TransactionDirection,
  TransactionType,
} from './types';

const VALID_TYPES = new Set<TransactionType>(['expense', 'deposit', 'transfer']);
const VALID_DIRECTIONS = new Set<TransactionDirection>(['outgoing', 'incoming']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);
}

function validateModeList(value: unknown, fieldName: string): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    return `Invalid ${fieldName} list in backup file.`;
  }
  return null;
}

function validateAccount(item: unknown): item is BankAccount {
  if (!isPlainObject(item)) return false;
  return (
    isNonEmptyString(item.id) &&
    isNonEmptyString(item.name) &&
    isSafeInt(item.startingBalancePaise) &&
    typeof item.createdAt === 'string' &&
    typeof item.archived === 'boolean'
  );
}

function validateCategory(item: unknown): item is Category {
  if (!isPlainObject(item)) return false;
  return (
    isNonEmptyString(item.id) &&
    isNonEmptyString(item.name) &&
    typeof item.hidden === 'boolean' &&
    typeof item.sortOrder === 'number' &&
    Number.isFinite(item.sortOrder) &&
    typeof item.isDefault === 'boolean'
  );
}

function validateTransaction(item: unknown, accountIds: Set<string>): item is Transaction {
  if (!isPlainObject(item)) return false;
  if (!isNonEmptyString(item.id)) return false;
  if (typeof item.type !== 'string' || !VALID_TYPES.has(item.type as TransactionType)) {
    return false;
  }
  if (
    typeof item.direction !== 'string' ||
    !VALID_DIRECTIONS.has(item.direction as TransactionDirection)
  ) {
    return false;
  }
  if (!isSafeInt(item.amountPaise) || item.amountPaise <= 0) return false;
  if (typeof item.accountId !== 'string' || !accountIds.has(item.accountId)) return false;
  if (item.categoryId !== null && typeof item.categoryId !== 'string') return false;
  if (typeof item.mode !== 'string') return false;
  if (typeof item.date !== 'string' || !ISO_DATE_RE.test(item.date)) return false;
  if (typeof item.note !== 'string') return false;
  if (typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string') return false;
  return true;
}

/**
 * Validates a user-entered transaction amount string and converts it to positive integer paise.
 */
export function validateTransactionAmount(
  raw: string
): { valid: true; paise: number } | { valid: false; error: string } {
  const paise = parseRupeesToPaise(raw);
  if (paise === null) {
    return {
      valid: false,
      error: 'Please enter a valid amount (e.g. 500 or 45.50).',
    };
  }
  if (paise <= 0) {
    return {
      valid: false,
      error: 'Please enter an amount greater than ₹0.',
    };
  }
  return { valid: true, paise };
}

/**
 * Validates an imported JSON backup payload before overwriting local IndexedDB state.
 */
export function validateBackupPayload(
  raw: unknown
): { valid: true; payload: BackupPayload } | { valid: false; error: string } {
  if (!isPlainObject(raw)) {
    return { valid: false, error: 'Backup file must be a JSON object.' };
  }
  if (raw.schemaVersion !== 1) {
    return { valid: false, error: 'Unsupported backup schema version.' };
  }
  if (raw._note !== undefined && typeof raw._note !== 'string') {
    return { valid: false, error: 'Invalid _note field in backup file.' };
  }
  if (raw.exportedAt !== undefined && typeof raw.exportedAt !== 'string') {
    return { valid: false, error: 'Invalid exportedAt field in backup file.' };
  }
  if (!Array.isArray(raw.accounts) || !Array.isArray(raw.categories) || !Array.isArray(raw.transactions)) {
    return { valid: false, error: 'Backup file is missing accounts, categories, or transactions.' };
  }

  const expenseModesErr = validateModeList(raw.expensePaymentModes, 'expensePaymentModes');
  if (expenseModesErr) return { valid: false, error: expenseModesErr };
  const transferModesErr = validateModeList(raw.transferPaymentModes, 'transferPaymentModes');
  if (transferModesErr) return { valid: false, error: transferModesErr };

  const accountIds = new Set<string>();
  for (let i = 0; i < raw.accounts.length; i++) {
    const acc = raw.accounts[i];
    if (!validateAccount(acc) || accountIds.has(acc.id)) {
      return { valid: false, error: `Invalid bank account at index ${i}.` };
    }
    accountIds.add(acc.id);
  }

  for (let i = 0; i < raw.categories.length; i++) {
    if (!validateCategory(raw.categories[i])) {
      return { valid: false, error: `Invalid category at index ${i}.` };
    }
  }

  for (let i = 0; i < raw.transactions.length; i++) {
    if (!validateTransaction(raw.transactions[i], accountIds)) {
      return { valid: false, error: `Invalid transaction at index ${i}.` };
    }
  }

  const payload: BackupPayload = {
    _note: typeof raw._note === 'string' ? raw._note : '',
    schemaVersion: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    accounts: raw.accounts as BankAccount[],
    categories: raw.categories as Category[],
    transactions: raw.transactions as Transaction[],
    ...(raw.expensePaymentModes !== undefined
      ? { expensePaymentModes: raw.expensePaymentModes as string[] }
      : {}),
    ...(raw.transferPaymentModes !== undefined
      ? { transferPaymentModes: raw.transferPaymentModes as string[] }
      : {}),
  };

  return { valid: true, payload };
}

/**
 * Converts a bank account name into a safe lowercase slug for CSV filenames.
 */
export function slugifyAccountName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'account';
}
