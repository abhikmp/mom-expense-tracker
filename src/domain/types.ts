export type TransactionType = 'expense' | 'deposit' | 'transfer';
export type TransactionDirection = 'outgoing' | 'incoming';
export type ThemeMode = 'light' | 'dark';
export type ViewId = 'home' | 'record' | 'bank-tx' | 'all' | 'manage';
export type FilterTypeKey =
  | 'all'
  | 'expense'
  | 'deposit'
  | 'transfer-outgoing'
  | 'transfer-incoming';

export interface BankAccount {
  id: string;
  name: string;
  startingBalancePaise: number;
  createdAt: string;
  archived: boolean;
}

export interface Category {
  id: string;
  name: string;
  hidden: boolean;
  sortOrder: number;
  isDefault: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  direction: TransactionDirection;
  amountPaise: number;
  accountId: string;
  categoryId: string | null;
  mode: string;
  date: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  theme: ThemeMode;
  expensePaymentModes: string[];
  transferPaymentModes: string[];
  depositModes: string[];
  lastUsedAccountId: string | null;
  lastBackupOrExportAt: string | null;
  changesSinceLastBackup: number;
}

export interface SaltedHash {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  saltB64: string;
  hashB64: string;
}

export interface SecurityRecord {
  key: 'lock';
  pinHash: SaltedHash;
  masterPasswordHash: SaltedHash;
  updatedAt: string;
}

export interface SecurityThrottleRecord {
  key: 'throttle';
  failedPinAttempts: number;
  pinCooldownUntil: number;
  failedMasterAttempts: number;
  masterCooldownUntil: number;
}

export interface FilterState {
  fromDate: string;
  toDate: string;
  typeKey: FilterTypeKey;
  categoryId: string;
}

export interface BackupPayload {
  _note: string;
  schemaVersion: number;
  exportedAt: string;
  accounts: BankAccount[];
  categories: Category[];
  expensePaymentModes?: string[];
  transferPaymentModes?: string[];
  transactions: Transaction[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat-groceries', name: 'Groceries', hidden: false, sortOrder: 1, isDefault: true },
  { id: 'cat-bills', name: 'Bills', hidden: false, sortOrder: 2, isDefault: true },
  { id: 'cat-medical', name: 'Medical', hidden: false, sortOrder: 3, isDefault: true },
  { id: 'cat-household', name: 'Household', hidden: false, sortOrder: 4, isDefault: true },
  { id: 'cat-travel', name: 'Travel', hidden: false, sortOrder: 5, isDefault: true },
  { id: 'cat-other', name: 'Other', hidden: false, sortOrder: 6, isDefault: true },
];

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  expensePaymentModes: ['GPay', 'Cash', 'Card'],
  transferPaymentModes: ['GPay', 'Cash', 'Cheque'],
  depositModes: ['Cash', 'Cheque'],
  lastUsedAccountId: null,
  lastBackupOrExportAt: null,
  changesSinceLastBackup: 0,
};
