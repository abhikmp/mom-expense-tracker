import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackupPayload,
  type BankAccount,
  type Category,
  type Transaction,
} from '../domain/types';
import { validateBackupPayload } from '../domain/validation';

const DEFAULT_DB_NAME = 'mom-expense-tracker';
const DB_VERSION = 1;
const SETTINGS_KEY = 'app' as const;

export interface SettingsRecord extends AppSettings {
  key: typeof SETTINGS_KEY;
}

export interface MomExpenseDbSchema extends DBSchema {
  accounts: {
    key: string;
    value: BankAccount;
  };
  categories: {
    key: string;
    value: Category;
  };
  transactions: {
    key: string;
    value: Transaction;
    indexes: {
      'by-date': string;
      'by-account': string;
    };
  };
  settings: {
    key: typeof SETTINGS_KEY;
    value: SettingsRecord;
  };
}

export interface AppDbState {
  accounts: BankAccount[];
  categories: Category[];
  transactions: Transaction[];
  settings: AppSettings;
}

function cloneDefaultSettings(): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    expensePaymentModes: [...DEFAULT_SETTINGS.expensePaymentModes],
    transferPaymentModes: [...DEFAULT_SETTINGS.transferPaymentModes],
    depositModes: [...DEFAULT_SETTINGS.depositModes],
  };
}

function toAppSettings(record: SettingsRecord | undefined): AppSettings {
  const defaults = cloneDefaultSettings();
  if (!record) return defaults;
  return {
    theme: record.theme ?? defaults.theme,
    expensePaymentModes: Array.isArray(record.expensePaymentModes)
      ? [...record.expensePaymentModes]
      : defaults.expensePaymentModes,
    transferPaymentModes: Array.isArray(record.transferPaymentModes)
      ? [...record.transferPaymentModes]
      : defaults.transferPaymentModes,
    depositModes: Array.isArray(record.depositModes)
      ? [...record.depositModes]
      : defaults.depositModes,
    lastUsedAccountId: record.lastUsedAccountId ?? defaults.lastUsedAccountId,
    lastBackupOrExportAt: record.lastBackupOrExportAt ?? defaults.lastBackupOrExportAt,
    changesSinceLastBackup:
      typeof record.changesSinceLastBackup === 'number'
        ? record.changesSinceLastBackup
        : defaults.changesSinceLastBackup,
  };
}

function toSettingsRecord(settings: AppSettings): SettingsRecord {
  return {
    key: SETTINGS_KEY,
    ...settings,
    expensePaymentModes: [...settings.expensePaymentModes],
    transferPaymentModes: [...settings.transferPaymentModes],
    depositModes: [...settings.depositModes],
  };
}

function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
}

function sortAccounts(accounts: BankAccount[]): BankAccount[] {
  return [...accounts].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}

function sortTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Opens (and upgrades if needed) the IndexedDB database for Mom Expense Tracker.
 */
export async function openAppDb(
  dbName: string = DEFAULT_DB_NAME
): Promise<IDBPDatabase<MomExpenseDbSchema>> {
  return openDB<MomExpenseDbSchema>(dbName, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('by-date', 'date');
        txStore.createIndex('by-account', 'accountId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    },
  });
}

/**
 * Loads all persisted state, seeding default categories and settings on first launch.
 */
export async function loadAppState(
  db: IDBPDatabase<MomExpenseDbSchema>
): Promise<AppDbState> {
  const tx = db.transaction(['accounts', 'categories', 'transactions', 'settings'], 'readwrite');
  const [accounts, rawCategories, transactions, rawSettings] = await Promise.all([
    tx.objectStore('accounts').getAll(),
    tx.objectStore('categories').getAll(),
    tx.objectStore('transactions').getAll(),
    tx.objectStore('settings').get(SETTINGS_KEY),
  ]);

  let categories = rawCategories;
  if (categories.length === 0) {
    const categoryStore = tx.objectStore('categories');
    categories = DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    await Promise.all(categories.map((category) => categoryStore.put(category)));
  }

  const settings = toAppSettings(rawSettings);
  if (!rawSettings) {
    await tx.objectStore('settings').put(toSettingsRecord(settings));
  }

  await tx.done;

  return {
    accounts: sortAccounts(accounts),
    categories: sortCategories(categories),
    transactions: sortTransactions(transactions),
    settings,
  };
}

/**
 * Atomically persists a new transaction and updates `lastUsedAccountId` and `changesSinceLastBackup`.
 */
export async function createTransactionAtomic(
  db: IDBPDatabase<MomExpenseDbSchema>,
  record: Transaction
): Promise<AppSettings> {
  const tx = db.transaction(['transactions', 'settings'], 'readwrite');
  const settingsStore = tx.objectStore('settings');

  await tx.objectStore('transactions').put(record);
  const current = toAppSettings(await settingsStore.get(SETTINGS_KEY));
  const nextSettings: AppSettings = {
    ...current,
    lastUsedAccountId: record.accountId,
    changesSinceLastBackup: current.changesSinceLastBackup + 1,
  };
  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;

  return nextSettings;
}

/**
 * Atomically updates an existing transaction and increments `changesSinceLastBackup`.
 */
export async function updateTransactionAtomic(
  db: IDBPDatabase<MomExpenseDbSchema>,
  record: Transaction
): Promise<AppSettings> {
  const tx = db.transaction(['transactions', 'settings'], 'readwrite');
  const settingsStore = tx.objectStore('settings');

  await tx.objectStore('transactions').put(record);
  const current = toAppSettings(await settingsStore.get(SETTINGS_KEY));
  const nextSettings: AppSettings = {
    ...current,
    changesSinceLastBackup: current.changesSinceLastBackup + 1,
  };
  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;

  return nextSettings;
}

/**
 * Atomically deletes a transaction by ID and increments `changesSinceLastBackup` if it existed.
 */
export async function deleteTransactionAtomic(
  db: IDBPDatabase<MomExpenseDbSchema>,
  txId: string
): Promise<AppSettings> {
  const tx = db.transaction(['transactions', 'settings'], 'readwrite');
  const txStore = tx.objectStore('transactions');
  const settingsStore = tx.objectStore('settings');

  const existing = await txStore.get(txId);
  const current = toAppSettings(await settingsStore.get(SETTINGS_KEY));

  if (!existing) {
    await tx.done;
    return current;
  }

  await txStore.delete(txId);
  const nextSettings: AppSettings = {
    ...current,
    changesSinceLastBackup: current.changesSinceLastBackup + 1,
  };
  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;

  return nextSettings;
}

/**
 * Saves a bank account and optionally marks it as `lastUsedAccountId`.
 */
export async function saveAccount(
  db: IDBPDatabase<MomExpenseDbSchema>,
  account: BankAccount,
  updateLastUsed: boolean = false
): Promise<void> {
  if (!updateLastUsed) {
    await db.put('accounts', account);
    return;
  }

  const tx = db.transaction(['accounts', 'settings'], 'readwrite');
  await tx.objectStore('accounts').put(account);
  const settingsStore = tx.objectStore('settings');
  const current = toAppSettings(await settingsStore.get(SETTINGS_KEY));
  const nextSettings: AppSettings = {
    ...current,
    lastUsedAccountId: account.id,
  };
  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;
}

/**
 * Saves a category record (create, rename, or toggle hidden while preserving `id`).
 */
export async function saveCategory(
  db: IDBPDatabase<MomExpenseDbSchema>,
  category: Category
): Promise<void> {
  await db.put('categories', category);
}

/**
 * Applies a partial patch to app settings and returns the updated settings.
 */
export async function saveSettings(
  db: IDBPDatabase<MomExpenseDbSchema>,
  patch: Partial<AppSettings>
): Promise<AppSettings> {
  const tx = db.transaction('settings', 'readwrite');
  const settingsStore = tx.objectStore('settings');
  const current = toAppSettings(await settingsStore.get(SETTINGS_KEY));
  const nextSettings = toAppSettings({
    key: SETTINGS_KEY,
    ...current,
    ...patch,
  });
  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;

  return nextSettings;
}

/**
 * Records a completed JSON backup or CSV export and resets `changesSinceLastBackup` to `0`.
 */
export async function markBackupOrExportCompleted(
  db: IDBPDatabase<MomExpenseDbSchema>,
  exportedAtIso: string
): Promise<AppSettings> {
  return saveSettings(db, {
    lastBackupOrExportAt: exportedAtIso,
    changesSinceLastBackup: 0,
  });
}

/**
 * Atomically validates and restores a backup payload, replacing all stored data.
 */
export async function restoreBackupAtomic(
  db: IDBPDatabase<MomExpenseDbSchema>,
  payload: BackupPayload
): Promise<AppDbState> {
  const validation = validateBackupPayload(payload);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const valid = validation.payload;
  const tx = db.transaction(['accounts', 'categories', 'transactions', 'settings'], 'readwrite');
  const accountsStore = tx.objectStore('accounts');
  const categoriesStore = tx.objectStore('categories');
  const transactionsStore = tx.objectStore('transactions');
  const settingsStore = tx.objectStore('settings');

  const currentSettings = toAppSettings(await settingsStore.get(SETTINGS_KEY));

  await Promise.all([
    accountsStore.clear(),
    categoriesStore.clear(),
    transactionsStore.clear(),
  ]);

  const accounts = valid.accounts.map((account) => ({ ...account }));
  const categories = valid.categories.map((category) => ({ ...category }));
  const transactions = valid.transactions.map((item) => ({ ...item }));

  await Promise.all([
    ...accounts.map((account) => accountsStore.put(account)),
    ...categories.map((category) => categoriesStore.put(category)),
    ...transactions.map((item) => transactionsStore.put(item)),
  ]);

  const firstActiveAccount = accounts.find((account) => !account.archived);
  const nextSettings: AppSettings = {
    ...currentSettings,
    expensePaymentModes: valid.expensePaymentModes
      ? [...valid.expensePaymentModes]
      : [...DEFAULT_SETTINGS.expensePaymentModes],
    transferPaymentModes: valid.transferPaymentModes
      ? [...valid.transferPaymentModes]
      : [...DEFAULT_SETTINGS.transferPaymentModes],
    lastUsedAccountId: firstActiveAccount ? firstActiveAccount.id : null,
    changesSinceLastBackup: 0,
  };

  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;

  return {
    accounts: sortAccounts(accounts),
    categories: sortCategories(categories),
    transactions: sortTransactions(transactions),
    settings: nextSettings,
  };
}
