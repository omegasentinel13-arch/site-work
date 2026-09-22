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
  investor_id?: string | null;
  investor_name?: string | null;
  work_category_id?: string | null;
  work_category_name?: string | null;
  work_role_id?: string | null;
  work_role_name?: string | null;
  attachment_url?: string | null;
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
  investorId?: string | null;
  investorName?: string | null;
  workCategoryId?: string | null;
  workRoleId?: string | null;
  attachmentUrl?: string | null;
  userId: string | null;
}): string {
  const db = getDb();
  const id = `tx-${crypto.randomUUID()}`;

  db.prepare(`
    INSERT INTO financial_transactions (
      id, site_id, date, type, debit_category, amount_paise,
      description, reference_note, investor_id, investor_name,
      work_category_id, work_role_id, attachment_url,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    data.siteId,
    data.date,
    data.type,
    data.type === 'DEBIT' ? (data.debitCategory || 'SUPPLIES') : null,
    Math.max(1, Math.floor(data.amountPaise)),
    data.description.trim(),
    data.referenceNote ? data.referenceNote.trim() : null,
    data.investorId || null,
    data.investorName ? data.investorName.trim() : null,
    data.workCategoryId || null,
    data.workRoleId || null,
    data.attachmentUrl || null,
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
  investorId?: string | null;
  investorName?: string | null;
  workCategoryId?: string | null;
  workRoleId?: string | null;
  attachmentUrl?: string | null;
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
      investor_id = ?,
      investor_name = ?,
      work_category_id = ?,
      work_role_id = ?,
      attachment_url = ?,
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
    data.investorId || null,
    data.investorName ? data.investorName.trim() : null,
    data.workCategoryId || null,
    data.workRoleId || null,
    data.attachmentUrl || null,
    data.userId,
    data.id
  );
}

export function deleteFinancialTransaction(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM financial_transactions WHERE id = ?`).run(id);
}

export function getFinancialTransactionById(id: string): FinancialDbRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM financial_transactions WHERE id = ?`).get(id) as FinancialDbRecord | undefined;
  return row || null;
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

/**
 * Calculates the current site balance from all persisted transactions.
 * Never uses artificial future sentinel dates.
 */
export function getAllTimeSiteBalance(siteId: string): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as balance_paise
    FROM financial_transactions
    WHERE site_id = ?
  `).get(siteId) as { balance_paise: number };

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
  let query = `
    SELECT 
      t.*,
      COALESCE(t.investor_name, i.name) as investor_name,
      c.name as work_category_name,
      r.name as work_role_name
    FROM financial_transactions t
    LEFT JOIN investors i ON t.investor_id = i.id
    LEFT JOIN work_categories c ON t.work_category_id = c.id
    LEFT JOIN work_roles r ON t.work_role_id = r.id
    WHERE t.site_id = ?
  `;
  const params: unknown[] = [siteId];

  if (options?.startDate) {
    query += ` AND t.date >= ?`;
    params.push(options.startDate);
  }
  if (options?.endDate) {
    query += ` AND t.date <= ?`;
    params.push(options.endDate);
  }
  if (options?.type) {
    query += ` AND t.type = ?`;
    params.push(options.type);
  }
  if (options?.debitCategory) {
    query += ` AND t.debit_category = ?`;
    params.push(options.debitCategory);
  }

  query += ` ORDER BY t.date DESC, t.created_at DESC`;

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
    investorId: rec.investor_id || null,
    investorName: rec.investor_name || null,
    workCategoryId: rec.work_category_id || null,
    workRoleId: rec.work_role_id || null,
    attachmentUrl: rec.attachment_url || null,
    createdAt: rec.created_at,
  };
}

export interface MonthOverviewItem {
  month: number;
  monthKey: string;
  monthLabel: string;
  shortMonthName: string;
  inflowPaise: number;
  outflowPaise: number;
  netPaise: number;
  closingBalancePaise: number;
  hasActivity: boolean;
  transactionCount: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function getYearMonthlyOverview(siteId: string, year: number): MonthOverviewItem[] {
  const db = getDb();
  let runningBalance = getCumulativeBalanceBeforeDate(siteId, `${year}-01-01`);

  const results: MonthOverviewItem[] = [];

  for (let m = 1; m <= 12; m++) {
    const monthStr = String(m).padStart(2, '0');
    const monthKey = `${year}-${monthStr}`;

    const row = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) as inflow_paise,
        COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as outflow_paise,
        COUNT(*) as count
      FROM financial_transactions
      WHERE site_id = ? AND strftime('%Y-%m', date) = ?
    `).get(siteId, monthKey) as { inflow_paise: number; outflow_paise: number; count: number };

    const inflow = row ? row.inflow_paise : 0;
    const outflow = row ? row.outflow_paise : 0;
    const net = inflow - outflow;
    runningBalance += net;

    results.push({
      month: m,
      monthKey,
      monthLabel: `${MONTH_NAMES[m - 1]} ${year}`,
      shortMonthName: SHORT_MONTHS[m - 1],
      inflowPaise: inflow,
      outflowPaise: outflow,
      netPaise: net,
      closingBalancePaise: runningBalance,
      hasActivity: (row ? row.count : 0) > 0,
      transactionCount: row ? row.count : 0,
    });
  }

  return results;
}

export interface MonthlyRollForward {
  previousMonthLabel: string;
  currentMonthLabel: string;
  previousMonthClosingPaise: number;
  currentMonthOpeningPaise: number;
  currentMonthInflowPaise: number;
  currentMonthOutflowPaise: number;
  currentMonthNetPaise: number;
  currentMonthClosingPaise: number;
  hasPriorData: boolean;
}

export function getMonthlyRollForward(siteId: string, referenceDate: string): MonthlyRollForward {
  const db = getDb();
  let refYear = new Date().getFullYear();
  let refMonth = new Date().getMonth() + 1;

  if (referenceDate && /^\d{4}-\d{2}/.test(referenceDate)) {
    const parts = referenceDate.split('-');
    refYear = parseInt(parts[0], 10) || refYear;
    refMonth = parseInt(parts[1], 10) || refMonth;
  }

  const currentMonthStart = `${refYear}-${String(refMonth).padStart(2, '0')}-01`;
  const nextYear = refMonth === 12 ? refYear + 1 : refYear;
  const nextMonth = refMonth === 12 ? 1 : refMonth + 1;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  const prevYear = refMonth === 1 ? refYear - 1 : refYear;
  const prevMonth = refMonth === 1 ? 12 : refMonth - 1;

  const previousMonthClosingPaise = getCumulativeBalanceBeforeDate(siteId, currentMonthStart);
  const currentMonthOpeningPaise = previousMonthClosingPaise;

  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) as inflow_paise,
      COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as outflow_paise
    FROM financial_transactions
    WHERE site_id = ? AND date >= ? AND date < ?
  `).get(siteId, currentMonthStart, nextMonthStart) as { inflow_paise: number; outflow_paise: number };

  const inflow = row ? row.inflow_paise : 0;
  const outflow = row ? row.outflow_paise : 0;
  const net = inflow - outflow;
  const currentMonthClosingPaise = currentMonthOpeningPaise + net;

  const priorCountRow = db.prepare(`
    SELECT COUNT(*) as c FROM financial_transactions WHERE site_id = ? AND date < ?
  `).get(siteId, currentMonthStart) as { c: number };

  return {
    previousMonthLabel: `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`,
    currentMonthLabel: `${MONTH_NAMES[refMonth - 1]} ${refYear}`,
    previousMonthClosingPaise,
    currentMonthOpeningPaise,
    currentMonthInflowPaise: inflow,
    currentMonthOutflowPaise: outflow,
    currentMonthNetPaise: net,
    currentMonthClosingPaise,
    hasPriorData: (priorCountRow?.c ?? 0) > 0,
  };
}

