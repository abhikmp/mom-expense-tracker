import { afterEach, describe, expect, it } from 'vitest';
import { openDB, type IDBPDatabase } from 'idb';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  type BackupPayload,
  type BankAccount,
  type Category,
  type SecurityRecord,
  type Transaction,
} from '../../src/domain/types';
import {
  createTransactionAtomic,
  deleteSecurityRecord,
  deleteTransactionAtomic,
  loadAppState,
  loadSecurityRecord,
  markBackupOrExportCompleted,
  openAppDb,
  restoreBackupAtomic,
  restoreDeletedTransactionAtomic,
  saveAccount,
  saveCategory,
  saveSecurityRecord,
  saveSettings,
  updateTransactionAtomic,
  type MomExpenseDbSchema,
} from '../../src/storage/db';

let testCounter = 0;
const openDbs: IDBPDatabase<MomExpenseDbSchema>[] = [];

async function createTestDb(): Promise<IDBPDatabase<MomExpenseDbSchema>> {
  testCounter += 1;
  const dbName = `mom-expense-test-${Date.now()}-${testCounter}`;
  const db = await openAppDb(dbName);
  openDbs.push(db);
  return db;
}

function makeAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'acc-1',
    name: 'SBI Savings',
    startingBalancePaise: 100_000,
    createdAt: '2026-11-01T08:00:00.000Z',
    archived: false,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 4550,
    accountId: 'acc-1',
    categoryId: 'cat-groceries',
    mode: 'GPay',
    date: '2026-11-26',
    note: 'Milk and vegetables',
    createdAt: '2026-11-26T09:00:00.000Z',
    updatedAt: '2026-11-26T09:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    db?.close();
  }
});

describe('IndexedDB persistence layer', () => {
  it('loadAppState on fresh DB seeds 0 accounts, 0 transactions, 6 DEFAULT_CATEGORIES, and DEFAULT_SETTINGS', async () => {
    const db = await createTestDb();

    const state = await loadAppState(db);

    expect(state.accounts).toEqual([]);
    expect(state.transactions).toEqual([]);
    expect(state.categories).toEqual(DEFAULT_CATEGORIES);
    expect(state.categories).toHaveLength(6);
    expect(state.settings).toEqual(DEFAULT_SETTINGS);

    // Reloading again does not duplicate seeded records
    const reloaded = await loadAppState(db);
    expect(reloaded.categories).toEqual(DEFAULT_CATEGORIES);
    expect(reloaded.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('createTransactionAtomic stores the transaction, updates lastUsedAccountId, and increments changesSinceLastBackup', async () => {
    const db = await createTestDb();
    await loadAppState(db);
    await saveAccount(db, makeAccount({ id: 'acc-sbi' }));

    const tx = makeTransaction({ id: 'tx-100', accountId: 'acc-sbi', amountPaise: 25000 });
    const updatedSettings = await createTransactionAtomic(db, tx);

    expect(updatedSettings.lastUsedAccountId).toBe('acc-sbi');
    expect(updatedSettings.changesSinceLastBackup).toBe(1);

    const state = await loadAppState(db);
    expect(state.transactions).toEqual([tx]);
    expect(state.settings.lastUsedAccountId).toBe('acc-sbi');
    expect(state.settings.changesSinceLastBackup).toBe(1);
  });

  it('updateTransactionAtomic and deleteTransactionAtomic modify/remove the record and increment changesSinceLastBackup', async () => {
    const db = await createTestDb();
    await loadAppState(db);
    await saveAccount(db, makeAccount({ id: 'acc-1' }));

    const original = makeTransaction({ id: 'tx-1', amountPaise: 1000, note: 'Initial' });
    await createTransactionAtomic(db, original);

    const modified: Transaction = {
      ...original,
      amountPaise: 2250,
      note: 'Updated note',
      updatedAt: '2026-11-26T10:30:00.000Z',
    };
    const afterUpdate = await updateTransactionAtomic(db, modified);
    expect(afterUpdate.changesSinceLastBackup).toBe(2);

    let state = await loadAppState(db);
    expect(state.transactions).toEqual([modified]);

    const afterDelete = await deleteTransactionAtomic(db, 'tx-1');
    expect(afterDelete.changesSinceLastBackup).toBe(3);

    state = await loadAppState(db);
    expect(state.transactions).toEqual([]);
    expect(state.settings.changesSinceLastBackup).toBe(3);
  });

  it('saveAccount creates, renames, adjusts startingBalancePaise, toggles archived, and optionally updates lastUsedAccountId', async () => {
    const db = await createTestDb();
    await loadAppState(db);

    const created = makeAccount({ id: 'acc-hdfc', name: 'HDFC', startingBalancePaise: 50_000 });
    await saveAccount(db, created, true);

    let state = await loadAppState(db);
    expect(state.accounts).toEqual([created]);
    expect(state.settings.lastUsedAccountId).toBe('acc-hdfc');

    const updated: BankAccount = {
      ...created,
      name: 'HDFC Primary',
      startingBalancePaise: 75_000,
      archived: true,
    };
    await saveAccount(db, updated);

    state = await loadAppState(db);
    expect(state.accounts).toEqual([updated]);
    expect(state.settings.lastUsedAccountId).toBe('acc-hdfc');
  });

  it('saveCategory creates, renames, and toggles hidden while preserving id', async () => {
    const db = await createTestDb();
    await loadAppState(db);

    const custom: Category = {
      id: 'cat-gifts',
      name: 'Gifts',
      hidden: false,
      sortOrder: 7,
      isDefault: false,
    };
    await saveCategory(db, custom);

    let state = await loadAppState(db);
    expect(state.categories.find((c) => c.id === 'cat-gifts')).toEqual(custom);

    const edited: Category = {
      ...custom,
      name: 'Family Gifts',
      hidden: true,
    };
    await saveCategory(db, edited);

    state = await loadAppState(db);
    const saved = state.categories.find((c) => c.id === 'cat-gifts');
    expect(saved).toEqual({
      id: 'cat-gifts',
      name: 'Family Gifts',
      hidden: true,
      sortOrder: 7,
      isDefault: false,
    });
  });

  it('saveSettings persists theme, expensePaymentModes, and transferPaymentModes', async () => {
    const db = await createTestDb();
    await loadAppState(db);

    const saved = await saveSettings(db, {
      theme: 'dark',
      expensePaymentModes: ['GPay', 'Cash', 'UPI Lite'],
      transferPaymentModes: ['NEFT', 'Cash'],
    });

    expect(saved.theme).toBe('dark');
    expect(saved.expensePaymentModes).toEqual(['GPay', 'Cash', 'UPI Lite']);
    expect(saved.transferPaymentModes).toEqual(['NEFT', 'Cash']);

    const state = await loadAppState(db);
    expect(state.settings.theme).toBe('dark');
    expect(state.settings.expensePaymentModes).toEqual(['GPay', 'Cash', 'UPI Lite']);
    expect(state.settings.transferPaymentModes).toEqual(['NEFT', 'Cash']);
    expect(state.settings.depositModes).toEqual(DEFAULT_SETTINGS.depositModes);
  });

  it('markBackupOrExportCompleted resets changesSinceLastBackup to 0 and sets lastBackupOrExportAt', async () => {
    const db = await createTestDb();
    await loadAppState(db);
    await saveAccount(db, makeAccount({ id: 'acc-1' }));
    await createTransactionAtomic(db, makeTransaction({ id: 'tx-1', accountId: 'acc-1' }));
    await createTransactionAtomic(db, makeTransaction({ id: 'tx-2', accountId: 'acc-1' }));

    const exportIso = '2026-11-26T12:00:00.000Z';
    const settings = await markBackupOrExportCompleted(db, exportIso);

    expect(settings.changesSinceLastBackup).toBe(0);
    expect(settings.lastBackupOrExportAt).toBe(exportIso);

    const state = await loadAppState(db);
    expect(state.settings.changesSinceLastBackup).toBe(0);
    expect(state.settings.lastBackupOrExportAt).toBe(exportIso);
  });

  it('restoreBackupAtomic replaces all stores, resets changesSinceLastBackup, and sets lastUsedAccountId to first active account', async () => {
    const db = await createTestDb();
    await loadAppState(db);

    // Existing data that must be wiped on restore
    await saveAccount(db, makeAccount({ id: 'old-acc', name: 'Old Bank' }), true);
    await saveCategory(db, {
      id: 'old-cat',
      name: 'Old Category',
      hidden: false,
      sortOrder: 99,
      isDefault: false,
    });
    await createTransactionAtomic(
      db,
      makeTransaction({ id: 'old-tx', accountId: 'old-acc', amountPaise: 999 })
    );

    const payload: BackupPayload = {
      _note: "Monetary fields ending in 'Paise' store integer paise.",
      schemaVersion: 1,
      exportedAt: '2026-11-25T15:00:00.000Z',
      accounts: [
        makeAccount({ id: 'acc-archived', name: 'Closed Account', archived: true }),
        makeAccount({ id: 'acc-active-1', name: 'ICICI', archived: false }),
        makeAccount({ id: 'acc-active-2', name: 'SBI', archived: false }),
      ],
      categories: [
        ...DEFAULT_CATEGORIES,
        { id: 'cat-puja', name: 'Puja', hidden: false, sortOrder: 7, isDefault: false },
      ],
      expensePaymentModes: ['Cash', 'PhonePe'],
      transferPaymentModes: ['IMPS', 'Cheque'],
      transactions: [
        makeTransaction({
          id: 'restored-tx-1',
          accountId: 'acc-active-1',
          categoryId: 'cat-puja',
          amountPaise: 50_000,
        }),
      ],
    };

    const restored = await restoreBackupAtomic(db, payload);

    expect(restored.accounts).toHaveLength(3);
    expect(restored.accounts.map((a) => a.id)).not.toContain('old-acc');
    expect(restored.categories.map((c) => c.id)).not.toContain('old-cat');
    expect(restored.categories).toHaveLength(7);
    expect(restored.transactions).toEqual(payload.transactions);
    expect(restored.settings.expensePaymentModes).toEqual(['Cash', 'PhonePe']);
    expect(restored.settings.transferPaymentModes).toEqual(['IMPS', 'Cheque']);
    expect(restored.settings.changesSinceLastBackup).toBe(0);
    expect(restored.settings.lastUsedAccountId).toBe('acc-active-1');

    const persisted = await loadAppState(db);
    expect(persisted).toEqual(restored);
  });

  it('restoreBackupAtomic sets lastUsedAccountId to null when no restored account is active and rejects invalid payloads', async () => {
    const db = await createTestDb();
    await loadAppState(db);
    await saveAccount(db, makeAccount({ id: 'existing-acc' }), true);

    const allArchivedPayload: BackupPayload = {
      _note: '',
      schemaVersion: 1,
      exportedAt: '2026-11-25T15:00:00.000Z',
      accounts: [makeAccount({ id: 'acc-closed', archived: true })],
      categories: DEFAULT_CATEGORIES,
      transactions: [],
    };

    const restored = await restoreBackupAtomic(db, allArchivedPayload);
    expect(restored.settings.lastUsedAccountId).toBeNull();
    expect(restored.settings.changesSinceLastBackup).toBe(0);

    const invalidPayload = { ...allArchivedPayload, schemaVersion: 99 } as unknown as BackupPayload;
    await expect(restoreBackupAtomic(db, invalidPayload)).rejects.toThrow();

    // Existing DB state remains intact after rejected restore
    const afterFailed = await loadAppState(db);
    expect(afterFailed.accounts.map((a) => a.id)).toEqual(['acc-closed']);
  });

  it('upgrades an existing v1 database to v2 preserving all data and creating the security store', async () => {
    testCounter += 1;
    const dbName = `mom-expense-v1-upgrade-${Date.now()}-${testCounter}`;

    const seededAccount = makeAccount({ id: 'acc-v1', name: 'SBI v1' });
    const seededTx = makeTransaction({ id: 'tx-v1', accountId: 'acc-v1', amountPaise: 12345 });

    const v1Db = await openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('accounts', { keyPath: 'id' });
        db.createObjectStore('categories', { keyPath: 'id' });
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('by-date', 'date');
        txStore.createIndex('by-account', 'accountId');
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
    await v1Db.put('accounts', seededAccount);
    await v1Db.put('categories', DEFAULT_CATEGORIES[0]);
    await v1Db.put('transactions', seededTx);
    await v1Db.put('settings', {
      key: 'app',
      ...DEFAULT_SETTINGS,
      lastUsedAccountId: 'acc-v1',
      changesSinceLastBackup: 4,
    });
    v1Db.close();

    const upgradedDb = await openAppDb(dbName);
    openDbs.push(upgradedDb);

    expect(upgradedDb.version).toBe(2);
    expect(upgradedDb.objectStoreNames.contains('security')).toBe(true);

    const state = await loadAppState(upgradedDb);
    expect(state.accounts).toEqual([seededAccount]);
    expect(state.categories).toEqual([DEFAULT_CATEGORIES[0]]);
    expect(state.transactions).toEqual([seededTx]);
    expect(state.settings.lastUsedAccountId).toBe('acc-v1');
    expect(state.settings.changesSinceLastBackup).toBe(4);
    await expect(loadSecurityRecord(upgradedDb)).resolves.toBeNull();
  });

  it('loads, saves, and deletes the security lock record', async () => {
    const db = await createTestDb();

    await expect(loadSecurityRecord(db)).resolves.toBeNull();

    const record: SecurityRecord = {
      key: 'lock',
      pinHash: {
        algorithm: 'PBKDF2-SHA256',
        iterations: 100_000,
        saltB64: 'c2FsdDE=',
        hashB64: 'aGFzaDE=',
      },
      masterPasswordHash: {
        algorithm: 'PBKDF2-SHA256',
        iterations: 100_000,
        saltB64: 'c2FsdDI=',
        hashB64: 'aGFzaDI=',
      },
      updatedAt: '2026-11-27T10:00:00.000Z',
    };

    await saveSecurityRecord(db, record);
    await expect(loadSecurityRecord(db)).resolves.toEqual(record);

    await deleteSecurityRecord(db);
    await expect(loadSecurityRecord(db)).resolves.toBeNull();
  });

  it('restoreBackupAtomic does not delete or overwrite an existing security lock record', async () => {
    const db = await createTestDb();
    await loadAppState(db);

    const lockRecord: SecurityRecord = {
      key: 'lock',
      pinHash: {
        algorithm: 'PBKDF2-SHA256',
        iterations: 100_000,
        saltB64: 'c2FsdDE=',
        hashB64: 'aGFzaDE=',
      },
      masterPasswordHash: {
        algorithm: 'PBKDF2-SHA256',
        iterations: 100_000,
        saltB64: 'c2FsdDI=',
        hashB64: 'aGFzaDI=',
      },
      updatedAt: '2026-11-27T10:00:00.000Z',
    };
    await saveSecurityRecord(db, lockRecord);

    const payload: BackupPayload = {
      _note: '',
      schemaVersion: 1,
      exportedAt: '2026-11-27T11:00:00.000Z',
      accounts: [makeAccount({ id: 'acc-restored' })],
      categories: DEFAULT_CATEGORIES,
      transactions: [],
    };

    await restoreBackupAtomic(db, payload);

    await expect(loadSecurityRecord(db)).resolves.toEqual(lockRecord);
  });

  it('restoreDeletedTransactionAtomic restores a deleted transaction and decrements changesSinceLastBackup clamped at 0', async () => {
    const db = await createTestDb();
    await loadAppState(db);
    await saveAccount(db, makeAccount({ id: 'acc-1' }));

    const txRecord = makeTransaction({ id: 'tx-undo', accountId: 'acc-1', amountPaise: 5000 });
    await createTransactionAtomic(db, txRecord);
    const afterDelete = await deleteTransactionAtomic(db, 'tx-undo');
    expect(afterDelete.changesSinceLastBackup).toBe(2);

    const afterUndo = await restoreDeletedTransactionAtomic(db, txRecord);
    expect(afterUndo.changesSinceLastBackup).toBe(1);

    const state = await loadAppState(db);
    expect(state.transactions).toEqual([txRecord]);

    // Clamps at 0 when changesSinceLastBackup is already 0
    await saveSettings(db, { changesSinceLastBackup: 0 });
    const clamped = await restoreDeletedTransactionAtomic(
      db,
      makeTransaction({ id: 'tx-undo-2', accountId: 'acc-1' })
    );
    expect(clamped.changesSinceLastBackup).toBe(0);
  });
});
