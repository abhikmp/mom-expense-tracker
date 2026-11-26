import { getTodayLocalISO } from '../domain/dates';
import type {
  AppSettings,
  BackupPayload,
  BankAccount,
  Category,
  Transaction,
} from '../domain/types';

const PAISE_NOTE =
  "Monetary fields ending in 'Paise' store integer paise (1 INR = 100 paise) to prevent floating-point rounding drift.";

/**
 * Triggers a browser file download from an in-memory string payload via an Object URL.
 */
export function triggerBlobDownload(
  filename: string,
  content: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Builds a schemaVersion 1 JSON backup payload preserving integer `*Paise` fields and custom modes.
 */
export function buildBackupPayload(params: {
  accounts: BankAccount[];
  categories: Category[];
  transactions: Transaction[];
  settings: AppSettings;
  exportedAt?: string;
}): BackupPayload {
  return {
    _note: PAISE_NOTE,
    schemaVersion: 1,
    exportedAt: params.exportedAt ?? new Date().toISOString(),
    accounts: [...params.accounts],
    categories: [...params.categories],
    expensePaymentModes: [...params.settings.expensePaymentModes],
    transferPaymentModes: [...params.settings.transferPaymentModes],
    transactions: [...params.transactions],
  };
}

/**
 * Downloads a formatted JSON backup file and returns the generated filename.
 */
export function downloadJsonBackup(
  payload: BackupPayload,
  todayIso: string = getTodayLocalISO()
): string {
  const filename = `moms-expenses-backup-${todayIso}.json`;
  triggerBlobDownload(
    filename,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
  return filename;
}
