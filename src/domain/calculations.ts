import type {
  AppSettings,
  BankAccount,
  Category,
  FilterState,
  Transaction,
} from './types';

const MS_PER_DAY = 86_400_000;
const BACKUP_REMINDER_CHANGES_THRESHOLD = 25;
const BACKUP_REMINDER_DAYS_THRESHOLD = 30;

/**
 * Computes net transaction flow in integer paise for a single account.
 */
export function computeNetTransactionsPaise(
  accountId: string,
  transactions: Transaction[]
): number {
  let net = 0;
  for (const tx of transactions) {
    if (tx.accountId !== accountId) continue;
    net += tx.direction === 'incoming' ? tx.amountPaise : -tx.amountPaise;
  }
  return net;
}

/**
 * Computes an account's current balance as `startingBalancePaise + netTransactionsPaise`.
 */
export function computeAccountBalancePaise(
  account: BankAccount,
  transactions: Transaction[]
): number {
  return account.startingBalancePaise + computeNetTransactionsPaise(account.id, transactions);
}

/**
 * Computes the `startingBalancePaise` needed for `accountId` to reach `desiredBalancePaise`.
 */
export function computeAdjustedStartingBalancePaise(
  desiredBalancePaise: number,
  accountId: string,
  transactions: Transaction[]
): number {
  return desiredBalancePaise - computeNetTransactionsPaise(accountId, transactions);
}

/**
 * Sums current balances across all non-archived bank accounts.
 */
export function computeTotalActiveBalancePaise(
  accounts: BankAccount[],
  transactions: Transaction[]
): number {
  let total = 0;
  for (const account of accounts) {
    if (!account.archived) {
      total += computeAccountBalancePaise(account, transactions);
    }
  }
  return total;
}

/**
 * Aggregates expense transactions for `ym` (`YYYY-MM`) by category, excluding deposits and transfers.
 */
export function computeMonthlyCategorySpending(
  ym: string,
  transactions: Transaction[],
  categories: Category[]
): {
  totalPaise: number;
  rows: Array<{ categoryId: string; name: string; amountPaise: number; sharePct: number }>;
} {
  const totalsByCategory = new Map<string, number>();
  let totalPaise = 0;

  for (const tx of transactions) {
    if (tx.type !== 'expense' || !tx.date.startsWith(ym)) continue;
    const categoryId = tx.categoryId || 'cat-other';
    totalsByCategory.set(categoryId, (totalsByCategory.get(categoryId) ?? 0) + tx.amountPaise);
    totalPaise += tx.amountPaise;
  }

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const rows = [...totalsByCategory.entries()]
    .map(([categoryId, amountPaise]) => ({
      categoryId,
      name: categoryById.get(categoryId)?.name ?? 'Other',
      amountPaise,
      sharePct: totalPaise > 0 ? Math.round((amountPaise / totalPaise) * 100) : 0,
    }))
    .sort((a, b) => b.amountPaise - a.amountPaise);

  return { totalPaise, rows };
}

/**
 * Returns a new array of transactions sorted newest-first by `date`, then `createdAt`.
 */
export function getSortedTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) =>
    a.date !== b.date
      ? b.date.localeCompare(a.date)
      : b.createdAt.localeCompare(a.createdAt)
  );
}

/**
 * Returns transactions matching `filters`, sorted newest-first.
 */
export function filterTransactions(
  transactions: Transaction[],
  filters: FilterState
): Transaction[] {
  return getSortedTransactions(transactions).filter((tx) => {
    if (filters.fromDate && tx.date < filters.fromDate) return false;
    if (filters.toDate && tx.date > filters.toDate) return false;
    if (filters.typeKey === 'expense' && tx.type !== 'expense') return false;
    if (filters.typeKey === 'deposit' && tx.type !== 'deposit') return false;
    if (
      filters.typeKey === 'transfer-outgoing' &&
      !(tx.type === 'transfer' && tx.direction === 'outgoing')
    ) {
      return false;
    }
    if (
      filters.typeKey === 'transfer-incoming' &&
      !(tx.type === 'transfer' && tx.direction === 'incoming')
    ) {
      return false;
    }
    if (
      filters.categoryId !== 'all' &&
      (tx.type !== 'expense' || tx.categoryId !== filters.categoryId)
    ) {
      return false;
    }
    return true;
  });
}

function getOldestTransactionTimestamp(transactions: Transaction[]): number | null {
  let oldestMs: number | null = null;
  for (const tx of transactions) {
    const ms = Date.parse(tx.createdAt);
    if (!Number.isFinite(ms)) continue;
    if (oldestMs === null || ms < oldestMs) {
      oldestMs = ms;
    }
  }
  return oldestMs;
}

/**
 * Determines whether the backup/export reminder banner should be shown.
 */
export function isBackupReminderDue(
  settings: AppSettings,
  accounts: BankAccount[],
  transactions: Transaction[],
  now: Date = new Date()
): { due: boolean; daysSince: number } {
  const hasActiveAccount = accounts.some((a) => !a.archived);
  if (!hasActiveAccount) {
    return { due: false, daysSince: 0 };
  }

  let referenceMs: number | null = null;
  if (settings.lastBackupOrExportAt) {
    const parsed = Date.parse(settings.lastBackupOrExportAt);
    if (Number.isFinite(parsed)) {
      referenceMs = parsed;
    }
  } else {
    referenceMs = getOldestTransactionTimestamp(transactions);
  }

  const diffMs = referenceMs !== null ? now.getTime() - referenceMs : 0;
  const daysSince = diffMs > 0 ? Math.floor(diffMs / MS_PER_DAY) : 0;
  const due =
    settings.changesSinceLastBackup >= BACKUP_REMINDER_CHANGES_THRESHOLD ||
    daysSince >= BACKUP_REMINDER_DAYS_THRESHOLD;

  return { due, daysSince };
}
