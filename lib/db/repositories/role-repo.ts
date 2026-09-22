import { getDb, runTransaction } from '../index';
import crypto from 'crypto';
import { 
  registerArchivedEntity, 
  registerRecycledEntity, 
  removeLifecycleRecord, 
  getLifecycleRecord 
} from './global-lifecycle-repo';
import { logAuditInTransaction } from '@/lib/audit/logger';

export interface CategoryRecord {
  id: string;
  name: string;
  sort_order: number;
  is_active: number;
  lifecycle_state?: string | null;
  role_count?: number;
  active_role_count?: number;
  inactive_role_count?: number;
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
  lifecycle_state?: string | null;
  attendance_count?: number;
  total_worker_days?: number;
  total_cost_paise?: number;
  sites_used_count?: number;
  site_override_count?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Lifecycle-aware query for categories.
 * Strictly excludes ARCHIVED and RECYCLE_BIN entities from operational results.
 */
export function getAllCategories(includeInactive = false): CategoryRecord[] {
  const db = getDb();
  let query = `
    SELECT 
      c.id,
      c.name,
      c.sort_order,
      c.is_active,
      slr.state as lifecycle_state,
      (SELECT COUNT(*) FROM work_roles wr
       LEFT JOIN system_lifecycle_records slr_r ON slr_r.entity_type = 'WORK_ROLE' AND slr_r.entity_id = wr.id
       WHERE wr.category_id = c.id AND slr_r.state IS NULL) as role_count,
      (SELECT COUNT(*) FROM work_roles wr
       LEFT JOIN system_lifecycle_records slr_r ON slr_r.entity_type = 'WORK_ROLE' AND slr_r.entity_id = wr.id
       WHERE wr.category_id = c.id AND wr.is_active = 1 AND slr_r.state IS NULL) as active_role_count,
      (SELECT COUNT(*) FROM work_roles wr
       LEFT JOIN system_lifecycle_records slr_r ON slr_r.entity_type = 'WORK_ROLE' AND slr_r.entity_id = wr.id
       WHERE wr.category_id = c.id AND wr.is_active = 0 AND slr_r.state IS NULL) as inactive_role_count,
      c.created_at,
      c.updated_at
    FROM work_categories c
    LEFT JOIN system_lifecycle_records slr 
      ON slr.entity_type = 'WORK_CATEGORY' AND slr.entity_id = c.id
    WHERE slr.state IS NULL
  `;

  if (!includeInactive) {
    query += ` AND c.is_active = 1`;
  }

  query += ` ORDER BY c.sort_order ASC, c.name ASC`;
  return db.prepare(query).all() as CategoryRecord[];
}

/**
 * Gets a single category by ID, including its current lifecycle state.
 */
export function getCategoryById(id: string): CategoryRecord | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT 
      c.*,
      slr.state as lifecycle_state,
      (SELECT COUNT(*) FROM work_roles wr
       LEFT JOIN system_lifecycle_records slr_r ON slr_r.entity_type = 'WORK_ROLE' AND slr_r.entity_id = wr.id
       WHERE wr.category_id = c.id AND slr_r.state IS NULL) as role_count,
      (SELECT COUNT(*) FROM work_roles wr
       LEFT JOIN system_lifecycle_records slr_r ON slr_r.entity_type = 'WORK_ROLE' AND slr_r.entity_id = wr.id
       WHERE wr.category_id = c.id AND wr.is_active = 1 AND slr_r.state IS NULL) as active_role_count,
      (SELECT COUNT(*) FROM work_roles wr
       LEFT JOIN system_lifecycle_records slr_r ON slr_r.entity_type = 'WORK_ROLE' AND slr_r.entity_id = wr.id
       WHERE wr.category_id = c.id AND wr.is_active = 0 AND slr_r.state IS NULL) as inactive_role_count
    FROM work_categories c
    LEFT JOIN system_lifecycle_records slr 
      ON slr.entity_type = 'WORK_CATEGORY' AND slr.entity_id = c.id
    WHERE c.id = ?
  `).get(id) as CategoryRecord | undefined;
  return row || null;
}

/**
 * Lifecycle-aware query for roles.
 * Operational queries strictly exclude ARCHIVED and RECYCLE_BIN entities (both role and parent category).
 */
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
      slr.state as lifecycle_state,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.role_id = r.id) as attendance_count,
      (SELECT COALESCE(SUM(ar.worker_days), 0) FROM attendance_records ar WHERE ar.role_id = r.id) as total_worker_days,
      (SELECT COALESCE(SUM(ar.total_cost_paise), 0) FROM attendance_records ar WHERE ar.role_id = r.id) as total_cost_paise,
      (SELECT COUNT(DISTINCT ar.site_id) FROM attendance_records ar WHERE ar.role_id = r.id) as sites_used_count,
      (SELECT COUNT(*) FROM site_role_rates srr2 WHERE srr2.role_id = r.id) as site_override_count,
      r.created_at,
      r.updated_at
    FROM work_roles r
    JOIN work_categories c ON r.category_id = c.id
    LEFT JOIN site_role_rates srr ON (srr.role_id = r.id AND srr.site_id = ?)
    LEFT JOIN system_lifecycle_records slr 
      ON slr.entity_type = 'WORK_ROLE' AND slr.entity_id = r.id
    LEFT JOIN system_lifecycle_records slr_c 
      ON slr_c.entity_type = 'WORK_CATEGORY' AND slr_c.entity_id = c.id
    WHERE slr.state IS NULL AND slr_c.state IS NULL
  `;

  if (!includeInactive) {
    query += ` AND r.is_active = 1 AND c.is_active = 1`;
  }

  query += ` ORDER BY c.sort_order ASC, r.sort_order ASC, r.name ASC`;
  return db.prepare(query).all(siteId || null) as RoleRecord[];
}

/**
 * Gets a single role by ID, including its category name and current lifecycle state.
 */
export function getRoleById(id: string, siteId?: string): RoleRecord | null {
  const db = getDb();
  const row = db.prepare(`
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
      slr.state as lifecycle_state,
      (SELECT COUNT(*) FROM attendance_records ar WHERE ar.role_id = r.id) as attendance_count,
      (SELECT COALESCE(SUM(ar.worker_days), 0) FROM attendance_records ar WHERE ar.role_id = r.id) as total_worker_days,
      (SELECT COALESCE(SUM(ar.total_cost_paise), 0) FROM attendance_records ar WHERE ar.role_id = r.id) as total_cost_paise,
      (SELECT COUNT(DISTINCT ar.site_id) FROM attendance_records ar WHERE ar.role_id = r.id) as sites_used_count,
      (SELECT COUNT(*) FROM site_role_rates srr2 WHERE srr2.role_id = r.id) as site_override_count,
      r.created_at,
      r.updated_at
    FROM work_roles r
    JOIN work_categories c ON r.category_id = c.id
    LEFT JOIN site_role_rates srr ON (srr.role_id = r.id AND srr.site_id = ?)
    LEFT JOIN system_lifecycle_records slr 
      ON slr.entity_type = 'WORK_ROLE' AND slr.entity_id = r.id
    WHERE r.id = ?
  `).get(siteId || null, id) as RoleRecord | undefined;
  return row || null;
}

/**
 * Checks whether a category name already exists (case-insensitive).
 */
export function checkCategoryNameExists(name: string, excludeId?: string): boolean {
  const db = getDb();
  let query = `SELECT COUNT(*) as c FROM work_categories WHERE LOWER(name) = LOWER(?)`;
  const params: unknown[] = [name.trim()];
  if (excludeId) {
    query += ` AND id != ?`;
    params.push(excludeId);
  }
  const row = db.prepare(query).get(...params) as { c: number };
  return row.c > 0;
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

/**
 * Atomically toggles category active status in-place.
 */
export function toggleCategoryActive(id: string, isActive: boolean, userId?: string | null): void {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) throw new Error('Category not found');

  if (existing.lifecycle_state) {
    throw new Error(`Cannot toggle status of ${existing.lifecycle_state.toLowerCase()} category. Please restore it first.`);
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_categories SET is_active = ?, updated_at = datetime('now') WHERE id = ?
    `).run(isActive ? 1 : 0, id);

    logAuditInTransaction(db, {
      entityType: 'CATEGORY',
      entityId: id,
      action: isActive ? 'CATEGORY_ACTIVATED' : 'CATEGORY_DEACTIVATED',
      userId: userId || null,
      beforeState: { is_active: existing.is_active },
      afterState: { is_active: isActive ? 1 : 0 },
    });
  });
}

/**
 * Atomically archives a category.
 */
export function archiveCategory(id: string, userId?: string | null): void {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) throw new Error('Category not found');

  if (existing.lifecycle_state === 'ARCHIVED') {
    return; // Idempotent
  }
  if (existing.lifecycle_state === 'RECYCLE_BIN') {
    throw new Error('Category is currently in the Recycle Bin. Please restore it before archiving.');
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    registerArchivedEntity({
      entityType: 'WORK_CATEGORY',
      entityId: id,
      entityName: existing.name,
      sourceModule: 'Categories',
      sourceRoute: '/setup/categories',
      restoreDestination: '/setup/categories',
      userId: userId || null,
    });

    logAuditInTransaction(db, {
      entityType: 'CATEGORY',
      entityId: id,
      action: 'CATEGORY_ARCHIVED',
      userId: userId || null,
      beforeState: { is_active: existing.is_active, lifecycle_state: existing.lifecycle_state },
      afterState: { state: 'ARCHIVED', is_active: 0 },
    });
  });
}

/**
 * Atomically moves a category to the Global Recycle Bin.
 */
export function recycleCategory(id: string, userId?: string | null): void {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) throw new Error('Category not found');

  if (existing.lifecycle_state === 'RECYCLE_BIN') {
    return; // Idempotent
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    registerRecycledEntity({
      entityType: 'WORK_CATEGORY',
      entityId: id,
      entityName: existing.name,
      sourceModule: 'Categories',
      sourceRoute: '/setup/categories',
      restoreDestination: '/setup/categories',
      userId: userId || null,
    });

    logAuditInTransaction(db, {
      entityType: 'CATEGORY',
      entityId: id,
      action: 'CATEGORY_DELETED_TO_RECYCLE_BIN',
      userId: userId || null,
      beforeState: { is_active: existing.is_active, lifecycle_state: existing.lifecycle_state },
      afterState: { state: 'RECYCLE_BIN', is_active: 0 },
    });
  });
}

/**
 * Atomically restores a category from Archive or Recycle Bin to ACTIVE status.
 */
export function restoreCategory(id: string, userId?: string | null): void {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) throw new Error('Category not found');

  if (!existing.lifecycle_state && existing.is_active === 1) {
    return; // Already active
  }

  const action = existing.lifecycle_state === 'RECYCLE_BIN'
    ? 'CATEGORY_RESTORED_FROM_RECYCLE_BIN'
    : 'CATEGORY_RESTORED';

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_categories SET is_active = 1, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    removeLifecycleRecord('WORK_CATEGORY', id);

    logAuditInTransaction(db, {
      entityType: 'CATEGORY',
      entityId: id,
      action,
      userId: userId || null,
      beforeState: { is_active: existing.is_active, lifecycle_state: existing.lifecycle_state },
      afterState: { state: 'ACTIVE', is_active: 1 },
    });
  });
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

export function updateRole(id: string, name: string, defaultRatePaise: number, sortOrder?: number, categoryId?: string): void {
  const db = getDb();
  if (categoryId) {
    if (sortOrder !== undefined) {
      db.prepare(`
        UPDATE work_roles SET category_id = ?, name = ?, default_rate_paise = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?
      `).run(categoryId, name.trim(), defaultRatePaise, sortOrder, id);
    } else {
      db.prepare(`
        UPDATE work_roles SET category_id = ?, name = ?, default_rate_paise = ?, updated_at = datetime('now') WHERE id = ?
      `).run(categoryId, name.trim(), defaultRatePaise, id);
    }
  } else {
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
}

/**
 * Atomically toggles role active status in-place.
 */
export function toggleRoleActive(id: string, isActive: boolean, userId?: string | null): void {
  const db = getDb();
  const existing = getRoleById(id);
  if (!existing) throw new Error('Role not found');

  if (existing.lifecycle_state) {
    throw new Error(`Cannot toggle status of ${existing.lifecycle_state.toLowerCase()} role. Please restore it first.`);
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_roles SET is_active = ?, updated_at = datetime('now') WHERE id = ?
    `).run(isActive ? 1 : 0, id);

    logAuditInTransaction(db, {
      entityType: 'ROLE',
      entityId: id,
      action: isActive ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED',
      userId: userId || null,
      beforeState: { is_active: existing.is_active },
      afterState: { is_active: isActive ? 1 : 0 },
    });
  });
}

/**
 * Atomically archives a role.
 */
export function archiveRole(id: string, userId?: string | null): void {
  const db = getDb();
  const existing = getRoleById(id);
  if (!existing) throw new Error('Role not found');

  if (existing.lifecycle_state === 'ARCHIVED') {
    return; // Idempotent
  }
  if (existing.lifecycle_state === 'RECYCLE_BIN') {
    throw new Error('Role is currently in the Recycle Bin. Please restore it before archiving.');
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_roles SET is_active = 0, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    registerArchivedEntity({
      entityType: 'WORK_ROLE',
      entityId: id,
      entityName: existing.name,
      sourceModule: 'Roles',
      sourceRoute: '/setup/roles',
      restoreDestination: '/setup/roles',
      userId: userId || null,
    });

    logAuditInTransaction(db, {
      entityType: 'ROLE',
      entityId: id,
      action: 'ROLE_ARCHIVED',
      userId: userId || null,
      beforeState: { is_active: existing.is_active, lifecycle_state: existing.lifecycle_state },
      afterState: { state: 'ARCHIVED', is_active: 0 },
    });
  });
}

/**
 * Atomically moves a role to the Global Recycle Bin.
 */
export function recycleRole(id: string, userId?: string | null): void {
  const db = getDb();
  const existing = getRoleById(id);
  if (!existing) throw new Error('Role not found');

  if (existing.lifecycle_state === 'RECYCLE_BIN') {
    return; // Idempotent
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_roles SET is_active = 0, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    registerRecycledEntity({
      entityType: 'WORK_ROLE',
      entityId: id,
      entityName: existing.name,
      sourceModule: 'Roles',
      sourceRoute: '/setup/roles',
      restoreDestination: '/setup/roles',
      userId: userId || null,
    });

    logAuditInTransaction(db, {
      entityType: 'ROLE',
      entityId: id,
      action: 'ROLE_DELETED_TO_RECYCLE_BIN',
      userId: userId || null,
      beforeState: { is_active: existing.is_active, lifecycle_state: existing.lifecycle_state },
      afterState: { state: 'RECYCLE_BIN', is_active: 0 },
    });
  });
}

/**
 * Atomically restores a role from Archive or Recycle Bin to ACTIVE status.
 */
export function restoreRole(id: string, userId?: string | null): void {
  const db = getDb();
  const existing = getRoleById(id);
  if (!existing) throw new Error('Role not found');

  if (!existing.lifecycle_state && existing.is_active === 1) {
    return; // Already active
  }

  const action = existing.lifecycle_state === 'RECYCLE_BIN'
    ? 'ROLE_RESTORED_FROM_RECYCLE_BIN'
    : 'ROLE_RESTORED';

  runTransaction(db, () => {
    db.prepare(`
      UPDATE work_roles SET is_active = 1, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    removeLifecycleRecord('WORK_ROLE', id);

    logAuditInTransaction(db, {
      entityType: 'ROLE',
      entityId: id,
      action,
      userId: userId || null,
      beforeState: { is_active: existing.is_active, lifecycle_state: existing.lifecycle_state },
      afterState: { state: 'ACTIVE', is_active: 1 },
    });
  });
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

