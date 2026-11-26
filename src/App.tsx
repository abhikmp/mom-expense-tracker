import { useState } from 'react';
import { BottomNav } from './components/BottomNav';
import { EditTransactionDialog } from './components/EditTransactionDialog';
import { AppProvider, useApp } from './state/AppContext';
import { AllTransactionsView } from './views/AllTransactionsView';
import { BankHistoryView } from './views/BankHistoryView';
import { HomeView } from './views/HomeView';
import { ManageView } from './views/ManageView';
import { RecordView } from './views/RecordView';

/**
 * Main mobile phone-frame shell coordinating active view rendering, bottom navigation, and edit dialog.
 */
export function AppShell() {
  const { loading, view, navigate } = useApp();
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="phone-frame">
        <header className="android-topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">Expenses</h1>
          </div>
        </header>
        <div className="phone-scroll">
          <section className="card" aria-label="Loading">
            <p className="sub-caption" style={{ margin: 0 }}>
              Loading your accounts…
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="phone-frame">
      {view === 'home' && <HomeView onEditTx={setEditingTxId} />}
      {view === 'record' && <RecordView />}
      {view === 'bank-tx' && <BankHistoryView onEditTx={setEditingTxId} />}
      {view === 'all' && <AllTransactionsView onEditTx={setEditingTxId} />}
      {view === 'manage' && <ManageView />}
      <BottomNav
        currentView={view}
        onSelectHome={() => {
          setEditingTxId(null);
          navigate('home');
        }}
        onSelectRecord={() => {
          setEditingTxId(null);
          navigate('record');
        }}
      />
      <EditTransactionDialog txId={editingTxId} onClose={() => setEditingTxId(null)} />
    </div>
  );
}

/**
 * Root application component providing persisted IndexedDB state to the UI shell.
 */
export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
