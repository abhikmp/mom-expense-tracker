import { ShareNetwork } from '@phosphor-icons/react';
import { Banners } from '../components/Banners';
import { TopBar } from '../components/TopBar';
import { TransactionRow } from '../components/TransactionRow';
import { computeAccountBalancePaise, getSortedTransactions } from '../domain/calculations';
import { formatRupees } from '../domain/money';
import { useApp } from '../state/AppContext';
import { HomeView } from './HomeView';

export interface BankHistoryViewProps {
  onEditTx: (id: string) => void;
}

/**
 * Single bank account ledger view showing current balance, bank-scoped CSV export, and transactions.
 */
export function BankHistoryView({ onEditTx }: BankHistoryViewProps) {
  const {
    accounts,
    transactions,
    selectedBankId,
    navigate,
    openRecordForBank,
    exportCsv,
  } = useApp();

  const acc = selectedBankId ? accounts.find((a) => a.id === selectedBankId) : undefined;
  if (!acc) {
    return <HomeView onEditTx={onEditTx} />;
  }

  const bankTxs = getSortedTransactions(transactions).filter((t) => t.accountId === acc.id);
  const balancePaise = computeAccountBalancePaise(acc, transactions);

  return (
    <>
      <TopBar
        title={acc.name}
        showBack
        onBack={() => navigate('home')}
        rightAction={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void exportCsv('bank', bankTxs, acc.name).catch(() => {})}
          >
            <ShareNetwork size={16} aria-hidden="true" />
            <span>Export ({bankTxs.length})</span>
          </button>
        }
      />

      <div className="phone-scroll">
        <Banners />

        <section className="card" aria-label={`${acc.name} Summary`}>
          <div className="row-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="balance-label">Current Balance</div>
              <div className="balance-hero num">{formatRupees(balancePaise)}</div>
              <p className="sub-caption num" style={{ marginTop: '6px' }}>
                {bankTxs.length} {bankTxs.length === 1 ? 'transaction' : 'transactions'} recorded
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => openRecordForBank(acc.id)}
            >
              + Record
            </button>
          </div>
        </section>

        <section className="card card-flush" aria-label={`${acc.name} Transactions`}>
          <div className="card-header card-header-padded">
            <div>
              <h2 className="section-title">Account History</h2>
              <p className="sub-caption">Tap any entry to edit or delete</p>
            </div>
          </div>
          {bankTxs.length === 0 ? (
            <div style={{ padding: '16px' }}>
              <div className="empty-box">No transactions recorded for {acc.name} yet.</div>
            </div>
          ) : (
            <div className="tx-list">
              {bankTxs.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  hideAccount
                  onSelect={(item) => onEditTx(item.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
