import { House, PlusCircle } from '@phosphor-icons/react';
import type { ViewId } from '../domain/types';

export interface BottomNavProps {
  currentView: ViewId;
  onSelectHome: () => void;
  onSelectRecord: () => void;
}

/**
 * Two-tab Android bottom navigation bar (`Home` and `Record`).
 */
export function BottomNav({ currentView, onSelectHome, onSelectRecord }: BottomNavProps) {
  const isHomeTab = currentView === 'home' || currentView === 'bank-tx';
  const isRecordTab = currentView === 'record';

  return (
    <nav className="android-bottom-nav" aria-label="Bottom tabs">
      <button
        type="button"
        className="android-nav-btn"
        onClick={onSelectHome}
        aria-current={isHomeTab ? 'page' : undefined}
      >
        <span className="nav-icon-pill">
          <House size={20} aria-hidden="true" />
        </span>
        <span>Home</span>
      </button>
      <button
        type="button"
        className="android-nav-btn"
        onClick={onSelectRecord}
        aria-current={isRecordTab ? 'page' : undefined}
      >
        <span className="nav-icon-pill">
          <PlusCircle size={20} aria-hidden="true" />
        </span>
        <span>Record</span>
      </button>
    </nav>
  );
}
