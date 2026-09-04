import { getDb, runTransaction } from '../index';
import crypto from 'crypto';

export interface SiteRecord {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  is_archived: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function getAllSites(includeArchived = false, userAllowedSiteIds?: string[] | null): SiteRecord[] {
  const db = getDb();
  let query = `SELECT * FROM sites WHERE 1=1`;
  const params: unknown[] = [];

  if (!includeArchived) {
    query += ` AND is_archived = 0`;
  }

  if (userAllowedSiteIds && userAllowedSiteIds.length > 0) {
    const placeholders = userAllowedSiteIds.map(() => '?').join(',');
    query += ` AND id IN (${placeholders})`;
    params.push(...userAllowedSiteIds);
  } else if (userAllowedSiteIds && userAllowedSiteIds.length === 0) {
    return [];
  }

  query += ` ORDER BY name ASC`;
  return db.prepare(query).all(...params) as SiteRecord[];
}

export function getSiteById(id: string): SiteRecord | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM sites WHERE id = ?`).get(id) as SiteRecord) || null;
}

export function createSite(name: string, code: string | null, location: string | null, createdBy: string | null): string {
  const db = getDb();
  const id = `site-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO sites (id, name, code, location, is_archived, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))
  `).run(id, name.trim(), code ? code.trim() : null, location ? location.trim() : null, createdBy);
  return id;
}

export function updateSite(id: string, name: string, code: string | null, location: string | null): void {
  const db = getDb();
  db.prepare(`
    UPDATE sites 
    SET name = ?, code = ?, location = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name.trim(), code ? code.trim() : null, location ? location.trim() : null, id);
}

export function toggleSiteArchived(id: string, isArchived: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE sites 
    SET is_archived = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(isArchived ? 1 : 0, id);
}

export function getSiteUserIds(siteId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`SELECT user_id FROM site_users WHERE site_id = ?`).all(siteId) as { user_id: string }[];
  return rows.map(r => r.user_id);
}

export function setSiteUsers(siteId: string, userIds: string[]): void {
  const db = getDb();
  const deleteStmt = db.prepare(`DELETE FROM site_users WHERE site_id = ?`);
  const insertStmt = db.prepare(`INSERT INTO site_users (id, site_id, user_id) VALUES (?, ?, ?)`);

  runTransaction(db, () => {
    deleteStmt.run(siteId);
    for (const uId of userIds) {
      insertStmt.run(`su-${crypto.randomUUID()}`, siteId, uId);
    }
  });
}
