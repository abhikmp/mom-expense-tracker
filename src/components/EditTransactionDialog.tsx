import { useState, type FormEvent } from 'react';
import { DialogShell } from './ConfirmDialogs';
import { formatDateShort } from '../domain/dates';
import { formatDecimalRupeesPlain, formatRupees } from '../domain/money';
import type {
  AppSettings,
  BankAccount,
  Category,
  Transaction,
  TransactionDirection,
  TransactionType,
} from '../domain/types';
import { validateTransactionAmount } from '../domain/validation';
import { useApp } from '../state/AppContext';

export interface EditTransactionDialogProps {
  txId: string | null;
  onClose: () => void;
}

type EditTypeKey = 'expense' | 'deposit' | 'transfer-outgoing' | 'transfer-incoming';

function toEditTypeKey(tx: Transaction): EditTypeKey {
  if (tx.type === 'transfer') {
    return tx.direction === 'incoming' ? 'transfer-incoming' : 'transfer-outgoing';
  }
  return tx.type;
}

function getBaseModeOptions(typeKey: EditTypeKey, settings: AppSettings): string[] {
  if (typeKey === 'deposit') return settings.depositModes;
  if (typeKey === 'transfer-outgoing' || typeKey === 'transfer-incoming') {
    return settings.transferPaymentModes;
  }
  return settings.expensePaymentModes;
}

function getDeleteTitle(tx: Transaction, categories: Category[]): string {
  if (tx.type === 'expense') {
    const cat = tx.categoryId ? categories.find((c) => c.id === tx.categoryId) : undefined;
    return cat ? cat.name : 'Other';
  }
  if (tx.type === 'deposit') {
    return 'Cash Deposit';
  }
  return tx.direction === 'incoming' ? 'Transfer In' : 'Transfer Out';
}

interface EditTransactionFormProps {
  tx: Transaction;
  accounts: BankAccount[];
  categories: Category[];
  settings: AppSettings;
  onUpdate: (tx: Transaction) => Promise<void>;
  onDelete: (txId: string) => Promise<void>;
  onClose: () => void;
}

function EditTransactionForm({
  tx,
  accounts,
  categories,
  settings,
  onUpdate,
  onDelete,
  onClose,
}: EditTransactionFormProps) {
  const initialTypeKey = toEditTypeKey(tx);
  const [typeKey, setTypeKey] = useState<EditTypeKey>(initialTypeKey);
  const [amountStr, setAmountStr] = useState(() => formatDecimalRupeesPlain(tx.amountPaise));
  const [accountId, setAccountId] = useState(tx.accountId);
  const [categoryId, setCategoryId] = useState(tx.categoryId ?? '');
  const [mode, setMode] = useState(tx.mode);
  const [date, setDate] = useState(tx.date);
  const [note, setNote] = useState(tx.note ?? '');
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const txAccounts = accounts.filter((a) => !a.archived || a.id === tx.accountId);
  const txCategories = categories.filter((c) => !c.hidden || c.id === tx.categoryId);

  const baseModeOpts = getBaseModeOptions(typeKey, settings);
  const isOriginalType = typeKey === initialTypeKey;
  const modeOptions =
    isOriginalType && tx.mode && !baseModeOpts.includes(tx.mode)
      ? [...baseModeOpts, tx.mode]
      : baseModeOpts;
  const resolvedMode = modeOptions.includes(mode) ? mode : (modeOptions[0] ?? '');

  const handleTypeChange = (nextTypeKey: EditTypeKey) => {
    setTypeKey(nextTypeKey);
    const nextModeOpts = getBaseModeOptions(nextTypeKey, settings);
    if (!nextModeOpts.includes(mode)) {
      setMode(nextModeOpts[0] ?? '');
    }
    if (nextTypeKey === 'expense') {
      if (!categoryId || !txCategories.some((c) => c.id === categoryId)) {
        setCategoryId(txCategories[0]?.id ?? '');
      }
    } else {
      setCategoryId('');
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const validation = validateTransactionAmount(amountStr);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    const nextType: TransactionType = typeKey.startsWith('transfer')
      ? 'transfer'
      : (typeKey as 'expense' | 'deposit');
    const nextDirection: TransactionDirection =
      typeKey === 'deposit' || typeKey === 'transfer-incoming' ? 'incoming' : 'outgoing';
    const nextCategoryId =
      nextType === 'expense' ? categoryId || txCategories[0]?.id || null : null;

    setSubmitting(true);
    try {
      await onUpdate({
        ...tx,
        type: nextType,
        direction: nextDirection,
        amountPaise: validation.paise,
        accountId,
        categoryId: nextCategoryId,
        mode: resolvedMode || tx.mode,
        date: date || tx.date,
        note,
      });
      onClose();
    } catch {
      // AppContext surfaced an error toast; keep the dialog open with edits intact.
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onDelete(tx.id);
      onClose();
    } catch {
      // AppContext surfaced an error toast; keep the delete confirmation open.
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmingDelete) {
    return (
      <DialogShell title="Delete Transaction?" onCancel={onClose}>
        <p style={{ margin: '0 0 16px', color: 'var(--color-muted-foreground)' }}>
          Remove{' '}
          <strong style={{ color: 'var(--color-foreground)' }}>
            {getDeleteTitle(tx, categories)}
          </strong>{' '}
          of{' '}
          <strong className="num" style={{ color: 'var(--color-foreground)' }}>
            {formatRupees(tx.amountPaise)}
          </strong>{' '}
          on {formatDateShort(tx.date)}? Balances update immediately.
        </p>
        <div className="row-between">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setConfirmingDelete(false)}
          >
            Keep Entry
          </button>
          <button
            type="button"
            className="btn btn-danger-fill"
            disabled={submitting}
            onClick={() => void handleConfirmDelete()}
          >
            Delete Entry
          </button>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell title="Edit Transaction" onCancel={onClose}>
      <form
        id="edit-tx-form"
        className="form-stack"
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
      >
        <div className="filter-grid">
          <div>
            <label className="field-label" htmlFor="edit-tx-type">
              Type
            </label>
            <select
              id="edit-tx-type"
              className="select-input"
              value={typeKey}
              onChange={(e) => handleTypeChange(e.target.value as EditTypeKey)}
            >
              <option value="expense">Expense</option>
              <option value="deposit">Deposit</option>
              <option value="transfer-outgoing">Transfer - Outgoing</option>
              <option value="transfer-incoming">Transfer - Incoming</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="edit-tx-amount">
              Amount (₹)
            </label>
            <input
              id="edit-tx-amount"
              className="text-input num"
              type="text"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                if (error) setError('');
              }}
            />
          </div>
        </div>

        {error && (
          <p className="field-error" role="alert" style={{ marginTop: '-8px' }}>
            {error}
          </p>
        )}

        <div>
          <label className="field-label" htmlFor="edit-tx-account">
            Bank Account
          </label>
          <select
            id="edit-tx-account"
            className="select-input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {txAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
                {acc.archived ? ' (Archived)' : ''}
              </option>
            ))}
          </select>
        </div>

        {typeKey === 'expense' && (
          <div id="edit-tx-cat-wrap">
            <label className="field-label" htmlFor="edit-tx-cat">
              Category
            </label>
            <select
              id="edit-tx-cat"
              className="select-input"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {txCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                  {cat.hidden ? ' (Hidden)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="edit-tx-mode">
            {typeKey === 'deposit' ? 'Mode of Deposit' : 'Payment Mode'}
          </label>
          <select
            id="edit-tx-mode"
            className="select-input"
            value={resolvedMode}
            onChange={(e) => setMode(e.target.value)}
          >
            {modeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-grid">
          <div>
            <label className="field-label" htmlFor="edit-tx-date">
              Date
            </label>
            <input
              id="edit-tx-date"
              className="text-input num"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="edit-tx-note">
              Note
            </label>
            <input
              id="edit-tx-note"
              className="text-input"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="row-between" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-danger-outline btn-sm"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete
          </button>
          <div className="row-gap-8">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              Save
            </button>
          </div>
        </div>
      </form>
    </DialogShell>
  );
}

/**
 * Centered modal dialog for editing or deleting an existing transaction.
 */
export function EditTransactionDialog({ txId, onClose }: EditTransactionDialogProps) {
  const { accounts, categories, transactions, settings, updateTransaction, deleteTransaction } =
    useApp();

  const tx = txId ? transactions.find((item) => item.id === txId) ?? null : null;
  if (!tx) return null;

  return (
    <EditTransactionForm
      key={tx.id}
      tx={tx}
      accounts={accounts}
      categories={categories}
      settings={settings}
      onUpdate={updateTransaction}
      onDelete={deleteTransaction}
      onClose={onClose}
    />
  );
}
