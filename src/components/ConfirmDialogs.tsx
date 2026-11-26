import { useEffect, type ReactNode } from 'react';
import { Warning } from '@phosphor-icons/react';
import { formatRupees } from '../domain/money';
import type { BackupPayload, BankAccount } from '../domain/types';

/**
 * Shared accessible modal dialog shell with backdrop click and Escape-key dismissal.
 */
export function DialogShell({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="overlay-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog-panel">
        <h2 className="section-title" style={{ margin: '0 0 14px' }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export interface ArchiveConfirmDialogProps {
  account: BankAccount | null;
  balancePaise: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal shown when archiving a bank account that still holds a non-zero balance.
 */
export function ArchiveConfirmDialog({
  account,
  balancePaise,
  onConfirm,
  onCancel,
}: ArchiveConfirmDialogProps) {
  if (!account) return null;

  return (
    <DialogShell title="Archive Account With Balance?" onCancel={onCancel}>
      <div className="banner banner-warning" style={{ marginBottom: '16px' }}>
        <div className="banner-copy">
          <Warning size={18} aria-hidden="true" />
          <span>
            <strong>{account.name}</strong> still has{' '}
            <strong className="num">{formatRupees(balancePaise)}</strong> remaining. Archiving
            hides it from Home &amp; Total Balance.
          </span>
        </div>
      </div>
      <div className="row-between">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          Archive Anyway
        </button>
      </div>
    </DialogShell>
  );
}

export interface RestoreConfirmDialogProps {
  payload: BackupPayload | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation modal summarizing a validated JSON backup before replacing on-device data.
 */
export function RestoreConfirmDialog({
  payload,
  onConfirm,
  onCancel,
}: RestoreConfirmDialogProps) {
  if (!payload) return null;

  return (
    <DialogShell title="Restore Backup?" onCancel={onCancel}>
      <p style={{ margin: '0 0 12px', color: 'var(--color-muted-foreground)' }}>
        Replace on-device data with:
      </p>
      <div
        className="card"
        style={{
          background: 'var(--color-background)',
          marginBottom: '16px',
          padding: '12px 14px',
        }}
      >
        <div className="num" style={{ fontSize: '15px', fontWeight: 600 }}>
          {payload.accounts.length} Accounts · {payload.categories.length} Categories ·{' '}
          {payload.transactions.length} Entries
        </div>
      </div>
      <div className="row-between">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-danger-fill" onClick={onConfirm}>
          Restore Now
        </button>
      </div>
    </DialogShell>
  );
}
