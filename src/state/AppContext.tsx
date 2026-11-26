import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { IDBPDatabase } from 'idb';
import { computeAdjustedStartingBalancePaise } from '../domain/calculations';
import { getCurrentMonthYM } from '../domain/dates';
import { formatRupees } from '../domain/money';
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackupPayload,
  type BankAccount,
  type Category,
  type FilterState,
  type Transaction,
  type ViewId,
} from '../domain/types';
import { buildBackupPayload, downloadJsonBackup } from '../export/backup';
import { exportCsvFiles } from '../export/csv';
import {
  createTransactionAtomic,
  deleteTransactionAtomic,
  loadAppState,
  markBackupOrExportCompleted,
  openAppDb,
  restoreBackupAtomic,
  saveAccount,
  saveCategory,
  saveSettings,
  updateTransactionAtomic,
  type MomExpenseDbSchema,
} from '../storage/db';

export type NewTransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

export interface NavigateOptions {
  manageJumpTarget?: string | null;
  bankId?: string | null;
}

export interface AppContextValue {
  loading: boolean;
  accounts: BankAccount[];
  categories: Category[];
  transactions: Transaction[];
  settings: AppSettings;
  view: ViewId;
  selectedBankId: string | null;
  preselectedAccountId: string | null;
  selectedMonth: string;
  filters: FilterState;
  manageJumpTarget: string | null;
  saveBanner: string | null;
  statusToast: string | null;
  backupDismissed: boolean;
  navigate: (view: ViewId, opts?: NavigateOptions) => void;
  openBankHistory: (bankId: string) => void;
  openRecordForBank: (bankId: string) => void;
  clearPreselectedAccount: () => void;
  clearManageJumpTarget: () => void;
  toggleTheme: () => Promise<void>;
  setSelectedMonth: (ym: string) => void;
  setFilters: (patch: Partial<FilterState>) => void;
  resetFilters: () => void;
  dismissSaveBanner: () => void;
  dismissToast: () => void;
  dismissBackupReminder: () => void;
  recordTransaction: (input: NewTransactionInput) => Promise<Transaction>;
  updateTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (txId: string) => Promise<void>;
  addAccount: (name: string, startingBalancePaise: number) => Promise<void>;
  renameAccount: (id: string, name: string) => Promise<void>;
  adjustAccountBalance: (id: string, desiredBalancePaise: number) => Promise<void>;
  setAccountArchived: (id: string, archived: boolean) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  renameCategory: (id: string, name: string) => Promise<void>;
  setCategoryHidden: (id: string, hidden: boolean) => Promise<void>;
  addCustomPaymentMode: (txType: 'expense' | 'transfer', mode: string) => Promise<string>;
  exportCsv: (
    scope: 'all' | 'filtered' | 'bank',
    txList: Transaction[],
    bankName?: string
  ) => Promise<{ method: 'share' | 'download' | 'cancelled'; files: [string, string] }>;
  downloadBackup: () => Promise<void>;
  restoreBackup: (payload: BackupPayload) => Promise<void>;
}

const INITIAL_FILTERS: FilterState = {
  fromDate: '',
  toDate: '',
  typeKey: 'all',
  categoryId: 'all',
};

const AppContext = createContext<AppContextValue | null>(null);

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Provides persisted IndexedDB state, navigation, theme syncing, and atomic actions for the app.
 */
export function AppProvider({
  dbName,
  children,
}: {
  dbName?: string;
  children: ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [view, setView] = useState<ViewId>('home');
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [preselectedAccountId, setPreselectedAccountId] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonthState] = useState<string>(() => getCurrentMonthYM());
  const [filters, setFiltersState] = useState<FilterState>(INITIAL_FILTERS);
  const [manageJumpTarget, setManageJumpTarget] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [backupDismissed, setBackupDismissed] = useState(false);

  const dbRef = useRef<IDBPDatabase<MomExpenseDbSchema> | null>(null);
  const dbReadyRef = useRef<Promise<IDBPDatabase<MomExpenseDbSchema>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const initPromise = openAppDb(dbName).then(async (db) => {
      if (cancelled) {
        db.close();
        throw new Error('AppProvider unmounted before DB initialization completed.');
      }
      dbRef.current = db;
      const loaded = await loadAppState(db);
      if (!cancelled) {
        setAccounts(loaded.accounts);
        setCategories(loaded.categories);
        setTransactions(loaded.transactions);
        setSettings(loaded.settings);
        setLoading(false);
      }
      return db;
    });

    dbReadyRef.current = initPromise;
    initPromise.catch(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      dbReadyRef.current = null;
      if (dbRef.current) {
        dbRef.current.close();
        dbRef.current = null;
      }
    };
  }, [dbName]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', settings.theme === 'dark' ? '#0B0F17' : '#F8FAFC');
    }
  }, [settings.theme]);

  const getDb = useCallback(async (): Promise<IDBPDatabase<MomExpenseDbSchema>> => {
    if (dbRef.current) {
      return dbRef.current;
    }
    if (dbReadyRef.current) {
      return dbReadyRef.current;
    }
    const db = await openAppDb(dbName);
    dbRef.current = db;
    return db;
  }, [dbName]);

  const navigate = useCallback((targetView: ViewId, opts?: NavigateOptions) => {
    setView(targetView);
    setManageJumpTarget(opts?.manageJumpTarget ?? null);
    if (opts?.bankId !== undefined) {
      setSelectedBankId(opts.bankId);
    }
    if (targetView !== 'record') {
      setPreselectedAccountId(null);
    }
    if (targetView === 'record') {
      setSaveBanner(null);
    }
  }, []);

  const openBankHistory = useCallback((bankId: string) => {
    setSelectedBankId(bankId);
    setPreselectedAccountId(null);
    setView('bank-tx');
  }, []);

  const openRecordForBank = useCallback((bankId: string) => {
    setPreselectedAccountId(bankId);
    setSaveBanner(null);
    setView('record');
  }, []);

  const clearPreselectedAccount = useCallback(() => {
    setPreselectedAccountId(null);
  }, []);

  const clearManageJumpTarget = useCallback(() => {
    setManageJumpTarget(null);
  }, []);

  const toggleTheme = useCallback(async () => {
    const nextTheme = settings.theme === 'light' ? 'dark' : 'light';
    setSettings((prev) => ({ ...prev, theme: nextTheme }));
    const db = await getDb();
    const updated = await saveSettings(db, { theme: nextTheme });
    setSettings((prev) => ({ ...prev, theme: updated.theme }));
  }, [getDb, settings.theme]);

  const setSelectedMonth = useCallback((ym: string) => {
    setSelectedMonthState(ym);
  }, []);

  const setFilters = useCallback((patch: Partial<FilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(INITIAL_FILTERS);
  }, []);

  const dismissSaveBanner = useCallback(() => {
    setSaveBanner(null);
  }, []);

  const dismissToast = useCallback(() => {
    setStatusToast(null);
  }, []);

  const dismissBackupReminder = useCallback(() => {
    setBackupDismissed(true);
  }, []);

  const recordTransaction = useCallback(
    async (input: NewTransactionInput): Promise<Transaction> => {
      const now = new Date().toISOString();
      const record: Transaction = {
        ...input,
        id: createId('tx'),
        categoryId: input.type === 'expense' ? input.categoryId : null,
        note: input.note.trim(),
        createdAt: now,
        updatedAt: now,
      };
      const db = await getDb();
      const nextSettings = await createTransactionAtomic(db, record);
      setTransactions((prev) => [record, ...prev]);
      setSettings(nextSettings);

      const accName = accounts.find((a) => a.id === record.accountId)?.name ?? 'account';
      const label =
        record.type === 'expense'
          ? categories.find((c) => c.id === record.categoryId)?.name ?? 'Expense'
          : record.type === 'deposit'
            ? `Deposit (${record.mode})`
            : `Transfer (${record.mode})`;
      setSaveBanner(`Saved ${label} (${formatRupees(record.amountPaise)}) to ${accName}.`);
      setPreselectedAccountId(null);
      setView('home');
      return record;
    },
    [accounts, categories, getDb]
  );

  const updateTransaction = useCallback(
    async (tx: Transaction): Promise<void> => {
      const updated: Transaction = {
        ...tx,
        categoryId: tx.type === 'expense' ? tx.categoryId : null,
        note: tx.note.trim(),
        updatedAt: new Date().toISOString(),
      };
      const db = await getDb();
      const nextSettings = await updateTransactionAtomic(db, updated);
      setTransactions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setSettings(nextSettings);
      setStatusToast('Updated entry and recalculated bank balances.');
    },
    [getDb]
  );

  const deleteTransaction = useCallback(
    async (txId: string): Promise<void> => {
      const db = await getDb();
      const nextSettings = await deleteTransactionAtomic(db, txId);
      setTransactions((prev) => prev.filter((item) => item.id !== txId));
      setSettings(nextSettings);
      setStatusToast('Transaction deleted and balances updated.');
    },
    [getDb]
  );

  const addAccount = useCallback(
    async (name: string, startingBalancePaise: number): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const account: BankAccount = {
        id: createId('acc'),
        name: trimmed,
        startingBalancePaise,
        createdAt: new Date().toISOString(),
        archived: false,
      };
      const db = await getDb();
      await saveAccount(db, account, true);
      setAccounts((prev) => [...prev, account]);
      setSettings((prev) => ({ ...prev, lastUsedAccountId: account.id }));
      setStatusToast(`Added ${trimmed} with balance ${formatRupees(startingBalancePaise)}.`);
    },
    [getDb]
  );

  const renameAccount = useCallback(
    async (id: string, name: string): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const target = accounts.find((a) => a.id === id);
      if (!target) return;
      const updated: BankAccount = { ...target, name: trimmed };
      const db = await getDb();
      await saveAccount(db, updated, false);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
    },
    [accounts, getDb]
  );

  const adjustAccountBalance = useCallback(
    async (id: string, desiredBalancePaise: number): Promise<void> => {
      const target = accounts.find((a) => a.id === id);
      if (!target) return;
      const startingBalancePaise = computeAdjustedStartingBalancePaise(
        desiredBalancePaise,
        id,
        transactions
      );
      const updated: BankAccount = { ...target, startingBalancePaise };
      const db = await getDb();
      await saveAccount(db, updated, false);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setStatusToast(`Updated ${target.name} balance to ${formatRupees(desiredBalancePaise)}.`);
    },
    [accounts, getDb, transactions]
  );

  const setAccountArchived = useCallback(
    async (id: string, archived: boolean): Promise<void> => {
      const target = accounts.find((a) => a.id === id);
      if (!target) return;
      const updated: BankAccount = { ...target, archived };
      const db = await getDb();
      await saveAccount(db, updated, false);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setStatusToast(`${target.name} ${archived ? 'archived' : 'restored to active'}.`);
    },
    [accounts, getDb]
  );

  const addCategory = useCallback(
    async (name: string): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const maxSortOrder = categories.reduce((max, c) => Math.max(max, c.sortOrder), 0);
      const category: Category = {
        id: createId('cat'),
        name: trimmed,
        hidden: false,
        sortOrder: maxSortOrder + 1,
        isDefault: false,
      };
      const db = await getDb();
      await saveCategory(db, category);
      setCategories((prev) => [...prev, category]);
    },
    [categories, getDb]
  );

  const renameCategory = useCallback(
    async (id: string, name: string): Promise<void> => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const target = categories.find((c) => c.id === id);
      if (!target) return;
      const updated: Category = { ...target, name: trimmed };
      const db = await getDb();
      await saveCategory(db, updated);
      setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
    },
    [categories, getDb]
  );

  const setCategoryHidden = useCallback(
    async (id: string, hidden: boolean): Promise<void> => {
      const target = categories.find((c) => c.id === id);
      if (!target) return;
      const updated: Category = { ...target, hidden };
      const db = await getDb();
      await saveCategory(db, updated);
      setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
    },
    [categories, getDb]
  );

  const addCustomPaymentMode = useCallback(
    async (txType: 'expense' | 'transfer', mode: string): Promise<string> => {
      const trimmed = mode.trim();
      if (!trimmed) return '';
      const field = txType === 'transfer' ? 'transferPaymentModes' : 'expensePaymentModes';
      const existing = settings[field].find((m) => m.toLowerCase() === trimmed.toLowerCase());
      if (existing) {
        return existing;
      }
      const nextList = [...settings[field], trimmed];
      const db = await getDb();
      const nextSettings = await saveSettings(db, { [field]: nextList });
      setSettings(nextSettings);
      return trimmed;
    },
    [getDb, settings]
  );

  const exportCsv = useCallback(
    async (
      scope: 'all' | 'filtered' | 'bank',
      txList: Transaction[],
      bankName?: string
    ): Promise<{ method: 'share' | 'download' | 'cancelled'; files: [string, string] }> => {
      const result = await exportCsvFiles({
        transactions: txList,
        allTransactions: transactions,
        accounts,
        categories,
        scope,
        bankName,
      });

      if (result.method !== 'cancelled') {
        const db = await getDb();
        const nextSettings = await markBackupOrExportCompleted(db, new Date().toISOString());
        setSettings(nextSettings);
        setBackupDismissed(false);
        setStatusToast(
          result.method === 'share'
            ? `Shared ${result.files[0]} & ${result.files[1]}.`
            : `Exported ${result.files[0]} & ${result.files[1]}.`
        );
      }

      return result;
    },
    [accounts, categories, getDb, transactions]
  );

  const downloadBackup = useCallback(async (): Promise<void> => {
    const exportedAt = new Date().toISOString();
    const payload = buildBackupPayload({
      accounts,
      categories,
      transactions,
      settings,
      exportedAt,
    });
    const filename = downloadJsonBackup(payload);
    const db = await getDb();
    const nextSettings = await markBackupOrExportCompleted(db, exportedAt);
    setSettings(nextSettings);
    setBackupDismissed(false);
    setStatusToast(`Downloaded backup ${filename}.`);
  }, [accounts, categories, getDb, settings, transactions]);

  const restoreBackup = useCallback(
    async (payload: BackupPayload): Promise<void> => {
      const db = await getDb();
      const restored = await restoreBackupAtomic(db, payload);
      setAccounts(restored.accounts);
      setCategories(restored.categories);
      setTransactions(restored.transactions);
      setSettings(restored.settings);
      setBackupDismissed(false);
      setSelectedBankId(null);
      setPreselectedAccountId(null);
      setSaveBanner(null);
      setFiltersState(INITIAL_FILTERS);
      setStatusToast(
        `Restored ${restored.accounts.length} accounts and ${restored.transactions.length} transactions.`
      );
      setView('home');
    },
    [getDb]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      loading,
      accounts,
      categories,
      transactions,
      settings,
      view,
      selectedBankId,
      preselectedAccountId,
      selectedMonth,
      filters,
      manageJumpTarget,
      saveBanner,
      statusToast,
      backupDismissed,
      navigate,
      openBankHistory,
      openRecordForBank,
      clearPreselectedAccount,
      clearManageJumpTarget,
      toggleTheme,
      setSelectedMonth,
      setFilters,
      resetFilters,
      dismissSaveBanner,
      dismissToast,
      dismissBackupReminder,
      recordTransaction,
      updateTransaction,
      deleteTransaction,
      addAccount,
      renameAccount,
      adjustAccountBalance,
      setAccountArchived,
      addCategory,
      renameCategory,
      setCategoryHidden,
      addCustomPaymentMode,
      exportCsv,
      downloadBackup,
      restoreBackup,
    }),
    [
      loading,
      accounts,
      categories,
      transactions,
      settings,
      view,
      selectedBankId,
      preselectedAccountId,
      selectedMonth,
      filters,
      manageJumpTarget,
      saveBanner,
      statusToast,
      backupDismissed,
      navigate,
      openBankHistory,
      openRecordForBank,
      clearPreselectedAccount,
      clearManageJumpTarget,
      toggleTheme,
      setSelectedMonth,
      setFilters,
      resetFilters,
      dismissSaveBanner,
      dismissToast,
      dismissBackupReminder,
      recordTransaction,
      updateTransaction,
      deleteTransaction,
      addAccount,
      renameAccount,
      adjustAccountBalance,
      setAccountArchived,
      addCategory,
      renameCategory,
      setCategoryHidden,
      addCustomPaymentMode,
      exportCsv,
      downloadBackup,
      restoreBackup,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Returns the current AppContext value; throws if called outside `AppProvider`.
 */
export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider.');
  }
  return ctx;
}
