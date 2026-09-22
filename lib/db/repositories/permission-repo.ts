import { getDb, runTransaction } from '../index';
import {
  PageId,
  ActionId,
  RoleScopeType,
  OverrideEffect,
  PermissionDefinition,
  STANDARD_PERMISSION_DEFINITIONS
} from '../../permissions/registry';

export interface RolePermissionRow {
  id: string;
  role: string;
  permission_id: string;
  scope_type: RoleScopeType;
  site_id: string | null;
  created_at: string;
  // Joined fields if available
  page_id?: PageId;
  action_id?: ActionId;
  display_name?: string;
  is_site_scoped?: number;
}

export interface UserPermissionOverrideRow {
  id: string;
  user_id: string;
  permission_id: string;
  site_id: string | null;
  effect: OverrideEffect;
  granted_by: string;
  created_at: string;
  updated_at: string;
  // Joined fields if available
  page_id?: PageId;
  action_id?: ActionId;
  display_name?: string;
}

export class PermissionRepository {
  // ==========================================================================
  // 1. PERMISSION DEFINITIONS
  // ==========================================================================

  static createPermissionDefinition(def: PermissionDefinition): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO permission_definitions (id, page_id, action_id, display_name, description, is_site_scoped, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(def.id, def.page_id, def.action_id, def.display_name, def.description, def.is_site_scoped ? 1 : 0);
  }

  static getPermissionDefinition(id: string): PermissionDefinition | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT id, page_id, action_id, display_name, description, is_site_scoped
      FROM permission_definitions
      WHERE id = ?
    `).get(id) as PermissionDefinition | undefined;
    return row || null;
  }

  static getPermissionDefinitionByPageAction(pageId: string, actionId: string): PermissionDefinition | null {
    const db = getDb();
    let row = db.prepare(`
      SELECT id, page_id, action_id, display_name, description, is_site_scoped
      FROM permission_definitions
      WHERE page_id = ? AND action_id = ?
    `).get(pageId, actionId) as PermissionDefinition | undefined;

    if (!row) {
      const count = (db.prepare('SELECT COUNT(*) as cnt FROM permission_definitions').get() as { cnt: number }).cnt;
      if (count === 0) {
        PermissionRepository.seedStandardDefinitions();
        row = db.prepare(`
          SELECT id, page_id, action_id, display_name, description, is_site_scoped
          FROM permission_definitions
          WHERE page_id = ? AND action_id = ?
        `).get(pageId, actionId) as PermissionDefinition | undefined;
      }
    }

    return row || null;
  }

  static listPermissionDefinitions(): PermissionDefinition[] {
    const db = getDb();
    let rows = db.prepare(`
      SELECT id, page_id, action_id, display_name, description, is_site_scoped
      FROM permission_definitions
      ORDER BY page_id ASC, action_id ASC
    `).all() as PermissionDefinition[];

    if (rows.length === 0) {
      PermissionRepository.seedStandardDefinitions();
      rows = db.prepare(`
        SELECT id, page_id, action_id, display_name, description, is_site_scoped
        FROM permission_definitions
        ORDER BY page_id ASC, action_id ASC
      `).all() as PermissionDefinition[];
    }

    return rows;
  }

  static seedStandardDefinitions(): number {
    const db = getDb();
    let seeded = 0;
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO permission_definitions (id, page_id, action_id, display_name, description, is_site_scoped, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const def of STANDARD_PERMISSION_DEFINITIONS) {
      const result = insertStmt.run(def.id, def.page_id, def.action_id, def.display_name, def.description, def.is_site_scoped ? 1 : 0);
      if (result.changes > 0) seeded++;
    }
    return seeded;
  }

  // ==========================================================================
  // 2. ROLE BASELINE PERMISSIONS
  // ==========================================================================

  static setRolePermission(params: {
    role: string;
    permissionId: string;
    scopeType: RoleScopeType;
    siteId?: string | null;
  }): string {
    const db = getDb();
    const id = `rp-${params.role.toLowerCase()}-${params.permissionId}-${params.scopeType.toLowerCase()}${params.siteId ? '-' + params.siteId : ''}`;
    const normalizedSiteId = params.scopeType === 'SPECIFIC_SITE' ? (params.siteId || null) : null;

    if (params.scopeType === 'SPECIFIC_SITE' && !normalizedSiteId) {
      throw new Error("SPECIFIC_SITE scope_type requires a valid site_id");
    }
    if (params.scopeType !== 'SPECIFIC_SITE' && normalizedSiteId) {
      throw new Error(`${params.scopeType} scope_type cannot have a site_id`);
    }

    return runTransaction(db, () => {
      db.prepare(`
        INSERT INTO role_permissions (id, role, permission_id, scope_type, site_id, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT DO UPDATE SET created_at = datetime('now')
      `).run(id, params.role, params.permissionId, params.scopeType, normalizedSiteId);

      // Atomically increment permission_version for all users assigned to this role
      db.prepare(`UPDATE users SET permission_version = permission_version + 1 WHERE role = ?`).run(params.role);

      return id;
    });
  }

  static removeRolePermission(params: {
    role: string;
    permissionId: string;
    scopeType?: RoleScopeType;
    siteId?: string | null;
  }): boolean {
    const db = getDb();
    let query = 'DELETE FROM role_permissions WHERE role = ? AND permission_id = ?';
    const queryParams: any[] = [params.role, params.permissionId];

    if (params.scopeType) {
      query += ' AND scope_type = ?';
      queryParams.push(params.scopeType);
    }
    if (params.siteId !== undefined) {
      if (params.siteId === null) {
        query += ' AND site_id IS NULL';
      } else {
        query += ' AND site_id = ?';
        queryParams.push(params.siteId);
      }
    }

    return runTransaction(db, () => {
      const result = db.prepare(query).run(...queryParams);
      if (result.changes > 0) {
        // Atomically increment permission_version for all users assigned to this role
        db.prepare(`UPDATE users SET permission_version = permission_version + 1 WHERE role = ?`).run(params.role);
        return true;
      }
      return false;
    });
  }

  static getRolePermissions(role: string, permissionId?: string): RolePermissionRow[] {
    const db = getDb();
    if (permissionId) {
      return db.prepare(`
        SELECT rp.id, rp.role, rp.permission_id, rp.scope_type, rp.site_id, rp.created_at,
               pd.page_id, pd.action_id, pd.display_name, pd.is_site_scoped
        FROM role_permissions rp
        JOIN permission_definitions pd ON rp.permission_id = pd.id
        WHERE rp.role = ? AND rp.permission_id = ?
      `).all(role, permissionId) as RolePermissionRow[];
    }

    return db.prepare(`
      SELECT rp.id, rp.role, rp.permission_id, rp.scope_type, rp.site_id, rp.created_at,
             pd.page_id, pd.action_id, pd.display_name, pd.is_site_scoped
      FROM role_permissions rp
      JOIN permission_definitions pd ON rp.permission_id = pd.id
      WHERE rp.role = ?
    `).all(role) as RolePermissionRow[];
  }

  // ==========================================================================
  // 3. USER PERMISSION OVERRIDES (With permission_version foundation)
  // ==========================================================================

  static setUserOverride(params: {
    userId: string;
    permissionId: string;
    siteId?: string | null;
    effect: OverrideEffect;
    grantedBy: string;
  }): string {
    const db = getDb();
    const normalizedSiteId = params.siteId || null;
    const id = `upo-${params.userId}-${params.permissionId}${normalizedSiteId ? '-' + normalizedSiteId : '-global'}`;

    return runTransaction(db, () => {
      // 1. Delete existing override for same user, permission, and site
      if (normalizedSiteId === null) {
        db.prepare(`
          DELETE FROM user_permission_overrides
          WHERE user_id = ? AND permission_id = ? AND site_id IS NULL
        `).run(params.userId, params.permissionId);
      } else {
        db.prepare(`
          DELETE FROM user_permission_overrides
          WHERE user_id = ? AND permission_id = ? AND site_id = ?
        `).run(params.userId, params.permissionId, normalizedSiteId);
      }

      // 2. Insert new override
      db.prepare(`
        INSERT INTO user_permission_overrides (
          id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(id, params.userId, params.permissionId, normalizedSiteId, params.effect, params.grantedBy);

      // 3. Atomically increment permission_version on users table
      db.prepare(`
        UPDATE users SET permission_version = permission_version + 1 WHERE id = ?
      `).run(params.userId);

      return id;
    });
  }

  static removeUserOverride(userId: string, permissionId: string, siteId?: string | null): boolean {
    const db = getDb();
    const normalizedSiteId = siteId || null;

    return runTransaction(db, () => {
      let result;
      if (normalizedSiteId === null) {
        result = db.prepare(`
          DELETE FROM user_permission_overrides
          WHERE user_id = ? AND permission_id = ? AND site_id IS NULL
        `).run(userId, permissionId);
      } else {
        result = db.prepare(`
          DELETE FROM user_permission_overrides
          WHERE user_id = ? AND permission_id = ? AND site_id = ?
        `).run(userId, permissionId, normalizedSiteId);
      }

      if (result.changes > 0) {
        // Atomically increment permission_version on users table
        db.prepare(`
          UPDATE users SET permission_version = permission_version + 1 WHERE id = ?
        `).run(userId);
        return true;
      }
      return false;
    });
  }

  static setUserOverridesBatch(params: {
    userId: string;
    changes: Array<{ permissionId: string; effect: 'ALLOW' | 'DENY' | 'RESET'; siteId?: string | null }>;
    grantedBy: string;
  }): { appliedCount: number; newVersion: number } {
    const db = getDb();
    return runTransaction(db, () => {
      let applied = 0;
      for (const change of params.changes) {
        if (!change.permissionId) continue;
        const normalizedSiteId = change.siteId && change.siteId.trim() !== '' ? change.siteId.trim() : null;

        // 1. Delete existing override
        if (normalizedSiteId === null) {
          db.prepare(`
            DELETE FROM user_permission_overrides
            WHERE user_id = ? AND permission_id = ? AND site_id IS NULL
          `).run(params.userId, change.permissionId);
        } else {
          db.prepare(`
            DELETE FROM user_permission_overrides
            WHERE user_id = ? AND permission_id = ? AND site_id = ?
          `).run(params.userId, change.permissionId, normalizedSiteId);
        }

        // 2. Insert new override if ALLOW or DENY
        if (change.effect === 'ALLOW' || change.effect === 'DENY') {
          const id = `upo-${params.userId}-${change.permissionId}${normalizedSiteId ? '-' + normalizedSiteId : '-global'}`;
          db.prepare(`
            INSERT INTO user_permission_overrides (
              id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(id, params.userId, change.permissionId, normalizedSiteId, change.effect, params.grantedBy);
        }
        applied++;
      }

      // 3. Atomically increment permission_version EXACTLY ONCE for the entire batch
      db.prepare(`
        UPDATE users SET permission_version = permission_version + 1 WHERE id = ?
      `).run(params.userId);

      const row = db.prepare('SELECT permission_version FROM users WHERE id = ?').get(params.userId) as { permission_version: number };
      const newVersion = row ? row.permission_version : 1;

      return { appliedCount: applied, newVersion };
    });
  }

  static getUserOverrides(userId: string): UserPermissionOverrideRow[] {
    const db = getDb();
    return db.prepare(`
      SELECT upo.id, upo.user_id, upo.permission_id, upo.site_id, upo.effect,
             upo.granted_by, upo.created_at, upo.updated_at,
             pd.page_id, pd.action_id, pd.display_name
      FROM user_permission_overrides upo
      JOIN permission_definitions pd ON upo.permission_id = pd.id
      WHERE upo.user_id = ?
    `).all(userId) as UserPermissionOverrideRow[];
  }

  static getUserOverride(userId: string, permissionId: string, siteId?: string | null): UserPermissionOverrideRow | null {
    const db = getDb();
    const normalizedSiteId = siteId || null;
    let row: UserPermissionOverrideRow | undefined;

    if (normalizedSiteId === null) {
      row = db.prepare(`
        SELECT upo.id, upo.user_id, upo.permission_id, upo.site_id, upo.effect,
               upo.granted_by, upo.created_at, upo.updated_at,
               pd.page_id, pd.action_id, pd.display_name
        FROM user_permission_overrides upo
        JOIN permission_definitions pd ON upo.permission_id = pd.id
        WHERE upo.user_id = ? AND upo.permission_id = ? AND upo.site_id IS NULL
      `).get(userId, permissionId) as UserPermissionOverrideRow | undefined;
    } else {
      row = db.prepare(`
        SELECT upo.id, upo.user_id, upo.permission_id, upo.site_id, upo.effect,
               upo.granted_by, upo.created_at, upo.updated_at,
               pd.page_id, pd.action_id, pd.display_name
        FROM user_permission_overrides upo
        JOIN permission_definitions pd ON upo.permission_id = pd.id
        WHERE upo.user_id = ? AND upo.permission_id = ? AND upo.site_id = ?
      `).get(userId, permissionId, normalizedSiteId) as UserPermissionOverrideRow | undefined;
    }

    return row || null;
  }

  // ==========================================================================
  // 4. PERMISSION VERSION MANAGEMENT
  // ==========================================================================

  static getPermissionVersion(userId: string): number {
    const db = getDb();
    const row = db.prepare('SELECT permission_version FROM users WHERE id = ?').get(userId) as { permission_version: number } | undefined;
    return row?.permission_version ?? 1;
  }

  static incrementPermissionVersion(userId: string): number {
    const db = getDb();
    db.prepare('UPDATE users SET permission_version = permission_version + 1 WHERE id = ?').run(userId);
    return this.getPermissionVersion(userId);
  }

  // ==========================================================================
  // 5. CANONICAL SITE ASSIGNMENT SOURCE (site_users table)
  // ==========================================================================

  static getUserAssignedSiteIds(userId: string): string[] {
    const db = getDb();
    const rows = db.prepare('SELECT site_id FROM site_users WHERE user_id = ?').all(userId) as { site_id: string }[];
    return rows.map(r => r.site_id);
  }

  static isPrimeSiteRestricted(userId: string): boolean {
    const db = getDb();
    const assignedCount = (db.prepare('SELECT COUNT(*) as cnt FROM site_users WHERE user_id = ?').get(userId) as { cnt: number }).cnt;
    if (assignedCount > 0) return true;
    try {
      const auditCount = (db.prepare(`
        SELECT COUNT(*) as cnt FROM audit_logs 
        WHERE action = 'SITE_ACCESS_CHANGED' 
          AND (user_id = ? OR entity_id = ?)
      `).get(userId, userId) as { cnt: number }).cnt;
      return auditCount > 0;
    } catch {
      return false;
    }
  }

  static isUserAssignedToSite(userId: string, siteId: string): boolean {
    const db = getDb();
    const row = db.prepare('SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?').get(userId, siteId);
    return Boolean(row);
  }

  static assignUserToSite(userId: string, siteId: string): void {
    const db = getDb();
    runTransaction(db, () => {
      db.prepare(`
        INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(`su-${crypto.randomUUID()}`, siteId, userId);

      db.prepare(`
        UPDATE users SET permission_version = permission_version + 1 WHERE id = ?
      `).run(userId);
    });
  }

  static removeUserFromSite(userId: string, siteId: string): boolean {
    const db = getDb();
    return runTransaction(db, () => {
      const result = db.prepare(`DELETE FROM site_users WHERE user_id = ? AND site_id = ?`).run(userId, siteId);
      if (result.changes > 0) {
        db.prepare(`
          UPDATE users SET permission_version = permission_version + 1 WHERE id = ?
        `).run(userId);
        return true;
      }
      return false;
    });
  }

  static setUserSites(userId: string, siteIds: string[]): string[] {
    const db = getDb();
    return runTransaction(db, () => {
      db.prepare('DELETE FROM site_users WHERE user_id = ?').run(userId);
      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `);
      for (const siteId of siteIds) {
        if (siteId && siteId.trim()) {
          insertStmt.run(`su-${crypto.randomUUID()}`, siteId.trim(), userId);
        }
      }
      db.prepare(`
        UPDATE users SET permission_version = permission_version + 1 WHERE id = ?
      `).run(userId);
      const rows = db.prepare('SELECT site_id FROM site_users WHERE user_id = ?').all(userId) as { site_id: string }[];
      return rows.map(r => r.site_id);
    });
  }
}
