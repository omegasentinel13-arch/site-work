import { getDb } from '../index';
import crypto from 'crypto';

export interface InvestorDbRecord {
  id: string;
  name: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

/**
 * Returns all active (non-archived) investors sorted alphabetically.
 */
export function getAllActiveInvestors(): InvestorDbRecord[] {
  const db = getDb();
  return db
    .prepare('SELECT * FROM investors WHERE is_archived = 0 ORDER BY name COLLATE NOCASE ASC')
    .all() as InvestorDbRecord[];
}

/**
 * Finds an investor by name (case-insensitive) or creates a new one.
 * Preserves active status if existing investor is already active.
 */
export function findOrCreateInvestor(name: string): InvestorDbRecord {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Investor name cannot be empty');
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM investors WHERE name = ? COLLATE NOCASE')
    .get(trimmed) as InvestorDbRecord | undefined;

  if (existing) {
    return existing;
  }

  const id = `inv-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO investors (id, name, is_archived, created_at, updated_at)
    VALUES (?, ?, 0, datetime('now'), datetime('now'))
  `).run(id, trimmed);

  return {
    id,
    name: trimmed,
    is_archived: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Archives an investor from the active reusable selection list.
 * Historical transactions referencing this investor remain completely intact.
 */
export function archiveInvestor(id: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE investors 
    SET is_archived = 1, updated_at = datetime('now') 
    WHERE id = ?
  `).run(id);
}
