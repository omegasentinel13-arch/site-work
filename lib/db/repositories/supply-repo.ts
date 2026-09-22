import { getDb } from '../index';
import crypto from 'crypto';

export interface SupplyItemDbRecord {
  id: string;
  site_id: string;
  name: string;
  normalized_name: string;
  usage_count: number;
  last_used_at: string;
  is_archived: number;
  created_at: string;
  updated_at: string;
}

/**
 * Normalizes supply name for duplicate prevention:
 * - trims leading/trailing whitespace
 * - collapses multiple internal whitespace characters to a single space
 * - lowercases for index comparison
 */
export function normalizeSupplyName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Returns active supply items for a specific site, ranked by:
 * 1. usage_count DESC (most frequently used first)
 * 2. last_used_at DESC (most recently used first)
 * 3. name COLLATE NOCASE ASC (alphabetical fallback)
 */
export function getActiveSuppliesForSite(siteId: string): SupplyItemDbRecord[] {
  const db = getDb();
  return db
    .prepare(`
      SELECT * FROM supply_items 
      WHERE site_id = ? AND is_archived = 0 
      ORDER BY usage_count DESC, last_used_at DESC, name COLLATE NOCASE ASC
    `)
    .all(siteId) as SupplyItemDbRecord[];
}

/**
 * Upserts a supply item into the site's memory.
 * - If an item with matching (site_id, normalized_name) exists:
 *   increments usage_count, un-archives if archived, and updates last_used_at and updated_at.
 * - If not:
 *   inserts a new row with usage_count = 1.
 */
export function recordSupplyUsage(siteId: string, name: string): SupplyItemDbRecord {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (!cleanName) {
    throw new Error('Supply name cannot be empty');
  }

  const normalized = normalizeSupplyName(cleanName);
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM supply_items WHERE site_id = ? AND normalized_name = ?')
    .get(siteId, normalized) as SupplyItemDbRecord | undefined;

  if (existing) {
    db.prepare(`
      UPDATE supply_items 
      SET usage_count = usage_count + 1, 
          last_used_at = datetime('now'), 
          updated_at = datetime('now'),
          is_archived = 0
      WHERE id = ?
    `).run(existing.id);

    return {
      ...existing,
      usage_count: existing.usage_count + 1,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_archived: 0,
    };
  }

  const id = `sup-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO supply_items (
      id, site_id, name, normalized_name, usage_count, last_used_at, is_archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, datetime('now'), 0, datetime('now'), datetime('now'))
  `).run(id, siteId, cleanName, normalized);

  return {
    id,
    site_id: siteId,
    name: cleanName,
    normalized_name: normalized,
    usage_count: 1,
    last_used_at: new Date().toISOString(),
    is_archived: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
