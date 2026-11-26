import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '../../src/state/AppContext';
import { AllTransactionsView } from '../../src/views/AllTransactionsView';
import { EditTransactionDialog } from '../../src/components/EditTransactionDialog';
import * as dbModule from '../../src/storage/db';
import type { Transaction } from '../../src/domain/types';
import {
  createTransactionAtomic,
  openAppDb,
  saveAccount,
  saveCategory,
} from '../../src/storage/db';
import * as csvModule from '../../src/export/csv';

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `all-tx-edit-test-db-${Date.now()}-${dbCounter}`;
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 50_000,
    accountId: 'acc-1',
    categoryId: 'cat-groceries',
    mode: 'GPay',
    date: '2026-11-15',
    note: 'Vegetables',
    createdAt: '2026-11-15T09:00:00.000Z',
    updatedAt: '2026-11-15T09:00:00.000Z',
    ...overrides,
  };
}

function AllTxHarness() {
  const { loading, accounts, transactions } = useApp();
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  if (loading) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div>
      <div data-testid="tx-count">{transactions.length}</div>
      <div data-testid="account-count">{accounts.length}</div>
      <AllTransactionsView onEditTx={setEditingTxId} />
      <EditTransactionDialog txId={editingTxId} onClose={() => setEditingTxId(null)} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AllTransactionsView & EditTransactionDialog', () => {
  it('filters by date range, type, and category (including hidden), updates counts and Export (X), and resets on Clear', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 1_000_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await saveCategory(db, {
      id: 'cat-hidden',
      name: 'Old Rent',
      hidden: true,
      sortOrder: 7,
      isDefault: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-exp-1',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 30_000,
        categoryId: 'cat-groceries',
        date: '2026-11-10',
        note: 'Milk',
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-exp-hidden',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 150_000,
        categoryId: 'cat-hidden',
        date: '2026-11-12',
        note: 'November Rent',
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-dep-1',
        type: 'deposit',
        direction: 'incoming',
        amountPaise: 400_000,
        categoryId: null,
        mode: 'Cash',
        date: '2026-11-18',
        note: 'Pension Deposit',
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-trf-in',
        type: 'transfer',
        direction: 'incoming',
        amountPaise: 200_000,
        categoryId: null,
        mode: 'GPay',
        date: '2026-11-22',
        note: 'From Son',
      })
    );
    db.close();

    const exportSpy = vi.spyOn(csvModule, 'exportCsvFiles').mockResolvedValue({
      method: 'download',
      files: ['transactions-filtered-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });

    render(
      <AppProvider dbName={dbName}>
        <AllTxHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Showing 4 of 4 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export (4)' })).toBeInTheDocument();

    // Filter by date range
    fireEvent.change(screen.getByLabelText('From Date'), { target: { value: '2026-11-11' } });
    fireEvent.change(screen.getByLabelText('To Date'), { target: { value: '2026-11-20' } });

    expect(screen.getByText('Showing 2 of 4 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export (2)' })).toBeInTheDocument();

    // Filter by hidden category
    await user.selectOptions(screen.getByLabelText('Category'), 'cat-hidden');
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Old Rent (Hidden)');
    expect(screen.getByText('Showing 1 of 4 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export (1)' })).toBeInTheDocument();
    expect(screen.getByText(/November Rent/)).toBeInTheDocument();

    // Export filtered
    await user.click(screen.getByRole('button', { name: 'Export (1)' }));
    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });
    expect(exportSpy.mock.calls[0][0].scope).toBe('filtered');
    expect(exportSpy.mock.calls[0][0].transactions).toHaveLength(1);

    // Clear resets all filters
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Showing 4 of 4 entries')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export (4)' })).toBeInTheDocument();

    // Filter by type transfer-incoming
    await user.selectOptions(screen.getByLabelText('Type'), 'transfer-incoming');
    expect(screen.getByText('Showing 1 of 4 entries')).toBeInTheDocument();
    expect(screen.getByText(/From Son/)).toBeInTheDocument();
  });

  it('preserves archived account and hidden category in EditTransactionDialog dropdowns and saves updated amount/note', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 1_000_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await saveAccount(db, {
      id: 'acc-arch',
      name: 'Old Axis',
      startingBalancePaise: 500_000,
      createdAt: '2026-10-01T08:00:00.000Z',
      archived: true,
    });
    await saveCategory(db, {
      id: 'cat-hidden',
      name: 'Old Rent',
      hidden: true,
      sortOrder: 7,
      isDefault: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-hist',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 120_000,
        accountId: 'acc-arch',
        categoryId: 'cat-hidden',
        mode: 'Card',
        date: '2026-10-15',
        note: 'Historical entry',
      })
    );
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <AllTxHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Historical entry/i }));

    const dialog = screen.getByRole('dialog', { name: 'Edit Transaction' });
    const accountSelect = within(dialog).getByLabelText('Bank Account') as HTMLSelectElement;
    const categorySelect = within(dialog).getByLabelText('Category') as HTMLSelectElement;

    expect(accountSelect.value).toBe('acc-arch');
    expect(within(accountSelect).getByRole('option', { name: 'Old Axis (Archived)' })).toBeInTheDocument();
    expect(categorySelect.value).toBe('cat-hidden');
    expect(within(categorySelect).getByRole('option', { name: 'Old Rent (Hidden)' })).toBeInTheDocument();

    const amountInput = within(dialog).getByLabelText('Amount (₹)');
    await user.clear(amountInput);
    await user.type(amountInput, '1500');
    const noteInput = within(dialog).getByLabelText('Note');
    await user.clear(noteInput);
    await user.type(noteInput, 'Updated historical note');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit Transaction' })).not.toBeInTheDocument();
    });

    expect(screen.getByText(/Updated historical note/)).toBeInTheDocument();
    expect(screen.getByText('-₹1,500')).toBeInTheDocument();
  });

  it('clears categoryId, updates mode options, and sets direction when changing Type from Expense (Card) to Deposit', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 1_000_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-card',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 80_000,
        accountId: 'acc-1',
        categoryId: 'cat-bills',
        mode: 'Card',
        date: '2026-11-16',
        note: 'Phone bill',
      })
    );
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <AllTxHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Phone bill/i }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Transaction' });

    await user.selectOptions(within(dialog).getByLabelText('Type'), 'deposit');

    expect(within(dialog).queryByLabelText('Category')).not.toBeInTheDocument();
    const modeSelect = within(dialog).getByLabelText('Mode of Deposit') as HTMLSelectElement;
    expect(modeSelect.value).toBe('Cash');
    expect(within(modeSelect).getByRole('option', { name: 'Cash' })).toBeInTheDocument();
    expect(within(modeSelect).getByRole('option', { name: 'Cheque' })).toBeInTheDocument();
    expect(within(modeSelect).queryByRole('option', { name: 'Card' })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit Transaction' })).not.toBeInTheDocument();
    });

    // Verify stored transaction in IndexedDB has categoryId: null, direction: 'incoming', mode: 'Cash'
    const verifyDb = await openAppDb(dbName);
    const saved = await verifyDb.get('transactions', 'tx-card');
    verifyDb.close();

    expect(saved).toMatchObject({
      id: 'tx-card',
      type: 'deposit',
      direction: 'incoming',
      categoryId: null,
      mode: 'Cash',
    });
    expect(screen.getByText('+₹800')).toBeInTheDocument();

    // Switching back from Deposit (Cheque) -> Expense defaults categoryId and normalizes mode to GPay
    await user.click(screen.getByRole('button', { name: /Phone bill/i }));
    const dialog2 = screen.getByRole('dialog', { name: 'Edit Transaction' });
    await user.selectOptions(within(dialog2).getByLabelText('Mode of Deposit'), 'Cheque');
    await user.selectOptions(within(dialog2).getByLabelText('Type'), 'expense');

    expect((within(dialog2).getByLabelText('Category') as HTMLSelectElement).value).toBe('cat-groceries');
    expect((within(dialog2).getByLabelText('Payment Mode') as HTMLSelectElement).value).toBe('GPay');

    // Invalid amount shows inline error without closing
    const amtInput = within(dialog2).getByLabelText('Amount (₹)');
    await user.clear(amtInput);
    await user.type(amtInput, '0');
    await user.click(within(dialog2).getByRole('button', { name: 'Save' }));
    expect(within(dialog2).getByRole('alert')).toHaveTextContent(
      'Please enter an amount greater than ₹0.'
    );
    expect(screen.getByRole('dialog', { name: 'Edit Transaction' })).toBeInTheDocument();

    // Backdrop click closes dialog
    fireEvent.click(dialog2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens "Delete Transaction?" confirmation on Delete, removes entry on Delete Entry, and closes on Escape/backdrop', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 1_000_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-del',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 25_000,
        accountId: 'acc-1',
        categoryId: 'cat-medical',
        mode: 'GPay',
        date: '2026-11-17',
        note: 'To delete',
      })
    );
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <AllTxHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    // Open and close via Escape
    await user.click(screen.getByRole('button', { name: /To delete/i }));
    expect(screen.getByRole('dialog', { name: 'Edit Transaction' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Open and go to Delete confirmation, test Keep Entry, then Escape on nested Delete confirmation
    await user.click(screen.getByRole('button', { name: /To delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const confirmDialog = screen.getByRole('dialog', { name: 'Delete Transaction?' });
    expect(confirmDialog).toBeInTheDocument();
    expect(within(confirmDialog).getByRole('button', { name: 'Keep Entry' })).toBeInTheDocument();
    expect(within(confirmDialog).getByRole('button', { name: 'Delete Entry' })).toBeInTheDocument();

    await user.click(within(confirmDialog).getByRole('button', { name: 'Keep Entry' }));
    expect(screen.getByRole('dialog', { name: 'Edit Transaction' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog', { name: 'Delete Transaction?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Reopen and confirm delete
    await user.click(screen.getByRole('button', { name: /To delete/i }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete Transaction?' })).getByRole('button', {
        name: 'Delete Entry',
      })
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('tx-count')).toHaveTextContent('0');
    expect(screen.getByText('Transaction deleted and balances updated.')).toBeInTheDocument();

    const verifyDb = await openAppDb(dbName);
    const deleted = await verifyDb.get('transactions', 'tx-del');
    verifyDb.close();
    expect(deleted).toBeUndefined();
  });

  it('surfaces an error toast without unhandled rejection and keeps EditTransactionDialog open when saving fails', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 1_000_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-fail-edit',
        amountPaise: 50_000,
        note: 'Edit fail target',
      })
    );
    db.close();

    vi.spyOn(dbModule, 'updateTransactionAtomic').mockRejectedValueOnce(
      new Error('IDB write failed')
    );

    render(
      <AppProvider dbName={dbName}>
        <AllTxHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Edit fail target/i }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Transaction' });
    const amountInput = within(dialog).getByLabelText('Amount (₹)');
    await user.clear(amountInput);
    await user.type(amountInput, '999');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const toast = screen.getByRole('status');
      expect(toast).toHaveClass('banner-error');
      expect(toast).toHaveTextContent(/Could not update this entry/i);
    });

    const openDialog = screen.getByRole('dialog', { name: 'Edit Transaction' });
    expect(within(openDialog).getByLabelText('Amount (₹)')).toHaveValue('999');
  });
});
