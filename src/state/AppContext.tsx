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
  type SecurityThrottleRecord,
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
  clearSecurityThrottle,
  createSecurityRecordIfAbsent,
  createTransactionAtomic,
  deleteSecurityRecord,
  deleteTransactionAtomic,
  loadAppState,
  loadSecurityRecord,
  loadSecurityThrottle,
  markBackupOrExportCompleted,
  openAppDb,
  recordFailedAttemptAtomic,
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
  failedMasterAttempts: number;
  masterCooldownUntil: number;
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
  setupPin: (
    pin: string,
    masterPassword: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  resetPinAfterMaster: (newPin: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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
  const [failedMasterAttempts, setFailedMasterAttempts] = useState(0);
  const [masterCooldownUntil, setMasterCooldownUntil] = useState(0);
  const [lastDeletedTx, setLastDeletedTx] = useState<Transaction | null>(null);

  const hasPin = securityRecord !== null;
  const isLocked = hasPin && !isUnlocked;

  const dbRef = useRef<IDBPDatabase<MomExpenseDbSchema> | null>(null);
  const dbReadyRef = useRef<Promise<IDBPDatabase<MomExpenseDbSchema>> | null>(null);
  const themeToggledDuringInitRef = useRef(false);
  const backgroundedAtRef = useRef<number | null>(null);
  const lastHiddenAtRef = useRef<number | null>(null);
  const undoInFlightRef = useRef(false);
  const securityRecordRef = useRef<SecurityRecord | null>(null);
  const isUnlockedRef = useRef(false);
  const pendingUndoEpochRef = useRef(0);
  const viewRef = useRef<ViewId>(view);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const updateUnlocked = useCallback((next: boolean) => {
    isUnlockedRef.current = next;
    setIsUnlocked(next);
  }, []);

  const applyThrottleState = useCallback((throttle: SecurityThrottleRecord) => {
    setFailedPinAttempts(throttle.failedPinAttempts);
    setPinCooldownUntil(throttle.pinCooldownUntil);
    setFailedMasterAttempts(throttle.failedMasterAttempts);
    setMasterCooldownUntil(throttle.masterCooldownUntil);
  }, []);

  const resetThrottleState = useCallback(() => {
    setFailedPinAttempts(0);
    setPinCooldownUntil(0);
    setFailedMasterAttempts(0);
    setMasterCooldownUntil(0);
  }, []);

  const checkIsLocked = useCallback(
    () => securityRecordRef.current !== null && !isUnlockedRef.current,
    []
  );

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

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
      const [loaded, loadedSecurity, loadedThrottle] = await Promise.all([
        loadAppState(db),
        loadSecurityRecord(db),
        loadSecurityThrottle(db),
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
        securityRecordRef.current = loadedSecurity;
        setSecurityRecord(loadedSecurity);
        updateUnlocked(false);
        setPinModalMode(null);
        applyThrottleState(loadedThrottle);
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
      pendingUndoEpochRef.current += 1;
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
        pendingUndoEpochRef.current += 1;
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
    pendingUndoEpochRef.current += 1;
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
      pendingUndoEpochRef.current += 1;
      updateUnlocked(false);
      setPinModalMode(null);
      setLastDeletedTx(null);
      backgroundedAtRef.current = null;
      if (view === 'bank-tx' || view === 'all') {
        setView('home');
        setSelectedBankId(null);
      }
      if (toastMessage) {
        showToast(toastMessage, 'success', 2000);
      } else {
        dismissToast();
      }
    },
    [dismissToast, showToast, updateUnlocked, view]
  );

  const postSecurityChanged = useCallback(() => {
    try {
      broadcastChannelRef.current?.postMessage({ type: 'security-changed' });
    } catch {
      // Ignore BroadcastChannel errors (e.g., closed channel during teardown)
    }
  }, []);

  const syncSecurityFromDb = useCallback(async (): Promise<SecurityRecord | null> => {
    const db = await getDb();
    const [latest, latestThrottle] = await Promise.all([
      loadSecurityRecord(db),
      loadSecurityThrottle(db),
    ]);
    const current = securityRecordRef.current;

    if (!latest) {
      if (current !== null) {
        securityRecordRef.current = null;
        setSecurityRecord(null);
        updateUnlocked(false);
        backgroundedAtRef.current = null;
        setPinModalMode((prev) => (prev && prev !== 'setup' ? null : prev));
      }
      applyThrottleState(latestThrottle);
      return null;
    }

    if (!current || current.updatedAt !== latest.updatedAt) {
      pendingUndoEpochRef.current += 1;
      securityRecordRef.current = latest;
      setSecurityRecord(latest);
      updateUnlocked(false);
      backgroundedAtRef.current = null;
      setLastDeletedTx(null);
      setPinModalMode((prev) =>
        prev === 'setup' || prev === 'change' || prev === 'disable' || prev === 'reset-pin'
          ? null
          : prev
      );
      if (viewRef.current === 'bank-tx' || viewRef.current === 'all') {
        setView('home');
        setSelectedBankId(null);
      }
    }

    applyThrottleState(latestThrottle);
    return latest;
  }, [applyThrottleState, getDb, updateUnlocked]);

  useEffect(() => {
    const channelName = `mom-expense-security-${dbName ?? 'default'}`;
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(channelName);
      broadcastChannelRef.current = channel;
      channel.onmessage = () => {
        void syncSecurityFromDb().catch(() => {});
      };
    }

    const handleFocus = () => {
      void syncSecurityFromDb().catch(() => {});
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncSecurityFromDb().catch(() => {});
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (channel) {
        channel.close();
        if (broadcastChannelRef.current === channel) {
          broadcastChannelRef.current = null;
        }
      }
    };
  }, [dbName, syncSecurityFromDb]);

  useEffect(() => {
    const trackHidden = () => {
      lastHiddenAtRef.current ??= Date.now();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        trackHidden();
      } else if (document.visibilityState === 'visible') {
        lastHiddenAtRef.current = null;
      }
    };
    if (document.visibilityState === 'hidden') {
      trackHidden();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', trackHidden);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', trackHidden);
    };
  }, []);

  useEffect(() => {
    if (!hasPin || !isUnlocked) {
      backgroundedAtRef.current = null;
      return;
    }

    const markBackgrounded = () => {
      backgroundedAtRef.current ??= lastHiddenAtRef.current ?? Date.now();
    };

    if (document.visibilityState === 'hidden') {
      markBackgrounded();
    }

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
        if (checkIsLocked()) {
          pendingUndoEpochRef.current += 1;
          setLastDeletedTx(null);
          return;
        }
        pendingUndoEpochRef.current += 1;
        setLastDeletedTx(targetTx);
        showToast('Transaction deleted and balances updated.', 'error', {
          durationMs: 4000,
          isDeleteUndo: true,
        });
      }),
    [checkIsLocked, getDb, runWithErrorToast, showToast, transactions]
  );

  const undoDeleteTransaction = useCallback(async (): Promise<void> => {
    const txToRestore = lastDeletedTx;
    if (!txToRestore || undoInFlightRef.current || checkIsLocked()) return;
    const attemptEpoch = pendingUndoEpochRef.current;
    undoInFlightRef.current = true;
    try {
      const db = await getDb();
      const nextSettings = await restoreDeletedTransactionAtomic(db, txToRestore);
      setTransactions((prev) =>
        prev.some((item) => item.id === txToRestore.id) ? prev : [txToRestore, ...prev]
      );
      setSettings(nextSettings);
      if (attemptEpoch === pendingUndoEpochRef.current && !checkIsLocked()) {
        pendingUndoEpochRef.current += 1;
        setLastDeletedTx(null);
        showToast('Transaction restored and balances updated.', 'success');
      } else {
        setLastDeletedTx(null);
      }
    } catch {
      if (attemptEpoch === pendingUndoEpochRef.current && !checkIsLocked()) {
        setLastDeletedTx(txToRestore);
        showToast('Could not restore this entry. Please try again.', 'error', {
          isDeleteUndo: true,
        });
      }
    } finally {
      undoInFlightRef.current = false;
    }
  }, [checkIsLocked, getDb, lastDeletedTx, showToast]);

  const verifyCurrentPin = useCallback(
    async (
      pin: string,
      wrongPinMessage: string
    ): Promise<
      { ok: true; record: SecurityRecord; hasThrottle: boolean } | { ok: false; error: string }
    > => {
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
      try {
        const db = await getDb();
        const [latestRecord, latestThrottle] = await Promise.all([
          loadSecurityRecord(db),
          loadSecurityThrottle(db),
        ]);
        if (latestRecord?.updatedAt !== securityRecordRef.current?.updatedAt) {
          securityRecordRef.current = latestRecord;
          setSecurityRecord(latestRecord);
        }
        applyThrottleState(latestThrottle);
        if (!latestRecord) {
          return { ok: false, error: 'PIN lock is not set up.' };
        }
        if (latestThrottle.pinCooldownUntil > Date.now()) {
          const remainingSec = Math.ceil((latestThrottle.pinCooldownUntil - Date.now()) / 1000);
          return {
            ok: false,
            error: `Too many wrong PINs. Wait ${remainingSec} seconds and try again.`,
          };
        }
        const matched = await verifySecret(pin, latestRecord.pinHash);
        if (!matched) {
          const updatedThrottle = await recordFailedAttemptAtomic(db, 'pin');
          applyThrottleState(updatedThrottle);
          postSecurityChanged();
          if (updatedThrottle.failedPinAttempts >= 5) {
            return {
              ok: false,
              error: 'Too many wrong PINs. Please wait 30 seconds or use your Master Password.',
            };
          }
          return { ok: false, error: wrongPinMessage };
        }
        const hasThrottle =
          latestThrottle.failedPinAttempts > 0 ||
          latestThrottle.pinCooldownUntil > 0 ||
          latestThrottle.failedMasterAttempts > 0 ||
          latestThrottle.masterCooldownUntil > 0;
        return { ok: true, record: latestRecord, hasThrottle };
      } catch {
        return { ok: false, error: 'Could not verify credentials. Please try again.' };
      }
    },
    [applyThrottleState, getDb, pinCooldownUntil, postSecurityChanged]
  );

  const verifyPinAndUnlock = useCallback(
    async (pin: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const auth = await verifyCurrentPin(pin, 'Incorrect PIN. Please try again.');
      if (!auth.ok) {
        return { ok: false, error: auth.error };
      }
      if (auth.hasThrottle) {
        try {
          const db = await getDb();
          await clearSecurityThrottle(db, 'all');
          postSecurityChanged();
        } catch {
          // Best-effort throttle clear after verified unlock
        }
      }
      resetThrottleState();
      backgroundedAtRef.current =
        document.visibilityState === 'hidden' ? (lastHiddenAtRef.current ?? Date.now()) : null;
      updateUnlocked(true);
      setPinModalMode(null);
      return { ok: true };
    },
    [getDb, postSecurityChanged, resetThrottleState, updateUnlocked, verifyCurrentPin]
  );

  const verifyMasterAndProceed = useCallback(
    async (masterPassword: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (masterCooldownUntil > Date.now()) {
        const remainingSec = Math.ceil((masterCooldownUntil - Date.now()) / 1000);
        return {
          ok: false,
          error: `Too many wrong attempts. Wait ${remainingSec} seconds and try again.`,
        };
      }
      if (!masterPassword) {
        return { ok: false, error: 'Please enter your Master Password.' };
      }
      try {
        const db = await getDb();
        const [latestRecord, latestThrottle] = await Promise.all([
          loadSecurityRecord(db),
          loadSecurityThrottle(db),
        ]);
        if (latestRecord?.updatedAt !== securityRecordRef.current?.updatedAt) {
          securityRecordRef.current = latestRecord;
          setSecurityRecord(latestRecord);
        }
        applyThrottleState(latestThrottle);
        if (!latestRecord) {
          return { ok: false, error: 'PIN lock is not set up.' };
        }
        if (latestThrottle.masterCooldownUntil > Date.now()) {
          const remainingSec = Math.ceil((latestThrottle.masterCooldownUntil - Date.now()) / 1000);
          return {
            ok: false,
            error: `Too many wrong attempts. Wait ${remainingSec} seconds and try again.`,
          };
        }
        const matched = await verifySecret(masterPassword, latestRecord.masterPasswordHash);
        if (!matched) {
          const updatedThrottle = await recordFailedAttemptAtomic(db, 'master');
          applyThrottleState(updatedThrottle);
          postSecurityChanged();
          if (updatedThrottle.failedMasterAttempts >= 5) {
            return {
              ok: false,
              error: 'Too many wrong attempts. Please wait 30 seconds and try again.',
            };
          }
          return { ok: false, error: 'Incorrect Master Password. Please try again.' };
        }
        const hasThrottle =
          latestThrottle.failedPinAttempts > 0 ||
          latestThrottle.pinCooldownUntil > 0 ||
          latestThrottle.failedMasterAttempts > 0 ||
          latestThrottle.masterCooldownUntil > 0;
        if (hasThrottle) {
          try {
            await clearSecurityThrottle(db, 'all');
            postSecurityChanged();
          } catch {
            // Best-effort throttle clear after verified recovery
          }
        }
        resetThrottleState();
        backgroundedAtRef.current =
          document.visibilityState === 'hidden' ? (lastHiddenAtRef.current ?? Date.now()) : null;
        updateUnlocked(true);
        setPinModalMode('reset-pin');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not verify credentials. Please try again.' };
      }
    },
    [
      applyThrottleState,
      getDb,
      masterCooldownUntil,
      postSecurityChanged,
      resetThrottleState,
      updateUnlocked,
    ]
  );

  const setupPin = useCallback(
    async (
      pin: string,
      masterPassword: string
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const pinCheck = validatePin(pin);
      if (!pinCheck.valid) {
        return { ok: false, error: pinCheck.error };
      }
      const pwCheck = validateMasterPassword(masterPassword);
      if (!pwCheck.valid) {
        return { ok: false, error: pwCheck.error };
      }
      try {
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
        const created = await createSecurityRecordIfAbsent(db, record);
        if (!created.created) {
          securityRecordRef.current = created.existing;
          setSecurityRecord(created.existing);
          updateUnlocked(false);
          backgroundedAtRef.current = null;
          const existingThrottle = await loadSecurityThrottle(db);
          applyThrottleState(existingThrottle);
          return {
            ok: false,
            error: 'PIN lock is already enabled. Please unlock with your existing PIN.',
          };
        }
        securityRecordRef.current = record;
        setSecurityRecord(record);
        backgroundedAtRef.current =
          document.visibilityState === 'hidden' ? (lastHiddenAtRef.current ?? Date.now()) : null;
        updateUnlocked(true);
        resetThrottleState();
        setPinModalMode(null);
        postSecurityChanged();
        showToast('PIN lock enabled.', 'success');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not save PIN lock settings. Please try again.' };
      }
    },
    [applyThrottleState, getDb, postSecurityChanged, resetThrottleState, showToast, updateUnlocked]
  );

  const resetPinAfterMaster = useCallback(
    async (newPin: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      const pinCheck = validatePin(newPin);
      if (!pinCheck.valid) {
        return { ok: false, error: pinCheck.error };
      }
      try {
        const db = await getDb();
        const latestRecord = await loadSecurityRecord(db);
        if (!latestRecord) {
          securityRecordRef.current = null;
          setSecurityRecord(null);
          return { ok: false, error: 'PIN lock is not set up.' };
        }
        const pinHash = await hashSecret(newPin);
        const updated: SecurityRecord = {
          ...latestRecord,
          pinHash,
          updatedAt: new Date().toISOString(),
        };
        await saveSecurityRecord(db, updated);
        securityRecordRef.current = updated;
        setSecurityRecord(updated);
        backgroundedAtRef.current =
          document.visibilityState === 'hidden' ? (lastHiddenAtRef.current ?? Date.now()) : null;
        updateUnlocked(true);
        resetThrottleState();
        setPinModalMode(null);
        postSecurityChanged();
        showToast('PIN updated and app unlocked.', 'success');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not update PIN. Please try again.' };
      }
    },
    [getDb, postSecurityChanged, resetThrottleState, showToast, updateUnlocked]
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
        securityRecordRef.current = updated;
        setSecurityRecord(updated);
        backgroundedAtRef.current =
          document.visibilityState === 'hidden' ? (lastHiddenAtRef.current ?? Date.now()) : null;
        updateUnlocked(true);
        resetThrottleState();
        setPinModalMode(null);
        postSecurityChanged();
        showToast('PIN changed.', 'success');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not update PIN. Please try again.' };
      }
    },
    [getDb, postSecurityChanged, resetThrottleState, showToast, updateUnlocked, verifyCurrentPin]
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
        securityRecordRef.current = null;
        setSecurityRecord(null);
        updateUnlocked(false);
        backgroundedAtRef.current = null;
        resetThrottleState();
        setPinModalMode(null);
        postSecurityChanged();
        showToast('PIN lock turned off.', 'success');
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not turn off PIN lock. Please try again.' };
      }
    },
    [getDb, postSecurityChanged, resetThrottleState, showToast, updateUnlocked, verifyCurrentPin]
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
      failedMasterAttempts,
      masterCooldownUntil,
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
      failedMasterAttempts,
      masterCooldownUntil,
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
