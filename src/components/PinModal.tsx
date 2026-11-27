import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import {
  sanitizePinInput,
  validateMasterPassword,
  validatePin,
} from '../security/crypto';
import { useApp, type PinModalMode } from '../state/AppContext';
import { DialogShell } from './ConfirmDialogs';

const MODAL_TITLES: Record<PinModalMode, string> = {
  unlock: 'Unlock Financial Details',
  'forgot-master': 'Verify Master Password',
  'reset-pin': 'Set New PIN',
  setup: 'Set Up PIN Lock',
  change: 'Change PIN',
  disable: 'Turn Off PIN Lock',
};

function PinInputField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="text-input num pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="off"
        placeholder="••••"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(sanitizePinInput(event.target.value))}
      />
    </div>
  );
}

function MasterPasswordField({
  id,
  label,
  value,
  shown,
  onToggleShown,
  onChange,
  autoComplete,
  placeholder,
  hint,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  shown: boolean;
  onToggleShown: () => void;
  onChange: (next: string) => void;
  autoComplete: string;
  placeholder: string;
  hint?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-with-toggle">
        <input
          ref={inputRef}
          id={id}
          className="text-input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="input-eye-btn"
          aria-pressed={shown}
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          onClick={onToggleShown}
        >
          {shown ? <EyeSlash size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

/**
 * Accessible PIN Lock modal handling unlock, Master Password recovery, setup, change, and disable flows.
 */
export function PinModal() {
  const {
    pinModalMode,
    pinCooldownUntil,
    openPinModal,
    closePinModal,
    verifyPinAndUnlock,
    verifyMasterAndProceed,
    setupPin,
    resetPinAfterMaster,
    changePin,
    disablePin,
  } = useApp();

  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [masterInput, setMasterInput] = useState('');
  const [masterConfirm, setMasterConfirm] = useState('');
  const [showMaster, setShowMaster] = useState(false);
  const [showMasterConfirm, setShowMasterConfirm] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const curPinRef = useRef<HTMLInputElement | null>(null);
  const pin1Ref = useRef<HTMLInputElement | null>(null);
  const pin2Ref = useRef<HTMLInputElement | null>(null);
  const master1Ref = useRef<HTMLInputElement | null>(null);
  const master2Ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPin1('');
    setPin2('');
    setCurrentPin('');
    setMasterInput('');
    setMasterConfirm('');
    setShowMaster(false);
    setShowMasterConfirm(false);
    setError('');
    setSubmitting(false);
    setNow(Date.now());
  }, [pinModalMode]);

  useEffect(() => {
    if (!pinModalMode) return;
    if (pinModalMode === 'forgot-master') {
      master1Ref.current?.focus();
    } else if (pinModalMode === 'change' || pinModalMode === 'disable') {
      if (!curPinRef.current?.disabled) {
        curPinRef.current?.focus();
      }
    } else {
      if (!pin1Ref.current?.disabled) {
        pin1Ref.current?.focus();
      }
    }
  }, [pinModalMode]);

  useEffect(() => {
    if (!pinModalMode || pinCooldownUntil <= Date.now()) return;
    setNow(Date.now());
    const interval = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= pinCooldownUntil) {
        window.clearInterval(interval);
        setError('');
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [pinCooldownUntil, pinModalMode]);

  if (!pinModalMode) return null;

  const cooldownSec = Math.max(0, Math.ceil((pinCooldownUntil - now) / 1000));
  const inCooldown = cooldownSec > 0;
  const activeError = inCooldown
    ? `Too many incorrect attempts. Try again in ${cooldownSec}s.`
    : error;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    if (pinModalMode === 'unlock') {
      if (inCooldown) return;
      const pinCheck = validatePin(pin1);
      if (!pinCheck.valid) {
        setError(pinCheck.error);
        pin1Ref.current?.focus();
        return;
      }
      setSubmitting(true);
      try {
        const res = await verifyPinAndUnlock(pin1);
        if (!res.ok) {
          setError(res.error);
          setPin1('');
          setNow(Date.now());
          pin1Ref.current?.focus();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (pinModalMode === 'forgot-master') {
      if (!masterInput) {
        setError('Please enter your Master Password.');
        master1Ref.current?.focus();
        return;
      }
      setSubmitting(true);
      try {
        const res = await verifyMasterAndProceed(masterInput);
        if (!res.ok) {
          setError(res.error);
          setMasterInput('');
          master1Ref.current?.focus();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (pinModalMode === 'reset-pin') {
      const pinCheck = validatePin(pin1);
      if (!pinCheck.valid) {
        setError(pinCheck.error);
        pin1Ref.current?.focus();
        return;
      }
      if (pin1 !== pin2) {
        setError('PINs do not match.');
        setPin2('');
        pin2Ref.current?.focus();
        return;
      }
      setSubmitting(true);
      try {
        await resetPinAfterMaster(pin1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update PIN. Please try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (pinModalMode === 'setup') {
      const pinCheck = validatePin(pin1);
      if (!pinCheck.valid) {
        setError(pinCheck.error);
        pin1Ref.current?.focus();
        return;
      }
      if (pin1 !== pin2) {
        setError('PINs do not match.');
        setPin2('');
        pin2Ref.current?.focus();
        return;
      }
      const pwCheck = validateMasterPassword(masterInput);
      if (!pwCheck.valid) {
        setError(pwCheck.error);
        master1Ref.current?.focus();
        return;
      }
      if (masterInput !== masterConfirm) {
        setError('Master Passwords do not match.');
        setMasterConfirm('');
        master2Ref.current?.focus();
        return;
      }
      setSubmitting(true);
      try {
        await setupPin(pin1, masterInput);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not save PIN lock settings. Please try again.'
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (pinModalMode === 'change') {
      if (inCooldown) return;
      const curCheck = validatePin(currentPin);
      if (!curCheck.valid) {
        setError(curCheck.error);
        curPinRef.current?.focus();
        return;
      }
      const newCheck = validatePin(pin1);
      if (!newCheck.valid) {
        setError('New PIN must be 4 to 6 digits.');
        pin1Ref.current?.focus();
        return;
      }
      if (pin1 !== pin2) {
        setError('New PINs do not match.');
        setPin2('');
        pin2Ref.current?.focus();
        return;
      }
      setSubmitting(true);
      try {
        const res = await changePin(currentPin, pin1);
        if (!res.ok) {
          setError(res.error);
          setCurrentPin('');
          setNow(Date.now());
          curPinRef.current?.focus();
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (pinModalMode === 'disable') {
      if (inCooldown) return;
      const curCheck = validatePin(currentPin);
      if (!curCheck.valid) {
        setError(curCheck.error);
        curPinRef.current?.focus();
        return;
      }
      setSubmitting(true);
      try {
        const res = await disablePin(currentPin);
        if (!res.ok) {
          setError(res.error);
          setCurrentPin('');
          setNow(Date.now());
          curPinRef.current?.focus();
        }
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <DialogShell title={MODAL_TITLES[pinModalMode]} onCancel={closePinModal}>
      <form className="form-stack" noValidate onSubmit={(event) => void handleSubmit(event)}>
        {pinModalMode === 'unlock' && (
          <>
            <p className="sub-caption" style={{ margin: 0, fontSize: '14px' }}>
              Enter your 4–6 digit PIN to view balances, spending, and transactions.
            </p>
            <PinInputField
              id="modal-pin-1"
              label="PIN"
              value={pin1}
              onChange={setPin1}
              disabled={inCooldown}
              inputRef={pin1Ref}
            />
          </>
        )}

        {pinModalMode === 'forgot-master' && (
          <>
            <p className="sub-caption" style={{ margin: 0, fontSize: '14px' }}>
              Enter your Master Password to unlock and set a new PIN.
            </p>
            <MasterPasswordField
              id="modal-master-1"
              label="Master Password"
              value={masterInput}
              shown={showMaster}
              onToggleShown={() => setShowMaster((prev) => !prev)}
              onChange={setMasterInput}
              autoComplete="current-password"
              placeholder="At least 8 characters"
              inputRef={master1Ref}
            />
          </>
        )}

        {pinModalMode === 'reset-pin' && (
          <>
            <p className="sub-caption" style={{ margin: 0, fontSize: '14px' }}>
              Master Password verified. Choose a new 4–6 digit PIN.
            </p>
            <PinInputField
              id="modal-pin-1"
              label="New PIN (4–6 digits)"
              value={pin1}
              onChange={setPin1}
              inputRef={pin1Ref}
            />
            <PinInputField
              id="modal-pin-2"
              label="Confirm New PIN"
              value={pin2}
              onChange={setPin2}
              inputRef={pin2Ref}
            />
          </>
        )}

        {pinModalMode === 'setup' && (
          <>
            <p className="sub-caption" style={{ margin: 0, fontSize: '14px' }}>
              Create a 4–6 digit PIN and a Master Password in case you ever forget the PIN.
            </p>
            <PinInputField
              id="modal-pin-1"
              label="New PIN (4–6 digits)"
              value={pin1}
              onChange={setPin1}
              inputRef={pin1Ref}
            />
            <PinInputField
              id="modal-pin-2"
              label="Confirm PIN"
              value={pin2}
              onChange={setPin2}
              inputRef={pin2Ref}
            />
            <div
              className="form-stack"
              style={{ borderTop: '1px solid var(--color-rule)', paddingTop: '12px' }}
            >
              <MasterPasswordField
                id="modal-master-1"
                label="Master Password (8+ characters)"
                value={masterInput}
                shown={showMaster}
                onToggleShown={() => setShowMaster((prev) => !prev)}
                onChange={setMasterInput}
                autoComplete="new-password"
                placeholder="Any 8+ characters"
                hint="Used only if you tap Forgot PIN."
                inputRef={master1Ref}
              />
              <MasterPasswordField
                id="modal-master-2"
                label="Confirm Master Password"
                value={masterConfirm}
                shown={showMasterConfirm}
                onToggleShown={() => setShowMasterConfirm((prev) => !prev)}
                onChange={setMasterConfirm}
                autoComplete="new-password"
                placeholder="Re-enter Master Password"
                inputRef={master2Ref}
              />
            </div>
          </>
        )}

        {pinModalMode === 'change' && (
          <>
            <PinInputField
              id="modal-cur-pin"
              label="Current PIN"
              value={currentPin}
              onChange={setCurrentPin}
              disabled={inCooldown}
              inputRef={curPinRef}
            />
            <PinInputField
              id="modal-pin-1"
              label="New PIN (4–6 digits)"
              value={pin1}
              onChange={setPin1}
              disabled={inCooldown}
              inputRef={pin1Ref}
            />
            <PinInputField
              id="modal-pin-2"
              label="Confirm New PIN"
              value={pin2}
              onChange={setPin2}
              disabled={inCooldown}
              inputRef={pin2Ref}
            />
          </>
        )}

        {pinModalMode === 'disable' && (
          <>
            <p className="sub-caption" style={{ margin: 0, fontSize: '14px' }}>
              Enter your current PIN to turn off PIN Lock. This clears your PIN and Master Password.
            </p>
            <PinInputField
              id="modal-cur-pin"
              label="Current PIN"
              value={currentPin}
              onChange={setCurrentPin}
              disabled={inCooldown}
              inputRef={curPinRef}
            />
          </>
        )}

        {activeError && (
          <p className={inCooldown ? 'field-error num' : 'field-error'} role="alert" style={{ margin: 0 }}>
            {activeError}
          </p>
        )}

        <div className="row-between">
          {pinModalMode === 'forgot-master' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openPinModal('unlock')}
            >
              Back
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={closePinModal}>
              Cancel
            </button>
          )}

          {pinModalMode === 'unlock' && (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={inCooldown || submitting}
            >
              Unlock
            </button>
          )}
          {pinModalMode === 'forgot-master' && (
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              Verify
            </button>
          )}
          {pinModalMode === 'reset-pin' && (
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              Save New PIN
            </button>
          )}
          {pinModalMode === 'setup' && (
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              Enable PIN Lock
            </button>
          )}
          {pinModalMode === 'change' && (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={inCooldown || submitting}
            >
              Update PIN
            </button>
          )}
          {pinModalMode === 'disable' && (
            <button
              type="submit"
              className="btn btn-danger-fill"
              disabled={inCooldown || submitting}
            >
              Turn Off PIN
            </button>
          )}
        </div>

        {(pinModalMode === 'unlock' || pinModalMode === 'change') && (
          <div
            style={{
              textAlign: 'center',
              borderTop: '1px solid var(--color-rule)',
              paddingTop: '8px',
            }}
          >
            <button
              type="button"
              className="link-btn"
              onClick={() => openPinModal('forgot-master')}
            >
              Forgot PIN?
            </button>
          </div>
        )}
      </form>
    </DialogShell>
  );
}
