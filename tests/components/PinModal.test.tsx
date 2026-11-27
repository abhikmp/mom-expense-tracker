import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider, useApp } from '../../src/state/AppContext';
import { LockedCard } from '../../src/components/LockedCard';
import { PinModal } from '../../src/components/PinModal';
import { hashSecret } from '../../src/security/crypto';
import { loadSecurityRecord, openAppDb, saveSecurityRecord } from '../../src/storage/db';

let dbCounter = 0;

function nextDbName(): string {
  dbCounter += 1;
  return `pin-modal-test-db-${Date.now()}-${dbCounter}`;
}

async function seedSecurity(dbName: string, pin = '1234', master = 'momsecret123') {
  const db = await openAppDb(dbName);
  const [pinHash, masterPasswordHash] = await Promise.all([
    hashSecret(pin),
    hashSecret(master),
  ]);
  await saveSecurityRecord(db, {
    key: 'lock',
    pinHash,
    masterPasswordHash,
    updatedAt: '2026-11-27T10:00:00.000Z',
  });
  db.close();
}

function PinTestHarness() {
  const app = useApp();
  const [showCard, setShowCard] = useState(true);

  if (app.loading) {
    return <div data-testid="loading">loading</div>;
  }

  return (
    <div>
      <div data-testid="has-pin">{String(app.hasPin)}</div>
      <div data-testid="is-unlocked">{String(app.isUnlocked)}</div>
      <div data-testid="is-locked">{String(app.isLocked)}</div>
      <div data-testid="modal-mode">{app.pinModalMode ?? 'none'}</div>
      <div data-testid="failed-attempts">{app.failedPinAttempts}</div>
      <div data-testid="toast">{app.statusToast ?? 'none'}</div>

      {showCard && (
        <LockedCard
          title="Financial details are hidden"
          copy="Unlock with your PIN to view balances."
          onUnlock={() => app.openPinModal('unlock')}
          showBack
          onBack={() => setShowCard(false)}
        />
      )}

      <button type="button" onClick={() => app.openPinModal('setup')}>
        Open Setup
      </button>
      <button type="button" onClick={() => app.openPinModal('change')}>
        Open Change
      </button>
      <button type="button" onClick={() => app.openPinModal('disable')}>
        Open Disable
      </button>

      <PinModal />
    </div>
  );
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe('LockedCard', () => {
  it('renders title, copy, unlock button, and optional Back to Home button', async () => {
    const user = userEvent.setup();
    const onUnlock = vi.fn();
    const onBack = vi.fn();

    const { rerender } = render(
      <LockedCard
        title="Financial details are hidden"
        copy="Unlock with your PIN to view balances."
        onUnlock={onUnlock}
      />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Financial details are hidden' })).toBeInTheDocument();
    expect(screen.getByText('Unlock with your PIN to view balances.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to Home' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));
    expect(onUnlock).toHaveBeenCalledTimes(1);

    rerender(
      <LockedCard
        title="History is locked"
        copy="Unlock to view history."
        onUnlock={onUnlock}
        showBack
        onBack={onBack}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('PinModal', () => {
  it('setup mode validates PIN, confirm PIN, Master Password, toggles visibility, and calls setupPin', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();

    render(
      <AppProvider dbName={dbName}>
        <PinTestHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open Setup' }));
    const dialog = screen.getByRole('dialog', { name: 'Set Up PIN Lock' });

    const pin1 = within(dialog).getByLabelText('New PIN (4–6 digits)') as HTMLInputElement;
    const pin2 = within(dialog).getByLabelText('Confirm PIN') as HTMLInputElement;
    const master1 = within(dialog).getByLabelText('Master Password (8+ characters)') as HTMLInputElement;
    const master2 = within(dialog).getByLabelText('Confirm Master Password') as HTMLInputElement;

    expect(pin1).toHaveAttribute('type', 'password');
    expect(pin1).toHaveAttribute('inputmode', 'numeric');
    expect(pin1).toHaveAttribute('maxlength', '6');
    expect(master1).toHaveAttribute('type', 'password');

    // Toggle Master Password visibility
    const showMaster1Btn = within(dialog).getByRole('button', {
      name: 'Show Master Password (8+ characters)',
    });
    expect(showMaster1Btn).toHaveAttribute('aria-pressed', 'false');
    await user.click(showMaster1Btn);
    expect(master1).toHaveAttribute('type', 'text');
    expect(
      within(dialog).getByRole('button', { name: 'Hide Master Password (8+ characters)' })
    ).toHaveAttribute('aria-pressed', 'true');

    // Invalid short PIN
    await user.type(pin1, '12');
    await user.click(within(dialog).getByRole('button', { name: 'Enable PIN Lock' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('PIN must be 4 to 6 digits.');

    // Mismatched confirm PIN
    await user.clear(pin1);
    await user.type(pin1, '1234');
    await user.type(pin2, '5678');
    await user.click(within(dialog).getByRole('button', { name: 'Enable PIN Lock' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('PINs do not match.');
    expect(pin2.value).toBe('');

    // Short Master Password
    await user.type(pin2, '1234');
    await user.type(master1, 'short');
    await user.click(within(dialog).getByRole('button', { name: 'Enable PIN Lock' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Master Password must be at least 8 characters.'
    );

    // Mismatched Master Password
    await user.clear(master1);
    await user.type(master1, 'momsecret123');
    await user.type(master2, 'different123');
    await user.click(within(dialog).getByRole('button', { name: 'Enable PIN Lock' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Master Passwords do not match.');
    expect(master2.value).toBe('');

    // Valid submission
    await user.type(master2, 'momsecret123');
    await user.click(within(dialog).getByRole('button', { name: 'Enable PIN Lock' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('has-pin')).toHaveTextContent('true');
    expect(screen.getByTestId('is-unlocked')).toHaveTextContent('true');
    expect(screen.getByTestId('toast')).toHaveTextContent('PIN lock enabled.');

    const db = await openAppDb(dbName);
    const saved = await loadSecurityRecord(db);
    db.close();
    expect(saved).not.toBeNull();
  });

  it('unlock mode shows inline error and clears input on wrong PIN, enforces 30s cooldown after 5 wrong tries while Forgot PIN? stays clickable, and unlocks on valid PIN', async () => {
    const dbName = nextDbName();
    await seedSecurity(dbName, '1234', 'momsecret123');

    render(
      <AppProvider dbName={dbName}>
        <PinTestHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Unlock with PIN' }));
    const dialog = screen.getByRole('dialog', { name: 'Unlock Financial Details' });
    const getPinInput = () => within(dialog).getByLabelText('PIN') as HTMLInputElement;

    // 4 wrong attempts
    for (let i = 1; i <= 4; i += 1) {
      fireEvent.change(getPinInput(), { target: { value: '9999' } });
      fireEvent.submit(within(dialog).getByRole('button', { name: 'Unlock' }).closest('form')!);
      await waitFor(() => {
        expect(screen.getByTestId('failed-attempts')).toHaveTextContent(String(i));
      });
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Incorrect PIN. Please try again.');
      expect(getPinInput().value).toBe('');
    }

    // 5th wrong attempt triggers 30s cooldown
    fireEvent.change(getPinInput(), { target: { value: '9999' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Unlock' }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('failed-attempts')).toHaveTextContent('5');
    });

    expect(getPinInput()).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Unlock' })).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/30\s*(?:s|seconds)/i);

    // Forgot PIN? remains clickable immediately during cooldown
    const forgotBtn = within(dialog).getByRole('button', { name: 'Forgot PIN?' });
    expect(forgotBtn).toBeEnabled();
    fireEvent.click(forgotBtn);
    expect(screen.getByRole('dialog', { name: 'Verify Master Password' })).toBeInTheDocument();

    // Switch to fake timers before returning to unlock so PinModal's interval uses fake timers
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Unlock Financial Details' })).toBeInTheDocument();
    expect(screen.getByLabelText('PIN')).toBeDisabled();

    // Verify countdown ticks down and re-enables after 30s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/2[89]s/);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await waitFor(() => {
      expect(screen.getByLabelText('PIN')).toBeEnabled();
    });
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeEnabled();

    // Valid PIN unlocks cleanly
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('is-unlocked')).toHaveTextContent('true');
    vi.useRealTimers();
  });

  it('forgot-master -> reset-pin shows error and clears input on wrong Master Password, then resets PIN on valid Master Password', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedSecurity(dbName, '1234', 'momsecret123');

    render(
      <AppProvider dbName={dbName}>
        <PinTestHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Unlock with PIN' }));
    await user.click(screen.getByRole('button', { name: 'Forgot PIN?' }));

    const masterDialog = screen.getByRole('dialog', { name: 'Verify Master Password' });
    const masterInput = within(masterDialog).getByLabelText('Master Password') as HTMLInputElement;

    // Wrong Master Password
    await user.type(masterInput, 'wrongpass');
    await user.click(within(masterDialog).getByRole('button', { name: 'Verify' }));

    await waitFor(() => {
      expect(within(masterDialog).getByRole('alert')).toHaveTextContent(
        'Incorrect Master Password. Please try again.'
      );
    });
    expect(masterInput.value).toBe('');

    // Valid Master Password transitions to reset-pin
    await user.type(masterInput, 'momsecret123');
    await user.click(within(masterDialog).getByRole('button', { name: 'Verify' }));

    const resetDialog = await screen.findByRole('dialog', { name: 'Set New PIN' });
    const newPin1 = within(resetDialog).getByLabelText('New PIN (4–6 digits)') as HTMLInputElement;
    const newPin2 = within(resetDialog).getByLabelText('Confirm New PIN') as HTMLInputElement;

    // Mismatch check
    await user.type(newPin1, '5678');
    await user.type(newPin2, '9999');
    await user.click(within(resetDialog).getByRole('button', { name: 'Save New PIN' }));
    expect(within(resetDialog).getByRole('alert')).toHaveTextContent('PINs do not match.');
    expect(newPin2.value).toBe('');

    // Matching valid PIN
    await user.type(newPin2, '5678');
    await user.click(within(resetDialog).getByRole('button', { name: 'Save New PIN' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('is-unlocked')).toHaveTextContent('true');
    expect(screen.getByTestId('toast')).toHaveTextContent('PIN updated and app unlocked.');
  });

  it('change mode verifies current PIN (with Forgot PIN? link) and updates to matching new PIN', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedSecurity(dbName, '1234', 'momsecret123');

    render(
      <AppProvider dbName={dbName}>
        <PinTestHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open Change' }));
    const dialog = screen.getByRole('dialog', { name: 'Change PIN' });
    expect(within(dialog).getByRole('button', { name: 'Forgot PIN?' })).toBeInTheDocument();

    const curPin = within(dialog).getByLabelText('Current PIN') as HTMLInputElement;
    const newPin1 = within(dialog).getByLabelText('New PIN (4–6 digits)') as HTMLInputElement;
    const newPin2 = within(dialog).getByLabelText('Confirm New PIN') as HTMLInputElement;

    // Wrong current PIN
    await user.type(curPin, '9999');
    await user.type(newPin1, '5678');
    await user.type(newPin2, '5678');
    await user.click(within(dialog).getByRole('button', { name: 'Update PIN' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Current PIN is incorrect.');
    });
    expect(curPin.value).toBe('');

    // Correct current PIN + valid matching new PIN
    await user.type(curPin, '1234');
    await user.click(within(dialog).getByRole('button', { name: 'Update PIN' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('toast')).toHaveTextContent('PIN changed.');
  });

  it('disable mode verifies current PIN and turns off PIN lock', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();
    await seedSecurity(dbName, '1234', 'momsecret123');

    render(
      <AppProvider dbName={dbName}>
        <PinTestHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open Disable' }));
    const dialog = screen.getByRole('dialog', { name: 'Turn Off PIN Lock' });
    const curPin = within(dialog).getByLabelText('Current PIN') as HTMLInputElement;

    // Wrong current PIN
    await user.type(curPin, '0000');
    await user.click(within(dialog).getByRole('button', { name: 'Turn Off PIN' }));

    await waitFor(() => {
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Current PIN is incorrect.');
    });
    expect(curPin.value).toBe('');

    // Valid current PIN
    await user.type(curPin, '1234');
    await user.click(within(dialog).getByRole('button', { name: 'Turn Off PIN' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('has-pin')).toHaveTextContent('false');
    expect(screen.getByTestId('toast')).toHaveTextContent('PIN lock turned off.');
  });

  it('supports paste in PIN & Master Password fields, moves focus into modal, traps Tab, closes on Escape, and restores focus to opener', async () => {
    const user = userEvent.setup();
    const dbName = nextDbName();

    render(
      <AppProvider dbName={dbName}>
        <PinTestHarness />
      </AppProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
    });

    const opener = screen.getByRole('button', { name: 'Open Setup' });
    opener.focus();
    expect(opener).toHaveFocus();

    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Set Up PIN Lock' });
    const pin1 = within(dialog).getByLabelText('New PIN (4–6 digits)') as HTMLInputElement;
    const enableBtn = within(dialog).getByRole('button', { name: 'Enable PIN Lock' });
    const master1 = within(dialog).getByLabelText('Master Password (8+ characters)') as HTMLInputElement;

    // Focus moved into modal on open
    expect(pin1).toHaveFocus();

    // Paste works on PIN (sanitizes non-digits) and Master Password
    await user.paste('12a34b');
    expect(pin1.value).toBe('1234');

    master1.focus();
    await user.paste('my-secret-pw');
    expect(master1.value).toBe('my-secret-pw');

    // Tab wraps from last focusable to first, and Shift+Tab wraps from first to last
    enableBtn.focus();
    await user.tab();
    expect(pin1).toHaveFocus();

    await user.tab({ shift: true });
    expect(enableBtn).toHaveFocus();

    // Escape closes modal and restores focus to opener
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
