import { CaretLeft, CaretRight, SlidersHorizontal } from '@phosphor-icons/react';
import { Banners } from '../components/Banners';
import { TopBar } from '../components/TopBar';
import { TransactionRow } from '../components/TransactionRow';
import {
  computeAccountBalancePaise,
  computeMonthlyCategorySpending,
  computeTotalActiveBalancePaise,
  getSortedTransactions,
} from '../domain/calculations';
import { formatMonthTitle, shiftMonth } from '../domain/dates';
import { formatRupees } from '../domain/money';
import { useApp } from '../state/AppContext';

export interface HomeViewProps {
  onEditTx: (id: string) => void;
}

/**
 * Primary dashboard showing active bank balances, monthly category spending breakdown, and recent transactions.
 */
export function HomeView({ onEditTx }: HomeViewProps) {
  const {
    accounts,
    categories,
    transactions,
    selectedMonth,
    setSelectedMonth,
    navigate,
    openBankHistory,
  } = useApp();

  const activeAccounts = accounts.filter((a) => !a.archived);
  const totalPaise = computeTotalActiveBalancePaise(accounts, transactions);
  const spending = computeMonthlyCategorySpending(selectedMonth, transactions, categories);
  const recent10 = getSortedTransactions(transactions).slice(0, 10);
  const monthTitle = formatMonthTitle(selectedMonth);

  return (
    <>
      <TopBar
        title="Expenses"
        rightAction={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => navigate('manage')}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>Manage</span>
          </button>
        }
      />

      <div className="phone-scroll">
        <Banners />

        {activeAccounts.length === 0 ? (
          <section className="card" aria-label="Welcome setup">
            <div className="empty-box">
              <p
                style={{
                  margin: '0 0 10px',
                  fontSize: '16px',
                  color: 'var(--color-foreground)',
                  fontWeight: 600,
                }}
              >
                No bank accounts added yet
              </p>
              <p style={{ margin: '0 0 16px' }}>
                Add your first bank account and current balance to start tracking expenses.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('manage', { manageJumpTarget: 'sec-accounts' })}
              >
                + Add Your First Bank Account
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="card card-flush" aria-label="Total and Bank Account Balances">
              <div className="card-header card-header-padded">
                <div>
                  <div className="balance-label">Total Balance</div>
                  <div className="balance-hero num">{formatRupees(totalPaise)}</div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate('manage', { manageJumpTarget: 'sec-accounts' })}
                >
                  + Add / Edit
                </button>
              </div>
              <div className="account-rows">
                {activeAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    className="account-row-btn"
                    onClick={() => openBankHistory(acc.id)}
                    aria-label={`View ${acc.name} transactions`}
                  >
                    <div>
                      <div className="account-name">{acc.name}</div>
                      <div className="account-sub">Available balance</div>
                    </div>
                    <span className="account-right">
                      <span className="account-amount num">
                        {formatRupees(computeAccountBalancePaise(acc, transactions))}
                      </span>
                      <span className="row-chevron" aria-hidden="true">
                        <CaretRight size={16} aria-hidden="true" />
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="card" aria-label="Where You Spent Most">
              <div className="spend-header">
                <div className="spend-header-row">
                  <h2 className="section-title">Where You Spent Most</h2>
                  <div className="month-switcher">
                    <button
                      type="button"
                      className="icon-btn icon-btn-outlined"
                      style={{ minWidth: '44px', minHeight: '44px' }}
                      onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
                      aria-label="Previous month"
                    >
                      <CaretLeft size={16} aria-hidden="true" />
                    </button>
                    <span className="month-label">{monthTitle}</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn-outlined"
                      style={{ minWidth: '44px', minHeight: '44px' }}
                      onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
                      aria-label="Next month"
                    >
                      <CaretRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <p className="sub-caption num">
                  {spending.totalPaise > 0
                    ? `${formatRupees(spending.totalPaise)} spent in ${monthTitle}`
                    : `No expenses in ${monthTitle}`}
                </p>
              </div>

              {spending.rows.length === 0 ? (
                <div className="empty-box">No expenses recorded in {monthTitle}.</div>
              ) : (
                <div className="spend-list">
                  {spending.rows.map((row, idx) => {
                    const leadAmount = spending.rows[0].amountPaise;
                    const barWidth =
                      leadAmount > 0
                        ? Math.max(4, Math.round((row.amountPaise / leadAmount) * 100))
                        : 4;
                    return (
                      <div
                        key={row.categoryId}
                        style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
                      >
                        <div className="spend-top">
                          <span className="spend-cat">
                            <span>{row.name}</span>
                            <span className="spend-pct num">{row.sharePct}%</span>
                          </span>
                          <span className="spend-val num">{formatRupees(row.amountPaise)}</span>
                        </div>
                        <div className="spend-track" aria-hidden="true">
                          <div
                            className={`spend-fill${idx === 0 ? ' spend-fill-lead' : ''}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="card card-flush" aria-label="Last 10 Transactions">
              <div className="card-header card-header-padded">
                <div>
                  <h2 className="section-title">Last 10 Transactions</h2>
                  <p className="sub-caption">Tap any entry to edit or delete</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate('all')}
                >
                  Show All →
                </button>
              </div>
              {recent10.length === 0 ? (
                <div style={{ padding: '16px' }}>
                  <div className="empty-box">
                    No transactions yet. Tap Record below to add one.
                  </div>
                </div>
              ) : (
                <div className="tx-list">
                  {recent10.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      onSelect={(item) => onEditTx(item.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
