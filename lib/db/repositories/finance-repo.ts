import { getDb } from '../index';
import crypto from 'crypto';
import { FinancialTransactionItem, DebitCategory, TransactionType } from '../../domain/finance-engine';

export interface FinancialDbRecord {
  id: string;
  site_id: string;
  date: string;
  type: TransactionType;
  debit_category: DebitCategory | null;
  amount_paise: number;
  description: string;
  reference_note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export function createFinancialTransaction(data: {
  siteId: string;
  date: string;
  type: TransactionType;
  debitCategory?: DebitCategory | null;
  amountPaise: number;
  description: string;
  referenceNote?: string | null;
  userId: string | null;
}): string {
  const db = getDb();
  const id = `tx-${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO financial_transactions (
      id, site_id, date, type, debit_category, amount_paise,
      description, reference_note, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    data.siteId,
    data.date,
    data.type,
    data.type === 'DEBIT' ? (data.debitCategory || 'SUPPLIES') : null,
    Math.max(1, Math.floor(data.amountPaise)),
    data.description.trim(),
    data.referenceNote ? data.referenceNote.trim() : null,
    data.userId,
    data.userId
  );

  return id;
}

export function updateFinancialTransaction(data: {
  id: string;
  date: string;
  type: TransactionType;
  debitCategory?: DebitCategory | null;
  amountPaise: number;
  description: string;
  referenceNote?: string | null;
  userId: string | null;
}): void {
  const db = getDb();
  db.prepare(`
    UPDATE financial_transactions
    SET 
      date = ?,
      type = ?,
      debit_category = ?,
      amount_paise = ?,
      description = ?,
      reference_note = ?,
      updated_by = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    data.date,
    data.type,
    data.type === 'DEBIT' ? (data.debitCategory || 'SUPPLIES') : null,
    Math.max(1, Math.floor(data.amountPaise)),
    data.description.trim(),
    data.referenceNote ? data.referenceNote.trim() : null,
    data.userId,
    data.id
  );
}

export function deleteFinancialTransaction(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM financial_transactions WHERE id = ?`).run(id);
}

export function getCumulativeBalanceBeforeDate(siteId: string, beforeDate: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as balance_paise
    FROM financial_transactions
    WHERE site_id = ? AND date < ?
  `).get(siteId, beforeDate) as { balance_paise: number };

  return row ? row.balance_paise : 0;
}

export function getFinancialTransactions(
  siteId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    type?: TransactionType;
    debitCategory?: DebitCategory;
  }
): FinancialDbRecord[] {
  const db = getDb();
  let query = `SELECT * FROM financial_transactions WHERE site_id = ?`;
  const params: unknown[] = [siteId];

  if (options?.startDate) {
    query += ` AND date >= ?`;
    params.push(options.startDate);
  }
  if (options?.endDate) {
    query += ` AND date <= ?`;
    params.push(options.endDate);
  }
  if (options?.type) {
    query += ` AND type = ?`;
    params.push(options.type);
  }
  if (options?.debitCategory) {
    query += ` AND debit_category = ?`;
    params.push(options.debitCategory);
  }

  query += ` ORDER BY date DESC, created_at DESC`;

  return db.prepare(query).all(...params) as FinancialDbRecord[];
}

export function mapDbRecordToItem(rec: FinancialDbRecord): FinancialTransactionItem {
  return {
    id: rec.id,
    siteId: rec.site_id,
    date: rec.date,
    type: rec.type,
    debitCategory: rec.debit_category,
    amountPaise: rec.amount_paise,
    description: rec.description,
    referenceNote: rec.reference_note,
    createdAt: rec.created_at,
  };
}
