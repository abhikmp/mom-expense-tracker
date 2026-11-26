import { computeAccountBalancePaise } from '../domain/calculations';
import { getTodayLocalISO } from '../domain/dates';
import { formatDecimalRupeesPlain } from '../domain/money';
import type { BankAccount, Category, Transaction } from '../domain/types';
import { slugifyAccountName } from '../domain/validation';
import { triggerBlobDownload } from './backup';

const UTF8_BOM = '\uFEFF';
const CSV_MIME = 'text/csv;charset=utf-8';
const TX_HEADER = [
  'Date',
  'Type',
  'Direction',
  'Account',
  'Category',
  'Mode',
  'Amount',
  'Signed Amount',
  'Note',
];
const BAL_HEADER = [
  'Account',
  'Status',
  'Starting Balance',
  'Current Balance',
  'As Of Date',
];

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function getTransactionsFilename(
  scope: 'all' | 'filtered' | 'bank',
  todayIso: string,
  bankName?: string
): string {
  if (scope === 'all') {
    return `transactions-${todayIso}.csv`;
  }
  if (scope === 'filtered') {
    return `transactions-filtered-${todayIso}.csv`;
  }
  return `transactions-${slugifyAccountName(bankName ?? '')}-filtered-${todayIso}.csv`;
}

/**
 * Escapes a single CSV cell according to RFC 4180 (quoting commas, quotes, CR, and LF).
 */
export function csvCell(val: unknown): string {
  const s = String(val ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Builds a UTF-8 BOM, CRLF-delimited CSV string of transactions, preserving archived accounts and hidden categories.
 */
export function buildTransactionsCsv(
  txList: Transaction[],
  accounts: BankAccount[],
  categories: Category[]
): string {
  const accountById = new Map(accounts.map((acc) => [acc.id, acc]));
  const categoryById = new Map(categories.map((cat) => [cat.id, cat]));

  const rows = txList.map((tx) => {
    const acc = accountById.get(tx.accountId);
    const cat = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
    const signedPaise = tx.direction === 'incoming' ? tx.amountPaise : -tx.amountPaise;
    const categoryName = tx.type === 'expense' ? (cat ? cat.name : 'Other') : '';

    return [
      tx.date,
      tx.type,
      tx.direction,
      acc ? acc.name : 'Unknown',
      categoryName,
      tx.mode || '',
      formatDecimalRupeesPlain(tx.amountPaise),
      formatDecimalRupeesPlain(signedPaise),
      tx.note || '',
    ]
      .map(csvCell)
      .join(',');
  });

  return UTF8_BOM + [TX_HEADER.join(','), ...rows].join('\r\n');
}

/**
 * Builds a UTF-8 BOM, CRLF-delimited CSV summary of all bank accounts and their computed balances.
 */
export function buildBalancesCsv(
  accounts: BankAccount[],
  transactions: Transaction[],
  asOfDate: string
): string {
  const rows = accounts.map((acc) =>
    [
      acc.name,
      acc.archived ? 'Archived' : 'Active',
      formatDecimalRupeesPlain(acc.startingBalancePaise),
      formatDecimalRupeesPlain(computeAccountBalancePaise(acc, transactions)),
      asOfDate,
    ]
      .map(csvCell)
      .join(',')
  );

  return UTF8_BOM + [BAL_HEADER.join(','), ...rows].join('\r\n');
}

/**
 * Exports transactions and bank balances CSV files via Android/Web Share Sheet when supported,
 * falling back to Blob URL downloads on unsupported platforms or non-abort share errors.
 */
export async function exportCsvFiles(params: {
  transactions: Transaction[];
  allTransactions: Transaction[];
  accounts: BankAccount[];
  categories: Category[];
  scope: 'all' | 'filtered' | 'bank';
  bankName?: string;
  todayIso?: string;
}): Promise<{ method: 'share' | 'download' | 'cancelled'; files: [string, string] }> {
  const todayIso = params.todayIso ?? getTodayLocalISO();
  const txName = getTransactionsFilename(params.scope, todayIso, params.bankName);
  const balName = `bank-balances-${todayIso}.csv`;
  const files: [string, string] = [txName, balName];

  const txCsv = buildTransactionsCsv(params.transactions, params.accounts, params.categories);
  const balCsv = buildBalancesCsv(params.accounts, params.allTransactions, todayIso);

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    const shareFiles = [
      new File([txCsv], txName, { type: CSV_MIME }),
      new File([balCsv], balName, { type: CSV_MIME }),
    ];

    if (navigator.canShare({ files: shareFiles })) {
      try {
        await navigator.share({ files: shareFiles });
        return { method: 'share', files };
      } catch (err) {
        if (isAbortError(err)) {
          return { method: 'cancelled', files };
        }
      }
    }
  }

  triggerBlobDownload(txName, txCsv, CSV_MIME);
  triggerBlobDownload(balName, balCsv, CSV_MIME);
  return { method: 'download', files };
}
