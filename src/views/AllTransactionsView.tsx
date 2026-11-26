import { ShareNetwork } from '@phosphor-icons/react';
import { Banners } from '../components/Banners';
import { TopBar } from '../components/TopBar';
import { TransactionRow } from '../components/TransactionRow';
import { filterTransactions } from '../domain/calculations';
import type { FilterTypeKey } from '../domain/types';
import { useApp } from '../state/AppContext';

export interface AllTransactionsViewProps {
  onEditTx: (id: string) => void;
}

/**
 * Full transaction history screen with date range, type, and category filters plus filtered CSV export.
 */
export function AllTransactionsView({ onEditTx }: AllTransactionsViewProps) {
  const {
    categories,
    transactions,
    filters,
    setFilters,
    resetFilters,
    exportCsv,
    navigate,
  } = useApp();

  const filtered = filterTransactions(transactions, filters);
  const hasActiveFilters = Boolean(
    filters.fromDate ||
      filters.toDate ||
      filters.typeKey !== 'all' ||
      filters.categoryId !== 'all'
  );

  return (
    <>
      <TopBar
        title="All Transactions"
        showBack
        onBack={() => navigate('home')}
        rightAction={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void exportCsv('filtered', filtered)}
          >
            <ShareNetwork size={16} aria-hidden="true" />
            <span>Export ({filtered.length})</span>
          </button>
        }
      />

      <div className="phone-scroll">
        <Banners />

        <section className="card" aria-label="Transaction filters">
          <div className="row-between" style={{ marginBottom: '10px' }}>
            <span className="sub-caption num" style={{ margin: 0 }}>
              Showing {filtered.length} of {transactions.length} entries
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={resetFilters}
              >
                Clear
              </button>
            )}
          </div>

          <div className="filter-grid">
            <div>
              <label className="field-label" htmlFor="flt-from">
                From Date
              </label>
              <input
                id="flt-from"
                className="text-input num"
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters({ fromDate: e.target.value })}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="flt-to">
                To Date
              </label>
              <input
                id="flt-to"
                className="text-input num"
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters({ toDate: e.target.value })}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="flt-type">
                Type
              </label>
              <select
                id="flt-type"
                className="select-input"
                value={filters.typeKey}
                onChange={(e) => setFilters({ typeKey: e.target.value as FilterTypeKey })}
              >
                <option value="all">All Types</option>
                <option value="expense">Expense</option>
                <option value="deposit">Deposit</option>
                <option value="transfer-outgoing">Transfer - Outgoing</option>
                <option value="transfer-incoming">Transfer - Incoming</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="flt-cat">
                Category
              </label>
              <select
                id="flt-cat"
                className="select-input"
                value={filters.categoryId}
                onChange={(e) => setFilters({ categoryId: e.target.value })}
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.hidden ? ' (Hidden)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="card card-flush" aria-label="Transaction history">
          {filtered.length === 0 ? (
            <div style={{ padding: '16px' }}>
              <div className="empty-box">No transactions match these filters.</div>
            </div>
          ) : (
            <div className="tx-list">
              {filtered.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
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
