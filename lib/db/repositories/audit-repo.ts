import { getDb } from '../index';
import type { DatabaseSync } from 'node:sqlite';
import { redactPayload, safeParseAndRedact, RedactionContext } from '@/lib/audit/redaction';
import { isSuperiorPrime, AuthorityTier } from '@/lib/auth/authority';
import { CanAccessSession } from '@/lib/permissions/evaluator';
import { getLifecycleRecord } from './global-lifecycle-repo';

export interface AuditFilterParams {
  from?: string | null;
  to?: string | null;
  actor?: string | null;
  site?: string | null;
  entityType?: string | null;
  action?: string | null;
  search?: string | null;
  page?: number | string | null;
  pageSize?: number | string | null;
}

export interface AuditQueryContext {
  session: CanAccessSession;
  isSuperiorPrime: boolean;
  isGlobalAdmin: boolean;
  assignedSiteIds: string[];
}

export interface SafeAuditActor {
  id: string | null;
  name: string;
  role: string | null;
}

export interface SafeAuditSite {
  id: string | null;
  name: string | null;
}

export interface SafeAuditRecoveryInfo {
  isEligible: boolean;
  entityType: string;
  entityId: string;
  entityName: string;
  sourceModule: string;
  sourceRoute: string;
  restoreDestination: string;
  currentState: 'ARCHIVED' | 'RECYCLE_BIN';
  reason?: string;
}

export interface SafeAuditLogItem {
  id: string;
  timestamp: string;
  action: string;
  actionDisplay: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  actor: SafeAuditActor;
  site: SafeAuditSite | null;
  module: string;
  metadata: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  };
  visibility: 'GLOBAL' | 'SITE_SCOPED';
  recovery?: SafeAuditRecoveryInfo | null;
}

export interface AuditStats {
  totalRecorded: number;
  securityCount: number;
  systemCount: number;
}

export interface AuditListResult {
  items: SafeAuditLogItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  stats?: AuditStats;
}

interface RawAuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  site_id: string | null;
  user_id: string | null;
  before_state: string | null;
  after_state: string | null;
  created_at: string;
  user_name: string | null;
  user_full_name: string | null;
  user_role: string | null;
  user_authority_tier: string | null;
  site_name: string | null;
}

interface SuperiorPrimeUser {
  id: string;
  username: string;
  recovery_email: string | null;
}

export class AuditRepository {
  /**
   * Retrieves all users currently designated as SUPERIOR_PRIME in the database.
   */
  private static getSuperiorPrimeUsers(db: DatabaseSync): SuperiorPrimeUser[] {
    return db.prepare(`
      SELECT id, username, recovery_email 
      FROM users 
      WHERE authority_tier IN ('KING_MAKER', 'SUPERIOR_PRIME')
    `).all() as unknown as SuperiorPrimeUser[];
  }

  /**
   * Maps an entity type to a human-readable high-level module.
   */
  private static mapModule(entityType: string): string {
    switch (entityType) {
      case 'ATTENDANCE':
        return 'Workforce';
      case 'FINANCE':
        return 'Financials';
      case 'SITE':
      case 'ROLE':
      case 'CATEGORY':
      case 'RATE':
        return 'System Config';
      case 'USER':
      case 'AUTH':
      case 'SECURITY':
      case 'PERMISSION':
        return 'Security & Access';
      case 'EXPORT':
      case 'LIFECYCLE':
        return 'Governance';
      default:
        return 'Operations';
    }
  }

  /**
   * Transforms raw action code to human-readable display string.
   */
  public static formatActionDisplay(action: string): string {
    const customLabels: Record<string, string> = {
      COMPLETE_EXPORT_REQUESTED: 'Export Requested',
      COMPLETE_EXPORT_GENERATED: 'Export Generated',
      COMPLETE_EXPORT_FAILED: 'Export Failed',
      LOGIN_SUCCESS: 'Sign In Successful',
      LOGIN_FAILURE: 'Sign In Failed',
      LOGOUT: 'Sign Out',
      PASSWORD_RESET: 'Password Reset',
      PASSWORD_CHANGE: 'Password Changed',
      USERNAME_CHANGE: 'Username Changed',
      USER_CREATE: 'User Created',
      USER_DELETE: 'User Deleted',
      USER_UPDATE: 'User Updated',
      ACCOUNT_ACTIVATED: 'Account Activated',
      ACCOUNT_DEACTIVATED: 'Account Deactivated',
      RECOVERY_REQUEST: 'Recovery Link Requested',
      RECOVERY_COMPLETE: 'Recovery Completed',
      RECOVERY_EMAIL_CHANGE: 'Recovery Email Changed',
      SITE_ARCHIVED: 'Site Archived',
      SITE_RESTORED: 'Site Restored',
      SITE_DELETED_TO_RECYCLE_BIN: 'Site Moved to Recycle Bin',
      SITE_PERMANENTLY_DELETED: 'Site Permanently Deleted',
      ROLE_CREATED: 'Role Created',
      ROLE_UPDATED: 'Role Updated',
      ROLE_ACTIVATED: 'Role Activated',
      ROLE_DEACTIVATED: 'Role Deactivated',
      CATEGORY_CREATED: 'Category Created',
      CATEGORY_UPDATED: 'Category Updated',
      CATEGORY_ACTIVATED: 'Category Activated',
      CATEGORY_DEACTIVATED: 'Category Deactivated',
      PERMISSION_GRANTED: 'Permission Granted',
      PERMISSION_DENIED: 'Permission Denied',
      PERMISSION_REMOVED: 'Permission Removed',
      ROLE_PERMISSION_CHANGED: 'Role Permission Changed',
      SITE_ACCESS_CHANGED: 'Site Access Changed'
    };

    if (customLabels[action]) {
      return customLabels[action];
    }

    return action
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Derives a friendly entity name from before/after states if available.
   */
  private static extractEntityName(
    entityType: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    siteName: string | null
  ): string | null {
    if (entityType === 'SITE' && siteName) {
      return siteName;
    }
    const state = after || before;
    if (state) {
      if (typeof state.name === 'string' && state.name) return state.name;
      if (typeof state.siteName === 'string' && state.siteName) return state.siteName;
      if (typeof state.fullName === 'string' && state.fullName) return state.fullName;
      if (typeof state.username === 'string' && state.username) return state.username;
      if (typeof state.description === 'string' && state.description) return state.description;
    }
    return entityId !== 'system' && entityId !== 'unauthenticated' ? entityId : null;
  }

  /**
   * Projects a raw database audit row into a safe, redacted client structure.
   */
  private static projectSafeAuditItem(
    row: RawAuditLogRow,
    context: AuditQueryContext,
    spUsers: SuperiorPrimeUser[]
  ): SafeAuditLogItem {
    const isCallerSuperior = context.isSuperiorPrime;
    const isActorSuperior = row.user_authority_tier === 'KING_MAKER' || row.user_authority_tier === 'SUPERIOR_PRIME' || spUsers.some(sp => sp.id === row.user_id);

    // Build Superior Prime identifiers set for redaction context
    const spIdentifiers = new Set<string>();
    for (const sp of spUsers) {
      if (sp.id) spIdentifiers.add(sp.id);
      if (sp.username) spIdentifiers.add(sp.username);
      if (sp.recovery_email) spIdentifiers.add(sp.recovery_email);
    }

    const redactionCtx: RedactionContext = {
      isSuperiorPrimeCaller: isCallerSuperior,
      superiorPrimeIdentifiers: spIdentifiers,
    };

    const beforeParsed = safeParseAndRedact(row.before_state, redactionCtx);
    const afterParsed = safeParseAndRedact(row.after_state, redactionCtx);

    // Resolve Actor
    let actor: SafeAuditActor;
    if (isActorSuperior) {
      if (isCallerSuperior) {
        actor = {
          id: row.user_id,
          name: row.user_full_name || row.user_name || 'Superior Prime',
          role: row.user_role || 'ADMIN',
        };
      } else {
        // Absolute Superior Prime pseudonymization for lower authorities:
        // Strip underlying identity fields, return "System Administrator"
        actor = {
          id: null,
          name: 'System Administrator',
          role: null,
        };
      }
    } else if (row.user_id) {
      actor = {
        id: row.user_id,
        name: row.user_full_name || row.user_name || row.user_id,
        role: row.user_role || null,
      };
    } else {
      // Unauthenticated, system, or deleted user
      actor = {
        id: null,
        name: row.action.startsWith('LOGIN') ? 'Unauthenticated' : 'System',
        role: null,
      };
    }

    // Resolve Site
    const site: SafeAuditSite | null = row.site_id
      ? {
          id: row.site_id,
          name: row.site_name || row.site_id,
        }
      : null;

    // Resolve Entity Name
    let entityName = this.extractEntityName(row.entity_type, row.entity_id, beforeParsed, afterParsed, row.site_name);
    if (!isCallerSuperior && entityName && spIdentifiers.has(entityName)) {
      entityName = '[REDACTED]';
    }

    // Resolve Entity ID for non-Superior Prime
    let safeEntityId = row.entity_id;
    if (!isCallerSuperior && spIdentifiers.has(row.entity_id)) {
      safeEntityId = '[REDACTED]';
    }

    // Resolve Controlled Recovery Eligibility
    let recovery: SafeAuditRecoveryInfo | null = null;
    const canHaveRecovery = ['SITE', 'WORK_ROLE', 'ROLE', 'WORK_CATEGORY', 'CATEGORY'].includes(row.entity_type);
    if (canHaveRecovery && safeEntityId !== '[REDACTED]') {
      const lfc = getLifecycleRecord(row.entity_type, row.entity_id);
      if (lfc && (lfc.state === 'ARCHIVED' || lfc.state === 'RECYCLE_BIN')) {
        recovery = {
          isEligible: true,
          entityType: lfc.entity_type,
          entityId: row.entity_id,
          entityName: lfc.entity_name || entityName || row.entity_id,
          sourceModule: lfc.source_module,
          sourceRoute: lfc.source_route,
          restoreDestination: lfc.restore_destination,
          currentState: lfc.state,
        };
      }
    }

    return {
      id: row.id,
      timestamp: row.created_at,
      action: row.action,
      actionDisplay: this.formatActionDisplay(row.action),
      entityType: row.entity_type,
      entityId: safeEntityId,
      entityName,
      actor,
      site,
      module: this.mapModule(row.entity_type),
      metadata: {
        before: beforeParsed,
        after: afterParsed,
      },
      visibility: row.site_id ? 'SITE_SCOPED' : 'GLOBAL',
      recovery,
    };
  }

  /**
   * Queries audit logs with deterministic filtering, pagination, site-scoping,
   * and absolute Superior Prime privacy enforcement.
   */
  public static getLogs(
    params: AuditFilterParams,
    context: AuditQueryContext
  ): AuditListResult {
    const db = getDb();
    const spUsers = this.getSuperiorPrimeUsers(db);
    const spIds = spUsers.map((u) => u.id);
    const spUsernames = spUsers.map((u) => u.username.toLowerCase());

    // 1. Pagination Parameters Validation
    let page = typeof params.page === 'number' ? params.page : parseInt(String(params.page || '1'), 10);
    if (isNaN(page) || page < 1) page = 1;

    let pageSize = typeof params.pageSize === 'number' ? params.pageSize : parseInt(String(params.pageSize || '25'), 10);
    if (isNaN(pageSize) || pageSize < 1) pageSize = 25;
    if (pageSize > 50) pageSize = 50; // Hard max page size = 50

    const offset = (page - 1) * pageSize;

    // 2. Query Builder Construction
    const whereConditions: string[] = ['1=1'];
    const sqlParams: Record<string, unknown> = {};

    // 3. Superior Prime Privacy Enforcement (Correction 1)
    if (!context.isSuperiorPrime) {
      // Exclude all security/account events targeting Superior Prime
      if (spIds.length > 0) {
        const spIdPlaceholders = spIds.map((_, i) => `@spId_${i}`).join(', ');
        spIds.forEach((id, i) => {
          sqlParams[`spId_${i}`] = id;
        });

        whereConditions.push(`
          NOT (
            (a.entity_type IN ('USER', 'SECURITY', 'AUTH') AND a.entity_id IN (${spIdPlaceholders}))
            OR (a.action IN (
              'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'PASSWORD_CHANGE', 
              'PASSWORD_RESET', 'USERNAME_CHANGE', 'RECOVERY_REQUEST', 
              'RECOVERY_COMPLETE', 'RECOVERY_EMAIL_CHANGE'
            ) AND (a.user_id IN (${spIdPlaceholders}) OR a.entity_id IN (${spIdPlaceholders})))
            OR (a.entity_type = 'SECURITY' AND a.action IN ('USER_CREATE', 'USER_UPDATE', 'USER_DELETE') AND a.entity_id IN (${spIdPlaceholders}))
          )
        `);
      }

      // Check if lower authority is attempting to query or search Superior Prime directly
      if (params.actor) {
        const actorLower = params.actor.trim().toLowerCase();
        const isSpActor = spUsers.some(
          (u) =>
            (u.username && actorLower === u.username.toLowerCase()) ||
            (u.id && actorLower === u.id.toLowerCase()) ||
            (u.recovery_email && actorLower === u.recovery_email.toLowerCase())
        );
        if (isSpActor) {
          // Zero discovery side-channel: return empty result without revealing actor existence
          whereConditions.push('1=0');
        }
      }

      if (params.search) {
        const searchLower = params.search.trim().toLowerCase();
        const hasSpIdentifier = spUsers.some(
          (u) =>
            (u.username && (searchLower === u.username.toLowerCase() || searchLower.includes(u.username.toLowerCase()))) ||
            (u.id && (searchLower === u.id.toLowerCase() || searchLower.includes(u.id.toLowerCase()))) ||
            (u.recovery_email && (searchLower === u.recovery_email.toLowerCase() || searchLower.includes(u.recovery_email.toLowerCase())))
        );
        if (hasSpIdentifier) {
          whereConditions.push('1=0');
        }
      }
    }

    // 4. Site Scope Enforcement (Section 4 & 8)
    if (!context.isGlobalAdmin) {
      // Non-global admins (e.g. SITE_MANAGER or VIEWER with explicit VIEW override)
      // Can ONLY inspect assigned sites. Global events (site_id IS NULL) are forbidden.
      if (context.assignedSiteIds.length === 0) {
        whereConditions.push('1=0'); // Assigned to zero sites -> zero records
      } else {
        const assignedPlaceholders = context.assignedSiteIds.map((_, i) => `@assignedSite_${i}`).join(', ');
        context.assignedSiteIds.forEach((sId, i) => {
          sqlParams[`assignedSite_${i}`] = sId;
        });

        whereConditions.push(`a.site_id IS NOT NULL AND a.site_id IN (${assignedPlaceholders})`);

        // If caller supplied site filter, enforce that it must be one of their assigned sites
        if (params.site) {
          if (!context.assignedSiteIds.includes(params.site)) {
            whereConditions.push('1=0'); // Attempt to spoof/query unassigned site
          } else {
            whereConditions.push('a.site_id = @filterSiteId');
            sqlParams.filterSiteId = params.site;
          }
        }
      }
    } else {
      // Global admin (SUPERIOR_PRIME, CLIENT_PRIME, STANDARD_ADMIN)
      if (params.site) {
        whereConditions.push('a.site_id = @filterSiteId');
        sqlParams.filterSiteId = params.site;
      }
    }

    // Capture base scope (Superior Prime Privacy + Site Scope) for real summary stats
    const baseWhereClause = whereConditions.join(' AND ');
    const baseSqlParams = { ...sqlParams };

    // 5. Dimension Filters
    if (params.entityType && params.entityType !== 'ALL') {
      whereConditions.push('a.entity_type = @filterEntityType');
      sqlParams.filterEntityType = params.entityType.toUpperCase();
    }

    if (params.action) {
      whereConditions.push('a.action = @filterAction');
      sqlParams.filterAction = params.action.toUpperCase();
    }

    if (params.actor && whereConditions.indexOf('1=0') === -1) {
      whereConditions.push('(a.user_id = @filterActor OR u.username = @filterActor)');
      sqlParams.filterActor = params.actor.trim();
    }

    if (params.from) {
      const fromStr = params.from.includes(' ') || params.from.includes('T') ? params.from : `${params.from} 00:00:00`;
      whereConditions.push('a.created_at >= @filterFrom');
      sqlParams.filterFrom = fromStr;
    }

    if (params.to) {
      const toStr = params.to.includes(' ') || params.to.includes('T') ? params.to : `${params.to} 23:59:59`;
      whereConditions.push('a.created_at <= @filterTo');
      sqlParams.filterTo = toStr;
    }

    if (params.search && whereConditions.indexOf('1=0') === -1) {
      whereConditions.push(`(
        a.entity_id LIKE @filterSearchPattern
        OR a.action LIKE @filterSearchPattern
        OR a.entity_type LIKE @filterSearchPattern
        OR (s.name IS NOT NULL AND s.name LIKE @filterSearchPattern)
        OR (u.username IS NOT NULL AND ${context.isSuperiorPrime ? '1=1' : "(u.authority_tier NOT IN ('KING_MAKER', 'SUPERIOR_PRIME') OR u.authority_tier IS NULL)"} AND u.username LIKE @filterSearchPattern)
        OR (${context.isSuperiorPrime ? '1=0' : "'system administrator' LIKE @filterSearchPattern"} AND a.user_id IN (SELECT id FROM users WHERE authority_tier IN ('KING_MAKER', 'SUPERIOR_PRIME')))
        OR (a.before_state IS NOT NULL AND a.before_state LIKE @filterSearchPattern)
        OR (a.after_state IS NOT NULL AND a.after_state LIKE @filterSearchPattern)
      )`);
      sqlParams.filterSearchPattern = `%${params.search.trim()}%`;
    }

    const whereClause = whereConditions.join(' AND ');

    // 6. Count Query (Exact visibility alignment — zero count leak)
    const countSql = `
      SELECT COUNT(*) as total
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN sites s ON a.site_id = s.id
      WHERE ${whereClause}
    `;
    const countResult = db.prepare(countSql).get(sqlParams) as { total: number };
    const totalCount = countResult ? countResult.total : 0;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasMore = page * pageSize < totalCount;

    // 7. Select Query with Deterministic Ordering (created_at DESC, id DESC)
    const dataSql = `
      SELECT 
        a.id, 
        a.entity_type, 
        a.entity_id, 
        a.action, 
        a.site_id, 
        a.user_id, 
        a.before_state, 
        a.after_state, 
        a.created_at,
        u.username as user_name,
        u.full_name as user_full_name,
        u.role as user_role,
        u.authority_tier as user_authority_tier,
        s.name as site_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN sites s ON a.site_id = s.id
      WHERE ${whereClause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT @limit OFFSET @offset
    `;

    const queryParams = {
      ...sqlParams,
      limit: pageSize,
      offset,
    };

    const rows = db.prepare(dataSql).all(queryParams) as unknown as RawAuditLogRow[];

    const items = rows.map((row) => this.projectSafeAuditItem(row, context, spUsers));

    // 8. Base Summary Stats Query (Zero mock data - strictly derived from real logs under authority scope)
    const statsSql = `
      SELECT 
        COUNT(*) as totalRecorded,
        SUM(CASE WHEN a.entity_type IN ('USER', 'SECURITY', 'AUTH', 'PERMISSION') THEN 1 ELSE 0 END) as securityCount,
        SUM(CASE WHEN a.entity_type IN ('SITE', 'ROLE', 'WORK_ROLE', 'CATEGORY', 'WORK_CATEGORY', 'RATE', 'LIFECYCLE') THEN 1 ELSE 0 END) as systemCount
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN sites s ON a.site_id = s.id
      WHERE ${baseWhereClause}
    `;
    const statsResult = db.prepare(statsSql).get(baseSqlParams) as {
      totalRecorded: number;
      securityCount: number | null;
      systemCount: number | null;
    } | undefined;

    const stats: AuditStats = {
      totalRecorded: statsResult?.totalRecorded || 0,
      securityCount: statsResult?.securityCount || 0,
      systemCount: statsResult?.systemCount || 0,
    };

    return {
      items,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasMore,
      stats,
    };
  }

  /**
   * Retrieves a single audit log record by ID with full authorization and scope checks.
   */
  public static getLogById(
    id: string,
    context: AuditQueryContext
  ): SafeAuditLogItem | null {
    const db = getDb();
    const spUsers = this.getSuperiorPrimeUsers(db);
    const spIds = spUsers.map((u) => u.id);

    const dataSql = `
      SELECT 
        a.id, 
        a.entity_type, 
        a.entity_id, 
        a.action, 
        a.site_id, 
        a.user_id, 
        a.before_state, 
        a.after_state, 
        a.created_at,
        u.username as user_name,
        u.full_name as user_full_name,
        u.role as user_role,
        u.authority_tier as user_authority_tier,
        s.name as site_name
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN sites s ON a.site_id = s.id
      WHERE a.id = ?
    `;

    const row = db.prepare(dataSql).get(id) as unknown as RawAuditLogRow | undefined;
    if (!row) {
      return null;
    }

    // 1. Superior Prime Privacy Check
    if (!context.isSuperiorPrime) {
      const isTargetingSuperior =
        (row.entity_type === 'USER' || row.entity_type === 'SECURITY' || row.entity_type === 'AUTH') &&
        spIds.includes(row.entity_id);

      const isSuperiorSecurityAction =
        [
          'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'PASSWORD_CHANGE', 
          'PASSWORD_RESET', 'USERNAME_CHANGE', 'RECOVERY_REQUEST', 
          'RECOVERY_COMPLETE', 'RECOVERY_EMAIL_CHANGE'
        ].includes(row.action) &&
        ((row.user_id && spIds.includes(row.user_id)) || spIds.includes(row.entity_id));

      if (isTargetingSuperior || isSuperiorSecurityAction) {
        // Return null as if record does not exist
        return null;
      }
    }

    // 2. Site Scope Check
    if (!context.isGlobalAdmin) {
      if (!row.site_id || !context.assignedSiteIds.includes(row.site_id)) {
        // Non-global admin attempting to view global or unassigned site record
        return null;
      }
    }

    return this.projectSafeAuditItem(row, context, spUsers);
  }
}
