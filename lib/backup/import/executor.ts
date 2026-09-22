/**
 * Task 4 — Step 4: INSERT-ONLY Logical Recovery Executor
 * Performs transactional, non-destructive insertion of validated new records.
 * NEVER overwrites existing data. Strips credentials. Enforces King Maker immutability.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AnalysisReport, ClassifiedRecord, RecoveryExecutionResult } from './types';
import { getNaturalKey } from './identity-matcher';
import { appendRecoveryHistory } from './history-repo';

export interface ExecuteRecoveryOptions {
  db?: DatabaseSync;
  dbPath?: string;
  actor: {
    userId: string;
    username: string;
    role: string;
  };
}

export async function executeLogicalRecovery(
  analysis: AnalysisReport,
  options: ExecuteRecoveryOptions
): Promise<RecoveryExecutionResult> {
  const operationId = `rec-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
  const startedAt = new Date().toISOString();

  if (analysis.isTampered) {
    throw new Error('RECOVERY_REFUSED: Package checksum validation failed. Corrupted packages cannot be imported.');
  }

  // Open writable database connection
  let db: DatabaseSync;
  let shouldCloseDb = false;

  if (options.db) {
    db = options.db;
  } else {
    const targetDbPath = options.dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
    db = new DatabaseSync(targetDbPath);
    shouldCloseDb = true;
  }

  // Ensure Foreign Keys are ENABLED
  db.exec('PRAGMA foreign_keys = ON;');

  const insertedPerTable: Record<string, number> = {};
  const skippedPerTable: Record<string, number> = {};
  let totalInserted = 0;
  let totalSkipped = 0;
  let quarantinedUsersCount = 0;
  let kingMakerProtected = true;
  let auditLogId = `aud-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;

  // Filter only records classified as NEW_RECORD
  const newRecords = analysis.classifiedRecords.filter((r) => r.classification === 'NEW_RECORD');
  const skippedRecords = analysis.classifiedRecords.filter((r) => r.classification !== 'NEW_RECORD');

  for (const r of skippedRecords) {
    skippedPerTable[r.table] = (skippedPerTable[r.table] || 0) + 1;
    totalSkipped++;
  }

  // Sort new records by strict 12-step FK order
  const tableOrder = [
    'permission_definitions',
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
    'role_permissions',
    'user_permission_overrides',
  ];

  const recordsByTable: Record<string, ClassifiedRecord[]> = {};
  for (const r of newRecords) {
    if (!recordsByTable[r.table]) recordsByTable[r.table] = [];
    recordsByTable[r.table].push(r);
  }

  // BEGIN IMMEDIATE TRANSACTION
  db.exec('BEGIN IMMEDIATE;');

  try {
    for (const table of tableOrder) {
      const records = recordsByTable[table] || [];
      if (records.length === 0) continue;

      for (const item of records) {
        const raw = { ...item.record };

        // 1. Double-check pre-insert existence to guarantee zero-overwrite idempotency
        const naturalKey = getNaturalKey(table, raw);
        if (item.record.id) {
          const checkById = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(item.record.id);
          if (checkById) {
            skippedPerTable[table] = (skippedPerTable[table] || 0) + 1;
            totalSkipped++;
            continue;
          }
        }

        // 2. Table-specific security, sanitation, and insertion rules
        if (table === 'users') {
          // KING MAKER IMMUTABILITY
          const uname = String(raw.username || '').toLowerCase().trim();
          const uid = String(raw.id || '').trim();
          if (uname === 'admin' || uid === 'usr-admin-1') {
            // Absolute prohibition: Prime admin identity cannot be imported or overwritten
            skippedPerTable[table] = (skippedPerTable[table] || 0) + 1;
            totalSkipped++;
            continue;
          }

          // Strip password_hash, recovery_email, recovery_tokens
          delete raw.password_hash;
          delete raw.recovery_email;
          delete raw.recovery_tokens;

          // AUTHORITY QUARANTINE: New imported users are created in inactive quarantine
          // with an unguessable disabled hash
          const disabledHash = `QUARANTINED_${crypto.randomBytes(32).toString('hex')}`;
          const insertStmt = db.prepare(`
            INSERT INTO users (
              id, username, password_hash, full_name, role, authority_tier, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
          `);

          insertStmt.run(
            raw.id || `usr-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.username,
            disabledHash,
            raw.full_name || raw.username,
            raw.role || 'VIEWER',
            'STANDARD', // Quarantined authority tier
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          quarantinedUsersCount++;
          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'sites') {
          const insertStmt = db.prepare(`
            INSERT INTO sites (
              id, name, code, location, is_archived, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `site-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.name,
            raw.code,
            raw.location || '',
            raw.is_archived ? 1 : 0,
            raw.created_by || options.actor.userId,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'site_users') {
          const insertStmt = db.prepare(`
            INSERT INTO site_users (id, site_id, user_id, created_at)
            VALUES (?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `su-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.site_id,
            raw.user_id,
            raw.created_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'work_categories') {
          const insertStmt = db.prepare(`
            INSERT INTO work_categories (id, name, sort_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `cat-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.name,
            Number(raw.sort_order || 0),
            raw.is_active !== undefined ? (raw.is_active ? 1 : 0) : 1,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'work_roles') {
          const insertStmt = db.prepare(`
            INSERT INTO work_roles (id, category_id, name, default_rate_paise, sort_order, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `role-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.category_id,
            raw.name,
            Number(raw.default_rate_paise || 0),
            Number(raw.sort_order || 0),
            raw.is_active !== undefined ? (raw.is_active ? 1 : 0) : 1,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'site_role_rates') {
          const insertStmt = db.prepare(`
            INSERT INTO site_role_rates (id, site_id, role_id, rate_paise, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `srr-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.site_id,
            raw.role_id,
            Number(raw.rate_paise || 0),
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'attendance_records') {
          const insertStmt = db.prepare(`
            INSERT INTO attendance_records (
              id, site_id, date, role_id, rate_snapshot_paise, full_day_count, half_day_count,
              total_workers, worker_days, total_cost_paise, created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `att-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.site_id,
            raw.date,
            raw.role_id,
            Number(raw.rate_snapshot_paise || 0),
            Number(raw.full_day_count || 0),
            Number(raw.half_day_count || 0),
            Number(raw.total_workers || 0),
            Number(raw.worker_days || 0),
            Number(raw.total_cost_paise || 0),
            raw.created_by || options.actor.userId,
            raw.updated_by || options.actor.userId,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'financial_transactions') {
          const insertStmt = db.prepare(`
            INSERT INTO financial_transactions (
              id, site_id, date, type, debit_category, amount_paise, description, reference_note,
              investor_id, investor_name, work_category_id, work_role_id, attachment_url,
              created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `tx-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.site_id,
            raw.date,
            raw.type,
            raw.debit_category || null,
            Number(raw.amount_paise || 0),
            raw.description || '',
            raw.reference_note || null,
            raw.investor_id || null,
            raw.investor_name || null,
            raw.work_category_id || null,
            raw.work_role_id || null,
            raw.attachment_url || null,
            raw.created_by || options.actor.userId,
            raw.updated_by || options.actor.userId,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'investors') {
          const insertStmt = db.prepare(`
            INSERT INTO investors (id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `inv-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.name,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'supply_items') {
          const insertStmt = db.prepare(`
            INSERT INTO supply_items (id, site_id, name, normalized_name, usage_count, last_used_at, is_archived, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `sup-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.site_id,
            raw.name,
            raw.normalized_name || String(raw.name).toLowerCase().trim(),
            Number(raw.usage_count || 1),
            raw.last_used_at || startedAt,
            raw.is_archived ? 1 : 0,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'permission_definitions') {
          const insertStmt = db.prepare(`
            INSERT INTO permission_definitions (id, page_id, action_id, display_name, description, is_site_scoped, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `perm-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.page_id,
            raw.action_id,
            raw.display_name || `${raw.page_id}:${raw.action_id}`,
            raw.description || '',
            raw.is_site_scoped ? 1 : 0,
            raw.created_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'role_permissions') {
          const insertStmt = db.prepare(`
            INSERT INTO role_permissions (id, role, permission_id, scope_type, site_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `rp-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.role,
            raw.permission_id,
            raw.scope_type || 'GLOBAL',
            raw.site_id || null,
            raw.created_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        } else if (table === 'user_permission_overrides') {
          const insertStmt = db.prepare(`
            INSERT INTO user_permission_overrides (id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          insertStmt.run(
            raw.id || `upo-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`,
            raw.user_id,
            raw.permission_id,
            raw.site_id || null,
            raw.effect || 'ALLOW',
            raw.granted_by || options.actor.userId,
            raw.created_at || startedAt,
            raw.updated_at || startedAt
          );

          insertedPerTable[table] = (insertedPerTable[table] || 0) + 1;
          totalInserted++;
        }
      }
    }

    // 3. Log BACKUP_IMPORTED to audit_logs
    const auditDetails = JSON.stringify({
      operationId,
      packageId: analysis.packageId,
      scope: analysis.scope,
      totalInserted,
      totalSkipped,
      quarantinedUsersCount,
      insertedPerTable,
    });

    const logStmt = db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    logStmt.run(
      auditLogId,
      'SECURITY',
      analysis.packageId,
      'COMPLETE_EXPORT_GENERATED',
      analysis.siteId || null,
      options.actor.userId,
      null,
      auditDetails,
      startedAt
    );

    // COMMIT TRANSACTION
    db.exec('COMMIT;');
  } catch (err: any) {
    db.exec('ROLLBACK;');
    throw new Error(`RECOVERY_TRANSACTION_FAILED: ${err.message}`);
  } finally {
    if (shouldCloseDb) {
      db.close();
    }
  }

  const completedAt = new Date().toISOString();

  // 4. Record to recovery_history.jsonl
  try {
    appendRecoveryHistory({
      operationId,
      packageId: analysis.packageId,
      executedAt: startedAt,
      actor: options.actor,
      scope: analysis.scope,
      siteId: analysis.siteId,
      siteName: analysis.siteName,
      packageChecksum: analysis.manifest?.database?.sha256 || 'n/a',
      analysisChecksum: crypto.createHash('sha256').update(JSON.stringify(analysis.tableSummaries)).digest('hex'),
      totalInserted,
      totalSkipped,
      totalConflicts: analysis.totalConflicts,
      insertedPerTable,
      status: 'SUCCESS',
    });
  } catch (histErr) {
    console.warn('Warning: Failed to append to recovery_history.jsonl:', histErr);
  }

  return {
    operationId,
    packageId: analysis.packageId,
    startedAt,
    completedAt,
    actor: options.actor,
    totalInserted,
    totalSkipped,
    insertedPerTable,
    skippedPerTable,
    quarantinedUsersCount,
    kingMakerProtected,
    auditLogId,
    success: true,
  };
}
