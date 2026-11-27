import { Check, Warning } from '@phosphor-icons/react';
import { isBackupReminderDue } from '../domain/calculations';
import { useApp } from '../state/AppContext';

/**
 * Displays transient status toasts, post-save confirmation banners, and the backup reminder banner.
 */
export function Banners() {
  const {
    accounts,
    transactions,
    settings,
    view,
    saveBanner,
    statusToast,
    statusToastTone,
    storageError,
    backupDismissed,
    isLocked,
    lastDeletedTx,
    navigate,
    dismissToast,
    dismissSaveBanner,
    dismissBackupReminder,
    undoDeleteTransaction,
  } = useApp();

  const backupCheck =
    view === 'home' && !backupDismissed && !isLocked
      ? isBackupReminderDue(settings, accounts, transactions)
      : { due: false, daysSince: 0 };

  const backupMessage =
    backupCheck.daysSince >= 30
      ? `It has been ${backupCheck.daysSince} days since your last backup or spreadsheet export.`
      : `You have ${settings.changesSinceLastBackup} new entries since your last backup or spreadsheet export.`;

  return (
    <>
      {statusToast ? (
        <div
          className={`banner ${statusToastTone === 'error' ? 'banner-error' : 'banner-success'}`}
          role="status"
        >
          <div className="banner-copy">
            {statusToastTone === 'error' ? (
              <Warning size={18} aria-hidden="true" />
            ) : (
              <Check size={18} aria-hidden="true" />
            )}
            <span>{statusToast}</span>
          </div>
          <div className="banner-actions">
            {lastDeletedTx && (
              <button
                type="button"
                className="btn btn-danger-fill btn-sm"
                onClick={() => void undoDeleteTransaction().catch(() => {})}
              >
                Undo
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={dismissToast}>
              Close
            </button>
          </div>
        </div>
      ) : (
        storageError && (
          <div className="banner banner-error" role="status">
            <div className="banner-copy">
              <Warning size={18} aria-hidden="true" />
              <span>{storageError}</span>
            </div>
          </div>
        )
      )}

      {saveBanner && (
        <div className="banner banner-success" role="status">
          <div className="banner-copy">
            <Check size={18} aria-hidden="true" />
            <span>{saveBanner}</span>
          </div>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('record')}
            >
              + Add another
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={dismissSaveBanner}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {backupCheck.due && (
        <div className="banner banner-warning" role="region" aria-label="Backup reminder">
          <div className="banner-copy">
            <Warning size={18} aria-hidden="true" />
            <span>{backupMessage}</span>
          </div>
          <div className="banner-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('manage', { manageJumpTarget: 'sec-backup' })}
            >
              Back Up Now
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={dismissBackupReminder}
            >
              Later
            </button>
          </div>
        </div>
      )}
    </>
  );
}
