import { getDb } from '../index';
import crypto from 'crypto';

export interface CategoryRecord {
  id: string;
  name: string;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RoleRecord {
  id: string;
  category_id: string;
  category_name?: string;
  name: string;
  default_rate_paise: number;
  site_rate_paise?: number | null;
  effective_rate_paise?: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function getAllCategories(includeInactive = false): CategoryRecord[] {
  const db = getDb();
  if (includeInactive) {
    return db.prepare(`SELECT * FROM work_categories ORDER BY sort_order ASC, name ASC`).all() as CategoryRecord[];
  }
  return db.prepare(`SELECT * FROM work_categories WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`).all() as CategoryRecord[];
}

export function getAllRoles(siteId?: string, includeInactive = false): RoleRecord[] {
  const db = getDb();
  let query = `
    SELECT 
      r.id,
      r.category_id,
      c.name as category_name,
      r.name,
      r.default_rate_paise,
      srr.rate_paise as site_rate_paise,
      COALESCE(srr.rate_paise, r.default_rate_paise) as effective_rate_paise,
      r.sort_order,
      r.is_active,
      r.created_at,
      r.updated_at
    FROM work_roles r
    JOIN work_categories c ON r.category_id = c.id
    LEFT JOIN site_role_rates srr ON (srr.role_id = r.id AND srr.site_id = ?)
  `;

  if (!includeInactive) {
    query += ` WHERE r.is_active = 1 AND c.is_active = 1`;
  }

  query += ` ORDER BY c.sort_order ASC, r.sort_order ASC, r.name ASC`;

  return db.prepare(query).all(siteId || null) as RoleRecord[];
}

export function addCategory(name: string, sortOrder = 0): string {
  const db = getDb();
  const id = `cat-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO work_categories (id, name, sort_order, is_active)
    VALUES (?, ?, ?, 1)
  `).run(id, name.trim(), sortOrder);
  return id;
}

export function updateCategory(id: string, name: string, sortOrder?: number): void {
  const db = getDb();
  if (sortOrder !== undefined) {
    db.prepare(`
      UPDATE work_categories SET name = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name.trim(), sortOrder, id);
  } else {
    db.prepare(`
      UPDATE work_categories SET name = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name.trim(), id);
  }
}

export function toggleCategoryActive(id: string, isActive: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE work_categories SET is_active = ?, updated_at = datetime('now') WHERE id = ?
  `).run(isActive ? 1 : 0, id);
}

export function addRole(categoryId: string, name: string, defaultRatePaise: number, sortOrder = 0): string {
  const db = getDb();
  const id = `role-${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO work_roles (id, category_id, name, default_rate_paise, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, categoryId, name.trim(), defaultRatePaise, sortOrder);
  return id;
}

export function updateRole(id: string, name: string, defaultRatePaise: number, sortOrder?: number): void {
  const db = getDb();
  if (sortOrder !== undefined) {
    db.prepare(`
      UPDATE work_roles SET name = ?, default_rate_paise = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name.trim(), defaultRatePaise, sortOrder, id);
  } else {
    db.prepare(`
      UPDATE work_roles SET name = ?, default_rate_paise = ?, updated_at = datetime('now') WHERE id = ?
    `).run(name.trim(), defaultRatePaise, id);
  }
}

export function toggleRoleActive(id: string, isActive: boolean): void {
  const db = getDb();
  db.prepare(`
    UPDATE work_roles SET is_active = ?, updated_at = datetime('now') WHERE id = ?
  `).run(isActive ? 1 : 0, id);
}

export function setSiteRoleRate(siteId: string, roleId: string, ratePaise: number | null): void {
  const db = getDb();
  if (ratePaise === null || ratePaise === undefined) {
    db.prepare(`DELETE FROM site_role_rates WHERE site_id = ? AND role_id = ?`).run(siteId, roleId);
  } else {
    const id = `srr-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO site_role_rates (id, site_id, role_id, rate_paise, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(site_id, role_id) DO UPDATE SET
        rate_paise = excluded.rate_paise,
        updated_at = datetime('now')
    `).run(id, siteId, roleId, ratePaise);
  }
}
