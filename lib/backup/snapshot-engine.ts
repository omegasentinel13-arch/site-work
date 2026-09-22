import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { calculateBufferSha256 } from './checksum-service';
import { BackupDatabaseMetadata } from './types';
import { ResolvedPeriod } from '../export/complete/types';

export interface StandaloneSnapshotResult {
  buffer: Buffer;
  sha256: string;
  sizeBytes: number;
  metadata: BackupDatabaseMetadata;
}

export interface SiteLogicalDataResult {
  siteProfileJson: string;
  siteUsersJson: string;
  attendanceJson: string;
  financeJson: string;
  rolesJson: string;
  categoriesJson: string;
  ratesJson: string;
  supplyItemsJson: string;
  lifecycleJson: string;
  auditLogsJson: string;
  counts: {
    attendance: number;
    finance: number;
    roles: number;
    categories: number;
    rates: number;
    siteUsers: number;
    supplyItems: number;
    lifecycle: number;
    auditLogs: number;
  };
}

export interface SystemLogicalDataResult {
  systemStateJson: string;
  usersJson: string;
  sitesJson: string;
  siteUsersJson: string;
  workCategoriesJson: string;
  workRolesJson: string;
  siteRoleRatesJson: string;
  attendanceJson: string;
  financeJson: string;
  investorsJson: string;
  supplyItemsJson: string;
  lifecycleJson: string;
  permissionDefinitionsJson: string;
  rolePermissionsJson: string;
  userOverridesJson: string;
  auditLogsJson: string;
  masterExportJson: string;
  counts: Record<string, number>;
}

/**
 * Creates a transactionally consistent, standalone SQLite database binary
 * using SQLite's native online serialization mechanism (sqlite3_serialize).
 * Incorporates all committed WAL journal frames into a self-contained image.
 * STRICTLY ADMIN ONLY for SYSTEM + ALL_DATA.
 *
 * Security Invariant: Purges recovery_tokens from snapshot binary so no
 * password reset hashes or tokens ever leak.
 */
export function generateSystemDatabaseSnapshot(): StandaloneSnapshotResult {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');

  // Open read-only connection without modifying or locking the database
  const readOnlyDb = new DatabaseSync(dbPath, { readOnly: true } as any);

  let serializedBytes: Uint8Array;
  try {
    serializedBytes = (readOnlyDb as any).serialize('main');
  } finally {
    readOnlyDb.close();
  }

  // Validate and sanitize snapshot in an isolated temporary sandbox file
  const tmpSandboxPath = path.join(os.tmpdir(), `snapshot_sandbox_${Date.now()}_${crypto.randomUUID().substring(0, 8)}.db`);
  fs.writeFileSync(tmpSandboxPath, Buffer.from(serializedBytes));

  let testDb: DatabaseSync;
  let integrityCheck = 'unknown';
  const tables = [
    'users',
    'sites',
    'site_users',
    'work_categories',
    'work_roles',
    'site_role_rates',
    'attendance_records',
    'financial_transactions',
    'investors',
    'supply_items',
    'system_lifecycle_records',
    'permission_definitions',
    'role_permissions',
    'user_permission_overrides',
    'audit_logs',
  ] as const;
  const tableCounts = {} as Record<(typeof tables)[number], number>;

  let sanitizedBuffer: Buffer;
  try {
    // Open writable connection in isolated tmp directory to purge secret tokens
    testDb = new DatabaseSync(tmpSandboxPath);
    
    // Purge temporary recovery tokens from the backup image
    try {
      testDb.exec('DELETE FROM recovery_tokens;');
    } catch {}

    const integrityRows = testDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    integrityCheck = integrityRows[0]?.integrity_check || 'unknown';

    for (const t of tables) {
      try {
        const row = testDb.prepare(`SELECT count(*) as count FROM ${t}`).get() as { count: number };
        tableCounts[t] = row?.count || 0;
      } catch {
        tableCounts[t] = 0;
      }
    }

    const reSerializedBytes = (testDb as any).serialize('main');
    sanitizedBuffer = Buffer.from(reSerializedBytes);
    testDb.close();
  } finally {
    try {
      if (fs.existsSync(tmpSandboxPath)) fs.unlinkSync(tmpSandboxPath);
      const walTmp = `${tmpSandboxPath}-wal`;
      const shmTmp = `${tmpSandboxPath}-shm`;
      if (fs.existsSync(walTmp)) fs.unlinkSync(walTmp);
      if (fs.existsSync(shmTmp)) fs.unlinkSync(shmTmp);
    } catch {}
  }

  const sha256 = calculateBufferSha256(sanitizedBuffer);
  const sizeBytes = sanitizedBuffer.length;

  return {
    buffer: sanitizedBuffer,
    sha256,
    sizeBytes,
    metadata: {
      included: true,
      isStandalone: true,
      sizeBytes,
      sha256,
      integrityCheck,
      tableCounts,
    },
  };
}

/**
 * Extracts complete, sanitized system-wide recovery datasets across all application tables.
 * Strict Security Invariant: users table is sanitized — password_hash, recovery_email,
 * and recovery_tokens are permanently EXCLUDED.
 */
export function extractSystemLogicalDatasets(): SystemLogicalDataResult {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
  const readOnlyDb = new DatabaseSync(dbPath, { readOnly: true } as any);

  try {
    // 1. Users — SANITIZED (zero passwords, zero recovery emails)
    const users = readOnlyDb.prepare(`
      SELECT id, username, full_name, role, authority_tier, is_active, created_at, updated_at
      FROM users ORDER BY created_at ASC
    `).all();

    // 2. Sites
    const sites = readOnlyDb.prepare(`
      SELECT id, name, code, location, is_archived, created_by, created_at, updated_at
      FROM sites ORDER BY created_at ASC
    `).all();

    // 3. Site Users
    const siteUsers = readOnlyDb.prepare(`
      SELECT id, site_id, user_id, created_at
      FROM site_users ORDER BY created_at ASC
    `).all();

    // 4. Work Categories
    const workCategories = readOnlyDb.prepare(`
      SELECT id, name, sort_order, is_active, created_at, updated_at
      FROM work_categories ORDER BY sort_order ASC, name ASC
    `).all();

    // 5. Work Roles
    const workRoles = readOnlyDb.prepare(`
      SELECT id, category_id, name, default_rate_paise, sort_order, is_active, created_at, updated_at
      FROM work_roles ORDER BY category_id ASC, sort_order ASC, name ASC
    `).all();

    // 6. Site Role Rates
    const siteRoleRates = readOnlyDb.prepare(`
      SELECT id, site_id, role_id, rate_paise, created_at, updated_at
      FROM site_role_rates ORDER BY created_at ASC
    `).all();

    // 7. Attendance Records
    const attendanceRecords = readOnlyDb.prepare(`
      SELECT id, site_id, date, role_id, rate_snapshot_paise, full_day_count, half_day_count,
             total_workers, worker_days, total_cost_paise, created_by, updated_by, created_at, updated_at
      FROM attendance_records ORDER BY date ASC, created_at ASC
    `).all();

    // 8. Financial Transactions
    const financialTransactions = readOnlyDb.prepare(`
      SELECT id, site_id, date, type, debit_category, amount_paise, description, reference_note,
             investor_id, investor_name, work_category_id, work_role_id, attachment_url,
             created_by, updated_by, created_at, updated_at
      FROM financial_transactions ORDER BY date ASC, created_at ASC
    `).all();

    // 9. Investors
    const investors = readOnlyDb.prepare(`
      SELECT id, name, is_archived, created_at, updated_at
      FROM investors ORDER BY name ASC
    `).all();

    // 10. Supply Items
    const supplyItems = readOnlyDb.prepare(`
      SELECT id, site_id, name, normalized_name, usage_count, last_used_at, is_archived, created_at, updated_at
      FROM supply_items ORDER BY site_id ASC, usage_count DESC
    `).all();

    // 11. System Lifecycle Records
    const lifecycleRecords = readOnlyDb.prepare(`
      SELECT id, entity_type, entity_id, entity_name, source_module, source_route,
             restore_destination, state, keep_permanently, archived_at, recycled_at,
             performed_by, metadata, created_at, updated_at
      FROM system_lifecycle_records ORDER BY created_at ASC
    `).all();

    // 12. Permission Definitions
    const permissionDefs = readOnlyDb.prepare(`
      SELECT id, page_id, action_id, display_name, description, is_site_scoped, created_at
      FROM permission_definitions ORDER BY page_id ASC, action_id ASC
    `).all();

    // 13. Role Permissions
    const rolePermissions = readOnlyDb.prepare(`
      SELECT id, role, permission_id, scope_type, site_id, created_at
      FROM role_permissions ORDER BY role ASC
    `).all();

    // 14. User Permission Overrides
    const userOverrides = readOnlyDb.prepare(`
      SELECT id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at
      FROM user_permission_overrides ORDER BY user_id ASC
    `).all();

    // 15. Audit Logs
    const auditLogs = readOnlyDb.prepare(`
      SELECT id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at
      FROM audit_logs ORDER BY created_at ASC
    `).all();

    const counts: Record<string, number> = {
      users: users.length,
      sites: sites.length,
      site_users: siteUsers.length,
      work_categories: workCategories.length,
      work_roles: workRoles.length,
      site_role_rates: siteRoleRates.length,
      attendance_records: attendanceRecords.length,
      financial_transactions: financialTransactions.length,
      investors: investors.length,
      supply_items: supplyItems.length,
      system_lifecycle_records: lifecycleRecords.length,
      permission_definitions: permissionDefs.length,
      role_permissions: rolePermissions.length,
      user_permission_overrides: userOverrides.length,
      audit_logs: auditLogs.length,
    };

    const systemState = {
      version: '2.0.0',
      exportedAt: new Date().toISOString(),
      scope: 'SYSTEM',
      counts,
      users,
      sites,
      site_users: siteUsers,
      work_categories: workCategories,
      work_roles: workRoles,
      site_role_rates: siteRoleRates,
      attendance_records: attendanceRecords,
      financial_transactions: financialTransactions,
      investors,
      supply_items: supplyItems,
      system_lifecycle_records: lifecycleRecords,
      permission_definitions: permissionDefs,
      role_permissions: rolePermissions,
      user_permission_overrides: userOverrides,
      audit_logs: auditLogs,
    };

    // Master Export JSON (compatible with existing parsers)
    const masterExport = {
      version: '2.0.0',
      generatedAt: new Date().toISOString(),
      scope: { type: 'SYSTEM' },
      sites,
      attendance: attendanceRecords,
      finance: financialTransactions,
      categories: workCategories,
      roles: workRoles,
      siteRoleRates,
      investors,
      auditLogs,
      counts,
    };

    return {
      systemStateJson: JSON.stringify(systemState, null, 2),
      usersJson: JSON.stringify(users, null, 2),
      sitesJson: JSON.stringify(sites, null, 2),
      siteUsersJson: JSON.stringify(siteUsers, null, 2),
      workCategoriesJson: JSON.stringify(workCategories, null, 2),
      workRolesJson: JSON.stringify(workRoles, null, 2),
      siteRoleRatesJson: JSON.stringify(siteRoleRates, null, 2),
      attendanceJson: JSON.stringify(attendanceRecords, null, 2),
      financeJson: JSON.stringify(financialTransactions, null, 2),
      investorsJson: JSON.stringify(investors, null, 2),
      supplyItemsJson: JSON.stringify(supplyItems, null, 2),
      lifecycleJson: JSON.stringify(lifecycleRecords, null, 2),
      permissionDefinitionsJson: JSON.stringify(permissionDefs, null, 2),
      rolePermissionsJson: JSON.stringify(rolePermissions, null, 2),
      userOverridesJson: JSON.stringify(userOverrides, null, 2),
      auditLogsJson: JSON.stringify(auditLogs, null, 2),
      masterExportJson: JSON.stringify(masterExport, null, 2),
      counts,
    };
  } finally {
    readOnlyDb.close();
  }
}

/**
 * Extracts isolated logical datasets for a single site.
 * Strictly filters by site_id, excluding unrelated sites, other site users,
 * system users, and global authentication records.
 */
export function extractSiteLogicalDatasets(
  siteId: string,
  period: ResolvedPeriod
): SiteLogicalDataResult {
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
  const readOnlyDb = new DatabaseSync(dbPath, { readOnly: true } as any);

  try {
    // 1. Site Profile
    const siteRow = readOnlyDb.prepare(`
      SELECT id, name, code, location, is_archived, created_at, updated_at
      FROM sites WHERE id = ?
    `).get(siteId) as any;

    if (!siteRow) {
      throw new Error(`Site not found: ${siteId}`);
    }

    // 2. Site Users (Sanitized without secrets)
    const siteUsers = readOnlyDb.prepare(`
      SELECT su.id, su.site_id, su.user_id, u.username, u.full_name, u.role, su.created_at
      FROM site_users su
      JOIN users u ON su.user_id = u.id
      WHERE su.site_id = ?
      ORDER BY su.created_at ASC
    `).all(siteId);

    // 3. Attendance Records (Filtered by siteId and optional period)
    let attQuery = `
      SELECT ar.id, ar.site_id, ar.date, ar.role_id, r.name as role_name, c.name as category_name,
             ar.rate_snapshot_paise, ar.full_day_count, ar.half_day_count, ar.total_workers,
             ar.worker_days, ar.total_cost_paise, ar.created_at, ar.updated_at
      FROM attendance_records ar
      LEFT JOIN work_roles r ON ar.role_id = r.id
      LEFT JOIN work_categories c ON r.category_id = c.id
      WHERE ar.site_id = ?
    `;
    const attParams: unknown[] = [siteId];

    if (!period.isUnbounded && period.startDate && period.endDate) {
      attQuery += ` AND ar.date >= ? AND ar.date <= ?`;
      attParams.push(period.startDate, period.endDate);
    }
    attQuery += ` ORDER BY ar.date ASC, ar.created_at ASC`;
    const attendanceRecords = readOnlyDb.prepare(attQuery).all(...attParams);

    // 4. Financial Transactions (Filtered by siteId and optional period)
    let finQuery = `
      SELECT id, site_id, date, type, debit_category, amount_paise, description, reference_note, created_at, updated_at
      FROM financial_transactions
      WHERE site_id = ?
    `;
    const finParams: unknown[] = [siteId];

    if (!period.isUnbounded && period.startDate && period.endDate) {
      finQuery += ` AND date >= ? AND date <= ?`;
      finParams.push(period.startDate, period.endDate);
    }
    finQuery += ` ORDER BY date ASC, created_at ASC`;
    const financialTransactions = readOnlyDb.prepare(finQuery).all(...finParams);

    // 5. Utilized Roles (Only roles actively utilized in this site's attendance)
    const utilizedRoles = readOnlyDb.prepare(`
      SELECT DISTINCT r.id, r.category_id, r.name, r.default_rate_paise, c.name as category_name, c.sort_order as category_sort_order
      FROM work_roles r
      JOIN work_categories c ON r.category_id = c.id
      WHERE r.id IN (SELECT DISTINCT role_id FROM attendance_records WHERE site_id = ?)
      ORDER BY c.sort_order ASC, r.name ASC
    `).all(siteId);

    // 6. Utilized Categories
    const utilizedCategories = readOnlyDb.prepare(`
      SELECT DISTINCT c.id, c.name, c.sort_order, c.is_active, c.created_at, c.updated_at
      FROM work_categories c
      JOIN work_roles r ON r.category_id = c.id
      WHERE r.id IN (SELECT DISTINCT role_id FROM attendance_records WHERE site_id = ?)
      ORDER BY c.sort_order ASC, c.name ASC
    `).all(siteId);

    // 7. Site Role Rates
    const siteRoleRates = readOnlyDb.prepare(`
      SELECT srr.id, srr.site_id, srr.role_id, r.name as role_name, srr.rate_paise, srr.created_at, srr.updated_at
      FROM site_role_rates srr
      JOIN work_roles r ON srr.role_id = r.id
      WHERE srr.site_id = ?
    `).all(siteId);

    // 8. Supply Items for this site
    const supplyItems = readOnlyDb.prepare(`
      SELECT id, site_id, name, normalized_name, usage_count, last_used_at, is_archived, created_at, updated_at
      FROM supply_items
      WHERE site_id = ?
      ORDER BY usage_count DESC
    `).all(siteId);

    // 9. Site Lifecycle Records
    const lifecycleRecords = readOnlyDb.prepare(`
      SELECT id, entity_type, entity_id, entity_name, source_module, source_route,
             restore_destination, state, keep_permanently, archived_at, recycled_at,
             performed_by, metadata, created_at, updated_at
      FROM system_lifecycle_records
      WHERE entity_id = ? OR metadata LIKE ?
    `).all(siteId, `%${siteId}%`);

    // 10. Site Audit Logs (Strictly where site_id = targetSiteId)
    const siteAuditLogs = readOnlyDb.prepare(`
      SELECT id, entity_type, entity_id, action, site_id, before_state, after_state, created_at
      FROM audit_logs
      WHERE site_id = ?
      ORDER BY created_at DESC
      LIMIT 1000
    `).all(siteId);

    return {
      siteProfileJson: JSON.stringify(siteRow, null, 2),
      siteUsersJson: JSON.stringify(siteUsers, null, 2),
      attendanceJson: JSON.stringify(attendanceRecords, null, 2),
      financeJson: JSON.stringify(financialTransactions, null, 2),
      rolesJson: JSON.stringify(utilizedRoles, null, 2),
      categoriesJson: JSON.stringify(utilizedCategories, null, 2),
      ratesJson: JSON.stringify(siteRoleRates, null, 2),
      supplyItemsJson: JSON.stringify(supplyItems, null, 2),
      lifecycleJson: JSON.stringify(lifecycleRecords, null, 2),
      auditLogsJson: JSON.stringify(siteAuditLogs, null, 2),
      counts: {
        attendance: attendanceRecords.length,
        finance: financialTransactions.length,
        roles: utilizedRoles.length,
        categories: utilizedCategories.length,
        rates: siteRoleRates.length,
        siteUsers: siteUsers.length,
        supplyItems: supplyItems.length,
        lifecycle: lifecycleRecords.length,
        auditLogs: siteAuditLogs.length,
      },
    };
  } finally {
    readOnlyDb.close();
  }
}

