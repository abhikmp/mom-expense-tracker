import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppShell } from '../../src/App';
import { PinModal } from '../../src/components/PinModal';
import { getCurrentMonthYM } from '../../src/domain/dates';
import type { Transaction } from '../../src/domain/types';
import { hashSecret } from '../../src/security/crypto';
import { AppProvider, useApp } from '../../src/state/AppContext';
import {
  createTransactionAtomic,
  loadAppState,
  openAppDb,
  saveAccount,
  saveSecurityRecord,
  saveSettings,
} from '../../src/storage/db';
import { AllTransactionsView } from '../../src/views/AllTransactionsView';
import { BankHistoryView } from '../../src/views/BankHistoryView';
import { ManageView } from '../../src/views/ManageView';

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `pin-lock-views-db-${Date.now()}-${dbCounter}`;
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  const ym = getCurrentMonthYM();
  return {
    id: 'tx-1',
    type: 'expense',
    direction: 'outgoing',
    amountPaise: 50_000,
    accountId: 'acc-1',
    categoryId: 'cat-groceries',
    mode: 'GPay',
    date: `${ym}-15`,
    note: 'Vegetables & milk',
    createdAt: `${ym}-15T09:00:00.000Z`,
    updatedAt: `${ym}-15T09:00:00.000Z`,
    ...overrides,
  };
}

async function seedAppData(
  dbName: string,
  opts: { withPin?: boolean; backupOverdue?: boolean } = {}
) {
  const { withPin = true, backupOverdue = false } = opts;
  const db = await openAppDb(dbName);
  await saveAccount(db, {
    id: 'acc-1',
    name: 'SBI Savings',
    startingBalancePaise: 1_500_000, // ₹15,000
    createdAt: '2026-10-01T08:00:00.000Z',
    archived: false,
  });
  await createTransactionAtomic(db, makeTx({ id: 'tx-1', amountPaise: 50_000 })); // balance ₹14,500
  if (backupOverdue) {
    await saveSettings(db, {
      lastBackupAt: '2020-01-01T00:00:00.000Z',
      changesSinceLastBackup: 12,
    });
  }
  if (withPin) {
    const [pinHash, masterPasswordHash] = await Promise.all([
      hashSecret('1234'),
      hashSecret('momsecret123'),
    ]);
    await saveSecurityRecord(db, {
      key: 'lock',
      pinHash,
      masterPasswordHash,
      updatedAt: '2026-11-27T10:00:00.000Z',
    });
  }
  db.close();
}

function DirectLockedViewHarness({
  targetView,
  bankId = 'acc-1',
}: {
  targetView: 'bank-tx' | 'all' | 'manage';
  bankId?: string;
}) {
  const app = useApp();
  const initRef = useRef(false);

  useEffect(() => {
    if (!app.loading && !initRef.current) {
      initRef.current = true;
      if (targetView === 'bank-tx') {
        app.openBankHistory(bankId);
      } else {
        app.navigate(targetView);
      }
    }
  }, [app, bankId, targetView]);

  if (app.loading || !initRef.current) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div>
      <div data-testid="current-view">{app.view}</div>
      <div data-testid="is-locked">{String(app.isLocked)}</div>
      <button type="button" onClick={() => app.lockApp('Financial details locked.')}>
        Trigger Lock
      </button>
      <button type="button" onClick={() => void app.verifyPinAndUnlock('1234')}>
        Trigger Unlock
      </button>
      {app.view === 'bank-tx' && <BankHistoryView onEditTx={vi.fn()} />}
      {app.view === 'all' && <AllTransactionsView onEditTx={vi.fn()} />}
      {app.view === 'manage' && <ManageView />}
      <PinModal />
    </div>
  );
}

function AppShellWithLockControl() {
  const app = useApp();
  return (
    <>
      <button type="button" data-testid="force-lock" onClick={() => app.lockApp('Financial details locked.')}>
        Force Lock
      </button>
      <AppShell />
    </>
  );
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PIN Lock view gating', () => {
  it('gates HomeView while locked and keeps Manage and Record reachable', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: true, backupOverdue: true });

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText(/Loading your accounts/i)).not.toBeInTheDocument();
    });

    // Sensitive Home content is hidden
    expect(screen.queryByText('Total Balance')).not.toBeInTheDocument();
    expect(screen.queryByText(/₹14,500/)).not.toBeInTheDocument();
    expect(screen.queryByText('Where You Spent Most')).not.toBeInTheDocument();
    expect(screen.queryByText('Last 10 Transactions')).not.toBeInTheDocument();
    expect(screen.queryByText('Vegetables & milk')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Backup reminder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock financial details' })).not.toBeInTheDocument();

    // Locked card is shown
    expect(screen.getByRole('heading', { name: 'Financial details are hidden' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock with PIN' })).toBeInTheDocument();

    // Manage is reachable
    await user.click(screen.getByRole('button', { name: /Manage/i }));
    expect(screen.getByRole('heading', { level: 1, name: 'Manage & Settings' })).toBeInTheDocument();

    // Record is reachable from bottom nav
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Record Entry' })).toBeInTheDocument();
  });

  it('keeps RecordView frictionless while locked: hides chip balances, saves to IndexedDB, and stays on RecordView', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: true });

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText(/Loading your accounts/i)).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Record Entry' })).toBeInTheDocument();

    const accountGroup = screen.getByRole('group', { name: 'Bank Account' });
    const chip = within(accountGroup).getByRole('button', { name: /SBI Savings/ });
    expect(chip).toHaveTextContent('SBI Savings');
    expect(chip).not.toHaveTextContent(/₹/);

    await user.type(screen.getByLabelText('Amount (Rupees)'), '250');
    await user.click(screen.getByRole('button', { name: 'Save Expense' }));

    await waitFor(() => {
      expect(screen.getByText(/Saved Groceries \(₹250\) to SBI Savings\./)).toBeInTheDocument();
    });

    // Stays on RecordView while locked
    expect(screen.getByRole('heading', { level: 1, name: 'Record Entry' })).toBeInTheDocument();

    // Verify saved to IndexedDB
    const db = await openAppDb(dbName);
    const state = await loadAppState(db);
    db.close();
    expect(state.transactions).toHaveLength(2);
    expect(state.transactions.some((tx) => tx.amountPaise === 25_000)).toBe(true);
  });

  it('gates BankHistoryView and AllTransactionsView behind LockedCard without Export or TopBar Lock button', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: true });

    const { unmount } = render(
      <AppProvider dbName={dbName}>
        <DirectLockedViewHarness targetView="bank-tx" bankId="acc-1" />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { level: 1, name: 'SBI Savings' })).toBeInTheDocument();
    expect(screen.queryByText('Current Balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Vegetables & milk')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock financial details' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'SBI Savings history is locked' })).toBeInTheDocument();
    const lockedRegion = screen.getByRole('region', { name: 'Locked financial details' });
    expect(within(lockedRegion).getByRole('button', { name: 'Unlock with PIN' })).toBeInTheDocument();

    await user.click(within(lockedRegion).getByRole('button', { name: 'Back to Home' }));
    expect(screen.getByTestId('current-view')).toHaveTextContent('home');

    unmount();

    render(
      <AppProvider dbName={dbName}>
        <DirectLockedViewHarness targetView="all" />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { level: 1, name: 'All Transactions' })).toBeInTheDocument();
    expect(screen.queryByText('Vegetables & milk')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock financial details' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Transaction history is locked' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock with PIN' })).toBeInTheDocument();
  });

  it('gates ManageView sections while keeping Appearance, PIN Lock, and Version visible, and closes confirm dialogs on lock', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: true });

    render(
      <AppProvider dbName={dbName}>
        <DirectLockedViewHarness targetView="manage" />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    // Appearance, PIN Lock (Enabled + Change/Turn Off), and Version remain visible
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    const pinSection = screen.getByRole('region', { name: 'PIN Lock' });
    expect(within(pinSection).getByText('Enabled')).toBeInTheDocument();
    expect(within(pinSection).getByRole('button', { name: 'Change PIN' })).toBeInTheDocument();
    expect(within(pinSection).getByRole('button', { name: 'Turn Off PIN' })).toBeInTheDocument();
    expect(screen.getByText(/^Version /)).toBeInTheDocument();

    // Sensitive Manage sections are hidden behind LockedCard
    expect(screen.queryByRole('region', { name: 'Bank Accounts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Expense Categories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Export All Spreadsheets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Backup and Restore' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Accounts & exports are hidden' })).toBeInTheDocument();

    // Unlock and open ArchiveConfirmDialog, then verify locking closes it
    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));
    const dialog = screen.getByRole('dialog', { name: 'Unlock Financial Details' });
    await user.type(within(dialog).getByLabelText('PIN'), '1234');
    await user.click(within(dialog).getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Bank Accounts' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('dialog', { name: 'Archive Account With Balance?' })).toBeInTheDocument();

    // Lock while ArchiveConfirmDialog is open -> closes it
    await user.click(screen.getByRole('button', { name: 'Lock financial details' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Archive Account With Balance?' })
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Accounts & exports are hidden' })).toBeInTheDocument();

    // Unlock again and open RestoreConfirmDialog, then verify locking closes it too
    await user.click(screen.getByRole('button', { name: 'Trigger Unlock' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Backup and Restore' })).toBeInTheDocument();
    });

    const fileInput = document.getElementById('restore-file-input') as HTMLInputElement;
    const validFile = new File(
      [
        JSON.stringify({
          schemaVersion: 1,
          exportedAt: '2026-11-25T10:00:00.000Z',
          accounts: [
            {
              id: 'acc-r1',
              name: 'Restored SBI',
              startingBalancePaise: 100_000,
              createdAt: '2026-11-01T08:00:00.000Z',
              archived: false,
            },
          ],
          categories: [],
          transactions: [],
        }),
      ],
      'backup.json',
      { type: 'application/json' }
    );
    await user.upload(fileInput, validFile);
    expect(await screen.findByRole('dialog', { name: 'Restore Backup?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trigger Lock' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Restore Backup?' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Accounts & exports are hidden' })).toBeInTheDocument();

    // Change PIN and Turn Off PIN buttons open PinModal in their respective modes
    await user.click(screen.getByRole('button', { name: 'Change PIN' }));
    expect(screen.getByRole('dialog', { name: 'Change PIN' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Turn Off PIN' }));
    expect(screen.getByRole('dialog', { name: 'Turn Off PIN Lock' })).toBeInTheDocument();
  });

  it('clears ManageView restoreError when locking and unlocking again', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: true });

    render(
      <AppProvider dbName={dbName}>
        <DirectLockedViewHarness targetView="manage" />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Unlock' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Backup and Restore' })).toBeInTheDocument();
    });

    const fileInput = document.getElementById('restore-file-input') as HTMLInputElement;
    const badFile = new File(['{invalid json'], 'bad-backup.json', { type: 'application/json' });
    await user.upload(fileInput, badFile);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not read backup JSON file.');
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Lock' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Accounts & exports are hidden' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Trigger Unlock' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Backup and Restore' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows PIN Lock Off + Set Up PIN when no PIN is configured and keeps existing views unlocked', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: false });

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText(/Loading your accounts/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText('Total Balance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock financial details' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Manage/i }));
    const pinSection = screen.getByRole('region', { name: 'PIN Lock' });
    expect(within(pinSection).getByText('Off')).toBeInTheDocument();
    expect(within(pinSection).getByRole('button', { name: 'Set Up PIN' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bank Accounts' })).toBeInTheDocument();

    await user.click(within(pinSection).getByRole('button', { name: 'Set Up PIN' }));
    expect(screen.getByRole('dialog', { name: 'Set Up PIN Lock' })).toBeInTheDocument();
  });

  it('unlocks all views together via PinModal, shows TopBar Lock on Home/Record/Manage only, closes EditTransactionDialog on lock, and re-locks manually', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedAppData(dbName, { withPin: true });

    render(
      <AppProvider dbName={dbName}>
        <AppShellWithLockControl />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText(/Loading your accounts/i)).not.toBeInTheDocument();
    });

    // Unlock via PinModal mounted in AppShell
    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));
    const pinDialog = screen.getByRole('dialog', { name: 'Unlock Financial Details' });
    await user.type(within(pinDialog).getByLabelText('PIN'), '1234');
    await user.click(within(pinDialog).getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // HomeView unlocked + Lock button visible
    expect(screen.getByText('Total Balance')).toBeInTheDocument();
    expect(screen.getAllByText('₹14,500').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Where You Spent Most')).toBeInTheDocument();
    expect(screen.getByText('Last 10 Transactions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock financial details' })).toBeInTheDocument();

    // RecordView shows balances and TopBar Lock button when unlocked
    await user.click(screen.getByRole('button', { name: 'Record' }));
    const accountGroup = screen.getByRole('group', { name: 'Bank Account' });
    expect(within(accountGroup).getByRole('button', { name: /SBI Savings/ })).toHaveTextContent(
      '(₹14,500)'
    );
    expect(screen.getByRole('button', { name: 'Lock financial details' })).toBeInTheDocument();

    // BankHistoryView omits TopBar Lock button
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'View SBI Savings transactions' }));
    expect(screen.getByRole('heading', { level: 1, name: 'SBI Savings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock financial details' })).not.toBeInTheDocument();

    // AllTransactionsView omits TopBar Lock button
    await user.click(screen.getByRole('button', { name: 'Back to Home' }));
    await user.click(screen.getByRole('button', { name: 'Show All →' }));
    expect(screen.getByRole('heading', { level: 1, name: 'All Transactions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock financial details' })).not.toBeInTheDocument();

    // Open EditTransactionDialog and lock while open -> AppShell closes it
    await user.click(screen.getByRole('button', { name: 'Back to Home' }));
    await user.click(screen.getByRole('button', { name: /Groceries/i }));
    expect(screen.getByRole('dialog', { name: 'Edit Transaction' })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('force-lock'));
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Edit Transaction' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('Financial details locked.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Financial details are hidden' })).toBeInTheDocument();

    // Unlock again and click manual TopBar Lock button on HomeView
    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));
    const pinDialog2 = screen.getByRole('dialog', { name: 'Unlock Financial Details' });
    await user.type(within(pinDialog2).getByLabelText('PIN'), '1234');
    await user.click(within(pinDialog2).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(screen.getByText('Total Balance')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Lock financial details' }));
    expect(screen.getByText('Financial details locked.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Financial details are hidden' })).toBeInTheDocument();
  });
});
