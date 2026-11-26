import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '../../src/state/AppContext';
import { TopBar } from '../../src/components/TopBar';
import { BottomNav } from '../../src/components/BottomNav';
import { Banners } from '../../src/components/Banners';
import { HomeView } from '../../src/views/HomeView';
import * as dbModule from '../../src/storage/db';
import { TransactionRow } from '../../src/components/TransactionRow';
import {
  ArchiveConfirmDialog,
  RestoreConfirmDialog,
} from '../../src/components/ConfirmDialogs';
import { DEFAULT_CATEGORIES, type BackupPayload, type Transaction } from '../../src/domain/types';
import {
  createTransactionAtomic,
  markBackupOrExportCompleted,
  openAppDb,
  saveAccount,
} from '../../src/storage/db';
import * as csvModule from '../../src/export/csv';

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `shell-test-db-${Date.now()}-${dbCounter}`;
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 45000,
    accountId: 'acc-1',
    categoryId: 'cat-groceries',
    mode: 'GPay',
    date: '2026-11-26',
    note: 'Vegetables',
    createdAt: '2026-11-26T09:00:00.000Z',
    updatedAt: '2026-11-26T09:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light');
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', '#F8FAFC');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BottomNav', () => {
  it('marks Home aria-current="page" on home and bank-tx, and Record on record', async () => {
    const user = userEvent.setup();
    const onSelectHome = vi.fn();
    const onSelectRecord = vi.fn();

    const { rerender } = render(
      <BottomNav
        currentView="home"
        onSelectHome={onSelectHome}
        onSelectRecord={onSelectRecord}
      />
    );

    const homeBtn = screen.getByRole('button', { name: 'Home' });
    const recordBtn = screen.getByRole('button', { name: 'Record' });
    expect(homeBtn).toHaveAttribute('aria-current', 'page');
    expect(recordBtn).not.toHaveAttribute('aria-current');

    rerender(
      <BottomNav
        currentView="bank-tx"
        onSelectHome={onSelectHome}
        onSelectRecord={onSelectRecord}
      />
    );
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Record' })).not.toHaveAttribute('aria-current');

    rerender(
      <BottomNav
        currentView="record"
        onSelectHome={onSelectHome}
        onSelectRecord={onSelectRecord}
      />
    );
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('aria-current', 'page');

    rerender(
      <BottomNav
        currentView="manage"
        onSelectHome={onSelectHome}
        onSelectRecord={onSelectRecord}
      />
    );
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Record' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(onSelectHome).toHaveBeenCalledTimes(1);
    expect(onSelectRecord).toHaveBeenCalledTimes(1);
  });
});

describe('TopBar', () => {
  it('renders h1 title, optional Back button, and theme toggle that flips data-theme and theme-color meta', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const dbName = nextDbName();

    render(
      <AppProvider dbName={dbName}>
        <TopBar
          title="Expenses"
          showBack
          onBack={onBack}
          rightAction={<button type="button">Manage</button>}
        />
      </AppProvider>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Expenses' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: 'Back to Home' });
    await user.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    const themeBtn = screen.getByRole('button', { name: /Switch to dark theme/i });
    expect(themeBtn).toHaveAttribute('aria-pressed', 'false');
    await user.click(themeBtn);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(screen.getByRole('button', { name: /Switch to light theme/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#0B0F17');
  });

  it('preserves a theme toggle made before IndexedDB initialization completes', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    let resolveOpen!: (db: Awaited<ReturnType<typeof openAppDb>>) => void;
    const pendingDb = new Promise<Awaited<ReturnType<typeof openAppDb>>>((resolve) => {
      resolveOpen = resolve;
    });
    const realOpen = dbModule.openAppDb;
    vi.spyOn(dbModule, 'openAppDb').mockReturnValueOnce(pendingDb);

    render(
      <AppProvider dbName={dbName}>
        <TopBar title="Expenses" />
      </AppProvider>
    );

    await user.click(screen.getByRole('button', { name: /Switch to dark theme/i }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    const db = await realOpen(dbName);
    resolveOpen(db);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(screen.getByRole('button', { name: /Switch to light theme/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });
  });
});

describe('TransactionRow', () => {
  async function seedAccount(dbName: string, archived = false) {
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 500_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived,
    });
    db.close();
  }

  it('renders deposit with green +₹ amount and Deposit pill, transfers with Incoming/Outgoing pills, and expense with category name', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAccount(dbName);
    const onSelect = vi.fn();

    const depositTx = makeTx({
      id: 'tx-dep',
      type: 'deposit',
      direction: 'incoming',
      amountPaise: 250000,
      categoryId: null,
      mode: 'Cash',
      note: 'Pension',
    });
    const transferInTx = makeTx({
      id: 'tx-tin',
      type: 'transfer',
      direction: 'incoming',
      amountPaise: 100000,
      categoryId: null,
      mode: 'GPay',
      note: 'From son',
    });
    const transferOutTx = makeTx({
      id: 'tx-tout',
      type: 'transfer',
      direction: 'outgoing',
      amountPaise: 75000,
      categoryId: null,
      mode: 'GPay',
      note: 'Rent',
    });
    const expenseTx = makeTx({
      id: 'tx-exp',
      type: 'expense',
      direction: 'outgoing',
      amountPaise: 45050,
      categoryId: 'cat-groceries',
      mode: 'GPay',
      note: 'Milk',
    });

    render(
      <AppProvider dbName={dbName}>
        <TransactionRow tx={depositTx} onSelect={onSelect} />
        <TransactionRow tx={transferInTx} onSelect={onSelect} />
        <TransactionRow tx={transferOutTx} onSelect={onSelect} />
        <TransactionRow tx={expenseTx} onSelect={onSelect} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeInTheDocument();
    });

    expect(screen.getByText('Cash Deposit')).toBeInTheDocument();
    expect(screen.getByText('Deposit')).toBeInTheDocument();
    const depAmount = screen.getByText('+₹2,500');
    expect(depAmount).toHaveClass('tx-amount-positive');

    expect(screen.getByText('Transfer In')).toBeInTheDocument();
    expect(screen.getByText('Incoming')).toBeInTheDocument();
    expect(screen.getByText('+₹1,000')).toHaveClass('tx-amount-positive');

    expect(screen.getByText('Transfer Out')).toBeInTheDocument();
    expect(screen.getByText('Outgoing')).toBeInTheDocument();
    expect(screen.getByText('-₹750')).not.toHaveClass('tx-amount-positive');

    expect(screen.getByText('-₹450.50')).not.toHaveClass('tx-amount-positive');
    expect(screen.getByText('SBI Savings · GPay · Milk')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Groceries/i }));
    expect(onSelect).toHaveBeenCalledWith(expenseTx);
  });

  it('hides account name when hideAccount is true', async () => {
    const dbName = nextDbName();
    await seedAccount(dbName);
    const expenseTx = makeTx({
      id: 'tx-exp-hide',
      type: 'expense',
      direction: 'outgoing',
      amountPaise: 12000,
      categoryId: 'cat-bills',
      mode: 'Card',
      note: 'Internet',
    });

    render(
      <AppProvider dbName={dbName}>
        <TransactionRow tx={expenseTx} hideAccount onSelect={vi.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Bills')).toBeInTheDocument();
    });
    expect(screen.getByText('Card · Internet')).toBeInTheDocument();
    expect(screen.queryByText(/SBI Savings/)).not.toBeInTheDocument();
  });
});

describe('Banners and AppContext state flows', () => {
  function ContextHarness() {
    const app = useApp();
    return (
      <div>
        <div data-testid="loading">{String(app.loading)}</div>
        <div data-testid="view">{app.view}</div>
        <div data-testid="jump">{app.manageJumpTarget ?? 'none'}</div>
        <div data-testid="preselected">{app.preselectedAccountId ?? 'none'}</div>
        <div data-testid="changes">{app.settings.changesSinceLastBackup}</div>
        <div data-testid="last-backup">{app.settings.lastBackupOrExportAt ?? 'none'}</div>
        <Banners />
        <button
          type="button"
          onClick={() =>
            app.recordTransaction({
              type: 'expense',
              direction: 'outgoing',
              amountPaise: 50000,
              accountId: 'acc-1',
              categoryId: 'cat-groceries',
              mode: 'GPay',
              date: '2026-11-26',
              note: 'Milk',
            })
          }
        >
          Save Sample
        </button>
        <button type="button" onClick={() => app.openRecordForBank('acc-1')}>
          Record For Bank
        </button>
        <button type="button" onClick={() => app.navigate('home')}>
          Go Home
        </button>
        <button type="button" onClick={() => app.clearManageJumpTarget()}>
          Clear Jump
        </button>
        <button type="button" onClick={() => app.exportCsv('all', app.transactions)}>
          Export CSV
        </button>
      </div>
    );
  }

  it('shows save banner on recordTransaction, allows Add another and Dismiss, and manages preselectedAccountId', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 500_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <ContextHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await user.click(screen.getByRole('button', { name: 'Record For Bank' }));
    expect(screen.getByTestId('view')).toHaveTextContent('record');
    expect(screen.getByTestId('preselected')).toHaveTextContent('acc-1');

    await user.click(screen.getByRole('button', { name: 'Go Home' }));
    expect(screen.getByTestId('view')).toHaveTextContent('home');
    expect(screen.getByTestId('preselected')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'Save Sample' }));
    await waitFor(() => {
      expect(screen.getByText(/Saved Groceries \(₹500\) to SBI Savings\./)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Saved Groceries/)).not.toBeInTheDocument();
  });

  it('renders backup reminder copy for >= 30 days and for >= 25 changes, and handles Later and Back Up Now', async () => {
    const user = userEvent.setup();
    const dbNameDays = nextDbName();
    const dbDays = await openAppDb(dbNameDays);
    await saveAccount(dbDays, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 100_000,
      createdAt: '2026-09-01T08:00:00.000Z',
      archived: false,
    });
    const oldDate = new Date(Date.now() - 35 * 86_400_000).toISOString();
    await markBackupOrExportCompleted(dbDays, oldDate);
    dbDays.close();

    const { unmount } = render(
      <AppProvider dbName={dbNameDays}>
        <ContextHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/It has been \d+ days since your last backup or spreadsheet export\./)
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Back Up Now' }));
    expect(screen.getByTestId('view')).toHaveTextContent('manage');
    expect(screen.getByTestId('jump')).toHaveTextContent('sec-backup');

    await user.click(screen.getByRole('button', { name: 'Clear Jump' }));
    expect(screen.getByTestId('jump')).toHaveTextContent('none');
    unmount();

    const dbNameChanges = nextDbName();
    const dbChanges = await openAppDb(dbNameChanges);
    await saveAccount(dbChanges, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 100_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await markBackupOrExportCompleted(dbChanges, new Date().toISOString());
    for (let i = 1; i <= 25; i++) {
      await createTransactionAtomic(
        dbChanges,
        makeTx({ id: `tx-c-${i}`, amountPaise: 1000 })
      );
    }
    dbChanges.close();

    render(
      <AppProvider dbName={dbNameChanges}>
        <ContextHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText('You have 25 new entries since your last backup or spreadsheet export.')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(
      screen.queryByText('You have 25 new entries since your last backup or spreadsheet export.')
    ).not.toBeInTheDocument();
  });

  it('does not mark backup completed or show toast when exportCsv is cancelled', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-1',
      name: 'SBI Savings',
      startingBalancePaise: 100_000,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await createTransactionAtomic(db, makeTx({ id: 'tx-cancel-1' }));
    db.close();

    vi.spyOn(csvModule, 'exportCsvFiles').mockResolvedValueOnce({
      method: 'cancelled',
      files: ['transactions-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });

    render(
      <AppProvider dbName={dbName}>
        <ContextHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('changes')).toHaveTextContent('1');
    expect(screen.getByTestId('last-backup')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => {
      expect(csvModule.exportCsvFiles).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('changes')).toHaveTextContent('1');
    expect(screen.getByTestId('last-backup')).toHaveTextContent('none');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows an error banner on startup when IndexedDB fails to open rather than failing silently', async () => {
    const dbName = nextDbName();
    vi.spyOn(dbModule, 'openAppDb').mockRejectedValueOnce(new Error('IndexedDB blocked'));

    render(
      <AppProvider dbName={dbName}>
        <HomeView onEditTx={vi.fn()} />
      </AppProvider>
    );

    await waitFor(() => {
      const banner = screen.getByRole('status');
      expect(banner).toHaveClass('banner-error');
      expect(banner).toHaveTextContent(
        'Could not open on-device storage. Please make sure browser storage is allowed and reload.'
      );
    });

    expect(screen.queryByText('No bank accounts added yet')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialogs', () => {
  it('renders ArchiveConfirmDialog and RestoreConfirmDialog and triggers callbacks', async () => {
    const user = userEvent.setup();
    const onArchiveConfirm = vi.fn();
    const onArchiveCancel = vi.fn();
    const onRestoreConfirm = vi.fn();
    const onRestoreCancel = vi.fn();

    const payload: BackupPayload = {
      _note: '',
      schemaVersion: 1,
      exportedAt: '2026-11-26T10:00:00.000Z',
      accounts: [
        {
          id: 'acc-1',
          name: 'SBI Savings',
          startingBalancePaise: 100_000,
          createdAt: '2026-11-01T08:00:00.000Z',
          archived: false,
        },
      ],
      categories: DEFAULT_CATEGORIES,
      transactions: [makeTx()],
    };

    render(
      <>
        <ArchiveConfirmDialog
          account={payload.accounts[0]}
          balancePaise={125000}
          onConfirm={onArchiveConfirm}
          onCancel={onArchiveCancel}
        />
        <RestoreConfirmDialog
          payload={payload}
          onConfirm={onRestoreConfirm}
          onCancel={onRestoreCancel}
        />
      </>
    );

    expect(
      screen.getByRole('dialog', { name: 'Archive Account With Balance?' })
    ).toBeInTheDocument();
    expect(screen.getByText('₹1,250')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Archive Anyway' }));
    expect(onArchiveConfirm).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('dialog', { name: 'Restore Backup?' })).toBeInTheDocument();
    expect(screen.getByText('1 Accounts · 6 Categories · 1 Entries')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore Now' }));
    expect(onRestoreConfirm).toHaveBeenCalledTimes(1);
  });
});
