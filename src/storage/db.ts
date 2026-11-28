import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackupPayload,
  type BankAccount,
  type Category,
  type SecurityRecord,
  type SecurityThrottleRecord,
  type Transaction,
} from '../domain/types';
import { validateBackupPayload } from '../domain/validation';

const DEFAULT_DB_NAME = 'mom-expense-tracker';
const DB_VERSION = 2;
const SETTINGS_KEY = 'app' as const;
const SECURITY_KEY = 'lock' as const;
const SECURITY_THROTTLE_KEY = 'throttle' as const;
const MAX_FAILED_AUTH_ATTEMPTS = 5;
const AUTH_COOLDOWN_MS = 30_000;

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
  security: {
    key: typeof SECURITY_KEY | typeof SECURITY_THROTTLE_KEY;
    value: SecurityRecord | SecurityThrottleRecord;
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
      if (!db.objectStoreNames.contains('security')) {
        db.createObjectStore('security', { keyPath: 'key' });
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

function isSecurityLockRecord(
  record: SecurityRecord | SecurityThrottleRecord | undefined
): record is SecurityRecord {
  return Boolean(record && record.key === SECURITY_KEY);
}

function toNonNegativeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function toNonNegativeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeThrottleRecord(
  record: SecurityRecord | SecurityThrottleRecord | undefined
): SecurityThrottleRecord {
  if (!record || record.key !== SECURITY_THROTTLE_KEY) {
    return {
      key: SECURITY_THROTTLE_KEY,
      failedPinAttempts: 0,
      pinCooldownUntil: 0,
      failedMasterAttempts: 0,
      masterCooldownUntil: 0,
    };
  }
  return {
    key: SECURITY_THROTTLE_KEY,
    failedPinAttempts: toNonNegativeCount(record.failedPinAttempts),
    pinCooldownUntil: toNonNegativeTimestamp(record.pinCooldownUntil),
    failedMasterAttempts: toNonNegativeCount(record.failedMasterAttempts),
    masterCooldownUntil: toNonNegativeTimestamp(record.masterCooldownUntil),
  };
}

/**
 * Loads the persisted PIN/Master Password security record, or `null` if lock is not enabled.
 */
export async function loadSecurityRecord(
  db: IDBPDatabase<MomExpenseDbSchema>
): Promise<SecurityRecord | null> {
  const record = await db.get('security', SECURITY_KEY);
  return isSecurityLockRecord(record) ? record : null;
}

/**
 * Persists the PIN/Master Password security record.
 */
export async function saveSecurityRecord(
  db: IDBPDatabase<MomExpenseDbSchema>,
  record: SecurityRecord
): Promise<void> {
  await db.put('security', record);
}

/**
 * Atomically creates the PIN/Master Password security record only if none exists yet.
 */
export async function createSecurityRecordIfAbsent(
  db: IDBPDatabase<MomExpenseDbSchema>,
  record: SecurityRecord
): Promise<{ created: true } | { created: false; existing: SecurityRecord }> {
  const tx = db.transaction('security', 'readwrite');
  const store = tx.objectStore('security');
  const existing = await store.get(SECURITY_KEY);
  if (isSecurityLockRecord(existing)) {
    await tx.done;
    return { created: false, existing };
  }
  await store.put(record);
  await tx.done;
  return { created: true };
}

/**
 * Loads persisted PIN and Master Password attempt counts and cooldown deadlines.
 */
export async function loadSecurityThrottle(
  db: IDBPDatabase<MomExpenseDbSchema>
): Promise<SecurityThrottleRecord> {
  const record = await db.get('security', SECURITY_THROTTLE_KEY);
  return normalizeThrottleRecord(record);
}

/**
 * Atomically records a failed PIN or Master Password attempt and activates a 30s cooldown at 5 failures.
 */
export async function recordFailedAttemptAtomic(
  db: IDBPDatabase<MomExpenseDbSchema>,
  target: 'pin' | 'master',
  nowMs: number = Date.now(),
  maxAttempts: number = MAX_FAILED_AUTH_ATTEMPTS,
  cooldownMs: number = AUTH_COOLDOWN_MS
): Promise<SecurityThrottleRecord> {
  const tx = db.transaction('security', 'readwrite');
  const store = tx.objectStore('security');
  const current = normalizeThrottleRecord(await store.get(SECURITY_THROTTLE_KEY));

  let next: SecurityThrottleRecord;
  if (target === 'pin') {
    const failedPinAttempts = current.failedPinAttempts + 1;
    next = {
      ...current,
      failedPinAttempts,
      pinCooldownUntil: failedPinAttempts >= maxAttempts ? nowMs + cooldownMs : current.pinCooldownUntil,
    };
  } else {
    const failedMasterAttempts = current.failedMasterAttempts + 1;
    next = {
      ...current,
      failedMasterAttempts,
      masterCooldownUntil:
        failedMasterAttempts >= maxAttempts ? nowMs + cooldownMs : current.masterCooldownUntil,
    };
  }

  await store.put(next);
  await tx.done;
  return next;
}

/**
 * Atomically clears persisted PIN, Master Password, or all throttle counters and cooldowns.
 */
export async function clearSecurityThrottle(
  db: IDBPDatabase<MomExpenseDbSchema>,
  scope: 'all' | 'pin' | 'master' = 'all'
): Promise<SecurityThrottleRecord> {
  const tx = db.transaction('security', 'readwrite');
  const store = tx.objectStore('security');
  if (scope === 'all') {
    await store.delete(SECURITY_THROTTLE_KEY);
    await tx.done;
    return normalizeThrottleRecord(undefined);
  }

  const current = normalizeThrottleRecord(await store.get(SECURITY_THROTTLE_KEY));
  const next: SecurityThrottleRecord =
    scope === 'pin'
      ? { ...current, failedPinAttempts: 0, pinCooldownUntil: 0 }
      : { ...current, failedMasterAttempts: 0, masterCooldownUntil: 0 };

  if (
    next.failedPinAttempts === 0 &&
    next.pinCooldownUntil === 0 &&
    next.failedMasterAttempts === 0 &&
    next.masterCooldownUntil === 0
  ) {
    await store.delete(SECURITY_THROTTLE_KEY);
  } else {
    await store.put(next);
  }
  await tx.done;
  return next;
}

/**
 * Removes the persisted PIN/Master Password security lock and throttle records.
 */
export async function deleteSecurityRecord(
  db: IDBPDatabase<MomExpenseDbSchema>
): Promise<void> {
  const tx = db.transaction('security', 'readwrite');
  const store = tx.objectStore('security');
  await Promise.all([store.delete(SECURITY_KEY), store.delete(SECURITY_THROTTLE_KEY)]);
  await tx.done;
}

/**
 * Atomically restores a previously deleted transaction and decrements `changesSinceLastBackup` (clamped to `>= 0`).
 */
export async function restoreDeletedTransactionAtomic(
  db: IDBPDatabase<MomExpenseDbSchema>,
  record: Transaction
): Promise<AppSettings> {
  const tx = db.transaction(['transactions', 'settings'], 'readwrite');
  const settingsStore = tx.objectStore('settings');

  await tx.objectStore('transactions').put(record);
  const current = toAppSettings(await settingsStore.get(SETTINGS_KEY));
  const nextSettings: AppSettings = {
    ...current,
    changesSinceLastBackup: Math.max(0, current.changesSinceLastBackup - 1),
  };
  await settingsStore.put(toSettingsRecord(nextSettings));
  await tx.done;

  return nextSettings;
}
