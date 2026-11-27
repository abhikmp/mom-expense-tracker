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
  type SecurityRecord,
  type Transaction,
  type ViewId,
} from '../domain/types';
import { buildBackupPayload, downloadJsonBackup } from '../export/backup';
import { exportCsvFiles } from '../export/csv';
import {
  hashSecret,
  validateMasterPassword,
  validatePin,
  verifySecret,
} from '../security/crypto';
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
} from '../storage/db';

export type NewTransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

export type PinModalMode = 'unlock' | 'forgot-master' | 'reset-pin' | 'setup' | 'change' | 'disable';

export interface ShowToastOptions {
  durationMs?: number | null;
  isDeleteUndo?: boolean;
}

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
  statusToastTone: 'success' | 'error';
  storageError: string | null;
  backupDismissed: boolean;
  hasPin: boolean;
  isUnlocked: boolean;
  isLocked: boolean;
  pinModalMode: PinModalMode | null;
  failedPinAttempts: number;
  pinCooldownUntil: number;
  lastDeletedTx: Transaction | null;
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
  showToast: (
    message: string,
    tone?: 'success' | 'error',
    options?: number | ShowToastOptions
  ) => void;
  dismissToast: () => void;
  dismissBackupReminder: () => void;
  openPinModal: (mode: PinModalMode) => void;
  closePinModal: () => void;
  lockApp: (toastMessage?: string) => void;
  verifyPinAndUnlock: (pin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  verifyMasterAndProceed: (
    masterPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  setupPin: (pin: string, masterPassword: string) => Promise<void>;
  resetPinAfterMaster: (newPin: string) => Promise<void>;
  changePin: (
    currentPin: string,
    newPin: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  disablePin: (currentPin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  recordTransaction: (input: NewTransactionInput) => Promise<Transaction>;
  updateTransaction: (tx: Transaction) => Promise<void>;
  deleteTransaction: (txId: string) => Promise<void>;
  undoDeleteTransaction: () => Promise<void>;
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

const STORAGE_OPEN_ERROR =
  'Could not open on-device storage. Please make sure browser storage is allowed and reload.';

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
  const [saveBannerSeq, setSaveBannerSeq] = useState(0);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [statusToastTone, setStatusToastTone] = useState<'success' | 'error'>('success');
  const [statusToastDurationMs, setStatusToastDurationMs] = useState<number | null>(null);
  const [statusToastSeq, setStatusToastSeq] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [backupDismissed, setBackupDismissed] = useState(false);

  const [securityRecord, setSecurityRecord] = useState<SecurityRecord | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinModalMode, setPinModalMode] = useState<PinModalMode | null>(null);
  const [failedPinAttempts, setFailedPinAttempts] = useState(0);
  const [pinCooldownUntil, setPinCooldownUntil] = useState(0);
  const [lastDeletedTx, setLastDeletedTx] = useState<Transaction | null>(null);

  const hasPin = securityRecord !== null;
  const isLocked = hasPin && !isUnlocked;

  const dbRef = useRef<IDBPDatabase<MomExpenseDbSchema> | null>(null);
  const dbReadyRef = useRef<Promise<IDBPDatabase<MomExpenseDbSchema>> | null>(null);
  const themeToggledDuringInitRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);
  const undoInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    themeToggledDuringInitRef.current = false;
    setLoading(true);
    setStorageError(null);

    const initPromise = openAppDb(dbName).then(async (db) => {
      if (cancelled) {
        db.close();
        throw new Error('AppProvider unmounted before DB initialization completed.');
      }
      dbRef.current = db;
      const [loaded, loadedSecurity] = await Promise.all([
        loadAppState(db),
        loadSecurityRecord(db),
      ]);
      if (!cancelled) {
        setAccounts(loaded.accounts);
        setCategories(loaded.categories);
        setTransactions(loaded.transactions);
        setSettings((prev) =>
          themeToggledDuringInitRef.current
            ? { ...loaded.settings, theme: prev.theme }
            : loaded.settings
        );
        setSecurityRecord(loadedSecurity);
        setIsUnlocked(false);
        setPinModalMode(null);
        setFailedPinAttempts(0);
        setPinCooldownUntil(0);
        setStorageError(null);
        setLoading(false);
      }
      return db;
    });

    dbReadyRef.current = initPromise;
    initPromise.catch(() => {
      if (dbReadyRef.current === initPromise) {
        dbReadyRef.current = null;
      }
      if (!cancelled) {
        setStorageError(STORAGE_OPEN_ERROR);
        setStatusToastTone('error');
        setStatusToastDurationMs(null);
        setStatusToast(STORAGE_OPEN_ERROR);
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

  useEffect(() => {
    if (!saveBanner) return;
    const timer = window.setTimeout(() => {
      setSaveBanner(null);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [saveBanner, saveBannerSeq]);

  useEffect(() => {
    if (!statusToast || statusToastDurationMs === null) return;
    const timer = window.setTimeout(() => {
      setStatusToast(null);
      setStatusToastTone('success');
      setStatusToastDurationMs(null);
      setLastDeletedTx(null);
    }, statusToastDurationMs);
    return () => window.clearTimeout(timer);
  }, [statusToast, statusToastDurationMs, statusToastSeq]);

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

  const dismissSaveBanner = useCallback(() => {
    setSaveBanner(null);
  }, []);

  const showToast = useCallback(
    (
      message: string,
      tone: 'success' | 'error' = 'success',
      options?: number | ShowToastOptions
    ) => {
      const resolvedOptions: ShowToastOptions =
        typeof options === 'number' ? { durationMs: options } : (options ?? {});
      const durationMs =
        resolvedOptions.durationMs !== undefined
          ? resolvedOptions.durationMs
          : tone === 'success'
            ? 2000
            : null;
      if (!resolvedOptions.isDeleteUndo) {
        setLastDeletedTx(null);
      }
      setStatusToastSeq((n) => n + 1);
      setStatusToastDurationMs(durationMs);
      setStatusToastTone(tone);
      setStatusToast(message);
    },
    []
  );

  const dismissToast = useCallback(() => {
    setStatusToast(null);
    setStatusToastTone('success');
    setStatusToastDurationMs(null);
    setLastDeletedTx(null);
  }, []);

  const dismissBackupReminder = useCallback(() => {
    setBackupDismissed(true);
  }, []);

  const openPinModal = useCallback((mode: PinModalMode) => {
    setPinModalMode(mode);
  }, []);

  const closePinModal = useCallback(() => {
    setPinModalMode(null);
  }, []);

  const lockApp = useCallback(
    (toastMessage?: string) => {
      setIsUnlocked(false);
      setPinModalMode(null);
      setLastDeletedTx(null);
      backgroundedAtRef.current = null;
      if (view === 'bank-tx' || view === 'all') {
        setView('home');
        setSelectedBankId(null);
      }
      if (toastMessage) {
        showToast(toastMessage, 'success', 2000);
      }
    },
    [showToast, view]
  );

  useEffect(() => {
    if (!hasPin || !isUnlocked) {
      backgroundedAtRef.current = null;
      return;
    }

    const markBackgrounded = () => {
      backgroundedAtRef.current ??= Date.now();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markBackgrounded();
        return;
      }
      if (document.visibilityState === 'visible' && backgroundedAtRef.current !== null) {
        const elapsed = Date.now() - backgroundedAtRef.current;
        if (elapsed > 60_000) {
          lockApp('Auto-locked after being away for over 1 minute.');
        } else {
          backgroundedAtRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', markBackgrounded);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', markBackgrounded);
    };
  }, [hasPin, isUnlocked, lockApp]);

  const runWithErrorToast = useCallback(
    async <T,>(
      errorMessage: string,
      action: () => Promise<T>,
      onError?: () => void
    ): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        onError?.();
        showToast(errorMessage, 'error');
        throw error;
      }
    },
    [showToast]
  );

  const toggleTheme = useCallback(async () => {
    themeToggledDuringInitRef.current = true;
    const previousTheme = settings.theme;
    const nextTheme = previousTheme === 'light' ? 'dark' : 'light';
    setSettings((prev) => ({ ...prev, theme: nextTheme }));
    await runWithErrorToast(
      'Could not save theme preference. Please try again.',
      async () => {
        const db = await getDb();
        const updated = await saveSettings(db, { theme: nextTheme });
        setSettings((prev) => ({ ...prev, theme: updated.theme }));
      },
      () => {
        setSettings((prev) => ({ ...prev, theme: previousTheme }));
      }
    );
  }, [getDb, runWithErrorToast, settings.theme]);

  const setSelectedMonth = useCallback((ym: string) => {
    setSelectedMonthState(ym);
  }, []);

  const setFilters = useCallback((patch: Partial<FilterState>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState(INITIAL_FILTERS);
  }, []);

  const recordTransaction = useCallback(
    async (input: NewTransactionInput): Promise<Transaction> =>
      runWithErrorToast(
        'Could not save this entry. Please check storage permissions and try again.',
        async () => {
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
          setSaveBannerSeq((n) => n + 1);
          setSaveBanner(`Saved ${label} (${formatRupees(record.amountPaise)}) to ${accName}.`);
          setPreselectedAccountId(null);
          if (!(hasPin && !isUnlocked)) {
            setView('home');
          }
          return record;
        }
      ),
    [accounts, categories, getDb, hasPin, isUnlocked, runWithErrorToast]
  );

  const updateTransaction = useCallback(
    async (tx: Transaction): Promise<void> =>
      runWithErrorToast('Could not update this entry. Please try again.', async () => {
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
        showToast('Updated entry and recalculated bank balances.');
      }),
    [getDb, runWithErrorToast, showToast]
  );

  const deleteTransaction = useCallback(
    async (txId: string): Promise<void> =>
      runWithErrorToast('Could not delete this entry. Please try again.', async () => {
        const targetTx = transactions.find((item) => item.id === txId) ?? null;
        const db = await getDb();
        const nextSettings = await deleteTransactionAtomic(db, txId);
        setTransactions((prev) => prev.filter((item) => item.id !== txId));
        setSettings(nextSettings);
        setLastDeletedTx(targetTx);
        showToast('Transaction deleted and balances updated.', 'error', {
          durationMs: 4000,
          isDeleteUndo: true,
        });
      }),
    [getDb, runWithErrorToast, showToast, transactions]
  );

  const undoDeleteTransaction = useCallback(async (): Promise<void> => {
    const txToRestore = lastDeletedTx;
    if (!txToRestore || undoInFlightRef.current) return;
    undoInFlightRef.current = true;
    setLastDeletedTx(null);
    try {
      await runWithErrorToast(
        'Could not restore this entry. Please try again.',
        async () => {
          const db = await getDb();
          const nextSettings = await restoreDeletedTransactionAtomic(db, txToRestore);
          setTransactions((prev) =>
            prev.some((item) => item.id === txToRestore.id) ? prev : [txToRestore, ...prev]
          );
          setSettings(nextSettings);
          showToast('Transaction restored and balances updated.', 'success');
        },
        () => {
          setLastDeletedTx(txToRestore);
        }
      );
    } finally {
      undoInFlightRef.current = false;
    }
  }, [getDb, lastDeletedTx, runWithErrorToast, showToast]);

  const verifyCurrentPin = useCallback(
    async (
      pin: string,
      wrongPinMessage: string
    ): Promise<{ ok: true; record: SecurityRecord } | { ok: false; error: string }> => {
      if (!securityRecord) {
        return { ok: false, error: 'PIN lock is not set up.' };
      }
      if (pinCooldownUntil > Date.now()) {
        const remainingSec = Math.ceil((pinCooldownUntil - Date.now()) / 1000);
        return {
          ok: false,
          error: `Too many wrong PINs. Wait ${remainingSec} seconds and try again.`,
        };
      }
      const check = validatePin(pin);
      if (!check.valid) {
        return { ok: false, error: check.error };
      }
      const matched = await verifySecret(pin, securityRecord.pinHash);
      if (!matched) {
        const nextAttempts = failedPinAttempts + 1;
        setFailedPinAttempts(nextAttempts);
        if (nextAttempts >= 5) {
          setPinCooldownUntil(Date.now() + 30_000);
          return {
            ok: false,
            error: 'Too many wrong PINs. Please wait 30 seconds or use your Master Password.',
          };
        }
        return { ok: false, error: wrongPinMessage };
      }
      return { ok: true, record: securityRecord };
    },
    [failedPinAttempts, pinCooldownUntil, securityRecord]
  );

  const verifyPinAndUnlock = useCallback(
    async (pin: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const auth = await verifyCurrentPin(pin, 'Incorrect PIN. Please try again.');
      if (!auth.ok) {
        return { ok: false, error: auth.error };
      }
      setFailedPinAttempts(0);
      setPinCooldownUntil(0);
      setIsUnlocked(true);
      setPinModalMode(null);
      backgroundedAtRef.current = null;
      return { ok: true };
    },
    [verifyCurrentPin]
  );

  const verifyMasterAndProceed = useCallback(
    async (masterPassword: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!securityRecord) {
        return { ok: false, error: 'PIN lock is not set up.' };
      }
      if (!masterPassword) {
        return { ok: false, error: 'Please enter your Master Password.' };
      }
      const matched = await verifySecret(masterPassword, securityRecord.masterPasswordHash);
      if (!matched) {
        return { ok: false, error: 'Incorrect Master Password. Please try again.' };
      }
      setFailedPinAttempts(0);
      setPinCooldownUntil(0);
      setPinModalMode('reset-pin');
      return { ok: true };
    },
    [securityRecord]
  );

  const setupPin = useCallback(
    async (pin: string, masterPassword: string): Promise<void> => {
      const pinCheck = validatePin(pin);
      if (!pinCheck.valid) {
        throw new Error(pinCheck.error);
      }
      const pwCheck = validateMasterPassword(masterPassword);
      if (!pwCheck.valid) {
        throw new Error(pwCheck.error);
      }
      await runWithErrorToast('Could not save PIN lock settings. Please try again.', async () => {
        const [pinHash, masterPasswordHash] = await Promise.all([
          hashSecret(pin),
          hashSecret(masterPassword),
        ]);
        const record: SecurityRecord = {
          key: 'lock',
          pinHash,
          masterPasswordHash,
          updatedAt: new Date().toISOString(),
        };
        const db = await getDb();
        await saveSecurityRecord(db, record);
        setSecurityRecord(record);
        setIsUnlocked(true);
        setFailedPinAttempts(0);
        setPinCooldownUntil(0);
        setPinModalMode(null);
        showToast('PIN lock enabled.', 'success');
      });
    },
    [getDb, runWithErrorToast, showToast]
  );

  const resetPinAfterMaster = useCallback(
    async (newPin: string): Promise<void> => {
      const pinCheck = validatePin(newPin);
      if (!pinCheck.valid) {
        throw new Error(pinCheck.error);
      }
      if (!securityRecord) {
        throw new Error('PIN lock is not set up.');
      }
      await runWithErrorToast('Could not update PIN. Please try again.', async () => {
        const pinHash = await hashSecret(newPin);
        const updated: SecurityRecord = {
          ...securityRecord,
          pinHash,
          updatedAt: new Date().toISOString(),
        };
        const db = await getDb();
        await saveSecurityRecord(db, updated);
        setSecurityRecord(updated);
        setIsUnlocked(true);
        setFailedPinAttempts(0);
        setPinCooldownUntil(0);
        setPinModalMode(null);
        showToast('PIN updated and app unlocked.', 'success');
      });
    },
    [getDb, runWithErrorToast, securityRecord, showToast]
  );

  const changePin = useCallback(
    async (
      currentPin: string,
      newPin: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const auth = await verifyCurrentPin(currentPin, 'Current PIN is incorrect.');
      if (!auth.ok) {
        return { ok: false, error: auth.error };
      }
      const newCheck = validatePin(newPin);
      if (!newCheck.valid) {
        return { ok: false, error: newCheck.error };
      }
      try {
        const pinHash = await hashSecret(newPin);
        const updated: SecurityRecord = {
          ...auth.record,
          pinHash,
          updatedAt: new Date().toISOString(),
        };
        const db = await getDb();
        await saveSecurityRecord(db, updated);
        setSecurityRecord(updated);
        setFailedPinAttempts(0);
        setPinCooldownUntil(0);
        setPinModalMode(null);
        showToast('PIN changed.', 'success');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not update PIN. Please try again.' };
      }
    },
    [getDb, showToast, verifyCurrentPin]
  );

  const disablePin = useCallback(
    async (currentPin: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const auth = await verifyCurrentPin(currentPin, 'Current PIN is incorrect.');
      if (!auth.ok) {
        return { ok: false, error: auth.error };
      }
      try {
        const db = await getDb();
        await deleteSecurityRecord(db);
        setSecurityRecord(null);
        setIsUnlocked(false);
        setFailedPinAttempts(0);
        setPinCooldownUntil(0);
        setPinModalMode(null);
        showToast('PIN lock turned off.', 'success');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not turn off PIN lock. Please try again.' };
      }
    },
    [getDb, showToast, verifyCurrentPin]
  );

  const addAccount = useCallback(
    async (name: string, startingBalancePaise: number): Promise<void> =>
      runWithErrorToast('Could not save bank account. Please try again.', async () => {
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
        showToast(`Added ${trimmed} with balance ${formatRupees(startingBalancePaise)}.`);
      }),
    [getDb, runWithErrorToast, showToast]
  );

  const renameAccount = useCallback(
    async (id: string, name: string): Promise<void> =>
      runWithErrorToast('Could not rename bank account. Please try again.', async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const target = accounts.find((a) => a.id === id);
        if (!target) return;
        const updated: BankAccount = { ...target, name: trimmed };
        const db = await getDb();
        await saveAccount(db, updated, false);
        setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      }),
    [accounts, getDb, runWithErrorToast]
  );

  const adjustAccountBalance = useCallback(
    async (id: string, desiredBalancePaise: number): Promise<void> =>
      runWithErrorToast('Could not update bank balance. Please try again.', async () => {
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
        showToast(`Updated ${target.name} balance to ${formatRupees(desiredBalancePaise)}.`);
      }),
    [accounts, getDb, runWithErrorToast, showToast, transactions]
  );

  const setAccountArchived = useCallback(
    async (id: string, archived: boolean): Promise<void> =>
      runWithErrorToast('Could not update bank account status. Please try again.', async () => {
        const target = accounts.find((a) => a.id === id);
        if (!target) return;
        const updated: BankAccount = { ...target, archived };
        const db = await getDb();
        await saveAccount(db, updated, false);
        setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
        showToast(`${target.name} ${archived ? 'archived' : 'restored to active'}.`);
      }),
    [accounts, getDb, runWithErrorToast, showToast]
  );

  const addCategory = useCallback(
    async (name: string): Promise<void> =>
      runWithErrorToast('Could not add category. Please try again.', async () => {
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
      }),
    [categories, getDb, runWithErrorToast]
  );

  const renameCategory = useCallback(
    async (id: string, name: string): Promise<void> =>
      runWithErrorToast('Could not rename category. Please try again.', async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const target = categories.find((c) => c.id === id);
        if (!target) return;
        const updated: Category = { ...target, name: trimmed };
        const db = await getDb();
        await saveCategory(db, updated);
        setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
      }),
    [categories, getDb, runWithErrorToast]
  );

  const setCategoryHidden = useCallback(
    async (id: string, hidden: boolean): Promise<void> =>
      runWithErrorToast('Could not update category visibility. Please try again.', async () => {
        const target = categories.find((c) => c.id === id);
        if (!target) return;
        const updated: Category = { ...target, hidden };
        const db = await getDb();
        await saveCategory(db, updated);
        setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
      }),
    [categories, getDb, runWithErrorToast]
  );

  const addCustomPaymentMode = useCallback(
    async (txType: 'expense' | 'transfer', mode: string): Promise<string> =>
      runWithErrorToast('Could not save payment mode. Please try again.', async () => {
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
      }),
    [getDb, runWithErrorToast, settings]
  );

  const exportCsv = useCallback(
    async (
      scope: 'all' | 'filtered' | 'bank',
      txList: Transaction[],
      bankName?: string
    ): Promise<{ method: 'share' | 'download' | 'cancelled'; files: [string, string] }> =>
      runWithErrorToast('Could not export spreadsheet files. Please try again.', async () => {
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
          showToast(
            result.method === 'share'
              ? `Shared ${result.files[0]} & ${result.files[1]}.`
              : `Exported ${result.files[0]} & ${result.files[1]}.`
          );
        }

        return result;
      }),
    [accounts, categories, getDb, runWithErrorToast, showToast, transactions]
  );

  const downloadBackup = useCallback(
    async (): Promise<void> =>
      runWithErrorToast('Could not save backup file. Please try again.', async () => {
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
        showToast(`Downloaded backup ${filename}.`);
      }),
    [accounts, categories, getDb, runWithErrorToast, settings, showToast, transactions]
  );

  const restoreBackup = useCallback(
    async (payload: BackupPayload): Promise<void> =>
      runWithErrorToast(
        'Could not restore backup. Your existing data was not changed.',
        async () => {
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
          showToast(
            `Restored ${restored.accounts.length} accounts and ${restored.transactions.length} transactions.`
          );
          setView('home');
        }
      ),
    [getDb, runWithErrorToast, showToast]
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
      statusToastTone,
      storageError,
      backupDismissed,
      hasPin,
      isUnlocked,
      isLocked,
      pinModalMode,
      failedPinAttempts,
      pinCooldownUntil,
      lastDeletedTx,
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
      showToast,
      dismissToast,
      dismissBackupReminder,
      openPinModal,
      closePinModal,
      lockApp,
      verifyPinAndUnlock,
      verifyMasterAndProceed,
      setupPin,
      resetPinAfterMaster,
      changePin,
      disablePin,
      recordTransaction,
      updateTransaction,
      deleteTransaction,
      undoDeleteTransaction,
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
      statusToastTone,
      storageError,
      backupDismissed,
      hasPin,
      isUnlocked,
      isLocked,
      pinModalMode,
      failedPinAttempts,
      pinCooldownUntil,
      lastDeletedTx,
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
      showToast,
      dismissToast,
      dismissBackupReminder,
      openPinModal,
      closePinModal,
      lockApp,
      verifyPinAndUnlock,
      verifyMasterAndProceed,
      setupPin,
      resetPinAfterMaster,
      changePin,
      disablePin,
      recordTransaction,
      updateTransaction,
      deleteTransaction,
      undoDeleteTransaction,
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
