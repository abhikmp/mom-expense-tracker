import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check } from '@phosphor-icons/react';
import { TopBar } from '../components/TopBar';
import { computeAccountBalancePaise } from '../domain/calculations';
import { getTodayLocalISO } from '../domain/dates';
import { formatRupees } from '../domain/money';
import type { TransactionDirection, TransactionType } from '../domain/types';
import { validateTransactionAmount } from '../domain/validation';
import { useApp } from '../state/AppContext';

export interface RecordViewProps {
  preselectedAccountId?: string | null;
}

const TYPE_MICROCOPY: Record<TransactionType, string> = {
  expense:
    'Use Expense for groceries, bills, pharmacy, and shop payments via Google Pay / UPI.',
  deposit: 'Use Deposit when adding cash or cheque into this bank account.',
  transfer:
    'Use Transfer when sending money to someone or receiving money from someone.',
};

/**
 * Primary form screen for recording a new Expense, Deposit, or Transfer entry.
 */
export function RecordView({ preselectedAccountId }: RecordViewProps = {}) {
  const {
    accounts,
    categories,
    transactions,
    settings,
    preselectedAccountId: contextPreselectedAccountId,
    clearPreselectedAccount,
    navigate,
    recordTransaction,
    addCustomPaymentMode,
  } = useApp();

  const effectivePreselected =
    preselectedAccountId !== undefined ? preselectedAccountId : contextPreselectedAccountId;

  const activeAccounts = accounts.filter((a) => !a.archived);
  const visibleCategories = categories.filter((c) => !c.hidden);

  const [type, setType] = useState<TransactionType>('expense');
  const [direction, setDirection] = useState<TransactionDirection>('outgoing');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [accountId, setAccountId] = useState<string>(() => {
    if (effectivePreselected && activeAccounts.some((a) => a.id === effectivePreselected)) {
      return effectivePreselected;
    }
    if (
      settings.lastUsedAccountId &&
      activeAccounts.some((a) => a.id === settings.lastUsedAccountId)
    ) {
      return settings.lastUsedAccountId;
    }
    return activeAccounts[0]?.id ?? '';
  });
  const [categoryId, setCategoryId] = useState<string>(() => visibleCategories[0]?.id ?? '');
  const [expenseMode, setExpenseMode] = useState<string>(
    () => settings.expensePaymentModes[0] ?? 'GPay'
  );
  const [transferMode, setTransferMode] = useState<string>(
    () => settings.transferPaymentModes[0] ?? 'GPay'
  );
  const [depositMode, setDepositMode] = useState<string>(
    () => settings.depositModes[0] ?? 'Cash'
  );
  const [addingPaymentMode, setAddingPaymentMode] = useState(false);
  const [newModeName, setNewModeName] = useState('');
  const [date, setDate] = useState<string>(() => getTodayLocalISO());
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const amountInputRef = useRef<HTMLInputElement>(null);
  const newModeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (effectivePreselected && activeAccounts.some((a) => a.id === effectivePreselected)) {
      setAccountId(effectivePreselected);
    }
  }, [effectivePreselected, activeAccounts]);

  const resolvedAccountId = activeAccounts.some((a) => a.id === accountId)
    ? accountId
    : effectivePreselected && activeAccounts.some((a) => a.id === effectivePreselected)
      ? effectivePreselected
      : settings.lastUsedAccountId &&
          activeAccounts.some((a) => a.id === settings.lastUsedAccountId)
        ? settings.lastUsedAccountId
        : (activeAccounts[0]?.id ?? '');

  const resolvedCategoryId = visibleCategories.some((c) => c.id === categoryId)
    ? categoryId
    : (visibleCategories[0]?.id ?? '');

  const currentModes =
    type === 'transfer' ? settings.transferPaymentModes : settings.expensePaymentModes;
  const activePaymentMode = type === 'transfer' ? transferMode : expenseMode;
  const resolvedPaymentMode = currentModes.includes(activePaymentMode)
    ? activePaymentMode
    : (currentModes[0] ?? '');
  const resolvedDepositMode = settings.depositModes.includes(depositMode)
    ? depositMode
    : (settings.depositModes[0] ?? 'Cash');

  const handleTypeSelect = (nextType: TransactionType) => {
    setType(nextType);
    setError('');
    setAddingPaymentMode(false);
    setNewModeName('');
  };

  const handleAccountSelect = (id: string) => {
    setAccountId(id);
    if (preselectedAccountId === undefined && contextPreselectedAccountId) {
      clearPreselectedAccount();
    }
  };

  const handleToggleAddMode = () => {
    setAddingPaymentMode((prev) => {
      const next = !prev;
      setNewModeName('');
      if (next) {
        queueMicrotask(() => newModeInputRef.current?.focus());
      }
      return next;
    });
  };

  const handleSaveNewMode = async () => {
    const trimmed = newModeName.trim();
    if (trimmed) {
      const saved = await addCustomPaymentMode(
        type === 'transfer' ? 'transfer' : 'expense',
        trimmed
      );
      if (saved) {
        if (type === 'transfer') {
          setTransferMode(saved);
        } else {
          setExpenseMode(saved);
        }
      }
    }
    setAddingPaymentMode(false);
    setNewModeName('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !resolvedAccountId) return;

    const validation = validateTransactionAmount(amount);
    if (!validation.valid) {
      setError(validation.error);
      amountInputRef.current?.focus();
      return;
    }

    const finalDirection: TransactionDirection =
      type === 'deposit' ? 'incoming' : type === 'expense' ? 'outgoing' : direction;
    const finalMode =
      type === 'deposit' ? resolvedDepositMode : resolvedPaymentMode;

    setSubmitting(true);
    try {
      await recordTransaction({
        type,
        direction: finalDirection,
        amountPaise: validation.paise,
        accountId: resolvedAccountId,
        categoryId: type === 'expense' ? resolvedCategoryId || null : null,
        mode: finalMode,
        date: date || getTodayLocalISO(),
        note,
      });
      setAmount('');
      setNote('');
      setError('');
      setDate(getTodayLocalISO());
    } finally {
      setSubmitting(false);
    }
  };

  const saveLabel =
    type === 'expense'
      ? 'Save Expense'
      : type === 'deposit'
        ? 'Save Deposit'
        : 'Save Transfer';

  return (
    <>
      <TopBar title="Record Entry" />

      <div className="phone-scroll">
        {activeAccounts.length === 0 ? (
          <section className="card">
            <div className="empty-box">
              <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--color-foreground)' }}>
                Add a bank account first
              </p>
              <p style={{ margin: '0 0 16px' }}>
                You need at least one active bank account before recording an entry.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('manage', { manageJumpTarget: 'sec-accounts' })}
              >
                + Add Bank Account
              </button>
            </div>
          </section>
        ) : (
          <form className="card form-stack" id="record-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
            <div>
              <span className="field-label">What kind of entry?</span>
              <div className="segmented-3" role="group" aria-label="Transaction Type">
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={type === 'expense'}
                  onClick={() => handleTypeSelect('expense')}
                >
                  Expense
                </button>
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={type === 'deposit'}
                  onClick={() => handleTypeSelect('deposit')}
                >
                  Deposit
                </button>
                <button
                  type="button"
                  className="seg-btn"
                  aria-pressed={type === 'transfer'}
                  onClick={() => handleTypeSelect('transfer')}
                >
                  Transfer
                </button>
              </div>
              <p className="field-hint">{TYPE_MICROCOPY[type]}</p>
            </div>

            {type === 'transfer' && (
              <div>
                <span className="field-label">Transfer Direction</span>
                <div className="segmented-2" role="group" aria-label="Transfer Direction">
                  <button
                    type="button"
                    className="chip-btn"
                    aria-pressed={direction === 'outgoing'}
                    onClick={() => setDirection('outgoing')}
                  >
                    Outgoing (−)
                  </button>
                  <button
                    type="button"
                    className="chip-btn"
                    aria-pressed={direction === 'incoming'}
                    onClick={() => setDirection('incoming')}
                  >
                    Incoming (+)
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="field-label" htmlFor="rec-amount-input">
                Amount (Rupees)
              </label>
              <div className="amount-box">
                <span className="amount-currency" aria-hidden="true">
                  ₹
                </span>
                <input
                  id="rec-amount-input"
                  ref={amountInputRef}
                  className="amount-input num"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (error) setError('');
                  }}
                  autoComplete="off"
                />
              </div>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <div>
              <span className="field-label">Bank Account</span>
              <div className="chip-wrap" role="group" aria-label="Bank Account">
                {activeAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    className="chip-btn"
                    aria-pressed={resolvedAccountId === acc.id}
                    onClick={() => handleAccountSelect(acc.id)}
                  >
                    <span>{acc.name}</span>
                    <span className="num" style={{ opacity: 0.85, fontSize: '13px' }}>
                      ({formatRupees(computeAccountBalancePaise(acc, transactions))})
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {type === 'expense' && (
              <div>
                <span className="field-label">Category</span>
                <div className="chip-wrap" role="group" aria-label="Expense Category">
                  {visibleCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className="chip-btn"
                      aria-pressed={resolvedCategoryId === cat.id}
                      onClick={() => setCategoryId(cat.id)}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {type === 'deposit' ? (
              <div>
                <span className="field-label">Mode of Deposit</span>
                <div className="chip-wrap" role="group" aria-label="Mode of Deposit">
                  {settings.depositModes.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="chip-btn"
                      aria-pressed={resolvedDepositMode === mode}
                      onClick={() => setDepositMode(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <span className="field-label">Payment Mode</span>
                <div className="chip-wrap" role="group" aria-label="Payment Mode">
                  {currentModes.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="chip-btn"
                      aria-pressed={resolvedPaymentMode === mode}
                      onClick={() => {
                        if (type === 'transfer') {
                          setTransferMode(mode);
                        } else {
                          setExpenseMode(mode);
                        }
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="chip-btn chip-add-btn"
                    aria-expanded={addingPaymentMode}
                    onClick={handleToggleAddMode}
                  >
                    + Add New
                  </button>
                </div>

                {addingPaymentMode && (
                  <div className="inline-editor" style={{ marginTop: '10px' }}>
                    <label className="field-label" htmlFor="new-pay-mode-input">
                      New Payment Mode
                    </label>
                    <div className="row-gap-8">
                      <input
                        id="new-pay-mode-input"
                        ref={newModeInputRef}
                        className="text-input"
                        type="text"
                        placeholder="e.g. NetBanking, Wallet"
                        value={newModeName}
                        onChange={(e) => setNewModeName(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void handleSaveNewMode()}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setAddingPaymentMode(false);
                          setNewModeName('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="field-label" htmlFor="rec-date-input">
                Date
              </label>
              <input
                id="rec-date-input"
                className="text-input num"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="rec-note-input">
                Note (optional)
              </label>
              <input
                id="rec-note-input"
                className="text-input"
                type="text"
                placeholder="e.g. Pharmacy or GPay to Ravi"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: '52px', fontSize: '16px' }}
              disabled={submitting}
            >
              <Check size={18} aria-hidden="true" />
              <span>{saveLabel}</span>
            </button>
          </form>
        )}
      </div>
    </>
  );
}
