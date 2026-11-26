import { formatDateShort } from '../domain/dates';
import { formatRupees } from '../domain/money';
import type { Category, Transaction } from '../domain/types';
import { useApp } from '../state/AppContext';

export interface TransactionRowProps {
  tx: Transaction;
  hideAccount?: boolean;
  onSelect: (tx: Transaction) => void;
}

function getTitleAndBadge(
  tx: Transaction,
  categories: Category[]
): { title: string; badgeText: string | null; badgePositive: boolean } {
  if (tx.type === 'expense') {
    const cat = tx.categoryId ? categories.find((c) => c.id === tx.categoryId) : undefined;
    return { title: cat ? cat.name : 'Other', badgeText: null, badgePositive: false };
  }
  if (tx.type === 'deposit') {
    return { title: 'Cash Deposit', badgeText: 'Deposit', badgePositive: true };
  }
  return {
    title: tx.direction === 'incoming' ? 'Transfer In' : 'Transfer Out',
    badgeText: tx.direction === 'incoming' ? 'Incoming' : 'Outgoing',
    badgePositive: false,
  };
}

/**
 * Interactive transaction list item showing category/type title, badge, metadata, signed amount, and short date.
 */
export function TransactionRow({ tx, hideAccount = false, onSelect }: TransactionRowProps) {
  const { accounts, categories } = useApp();
  const acc = accounts.find((a) => a.id === tx.accountId);
  const accLabel = acc ? `${acc.name}${acc.archived ? ' (Archived)' : ''}` : 'Unknown account';

  const { title, badgeText, badgePositive } = getTitleAndBadge(tx, categories);
  const isPositive = tx.direction === 'incoming';
  const signedPaise = isPositive ? tx.amountPaise : -tx.amountPaise;

  const subParts: string[] = [];
  if (!hideAccount) subParts.push(accLabel);
  if (tx.mode) subParts.push(tx.mode);
  if (tx.note) subParts.push(tx.note);

  return (
    <button type="button" className="tx-row-btn" onClick={() => onSelect(tx)}>
      <span className="tx-left">
        <span className="tx-primary">
          <span>{title}</span>
          {badgeText && (
            <span className={`pill ${badgePositive ? 'pill-positive' : 'pill-neutral'}`}>
              {badgeText}
            </span>
          )}
        </span>
        {subParts.length > 0 && <span className="tx-meta">{subParts.join(' · ')}</span>}
      </span>
      <span className="tx-right">
        <span className={`tx-amount num${isPositive ? ' tx-amount-positive' : ''}`}>
          {formatRupees(signedPaise, { signed: true })}
        </span>
        <span className="tx-date num">{formatDateShort(tx.date)}</span>
      </span>
    </button>
  );
}
