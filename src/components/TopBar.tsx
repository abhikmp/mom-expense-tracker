import type { ReactNode } from 'react';
import { ArrowLeft, Lock, Moon, Sun } from '@phosphor-icons/react';
import { useApp } from '../state/AppContext';

export interface TopBarProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: ReactNode;
  showLock?: boolean;
}

/**
 * Sticky Android-style top app bar with optional back navigation, lock button, action slot, and theme toggle.
 */
export function TopBar({
  title,
  showBack = false,
  onBack,
  rightAction,
  showLock = false,
}: TopBarProps) {
  const { settings, hasPin, isUnlocked, toggleTheme, navigate, lockApp } = useApp();
  const isDark = settings.theme === 'dark';

  return (
    <header className="android-topbar">
      <div className="topbar-left">
        {showBack && (
          <button
            type="button"
            className="icon-btn"
            onClick={onBack ?? (() => navigate('home'))}
            aria-label="Back to Home"
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        )}
        <h1 className="topbar-title">{title}</h1>
      </div>
      <div className="topbar-actions">
        {showLock && hasPin && isUnlocked && (
          <button
            type="button"
            className="icon-btn icon-btn-outlined"
            onClick={() => lockApp('Financial details locked.')}
            aria-label="Lock financial details"
            title="Lock financial details"
          >
            <Lock size={18} aria-hidden="true" />
          </button>
        )}
        {rightAction}
        <button
          type="button"
          className="icon-btn"
          onClick={() => void toggleTheme().catch(() => {})}
          aria-pressed={isDark}
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={isDark ? 'Light theme' : 'Dark theme'}
        >
          {isDark ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}
