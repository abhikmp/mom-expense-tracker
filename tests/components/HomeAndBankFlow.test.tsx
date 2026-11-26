import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '../../src/state/AppContext';
import { HomeView } from '../../src/views/HomeView';
import { BankHistoryView } from '../../src/views/BankHistoryView';
import { formatMonthTitle, getCurrentMonthYM, shiftMonth } from '../../src/domain/dates';
import type { Transaction } from '../../src/domain/types';
import { createTransactionAtomic, openAppDb, saveAccount } from '../../src/storage/db';
import * as csvModule from '../../src/export/csv';

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `home-bank-test-db-${Date.now()}-${dbCounter}`;
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
    date: `${getCurrentMonthYM()}-15`,
    note: 'Vegetables',
    createdAt: `${getCurrentMonthYM()}-15T09:00:00.000Z`,
    updatedAt: `${getCurrentMonthYM()}-15T09:00:00.000Z`,
    ...overrides,
  };
}

function ViewHarness({ onEditTx = vi.fn() }: { onEditTx?: (id: string) => void }) {
  const { loading, view, manageJumpTarget, preselectedAccountId } = useApp();

  if (loading) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div data-testid="shell" data-view={view}>
      <div data-testid="current-view">{view}</div>
      <div data-testid="jump-target">{manageJumpTarget ?? 'none'}</div>
      <div data-testid="preselected-bank">{preselectedAccountId ?? 'none'}</div>
      {view === 'bank-tx' ? (
        <BankHistoryView onEditTx={onEditTx} />
      ) : (
        <HomeView onEditTx={onEditTx} />
      )}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HomeView & BankHistoryView', () => {
  it('renders first-run welcome setup when 0 accounts exist and navigates to Manage accounts on click', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();

    render(
      <AppProvider dbName={dbName}>
        <ViewHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText('No bank accounts added yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first bank account and current balance to start tracking expenses.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Total Balance')).not.toBeInTheDocument();
    expect(screen.queryByText(/SBI|HDFC|ICICI/i)).not.toBeInTheDocument();

    const addFirstBtn = screen.getByRole('button', { name: '+ Add Your First Bank Account' });
    await user.click(addFirstBtn);

    expect(screen.getByTestId('current-view')).toHaveTextContent('manage');
    expect(screen.getByTestId('jump-target')).toHaveTextContent('sec-accounts');
  });

  it('shows Total Balance for active accounts only, excludes archived accounts, and never renders Export on Home', async () => {
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
      id: 'acc-2',
      name: 'HDFC Pension',
      startingBalancePaise: 2_500_000,
      createdAt: '2026-11-02T08:00:00.000Z',
      archived: false,
    });
    await saveAccount(db, {
      id: 'acc-arch',
      name: 'Old Axis',
      startingBalancePaise: 5_000_000,
      createdAt: '2026-10-01T08:00:00.000Z',
      archived: true,
    });
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <ViewHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Total Balance')).toBeInTheDocument();
    });

    const balanceSection = screen.getByRole('region', { name: 'Total and Bank Account Balances' });
    expect(within(balanceSection).getByText('₹35,000')).toBeInTheDocument();
    expect(within(balanceSection).getByText('SBI Savings')).toBeInTheDocument();
    expect(within(balanceSection).getByText('₹10,000')).toBeInTheDocument();
    expect(within(balanceSection).getByText('HDFC Pension')).toBeInTheDocument();
    expect(within(balanceSection).getByText('₹25,000')).toBeInTheDocument();

    expect(within(balanceSection).queryByText('Old Axis')).not.toBeInTheDocument();
    expect(within(balanceSection).queryByText('₹50,000')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/i })).not.toBeInTheDocument();
  });

  it('aggregates ONLY Expense transactions in Where You Spent Most and switches months via Previous/Next', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const curMonth = getCurrentMonthYM();
    const prevMonth = shiftMonth(curMonth, -1);

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
        id: 'tx-cur-exp-1',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 30_000,
        categoryId: 'cat-groceries',
        date: `${curMonth}-10`,
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-cur-exp-2',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 10_000,
        categoryId: 'cat-medical',
        date: `${curMonth}-12`,
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-cur-dep',
        type: 'deposit',
        direction: 'incoming',
        amountPaise: 500_000,
        categoryId: null,
        mode: 'Cash',
        date: `${curMonth}-13`,
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-cur-trf',
        type: 'transfer',
        direction: 'outgoing',
        amountPaise: 200_000,
        categoryId: null,
        mode: 'GPay',
        date: `${curMonth}-14`,
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-prev-exp',
        type: 'expense',
        direction: 'outgoing',
        amountPaise: 75_000,
        categoryId: 'cat-bills',
        date: `${prevMonth}-08`,
      })
    );
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <ViewHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Where You Spent Most' })).toBeInTheDocument();
    });

    const spendSection = screen.getByRole('region', { name: 'Where You Spent Most' });
    const curTitle = formatMonthTitle(curMonth);
    const prevTitle = formatMonthTitle(prevMonth);

    expect(within(spendSection).getByText(curTitle)).toBeInTheDocument();
    expect(within(spendSection).getByText(`₹400 spent in ${curTitle}`)).toBeInTheDocument();
    expect(within(spendSection).getByText('Groceries')).toBeInTheDocument();
    expect(within(spendSection).getByText('75%')).toBeInTheDocument();
    expect(within(spendSection).getByText('₹300')).toBeInTheDocument();
    expect(within(spendSection).getByText('Medical')).toBeInTheDocument();
    expect(within(spendSection).getByText('25%')).toBeInTheDocument();
    expect(within(spendSection).getByText('₹100')).toBeInTheDocument();
    expect(within(spendSection).queryByText('Bills')).not.toBeInTheDocument();

    await user.click(within(spendSection).getByRole('button', { name: 'Previous month' }));

    expect(within(spendSection).getByText(prevTitle)).toBeInTheDocument();
    expect(within(spendSection).getByText(`₹750 spent in ${prevTitle}`)).toBeInTheDocument();
    expect(within(spendSection).getByText('Bills')).toBeInTheDocument();
    expect(within(spendSection).getByText('100%')).toBeInTheDocument();
    expect(within(spendSection).queryByText('Groceries')).not.toBeInTheDocument();

    await user.click(within(spendSection).getByRole('button', { name: 'Next month' }));
    expect(within(spendSection).getByText(curTitle)).toBeInTheDocument();
    expect(within(spendSection).getByText(`₹400 spent in ${curTitle}`)).toBeInTheDocument();
  });

  it('renders at most 10 newest-first transactions in Last 10 Transactions with Show All -> and edit callback', async () => {
    const user = userEvent.setup();
    const onEditTx = vi.fn();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 1_000_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });

    for (let day = 1; day <= 12; day += 1) {
      const dd = String(day).padStart(2, '0');
      await createTransactionAtomic(
        db,
        makeTx({
          id: `tx-day-${day}`,
          date: `2026-11-${dd}`,
          note: `Entry day ${day}`,
          createdAt: `2026-11-${dd}T10:00:00.000Z`,
          updatedAt: `2026-11-${dd}T10:00:00.000Z`,
        })
      );
    }
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <ViewHarness onEditTx={onEditTx} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Last 10 Transactions' })).toBeInTheDocument();
    });

    const recentSection = screen.getByRole('region', { name: 'Last 10 Transactions' });
    const rows = within(recentSection)
      .getAllByRole('button')
      .filter((btn) => btn.classList.contains('tx-row-btn'));
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('Entry day 12');
    expect(rows[9]).toHaveTextContent('Entry day 3');
    expect(within(recentSection).queryByText(/Entry day 2$/)).not.toBeInTheDocument();
    expect(within(recentSection).queryByText(/Entry day 1$/)).not.toBeInTheDocument();

    await user.click(rows[0]);
    expect(onEditTx).toHaveBeenCalledWith('tx-day-12');

    const showAllBtn = within(recentSection).getByRole('button', { name: 'Show All →' });
    await user.click(showAllBtn);
    expect(screen.getByTestId('current-view')).toHaveTextContent('all');
  });

  it('opens BankHistoryView when tapping an active account, filters by bank, exports bank CSV, and navigates to preselected Record', async () => {
    const user = userEvent.setup();
    const onEditTx = vi.fn();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 500_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await saveAccount(db, {
      id: 'acc-2',
      name: 'HDFC Pension',
      startingBalancePaise: 900_000,
      createdAt: '2026-11-02T08:00:00.000Z',
      archived: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-sbi-1',
        accountId: 'acc-1',
        amountPaise: 50_000,
        note: 'SBI Milk',
        date: '2026-11-20',
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-sbi-2',
        accountId: 'acc-1',
        amountPaise: 25_000,
        note: 'SBI Pharmacy',
        date: '2026-11-21',
      })
    );
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-hdfc-1',
        accountId: 'acc-2',
        amountPaise: 100_000,
        note: 'HDFC Electric',
        date: '2026-11-22',
      })
    );
    db.close();

    const exportSpy = vi.spyOn(csvModule, 'exportCsvFiles').mockResolvedValue({
      method: 'download',
      files: ['sbi-savings-transactions-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });

    render(
      <AppProvider dbName={dbName}>
        <ViewHarness onEditTx={onEditTx} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'View SBI Savings transactions' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'View SBI Savings transactions' }));

    await waitFor(() => {
      expect(screen.getByTestId('current-view')).toHaveTextContent('bank-tx');
    });

    expect(screen.getByRole('heading', { level: 1, name: 'SBI Savings' })).toBeInTheDocument();
    expect(screen.getByText('Current Balance')).toBeInTheDocument();
    expect(screen.getByText('₹4,250')).toBeInTheDocument();
    expect(screen.getByText('2 transactions recorded')).toBeInTheDocument();

    const bankTxSection = screen.getByRole('region', { name: 'SBI Savings Transactions' });
    expect(within(bankTxSection).getByText(/SBI Pharmacy/)).toBeInTheDocument();
    expect(within(bankTxSection).getByText(/SBI Milk/)).toBeInTheDocument();
    expect(within(bankTxSection).queryByText(/HDFC Electric/)).not.toBeInTheDocument();
    // hideAccount is true on BankHistoryView so account name isn't duplicated inside row metadata
    expect(within(bankTxSection).queryByText(/SBI Savings ·/)).not.toBeInTheDocument();

    const exportBtn = screen.getByRole('button', { name: 'Export (2)' });
    await user.click(exportBtn);

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });
    expect(exportSpy.mock.calls[0][0]).toMatchObject({
      scope: 'bank',
      bankName: 'SBI Savings',
    });
    expect(exportSpy.mock.calls[0][0].transactions).toHaveLength(2);

    await user.click(within(bankTxSection).getByRole('button', { name: /SBI Pharmacy/i }));
    expect(onEditTx).toHaveBeenCalledWith('tx-sbi-2');

    await user.click(screen.getByRole('button', { name: '+ Record' }));
    expect(screen.getByTestId('current-view')).toHaveTextContent('record');
    expect(screen.getByTestId('preselected-bank')).toHaveTextContent('acc-1');
  });

  it('falls back cleanly to HomeView when BankHistoryView has no matching selectedBankId', async () => {
    const dbName = nextDbName();

    render(
      <AppProvider dbName={dbName}>
        <BankHistoryView onEditTx={vi.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Expenses' })).toBeInTheDocument();
    });
    expect(screen.getByText('No bank accounts added yet')).toBeInTheDocument();
  });
});
