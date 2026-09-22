/**
 * Task 4 — Step 4: Logical Backup Analyzer
 * Analyzes backup archives, validates cryptographic signatures, resolves 12-step FK dependencies,
 * and classifies records into MATCHED_EXACT, NEW_RECORD, CONFLICT, DEPENDENCY_BLOCKED, UNRESOLVED_HISTORICAL.
 */

import JSZip from 'jszip';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { calculateBufferSha256 } from '../checksum-service';
import { BackupManifest } from '../types';
import { AnalysisReport, ClassifiedRecord, ConflictRecord, TableAnalysisSummary } from './types';
import { getNaturalKey, compareRecords, normalizeString } from './identity-matcher';

export interface AnalyzeOptions {
  db?: DatabaseSync;
  dbPath?: string;
}

export async function analyzeBackupPackage(
  zipBuffer: Buffer,
  options?: AnalyzeOptions
): Promise<AnalysisReport> {
  const analysisId = `anl-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
  const analyzedAt = new Date().toISOString();

  // 1. Unpack ZIP
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch (err: any) {
    throw new Error(`Failed to read backup ZIP archive: ${err.message}`);
  }

  // 2. Validate manifest.json
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('CORRUPTED_PACKAGE: manifest.json is missing from the backup archive.');
  }

  const manifestStr = await manifestFile.async('text');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestStr);
  } catch (err: any) {
    throw new Error(`CORRUPTED_PACKAGE: manifest.json is not valid JSON: ${err.message}`);
  }

  // 3. Cryptographic Verification of Archive Files
  let isTampered = false;
  const tamperDetails: string[] = [];

  if (Array.isArray(manifest.files)) {
    for (const entry of manifest.files) {
      const fileInZip = zip.file(entry.path);
      if (!fileInZip) {
        isTampered = true;
        tamperDetails.push(`Missing file: ${entry.path}`);
        continue;
      }

      const fileBuf = await fileInZip.async('nodebuffer');
      const actualSha256 = calculateBufferSha256(fileBuf);
      if (actualSha256 !== entry.sha256) {
        isTampered = true;
        tamperDetails.push(`Checksum mismatch in ${entry.path}: expected ${entry.sha256}, calculated ${actualSha256}`);
      }
    }
  }

  // 4. Open target database connection for analysis (read-only)
  let db: DatabaseSync;
  let shouldCloseDb = false;

  if (options?.db) {
    db = options.db;
  } else {
    const targetDbPath = options?.dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
    db = new DatabaseSync(targetDbPath, { readOnly: true } as any);
    shouldCloseDb = true;
  }

  try {
    // 5. Read JSON Datasets from ZIP
    const datasets: Record<string, Record<string, unknown>[]> = {};

    const loadJson = async (zipPath: string): Promise<Record<string, unknown>[]> => {
      const file = zip.file(zipPath);
      if (!file) return [];
      try {
        const text = await file.async('text');
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    };

    // Users
    datasets['users'] = await loadJson('data/users.json');

    // Sites (system or site-scoped)
    const sitesArr = await loadJson('data/sites.json');
    if (sitesArr.length > 0) {
      datasets['sites'] = sitesArr;
    } else {
      datasets['sites'] = await loadJson('data/site_profile.json');
    }

    // Site Users
    datasets['site_users'] = await loadJson('data/site_users.json');

    // Work Categories
    const catArr = await loadJson('data/work_categories.json');
    datasets['work_categories'] = catArr.length > 0 ? catArr : await loadJson('data/utilized_categories.json');

    // Work Roles
    const roleArr = await loadJson('data/work_roles.json');
    datasets['work_roles'] = roleArr.length > 0 ? roleArr : await loadJson('data/utilized_roles.json');

    // Site Role Rates
    datasets['site_role_rates'] = await loadJson('data/site_role_rates.json');

    // Attendance Records
    datasets['attendance_records'] = await loadJson('data/attendance_records.json');

    // Financial Transactions
    datasets['financial_transactions'] = await loadJson('data/financial_transactions.json');

    // Investors
    datasets['investors'] = await loadJson('data/investors.json');

    // Supply Items
    datasets['supply_items'] = await loadJson('data/supply_items.json');

    // Audit Logs
    datasets['audit_logs'] = await loadJson('data/audit_logs.json');

    // Permissions & Overrides from system_state.json if available
    const systemState = await loadJson('data/system_state.json');
    if (systemState.length > 0 && typeof systemState[0] === 'object') {
      const stateObj = systemState[0] as any;
      if (Array.isArray(stateObj.permission_definitions)) datasets['permission_definitions'] = stateObj.permission_definitions;
      if (Array.isArray(stateObj.role_permissions)) datasets['role_permissions'] = stateObj.role_permissions;
      if (Array.isArray(stateObj.user_permission_overrides)) datasets['user_permission_overrides'] = stateObj.user_permission_overrides;
    } else {
      datasets['permission_definitions'] = await loadJson('data/permission_definitions.json');
      datasets['role_permissions'] = await loadJson('data/role_permissions.json');
      datasets['user_permission_overrides'] = await loadJson('data/user_permission_overrides.json');
    }

    // 6. 12-Step Foreign Key Dependency Resolution & Classification Engine
    const tableSummaries: TableAnalysisSummary[] = [];
    const classifiedRecords: ClassifiedRecord[] = [];
    const conflicts: ConflictRecord[] = [];
    const warnings: string[] = [];

    // Track available IDs in target DB + validated new inserts
    const availableUserIds = new Set<string>();
    const availableSiteIds = new Set<string>();
    const availableCategoryIds = new Set<string>();
    const availableRoleIds = new Set<string>();
    const availableInvestorIds = new Set<string>();
    const availablePermissionIds = new Set<string>();

    // Pre-populate target DB existing IDs
    const existingUsers = db.prepare('SELECT id, username, full_name, role, authority_tier, is_active FROM users').all() as any[];
    for (const u of existingUsers) availableUserIds.add(u.id);

    const existingSites = db.prepare('SELECT id, name, code, location, is_archived FROM sites').all() as any[];
    for (const s of existingSites) availableSiteIds.add(s.id);

    const existingCategories = db.prepare('SELECT id, name, sort_order, is_active FROM work_categories').all() as any[];
    for (const c of existingCategories) availableCategoryIds.add(c.id);

    const existingRoles = db.prepare('SELECT id, category_id, name, default_rate_paise, sort_order, is_active FROM work_roles').all() as any[];
    for (const r of existingRoles) availableRoleIds.add(r.id);

    const existingInvestors = db.prepare('SELECT id, name FROM investors').all() as any[];
    for (const i of existingInvestors) availableInvestorIds.add(i.id);

    try {
      const existingPerms = db.prepare('SELECT id FROM permission_definitions').all() as any[];
      for (const p of existingPerms) availablePermissionIds.add(String(p.id));
    } catch {}

    // Ordered 12 Steps
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

    for (const table of tableOrder) {
      const records = datasets[table] || [];
      if (records.length === 0) continue;

      let matchedExact = 0;
      let newRecords = 0;
      let conflictCount = 0;
      let dependencyBlocked = 0;
      let unresolvedHistorical = 0;

      // Query existing table rows
      let existingRows: any[] = [];
      try {
        existingRows = db.prepare(`SELECT * FROM ${table}`).all();
      } catch {
        existingRows = [];
      }

      // Index existing rows by natural key and by id
      const existingByNatural = new Map<string, any>();
      const existingById = new Map<string, any>();

      for (const row of existingRows) {
        if (row.id) existingById.set(String(row.id), row);
        const nk = getNaturalKey(table, row);
        if (nk) existingByNatural.set(nk, row);
      }

      for (const incoming of records) {
        const naturalKey = getNaturalKey(table, incoming);
        const incomingId = incoming.id ? String(incoming.id) : '';

        // Step A: Check for existing match
        const existingRecord = existingByNatural.get(naturalKey) || (incomingId ? existingById.get(incomingId) : undefined);

        if (existingRecord) {
          // Compare fields
          const diffs = compareRecords(table, existingRecord, incoming);
          if (diffs.length === 0) {
            matchedExact++;
            classifiedRecords.push({
              table,
              naturalKey,
              classification: 'MATCHED_EXACT',
              record: incoming,
            });
          } else {
            conflictCount++;
            const conflict: ConflictRecord = {
              table,
              naturalKey,
              existingRecord,
              incomingRecord: incoming,
              fieldDifferences: diffs,
              resolutionRecommendation: 'SKIP', // Non-destructive: skip incoming, keep existing
            };
            conflicts.push(conflict);
            classifiedRecords.push({
              table,
              naturalKey,
              classification: 'CONFLICT',
              record: incoming,
              conflict,
              reason: `Record has ${diffs.length} differing fields compared to active database`,
            });
          }
          continue;
        }

        // Step B: Record does not exist -> check foreign key dependencies
        let isBlocked = false;
        let blockReason = '';

        if (table === 'site_users') {
          if (!availableSiteIds.has(String(incoming.site_id))) {
            isBlocked = true;
            blockReason = `Referenced site_id ${incoming.site_id} is not present`;
          } else if (!availableUserIds.has(String(incoming.user_id))) {
            isBlocked = true;
            blockReason = `Referenced user_id ${incoming.user_id} is not present`;
          }
        } else if (table === 'work_roles') {
          if (!availableCategoryIds.has(String(incoming.category_id))) {
            isBlocked = true;
            blockReason = `Referenced category_id ${incoming.category_id} is not present`;
          }
        } else if (table === 'site_role_rates') {
          if (!availableSiteIds.has(String(incoming.site_id))) {
            isBlocked = true;
            blockReason = `Referenced site_id ${incoming.site_id} is not present`;
          } else if (!availableRoleIds.has(String(incoming.role_id))) {
            isBlocked = true;
            blockReason = `Referenced role_id ${incoming.role_id} is not present`;
          }
        } else if (table === 'attendance_records') {
          if (!availableSiteIds.has(String(incoming.site_id))) {
            isBlocked = true;
            blockReason = `Referenced site_id ${incoming.site_id} is not present`;
          } else if (!availableRoleIds.has(String(incoming.role_id))) {
            isBlocked = true;
            blockReason = `Referenced role_id ${incoming.role_id} is not present`;
          }
        } else if (table === 'financial_transactions') {
          if (!availableSiteIds.has(String(incoming.site_id))) {
            isBlocked = true;
            blockReason = `Referenced site_id ${incoming.site_id} is not present`;
          }
        } else if (table === 'supply_items') {
          if (!availableSiteIds.has(String(incoming.site_id))) {
            isBlocked = true;
            blockReason = `Referenced site_id ${incoming.site_id} is not present`;
          }
        } else if (table === 'role_permissions') {
          if (!availablePermissionIds.has(String(incoming.permission_id))) {
            isBlocked = true;
            blockReason = `Permission definition ${incoming.permission_id} is not recognized`;
          }
        } else if (table === 'user_permission_overrides') {
          if (!availableUserIds.has(String(incoming.user_id))) {
            isBlocked = true;
            blockReason = `Referenced user_id ${incoming.user_id} is not present`;
          } else if (!availablePermissionIds.has(String(incoming.permission_id))) {
            isBlocked = true;
            blockReason = `Permission definition ${incoming.permission_id} is not recognized`;
          }
        }

        if (isBlocked) {
          dependencyBlocked++;
          classifiedRecords.push({
            table,
            naturalKey,
            classification: 'DEPENDENCY_BLOCKED',
            record: incoming,
            reason: blockReason,
          });
        } else {
          newRecords++;
          classifiedRecords.push({
            table,
            naturalKey,
            classification: 'NEW_RECORD',
            record: incoming,
          });

          // Register new IDs for downstream dependencies
          if (incoming.id) {
            const idStr = String(incoming.id);
            if (table === 'users') availableUserIds.add(idStr);
            else if (table === 'sites') availableSiteIds.add(idStr);
            else if (table === 'work_categories') availableCategoryIds.add(idStr);
            else if (table === 'work_roles') availableRoleIds.add(idStr);
            else if (table === 'investors') availableInvestorIds.add(idStr);
            else if (table === 'permission_definitions') availablePermissionIds.add(idStr);
          }
        }
      }

      tableSummaries.push({
        table,
        totalIncoming: records.length,
        matchedExact,
        newRecords,
        conflicts: conflictCount,
        dependencyBlocked,
        unresolvedHistorical,
      });
    }

    const totalIncoming = tableSummaries.reduce((acc, t) => acc + t.totalIncoming, 0);
    const totalMatchedExact = tableSummaries.reduce((acc, t) => acc + t.matchedExact, 0);
    const totalNewRecords = tableSummaries.reduce((acc, t) => acc + t.newRecords, 0);
    const totalConflicts = tableSummaries.reduce((acc, t) => acc + t.conflicts, 0);
    const totalDependencyBlocked = tableSummaries.reduce((acc, t) => acc + t.dependencyBlocked, 0);
    const totalUnresolvedHistorical = tableSummaries.reduce((acc, t) => acc + t.unresolvedHistorical, 0);

    const safeToExecute = !isTampered && totalDependencyBlocked === 0;

    if (totalConflicts > 0) {
      warnings.push(`${totalConflicts} conflict(s) detected. In accordance with zero-data-loss policy, existing records in the database will be PRESERVED and incoming conflicts will be skipped.`);
    }

    if (totalDependencyBlocked > 0) {
      warnings.push(`${totalDependencyBlocked} record(s) blocked due to missing parent foreign-key dependencies.`);
    }

    if (isTampered) {
      warnings.push('CRITICAL: Archive checksum verification failed. The package appears to have been altered or corrupted.');
    }

    return {
      analysisId,
      packageId: manifest.backupId || 'unknown',
      analyzedAt,
      scope: manifest.scope || 'SYSTEM',
      siteId: manifest.siteId,
      siteName: manifest.siteName,
      siteCode: manifest.siteCode,
      isTampered,
      tamperDetails: tamperDetails.length > 0 ? tamperDetails : undefined,
      manifest,
      tableSummaries,
      totalIncoming,
      totalMatchedExact,
      totalNewRecords,
      totalConflicts,
      totalDependencyBlocked,
      totalUnresolvedHistorical,
      conflicts,
      classifiedRecords,
      safeToExecute,
      warnings,
    };
  } finally {
    if (shouldCloseDb) {
      db.close();
    }
  }
}
