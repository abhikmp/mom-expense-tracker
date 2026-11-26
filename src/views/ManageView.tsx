import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Moon, ShareNetwork, Sun } from '@phosphor-icons/react';
import { Banners } from '../components/Banners';
import { ArchiveConfirmDialog, RestoreConfirmDialog } from '../components/ConfirmDialogs';
import { TopBar } from '../components/TopBar';
import { computeAccountBalancePaise, getSortedTransactions } from '../domain/calculations';
import {
  formatDecimalRupeesPlain,
  formatRupees,
  parseRupeesToPaise,
} from '../domain/money';
import type { BackupPayload } from '../domain/types';
import { validateBackupPayload } from '../domain/validation';
import { useApp } from '../state/AppContext';

/**
 * Settings and management screen for theme, bank accounts, categories, CSV export, and JSON backups.
 */
export function ManageView() {
  const {
    accounts,
    categories,
    transactions,
    settings,
    manageJumpTarget,
    clearManageJumpTarget,
    navigate,
    toggleTheme,
    addAccount,
    renameAccount,
    adjustAccountBalance,
    setAccountArchived,
    addCategory,
    renameCategory,
    setCategoryHidden,
    exportCsv,
    downloadBackup,
    restoreBackup,
    showToast,
  } = useApp();

  const [newAccName, setNewAccName] = useState('');
  const [newAccBal, setNewAccBal] = useState('');
  const [newAccError, setNewAccError] = useState('');

  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [renameAccValue, setRenameAccValue] = useState('');
  const [renameAccError, setRenameAccError] = useState('');

  const [adjustAccountId, setAdjustAccountId] = useState<string | null>(null);
  const [adjustAccValue, setAdjustAccValue] = useState('');
  const [adjustAccError, setAdjustAccError] = useState('');

  const [archiveConfirmAccountId, setArchiveConfirmAccountId] = useState<string | null>(null);

  const [newCatName, setNewCatName] = useState('');
  const [newCatError, setNewCatError] = useState('');

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [renameCatValue, setRenameCatValue] = useState('');
  const [renameCatError, setRenameCatError] = useState('');

  const [restoreConfirmPayload, setRestoreConfirmPayload] = useState<BackupPayload | null>(null);
  const [restoreError, setRestoreError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!manageJumpTarget) return;
    const el = document.getElementById(manageJumpTarget);
    el?.scrollIntoView?.({ behavior: 'auto', block: 'start' });
    clearManageJumpTarget();
  }, [manageJumpTarget, clearManageJumpTarget]);

  const isDark = settings.theme === 'dark';

  const archiveTarget = archiveConfirmAccountId
    ? accounts.find((a) => a.id === archiveConfirmAccountId) ?? null
    : null;
  const archiveTargetBalance = archiveTarget
    ? computeAccountBalancePaise(archiveTarget, transactions)
    : 0;

  const handleAddAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const trimmedName = newAccName.trim();
    if (!trimmedName) {
      setNewAccError('Please enter an account name.');
      return;
    }
    const paise = parseRupeesToPaise(newAccBal.trim() || '0');
    if (paise === null) {
      setNewAccError('Please enter a valid non-negative balance (e.g. 0 or 5000.50).');
      return;
    }
    setSubmitting(true);
    try {
      await addAccount(trimmedName, paise);
      setNewAccName('');
      setNewAccBal('');
      setNewAccError('');
    } catch {
      // AppContext surfaced an error toast; preserve form inputs.
    } finally {
      setSubmitting(false);
    }
  };

  const handleRenameAccount = async (event: FormEvent<HTMLFormElement>, accountId: string) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = renameAccValue.trim();
    if (!trimmed) {
      setRenameAccError('Please enter an account name.');
      return;
    }
    setSubmitting(true);
    try {
      await renameAccount(accountId, trimmed);
      setEditingAccountId(null);
      setRenameAccError('');
    } catch {
      // AppContext surfaced an error toast; keep inline editor open.
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdjustAccount = async (event: FormEvent<HTMLFormElement>, accountId: string) => {
    event.preventDefault();
    if (submitting) return;
    const desiredPaise = parseRupeesToPaise(adjustAccValue);
    if (desiredPaise === null) {
      setAdjustAccError('Please enter a valid non-negative balance (e.g. 0 or 2000).');
      return;
    }
    setSubmitting(true);
    try {
      await adjustAccountBalance(accountId, desiredPaise);
      setAdjustAccountId(null);
      setAdjustAccError('');
    } catch {
      // AppContext surfaced an error toast; keep inline editor open.
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setNewCatError('Please enter a category name.');
      return;
    }
    setSubmitting(true);
    try {
      await addCategory(trimmed);
      setNewCatName('');
      setNewCatError('');
    } catch {
      // AppContext surfaced an error toast; preserve category input.
    } finally {
      setSubmitting(false);
    }
  };

  const handleRenameCategory = async (event: FormEvent<HTMLFormElement>, categoryId: string) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = renameCatValue.trim();
    if (!trimmed) {
      setRenameCatError('Please enter a category name.');
      return;
    }
    setSubmitting(true);
    try {
      await renameCategory(categoryId, trimmed);
      setEditingCategoryId(null);
      setRenameCatError('');
    } catch {
      // AppContext surfaced an error toast; keep inline editor open.
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestoreFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const inputEl = event.target;
    const file = inputEl.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        const validation = validateBackupPayload(parsed);
        if (!validation.valid) {
          setRestoreError(validation.error);
          showToast(validation.error, 'error');
        } else {
          setRestoreError('');
          setRestoreConfirmPayload(validation.payload);
        }
      } catch {
        const msg = 'Could not read backup JSON file.';
        setRestoreError(msg);
        showToast(msg, 'error');
      } finally {
        inputEl.value = '';
      }
    };
    reader.onerror = () => {
      const msg = 'Could not read backup JSON file.';
      setRestoreError(msg);
      showToast(msg, 'error');
      inputEl.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <>
      <TopBar title="Manage & Settings" showBack onBack={() => navigate('home')} />

      <div className="phone-scroll">
        <Banners />

        <section className="card" aria-label="Appearance">
          <div className="row-between">
            <div>
              <h2 className="section-title">Appearance</h2>
              <p className="sub-caption">Switch between Light and Dark theme</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-pressed={isDark}
              onClick={() => void toggleTheme().catch(() => {})}
            >
              {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              <span>{isDark ? 'Dark On' : 'Light On'}</span>
            </button>
          </div>
        </section>

        <section id="sec-accounts" className="card form-stack" aria-label="Bank Accounts">
          <div>
            <h2 className="section-title">Bank Accounts</h2>
            <p className="sub-caption">Add accounts, rename, adjust balance, or archive old ones.</p>
          </div>

          <form
            id="add-account-form"
            className="inline-editor"
            onSubmit={(e) => void handleAddAccount(e)}
            noValidate
          >
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Add New Bank Account</div>
            <div className="filter-grid">
              <div>
                <label className="field-label" htmlFor="new-acc-name">
                  Account Name
                </label>
                <input
                  id="new-acc-name"
                  className="text-input"
                  type="text"
                  placeholder="e.g. ICICI Bank"
                  value={newAccName}
                  onChange={(e) => {
                    setNewAccName(e.target.value);
                    if (newAccError) setNewAccError('');
                  }}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="new-acc-bal">
                  Current Balance (₹)
                </label>
                <input
                  id="new-acc-bal"
                  className="text-input num"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={newAccBal}
                  onChange={(e) => {
                    setNewAccBal(e.target.value);
                    if (newAccError) setNewAccError('');
                  }}
                />
              </div>
            </div>
            {newAccError && (
              <p className="field-error" role="alert" style={{ margin: 0 }}>
                {newAccError}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              + Add Bank Account
            </button>
          </form>

          <div>
            {accounts.map((acc) => {
              const bal = computeAccountBalancePaise(acc, transactions);
              const isRenaming = editingAccountId === acc.id;
              const isAdjusting = adjustAccountId === acc.id;
              return (
                <div key={acc.id} className="manage-item">
                  <div className="row-between">
                    <div>
                      <div className="row-gap-8">
                        <span className="account-name">{acc.name}</span>
                        {acc.archived ? (
                          <span className="pill pill-neutral">Archived</span>
                        ) : (
                          <span className="pill pill-positive">Active</span>
                        )}
                      </div>
                      <div className="account-sub num">Balance: {formatRupees(bal)}</div>
                    </div>
                  </div>

                  <div className="row-gap-8">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditingAccountId(isRenaming ? null : acc.id);
                        setRenameAccValue(acc.name);
                        setRenameAccError('');
                        setAdjustAccountId(null);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setAdjustAccountId(isAdjusting ? null : acc.id);
                        setAdjustAccValue(formatDecimalRupeesPlain(bal));
                        setAdjustAccError('');
                        setEditingAccountId(null);
                      }}
                    >
                      Adjust Balance
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (!acc.archived && bal !== 0) {
                          setArchiveConfirmAccountId(acc.id);
                        } else {
                          void setAccountArchived(acc.id, !acc.archived).catch(() => {});
                        }
                      }}
                    >
                      {acc.archived ? 'Unarchive' : 'Archive'}
                    </button>
                  </div>

                  {isRenaming && (
                    <form
                      className="inline-editor"
                      onSubmit={(e) => void handleRenameAccount(e, acc.id)}
                      noValidate
                    >
                      <label className="field-label" htmlFor={`rename-acc-input-${acc.id}`}>
                        New Account Name
                      </label>
                      <div className="row-gap-8">
                        <input
                          id={`rename-acc-input-${acc.id}`}
                          className="text-input"
                          type="text"
                          value={renameAccValue}
                          onChange={(e) => {
                            setRenameAccValue(e.target.value);
                            if (renameAccError) setRenameAccError('');
                          }}
                          style={{ flex: 1 }}
                        />
                        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditingAccountId(null);
                            setRenameAccError('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      {renameAccError && (
                        <p className="field-error" role="alert" style={{ margin: 0 }}>
                          {renameAccError}
                        </p>
                      )}
                    </form>
                  )}

                  {isAdjusting && (
                    <form
                      className="inline-editor"
                      onSubmit={(e) => void handleAdjustAccount(e, acc.id)}
                      noValidate
                    >
                      <label className="field-label" htmlFor={`adjust-acc-input-${acc.id}`}>
                        Desired Balance (₹)
                      </label>
                      <div className="row-gap-8">
                        <input
                          id={`adjust-acc-input-${acc.id}`}
                          className="text-input num"
                          type="text"
                          inputMode="decimal"
                          value={adjustAccValue}
                          onChange={(e) => {
                            setAdjustAccValue(e.target.value);
                            if (adjustAccError) setAdjustAccError('');
                          }}
                          style={{ flex: 1 }}
                        />
                        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
                          Update
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setAdjustAccountId(null);
                            setAdjustAccError('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      {adjustAccError && (
                        <p className="field-error" role="alert" style={{ margin: 0 }}>
                          {adjustAccError}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section id="sec-categories" className="card form-stack" aria-label="Expense Categories">
          <div>
            <h2 className="section-title">Expense Categories</h2>
            <p className="sub-caption">
              Rename updates past records automatically. Hide removes from Record.
            </p>
          </div>

          <form
            id="add-cat-form"
            className="form-stack"
            style={{ gap: '6px' }}
            onSubmit={(e) => void handleAddCategory(e)}
            noValidate
          >
            <div className="row-gap-8">
              <label className="sr-only" htmlFor="new-cat-name">
                New Category Name
              </label>
              <input
                id="new-cat-name"
                className="text-input"
                type="text"
                placeholder="New category (e.g. Gifts)"
                value={newCatName}
                onChange={(e) => {
                  setNewCatName(e.target.value);
                  if (newCatError) setNewCatError('');
                }}
                style={{ flex: 1 }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
                + Add
              </button>
            </div>
            {newCatError && (
              <p className="field-error" role="alert" style={{ margin: 0 }}>
                {newCatError}
              </p>
            )}
          </form>

          <div>
            {categories.map((cat) => {
              const isRenaming = editingCategoryId === cat.id;
              return (
                <div key={cat.id} className="manage-item">
                  <div className="row-between">
                    <div className="row-gap-8">
                      <span className="account-name">{cat.name}</span>
                      {cat.hidden && <span className="pill pill-neutral">Hidden</span>}
                    </div>
                    <div className="row-gap-8">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setEditingCategoryId(isRenaming ? null : cat.id);
                          setRenameCatValue(cat.name);
                          setRenameCatError('');
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void setCategoryHidden(cat.id, !cat.hidden).catch(() => {})}
                      >
                        {cat.hidden ? 'Show' : 'Hide'}
                      </button>
                    </div>
                  </div>

                  {isRenaming && (
                    <form
                      className="inline-editor"
                      onSubmit={(e) => void handleRenameCategory(e, cat.id)}
                      noValidate
                    >
                      <label className="field-label" htmlFor={`rename-cat-input-${cat.id}`}>
                        Category Name
                      </label>
                      <div className="row-gap-8">
                        <input
                          id={`rename-cat-input-${cat.id}`}
                          className="text-input"
                          type="text"
                          value={renameCatValue}
                          onChange={(e) => {
                            setRenameCatValue(e.target.value);
                            if (renameCatError) setRenameCatError('');
                          }}
                          style={{ flex: 1 }}
                        />
                        <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditingCategoryId(null);
                            setRenameCatError('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                      {renameCatError && (
                        <p className="field-error" role="alert" style={{ margin: 0 }}>
                          {renameCatError}
                        </p>
                      )}
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section id="sec-export" className="card form-stack" aria-label="Export All Spreadsheets">
          <div>
            <h2 className="section-title">Spreadsheet Export (.csv)</h2>
            <p className="sub-caption num">
              {transactions.length} transactions · {accounts.length} accounts
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void exportCsv('all', getSortedTransactions(transactions)).catch(() => {})}
          >
            <ShareNetwork size={18} aria-hidden="true" />
            <span>Export All (.csv)</span>
          </button>
        </section>

        <section id="sec-backup" className="card form-stack" aria-label="Backup and Restore">
          <div>
            <h2 className="section-title">Backup &amp; Restore (.json)</h2>
            <p className="sub-caption">
              Save a complete backup file on this phone or restore from a saved JSON file.
            </p>
          </div>
          <div className="filter-grid">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setRestoreError('');
                void downloadBackup().catch(() => {});
              }}
            >
              Download Backup
            </button>
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              <span>Restore Backup</span>
              <input
                id="restore-file-input"
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleRestoreFileChange}
              />
            </label>
          </div>
          {restoreError && (
            <p className="field-error" role="alert" style={{ margin: 0 }}>
              {restoreError}
            </p>
          )}
        </section>
      </div>

      <ArchiveConfirmDialog
        account={archiveTarget}
        balancePaise={archiveTargetBalance}
        onCancel={() => setArchiveConfirmAccountId(null)}
        onConfirm={() => {
          if (!archiveTarget || submitting) return;
          const id = archiveTarget.id;
          void (async () => {
            setSubmitting(true);
            try {
              await setAccountArchived(id, true);
              setArchiveConfirmAccountId(null);
            } catch {
              // AppContext surfaced an error toast; keep the archive dialog open.
            } finally {
              setSubmitting(false);
            }
          })();
        }}
      />

      <RestoreConfirmDialog
        payload={restoreConfirmPayload}
        onCancel={() => setRestoreConfirmPayload(null)}
        onConfirm={() => {
          if (!restoreConfirmPayload || submitting) return;
          const payload = restoreConfirmPayload;
          void (async () => {
            setSubmitting(true);
            try {
              await restoreBackup(payload);
              setRestoreConfirmPayload(null);
            } catch {
              // AppContext surfaced an error toast; keep the restore dialog open.
            } finally {
              setSubmitting(false);
            }
          })();
        }}
      />
    </>
  );
}
