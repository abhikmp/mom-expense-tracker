import { useEffect, useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '../../src/state/AppContext';
import { RecordView } from '../../src/views/RecordView';
import { HomeView } from '../../src/views/HomeView';
import { openAppDb, saveAccount, saveSettings } from '../../src/storage/db';

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `record-view-test-db-${Date.now()}-${dbCounter}`;
}

function RecordHarness({ preselectedAccountId }: { preselectedAccountId?: string | null }) {
  const { loading, view, manageJumpTarget, settings, navigate } = useApp();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!loading && !initializedRef.current) {
      initializedRef.current = true;
      navigate('record');
    }
  }, [loading, navigate]);

  if (loading || !initializedRef.current) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div data-testid="shell" data-view={view}>
      <div data-testid="current-view">{view}</div>
      <div data-testid="jump-target">{manageJumpTarget ?? 'none'}</div>
      <div data-testid="expense-modes">{settings.expensePaymentModes.join(',')}</div>
      <div data-testid="transfer-modes">{settings.transferPaymentModes.join(',')}</div>
      {view === 'home' ? (
        <HomeView onEditTx={vi.fn()} />
      ) : (
        <RecordView preselectedAccountId={preselectedAccountId} />
      )}
    </div>
  );
}

function DirectRecordHarness({ preselectedAccountId }: { preselectedAccountId?: string | null }) {
  const { loading, view, manageJumpTarget, settings, navigate } = useApp();
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!loading && !initializedRef.current) {
      initializedRef.current = true;
      navigate('record');
    }
  }, [loading, navigate]);

  if (loading || !initializedRef.current) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div data-testid="shell" data-view={view}>
      <div data-testid="current-view">{view}</div>
      <div data-testid="jump-target">{manageJumpTarget ?? 'none'}</div>
      <div data-testid="expense-modes">{settings.expensePaymentModes.join(',')}</div>
      <div data-testid="transfer-modes">{settings.transferPaymentModes.join(',')}</div>
      {view === 'manage' ? (
        <div data-testid="manage-view">manage</div>
      ) : view === 'home' ? (
        <HomeView onEditTx={vi.fn()} />
      ) : (
        <RecordView preselectedAccountId={preselectedAccountId} />
      )}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RecordView', () => {
  it('displays "Add a bank account first" prompt when zero active accounts exist', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    const db = await openAppDb(dbName);
    await saveAccount(db, {
      id: 'acc-arch',
      name: 'Old Axis',
      startingBalancePaise: 500_000,
      createdAt: '2026-10-01T08:00:00.000Z',
      archived: true,
    });
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <DirectRecordHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Add a bank account first')).toBeInTheDocument();
    expect(
      screen.getByText('You need at least one active bank account before recording an entry.')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Add Bank Account' }));
    expect(screen.getByTestId('current-view')).toHaveTextContent('manage');
    expect(screen.getByTestId('jump-target')).toHaveTextContent('sec-accounts');
  });

  it('switches the 3-way toggle (Expense, Deposit, Transfer) with correct fields, defaults, and preselectedAccountId override', async () => {
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
      id: 'acc-2',
      name: 'HDFC Pension',
      startingBalancePaise: 2_500_000,
      createdAt: '2026-11-02T08:00:00.000Z',
      archived: false,
    });
    await saveSettings(db, { lastUsedAccountId: 'acc-1' });
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <DirectRecordHarness preselectedAccountId="acc-2" />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    // preselectedAccountId overrides lastUsedAccountId
    const bankGroup = screen.getByRole('group', { name: 'Bank Account' });
    expect(within(bankGroup).getByRole('button', { name: /HDFC Pension/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(bankGroup).getByRole('button', { name: /SBI Savings/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // Expense default state
    const typeGroup = screen.getByRole('group', { name: 'Transaction Type' });
    expect(within(typeGroup).getByRole('button', { name: 'Expense' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('group', { name: 'Expense Category' })).toBeInTheDocument();
    const expensePayGroup = screen.getByRole('group', { name: 'Payment Mode' });
    expect(within(expensePayGroup).getByRole('button', { name: 'GPay' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(expensePayGroup).getByRole('button', { name: 'Cash' })).toBeInTheDocument();
    expect(within(expensePayGroup).getByRole('button', { name: 'Card' })).toBeInTheDocument();
    expect(within(expensePayGroup).getByRole('button', { name: '+ Add New' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Transfer Direction' })).not.toBeInTheDocument();

    // Switch to Deposit
    await user.click(within(typeGroup).getByRole('button', { name: 'Deposit' }));
    expect(screen.queryByRole('group', { name: 'Expense Category' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Payment Mode' })).not.toBeInTheDocument();
    const depositGroup = screen.getByRole('group', { name: 'Mode of Deposit' });
    expect(within(depositGroup).getByRole('button', { name: 'Cash' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(depositGroup).getByRole('button', { name: 'Cheque' })).toBeInTheDocument();

    // Switch to Transfer
    await user.click(within(typeGroup).getByRole('button', { name: 'Transfer' }));
    expect(screen.queryByRole('group', { name: 'Expense Category' })).not.toBeInTheDocument();
    const dirGroup = screen.getByRole('group', { name: 'Transfer Direction' });
    expect(within(dirGroup).getByRole('button', { name: 'Outgoing (−)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(dirGroup).getByRole('button', { name: 'Incoming (+)' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    const transferPayGroup = screen.getByRole('group', { name: 'Payment Mode' });
    expect(within(transferPayGroup).getByRole('button', { name: 'GPay' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(transferPayGroup).getByRole('button', { name: 'Cash' })).toBeInTheDocument();
    expect(within(transferPayGroup).getByRole('button', { name: 'Cheque' })).toBeInTheDocument();
    expect(within(transferPayGroup).getByRole('button', { name: '+ Add New' })).toBeInTheDocument();
  });

  it('persists custom payment mode "NetBanking" in settings and selects it when added via + Add New', async () => {
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
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <DirectRecordHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '+ Add New' }));
    const newModeInput = screen.getByLabelText('New Payment Mode');
    await user.type(newModeInput, 'NetBanking');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByTestId('expense-modes')).toHaveTextContent('GPay,Cash,Card,NetBanking');
    });

    const payGroup = screen.getByRole('group', { name: 'Payment Mode' });
    expect(within(payGroup).getByRole('button', { name: 'NetBanking' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('shows inline validation error on empty or zero amount without saving', async () => {
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
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <DirectRecordHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    // Empty submit
    await user.click(screen.getByRole('button', { name: /Save Expense/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please enter a valid amount (e.g. 500 or 45.50).'
    );

    // Zero submit
    await user.type(screen.getByLabelText('Amount (Rupees)'), '0');
    await user.click(screen.getByRole('button', { name: /Save Expense/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter an amount greater than ₹0.');
    expect(screen.getByTestId('current-view')).not.toHaveTextContent('home');
  });

  it('saves valid Expense to IndexedDB, updates bank balance immediately, returns to Home, and shows confirmation banner with "+ Add another"', async () => {
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
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <RecordHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.type(screen.getByLabelText('Amount (Rupees)'), '450');
    await user.click(
      within(screen.getByRole('group', { name: 'Expense Category' })).getByRole('button', {
        name: 'Medical',
      })
    );
    await user.type(screen.getByLabelText('Note (optional)'), 'Apollo Pharmacy');
    await user.click(screen.getByRole('button', { name: /Save Expense/ }));

    await waitFor(() => {
      expect(screen.getByTestId('current-view')).toHaveTextContent('home');
    });

    const statusBanner = screen.getByRole('status');
    expect(statusBanner).toHaveTextContent('Saved Medical (₹450) to SBI Savings.');
    expect(within(statusBanner).getByRole('button', { name: '+ Add another' })).toBeInTheDocument();

    const balanceSection = screen.getByRole('region', { name: 'Total and Bank Account Balances' });
    expect(within(balanceSection).getAllByText('₹9,550').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Apollo Pharmacy/)).toBeInTheDocument();
  });

  it('keeps a manually selected bank account chip active when preselectedAccountId prop is provided', async () => {
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
      id: 'acc-2',
      name: 'HDFC Pension',
      startingBalancePaise: 2_500_000,
      createdAt: '2026-11-02T08:00:00.000Z',
      archived: false,
    });
    db.close();

    render(
      <AppProvider dbName={dbName}>
        <DirectRecordHarness preselectedAccountId="acc-2" />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    const bankGroup = screen.getByRole('group', { name: 'Bank Account' });
    const hdfcBtn = within(bankGroup).getByRole('button', { name: /HDFC Pension/ });
    const sbiBtn = within(bankGroup).getByRole('button', { name: /SBI Savings/ });

    expect(hdfcBtn).toHaveAttribute('aria-pressed', 'true');
    expect(sbiBtn).toHaveAttribute('aria-pressed', 'false');

    await user.click(sbiBtn);
    await user.type(screen.getByLabelText('Amount (Rupees)'), '200');

    expect(sbiBtn).toHaveAttribute('aria-pressed', 'true');
    expect(hdfcBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
