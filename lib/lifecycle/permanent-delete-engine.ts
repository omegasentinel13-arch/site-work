import { getDb, runTransaction } from '@/lib/db';
import { logAuditInTransaction } from '@/lib/audit/logger';
import { evaluateCategoryDependencies } from '@/lib/lifecycle/category-dependency';
import { evaluateRoleDependencies } from '@/lib/lifecycle/role-dependency';
import { evaluateSiteDependencies } from '@/lib/lifecycle/site-dependency';

export class PermanentDeleteConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeleteConflictError';
  }
}

export class PermanentDeleteNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeleteNotFoundError';
  }
}

export interface PermanentDeleteResult {
  success: boolean;
  entityType: string;
  entityId: string;
  entityName: string;
  message: string;
}

export interface PermanentDeleteOptions {
  _simulateAuditFailure?: boolean;
}

/**
 * Executes an atomic, transactional permanent deletion for an entity
 * in the Global Recycle Bin.
 *
 * Required Sequence (Atomic Transaction):
 * 1. Verify entity exists in primary table.
 * 2. Verify lifecycle record exists in system_lifecycle_records.
 * 3. Verify lifecycle state = 'RECYCLE_BIN'. Reject ACTIVE, INACTIVE, ARCHIVED.
 * 4. Re-evaluate dependencies (zero trust of prior checks).
 * 5. Re-check protected historical records (attendance, finance).
 * 6. Delete primary entity row (and clean non-historical operational rows).
 * 7. Delete system_lifecycle_records row.
 * 8. Write distinct permanent-deletion audit log via logAuditInTransaction.
 * 9. Commit transaction. If any step fails, roll back completely.
 */
export function executePermanentDelete(
  rawEntityType: string,
  entityId: string,
  adminUserId: string,
  deletionReason?: string,
  options?: PermanentDeleteOptions
): PermanentDeleteResult {
  const db = getDb();
  const normalizedType = normalizeEntityType(rawEntityType);

  return runTransaction(db, () => {
    // -------------------------------------------------------------------------
    // 1. Verify primary entity exists & capture snapshot
    // -------------------------------------------------------------------------
    let entityName = '';
    let beforeState: Record<string, unknown> = {};

    if (normalizedType === 'WORK_ROLE') {
      const role = db.prepare(`
        SELECT id, category_id, name, default_rate_paise, sort_order, is_active
        FROM work_roles WHERE id = ?
      `).get(entityId) as {
        id: string;
        category_id: string;
        name: string;
        default_rate_paise: number;
        sort_order: number;
        is_active: number;
      } | undefined;

      if (!role) {
        throw new PermanentDeleteNotFoundError(`Work role '${entityId}' not found or already permanently deleted.`);
      }
      entityName = role.name;
      beforeState = {
        id: role.id,
        name: role.name,
        category_id: role.category_id,
        default_rate_paise: role.default_rate_paise,
        is_active: role.is_active,
        source_module: 'Roles',
        source_route: '/setup/roles',
      };
    } else if (normalizedType === 'WORK_CATEGORY') {
      const cat = db.prepare(`
        SELECT id, name, sort_order, is_active
        FROM work_categories WHERE id = ?
      `).get(entityId) as {
        id: string;
        name: string;
        sort_order: number;
        is_active: number;
      } | undefined;

      if (!cat) {
        throw new PermanentDeleteNotFoundError(`Category '${entityId}' not found or already permanently deleted.`);
      }
      entityName = cat.name;
      beforeState = {
        id: cat.id,
        name: cat.name,
        is_active: cat.is_active,
        source_module: 'Categories',
        source_route: '/setup/categories',
      };
    } else if (normalizedType === 'SITE') {
      const site = db.prepare(`
        SELECT id, name, code, location, is_archived
        FROM sites WHERE id = ?
      `).get(entityId) as {
        id: string;
        name: string;
        code: string | null;
        location: string | null;
        is_archived: number;
      } | undefined;

      if (!site) {
        throw new PermanentDeleteNotFoundError(`Site '${entityId}' not found or already permanently deleted.`);
      }
      entityName = site.name;
      beforeState = {
        id: site.id,
        name: site.name,
        code: site.code,
        location: site.location,
        is_archived: site.is_archived,
        source_module: 'Sites',
        source_route: '/setup/sites',
      };
    } else {
      throw new PermanentDeleteConflictError(`Unsupported entity type for permanent deletion: '${rawEntityType}'`);
    }

    // -------------------------------------------------------------------------
    // 2 & 3. Verify lifecycle record & ensure state is RECYCLE_BIN
    // -------------------------------------------------------------------------
    const lfc = db.prepare(`
      SELECT * FROM system_lifecycle_records
      WHERE entity_type = ? AND entity_id = ?
    `).get(normalizedType, entityId) as {
      id: string;
      state: string;
      keep_permanently: number;
      source_module: string;
      source_route: string;
    } | undefined;

    if (!lfc) {
      throw new PermanentDeleteConflictError(
        `Cannot permanently delete: entity '${entityName}' is not in the Recycle Bin. It must be moved to the Recycle Bin before permanent deletion.`
      );
    }

    if (lfc.state !== 'RECYCLE_BIN') {
      throw new PermanentDeleteConflictError(
        `Cannot permanently delete: entity '${entityName}' is currently in state '${lfc.state}'. Permanent deletion is strictly restricted to items in RECYCLE_BIN.`
      );
    }

    // -------------------------------------------------------------------------
    // 4 & 5. Re-evaluate dependencies & protected historical records
    // -------------------------------------------------------------------------
    if (normalizedType === 'WORK_CATEGORY') {
      const depReport = evaluateCategoryDependencies(entityId);
      if (!depReport.canDelete) {
        throw new PermanentDeleteConflictError(
          depReport.blockingReason || 'Cannot permanently delete category: active dependencies exist.'
        );
      }
    } else if (normalizedType === 'WORK_ROLE') {
      const depReport = evaluateRoleDependencies(entityId);
      if (!depReport.canDelete) {
        throw new PermanentDeleteConflictError(
          depReport.blockingReason || 'Cannot permanently delete role: protected history or overrides exist.'
        );
      }
    } else if (normalizedType === 'SITE') {
      const depReport = evaluateSiteDependencies(entityId);
      if (!depReport.canDelete) {
        throw new PermanentDeleteConflictError(
          depReport.blockingReason || 'Cannot permanently delete site: operational history exists.'
        );
      }
    }

    // -------------------------------------------------------------------------
    // 6. Delete primary entity row & safe operational attachments
    // -------------------------------------------------------------------------
    if (normalizedType === 'WORK_ROLE') {
      db.prepare('DELETE FROM work_roles WHERE id = ?').run(entityId);
    } else if (normalizedType === 'WORK_CATEGORY') {
      db.prepare('DELETE FROM work_categories WHERE id = ?').run(entityId);
    } else if (normalizedType === 'SITE') {
      db.prepare('DELETE FROM site_users WHERE site_id = ?').run(entityId);
      db.prepare('DELETE FROM site_role_rates WHERE site_id = ?').run(entityId);
      db.prepare('DELETE FROM supply_items WHERE site_id = ?').run(entityId);
      db.prepare('DELETE FROM sites WHERE id = ?').run(entityId);
    }

    // -------------------------------------------------------------------------
    // 7. Delete system_lifecycle_records row
    // -------------------------------------------------------------------------
    db.prepare(`
      DELETE FROM system_lifecycle_records
      WHERE entity_type = ? AND entity_id = ?
    `).run(normalizedType, entityId);

    // -------------------------------------------------------------------------
    // Simulated audit failure hook for transactional integrity testing
    // -------------------------------------------------------------------------
    if (options?._simulateAuditFailure) {
      throw new Error('FORCED_AUDIT_FAILURE_SIMULATION: Testing transactional rollback on audit failure');
    }

    // -------------------------------------------------------------------------
    // 8. Insert distinct permanent-deletion audit log atomically
    // -------------------------------------------------------------------------
    const auditAction = getPermanentDeleteAuditAction(normalizedType);
    const auditEntityType = getAuditEntityType(normalizedType);

    logAuditInTransaction(db, {
      entityType: auditEntityType,
      entityId,
      action: auditAction,
      siteId: normalizedType === 'SITE' ? entityId : null,
      userId: adminUserId,
      beforeState,
      afterState: {
        permanently_deleted: true,
        entity_name: entityName,
        source_module: lfc.source_module,
        source_route: lfc.source_route,
        deletion_reason: deletionReason || 'Admin permanent deletion',
        deleted_by: adminUserId,
        deleted_at: new Date().toISOString(),
      },
    });

    return {
      success: true,
      entityType: normalizedType,
      entityId,
      entityName,
      message: `"${entityName}" has been permanently deleted from the system.`,
    };
  });
}

function normalizeEntityType(type: string): 'WORK_ROLE' | 'WORK_CATEGORY' | 'SITE' {
  const upper = type.toUpperCase().trim();
  if (upper === 'WORK_ROLE' || upper === 'ROLE') return 'WORK_ROLE';
  if (upper === 'WORK_CATEGORY' || upper === 'CATEGORY') return 'WORK_CATEGORY';
  if (upper === 'SITE') return 'SITE';
  throw new PermanentDeleteConflictError(`Unsupported entity type: '${type}'`);
}

function getPermanentDeleteAuditAction(type: 'WORK_ROLE' | 'WORK_CATEGORY' | 'SITE') {
  switch (type) {
    case 'WORK_ROLE':
      return 'ROLE_PERMANENTLY_DELETED';
    case 'WORK_CATEGORY':
      return 'CATEGORY_PERMANENTLY_DELETED';
    case 'SITE':
      return 'SITE_PERMANENTLY_DELETED';
  }
}

function getAuditEntityType(type: 'WORK_ROLE' | 'WORK_CATEGORY' | 'SITE'): 'ROLE' | 'CATEGORY' | 'SITE' {
  switch (type) {
    case 'WORK_ROLE':
      return 'ROLE';
    case 'WORK_CATEGORY':
      return 'CATEGORY';
    case 'SITE':
      return 'SITE';
  }
}
