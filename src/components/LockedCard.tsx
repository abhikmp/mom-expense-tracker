import { Lock, LockOpen } from '@phosphor-icons/react';

export interface LockedCardProps {
  title: string;
  copy: string;
  onUnlock: () => void;
  showBack?: boolean;
  onBack?: () => void;
}

/**
 * Presentational placeholder card shown on protected views when PIN lock is active.
 */
export function LockedCard({
  title,
  copy,
  onUnlock,
  showBack = false,
  onBack,
}: LockedCardProps) {
  return (
    <section className="card lock-card" aria-label="Locked financial details">
      <div className="lock-badge">
        <Lock size={26} aria-hidden="true" />
      </div>
      <h2 className="lock-card-title">{title}</h2>
      <p className="lock-card-copy">{copy}</p>
      <div className="lock-card-actions">
        <button type="button" className="btn btn-primary btn-block" onClick={onUnlock}>
          <LockOpen size={18} aria-hidden="true" />
          <span>Unlock with PIN</span>
        </button>
        {showBack && (
          <button type="button" className="btn btn-secondary btn-block" onClick={onBack}>
            Back to Home
          </button>
        )}
      </div>
    </section>
  );
}
