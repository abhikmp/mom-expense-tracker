import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '../../src/state/AppContext';
import { AppShell } from '../../src/App';
import { ManageView } from '../../src/views/ManageView';
import type { BackupPayload, Transaction } from '../../src/domain/types';
import {
  createTransactionAtomic,
  loadAppState,
  openAppDb,
  saveAccount,
} from '../../src/storage/db';
import * as csvModule from '../../src/export/csv';
import * as backupModule from '../../src/export/backup';
import * as dbModule from '../../src/storage/db';

function ManageHarness() {
  const { loading, view, navigate } = useApp();
  const initRef = useRef(false);

  useEffect(() => {
    if (!loading && !initRef.current) {
      initRef.current = true;
      navigate('manage');
    }
  }, [loading, navigate]);

  if (loading || !initRef.current || view !== 'manage') {
    return <div data-testid="loading">loading</div>;
  }

  return <ManageView />;
}

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `manage-view-test-db-${Date.now()}-${dbCounter}`;
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
    date: '2026-11-20',
    note: 'Vegetables',
    createdAt: '2026-11-20T09:00:00.000Z',
    updatedAt: '2026-11-20T09:00:00.000Z',
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

describe('ManageView & AppShell', () => {
  it('toggles Light/Dark appearance and persists across reloads', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();

    const firstRender = render(
      <AppProvider dbName={dbName}>
        <ManageHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    const appearanceSec = screen.getByRole('region', { name: 'Appearance' });
    const toggleBtn = within(appearanceSec).getByRole('button', { name: /Light On/i });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggleBtn);

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(within(appearanceSec).getByRole('button', { name: /Dark On/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Wait for IndexedDB persistence before unmounting to simulate reload
    await waitFor(async () => {
      const checkDb = await openAppDb(dbName);
      const state = await loadAppState(checkDb);
      checkDb.close();
      expect(state.settings.theme).toBe('dark');
    });

    firstRender.unmount();

    // Simulate reload with same IndexedDB database
    document.documentElement.setAttribute('data-theme', 'light');
    render(
      <AppProvider dbName={dbName}>
        <ManageHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(
      within(screen.getByRole('region', { name: 'Appearance' })).getByRole('button', {
        name: /Dark On/i,
      })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds bank accounts (including 0 and decimal), renames, adjusts balance (starting = desired - net), and enforces archive confirmation on non-zero balances', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();

    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-zero',
      name: 'Zero Bank',
      startingBalancePaise: 0,
      createdAt: '2026-11-01T08:00:00.000Z',
      archived: false,
    });
    await saveAccount(db, {
      id: 'acc-active',
      name: 'SBI Savings',
      startingBalancePaise: 100_000, // ₹1,000
      createdAt: '2026-11-02T08:00:00.000Z',
      archived: false,
    });
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-sbi-1',
        accountId: 'acc-active',
        amountPaise: 30_000, // -₹300 => net = -30_000, current balance = ₹700
      })
    );
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <ManageHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
      expect(screen.getByText('SBI Savings')).toBeInTheDocument();
    });

    const accSec = screen.getByRole('region', { name: 'Bank Accounts' });

    // Add account with decimal amount 5000.50
    await user.type(within(accSec).getByLabelText('Account Name'), 'ICICI Bank');
    await user.type(within(accSec).getByLabelText('Current Balance (₹)'), '5000.50');
    await user.click(within(accSec).getByRole('button', { name: '+ Add Bank Account' }));

    await waitFor(() => {
      expect(within(accSec).getByText('ICICI Bank')).toBeInTheDocument();
    });
    expect(within(accSec).getByText('Balance: ₹5,000.50')).toBeInTheDocument();

    // Add account with empty/0 balance
    await user.type(within(accSec).getByLabelText('Account Name'), 'Kotak Zero');
    await user.click(within(accSec).getByRole('button', { name: '+ Add Bank Account' }));

    await waitFor(() => {
      expect(within(accSec).getByText('Kotak Zero')).toBeInTheDocument();
    });
    expect(within(accSec).getAllByText('Balance: ₹0').length).toBeGreaterThanOrEqual(2);

    // Rename Zero Bank -> Axis Zero
    const zeroItem = within(accSec).getByText('Zero Bank').closest('.manage-item') as HTMLElement;
    await user.click(within(zeroItem).getByRole('button', { name: 'Rename' }));
    const renameInput = within(zeroItem).getByLabelText('New Account Name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Axis Zero');
    await user.click(within(zeroItem).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(within(accSec).getByText('Axis Zero')).toBeInTheDocument();
    });

    // Archive zero-balance account immediately without dialog
    const axisItem = within(accSec).getByText('Axis Zero').closest('.manage-item') as HTMLElement;
    await user.click(within(axisItem).getByRole('button', { name: 'Archive' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(axisItem).getByText('Archived')).toBeInTheDocument();
    });
    expect(within(axisItem).getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();

    // Adjust Balance on SBI Savings (net = -30_000, desired = ₹2,000 = 200_000 => starting = 230_000)
    const sbiItem = within(accSec).getByText('SBI Savings').closest('.manage-item') as HTMLElement;
    await user.click(within(sbiItem).getByRole('button', { name: 'Adjust Balance' }));
    const adjustInput = within(sbiItem).getByLabelText('Desired Balance (₹)');
    await user.clear(adjustInput);
    await user.type(adjustInput, '2000');
    await user.click(within(sbiItem).getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(within(sbiItem).getByText('Balance: ₹2,000')).toBeInTheDocument();
    });

    const verifyDb = await openAppDb(dbName);
    const updatedSbi = await verifyDb.get('accounts', 'acc-active');
    verifyDb.close();
    expect(updatedSbi?.startingBalancePaise).toBe(230_000);

    // Archive non-zero account opens confirmation dialog
    await user.click(within(sbiItem).getByRole('button', { name: 'Archive' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive Account With Balance?' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('₹2,000')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Archive Anyway' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(within(sbiItem).getByText('Archived')).toBeInTheDocument();
  });

  it('adds, renames, and hides/shows expense categories, updating labels automatically and hiding from Record chips while keeping past entries', async () => {
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
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-cat-test',
        accountId: 'acc-1',
        categoryId: 'cat-groceries',
        amountPaise: 25_000,
        note: 'Weekly market',
      })
    );
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Loading' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    });

    // Navigate to Manage
    await user.click(screen.getByRole('button', { name: 'Manage' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Manage & Settings' })).toBeInTheDocument();
    });

    const catSec = screen.getByRole('region', { name: 'Expense Categories' });

    // Add category
    await user.type(within(catSec).getByLabelText('New Category Name'), 'Gifts');
    await user.click(within(catSec).getByRole('button', { name: '+ Add' }));
    await waitFor(() => {
      expect(within(catSec).getByText('Gifts')).toBeInTheDocument();
    });

    // Rename Groceries -> Food & Groceries
    const grocItem = within(catSec).getByText('Groceries').closest('.manage-item') as HTMLElement;
    await user.click(within(grocItem).getByRole('button', { name: 'Rename' }));
    const renameCatInput = within(grocItem).getByLabelText('Category Name');
    await user.clear(renameCatInput);
    await user.type(renameCatInput, 'Food & Groceries');
    await user.click(within(grocItem).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(within(catSec).getByText('Food & Groceries')).toBeInTheDocument();
    });

    // Hide Food & Groceries
    const renamedItem = within(catSec)
      .getByText('Food & Groceries')
      .closest('.manage-item') as HTMLElement;
    await user.click(within(renamedItem).getByRole('button', { name: 'Hide' }));
    await waitFor(() => {
      expect(within(renamedItem).getByText('Hidden')).toBeInTheDocument();
    });
    expect(within(renamedItem).getByRole('button', { name: 'Show' })).toBeInTheDocument();

    // Check Record screen: Food & Groceries should not appear as a chip, Gifts should appear
    await user.click(screen.getByRole('button', { name: 'Record' }));
    const catGroup = screen.getByRole('group', { name: 'Expense Category' });
    expect(within(catGroup).queryByRole('button', { name: 'Food & Groceries' })).not.toBeInTheDocument();
    expect(within(catGroup).getByRole('button', { name: 'Gifts' })).toBeInTheDocument();

    // Check Home screen: existing transaction still shows renamed category "Food & Groceries"
    await user.click(screen.getByRole('button', { name: 'Home' }));
    const recentSec = screen.getByRole('region', { name: 'Last 10 Transactions' });
    expect(within(recentSec).getByText('Food & Groceries')).toBeInTheDocument();
  });

  it('exports all CSVs, downloads JSON backup, opens Restore confirmation for valid JSON, and shows error toast for invalid JSON without wiping data', async () => {
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
    await createTransactionAtomic(
      db,
      makeTx({
        id: 'tx-existing',
        accountId: 'acc-1',
        amountPaise: 15_000,
        note: 'Existing milk',
      })
    );
    db.close();

    const exportSpy = vi.spyOn(csvModule, 'exportCsvFiles').mockResolvedValue({
      method: 'download',
      files: ['transactions-2026-11-26.csv', 'bank-balances-2026-11-26.csv'],
    });
    const downloadSpy = vi
      .spyOn(backupModule, 'downloadJsonBackup')
      .mockReturnValue('moms-expenses-backup-2026-11-26.json');

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Loading' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Manage' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Manage & Settings' })).toBeInTheDocument();
    });

    // Export All (.csv)
    await user.click(screen.getByRole('button', { name: /Export All \(\.csv\)/i }));
    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledTimes(1);
    });
    expect(exportSpy.mock.calls[0][0].scope).toBe('all');
    expect(exportSpy.mock.calls[0][0].transactions).toHaveLength(1);

    // Download Backup
    await user.click(screen.getByRole('button', { name: 'Download Backup' }));
    await waitFor(() => {
      expect(downloadSpy).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByText(/Downloaded backup moms-expenses-backup-2026-11-26\.json\./)
    ).toBeInTheDocument();

    // Upload invalid JSON file -> error toast, data intact
    const fileInput = document.getElementById('restore-file-input') as HTMLInputElement;
    const corruptFile = new File(['{not valid json'], 'corrupt.json', {
      type: 'application/json',
    });
    await user.upload(fileInput, corruptFile);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Could not read backup JSON file/i);
    });
    expect(screen.queryByRole('dialog', { name: 'Restore Backup?' })).not.toBeInTheDocument();

    // Upload schema-invalid JSON file -> error toast, data intact
    const badSchemaFile = new File(
      [JSON.stringify({ schemaVersion: 99, accounts: [], categories: [], transactions: [] })],
      'bad-schema.json',
      { type: 'application/json' }
    );
    await user.upload(fileInput, badSchemaFile);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/Unsupported backup schema version/i);
    });

    const checkDb = await openAppDb(dbName);
    const existingAcc = await checkDb.get('accounts', 'acc-1');
    const existingTx = await checkDb.get('transactions', 'tx-existing');
    checkDb.close();
    expect(existingAcc?.name).toBe('SBI Savings');
    expect(existingTx?.note).toBe('Existing milk');

    // Upload valid JSON backup -> opens Restore Backup? dialog with exact counts
    const validPayload: BackupPayload = {
      _note: 'test',
      schemaVersion: 1,
      exportedAt: '2026-11-25T10:00:00.000Z',
      accounts: [
        {
          id: 'acc-restored-1',
          name: 'Restored HDFC',
          startingBalancePaise: 900_000,
          createdAt: '2026-11-01T08:00:00.000Z',
          archived: false,
        },
        {
          id: 'acc-restored-2',
          name: 'Restored SBI',
          startingBalancePaise: 300_000,
          createdAt: '2026-11-02T08:00:00.000Z',
          archived: false,
        },
      ],
      categories: [
        {
          id: 'cat-restored',
          name: 'Restored Bills',
          hidden: false,
          sortOrder: 1,
          isDefault: false,
        },
      ],
      transactions: [
        makeTx({
          id: 'tx-restored-1',
          accountId: 'acc-restored-1',
          categoryId: 'cat-restored',
          amountPaise: 100_000,
          note: 'Restored electric bill',
        }),
      ],
    };

    const validFile = new File([JSON.stringify(validPayload)], 'backup.json', {
      type: 'application/json',
    });
    await user.upload(fileInput, validFile);

    const restoreDialog = await screen.findByRole('dialog', { name: 'Restore Backup?' });
    expect(within(restoreDialog).getByText('2 Accounts · 1 Categories · 1 Entries')).toBeInTheDocument();

    await user.click(within(restoreDialog).getByRole('button', { name: 'Restore Now' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Expenses' })).toBeInTheDocument();
    });

    expect(screen.getByText('Restored HDFC')).toBeInTheDocument();
    expect(screen.getByText('Restored SBI')).toBeInTheDocument();
    expect(screen.queryByText('SBI Savings')).not.toBeInTheDocument();
    expect(screen.getByText('Restored 2 accounts and 1 transactions.')).toBeInTheDocument();
  });

  it('scrolls #sec-accounts into view when navigating from HomeView + Add / Edit', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock;

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No bank accounts added yet')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '+ Add Your First Bank Account' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Manage & Settings' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalled();
    });
  });

  it('surfaces an error toast without unhandled rejection and keeps RestoreConfirmDialog open when restoreBackup fails', async () => {
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

    vi.spyOn(dbModule, 'restoreBackupAtomic').mockRejectedValueOnce(
      new Error('Restore write failed')
    );

    render(
      <AppProvider dbName={dbName}>
        <AppShell />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Manage' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Manage & Settings' })).toBeInTheDocument();
    });

    const validPayload: BackupPayload = {
      _note: 'test',
      schemaVersion: 1,
      exportedAt: '2026-11-25T10:00:00.000Z',
      accounts: [
        {
          id: 'acc-restored-1',
          name: 'Restored HDFC',
          startingBalancePaise: 900_000,
          createdAt: '2026-11-01T08:00:00.000Z',
          archived: false,
        },
      ],
      categories: [],
      transactions: [],
    };

    const fileInput = document.getElementById('restore-file-input') as HTMLInputElement;
    const validFile = new File([JSON.stringify(validPayload)], 'backup.json', {
      type: 'application/json',
    });
    await user.upload(fileInput, validFile);

    const restoreDialog = await screen.findByRole('dialog', { name: 'Restore Backup?' });
    await user.click(within(restoreDialog).getByRole('button', { name: 'Restore Now' }));

    await waitFor(() => {
      const toast = screen.getByRole('status');
      expect(toast).toHaveClass('banner-error');
      expect(toast).toHaveTextContent(/Could not restore backup/i);
    });

    expect(screen.getByRole('dialog', { name: 'Restore Backup?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Manage & Settings' })).toBeInTheDocument();
  });
});
