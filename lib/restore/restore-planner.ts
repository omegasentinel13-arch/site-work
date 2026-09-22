import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { RestorePlan, ConflictItem, RecordDiffItem } from '../backup/types';
import { deepValidateBackupArchive } from './deep-validator';

export async function createRestorePlan(zipBuffer: Buffer): Promise<RestorePlan> {
  const validation = await deepValidateBackupArchive(zipBuffer);

  const conflicts: ConflictItem[] = [...validation.conflicts];
  const recordDiff: RecordDiffItem[] = [];

  if (!validation.extractedDbBuffer || !validation.manifest) {
    return {
      backupId: validation.manifest?.backupId || 'unknown',
      backupTimestamp: validation.manifest?.backupTimestamp || 'unknown',
      scope: validation.manifest?.scope || 'SYSTEM',
      siteName: validation.manifest?.siteName || undefined,
      restorableAsDatabase: false,
      canExecuteRestore: false,
      conflicts,
      hasBlockingConflicts: true,
      hasWarnings: false,
      recordDiff: [],
      preRestoreSafetyBackupRequired: true,
    };
  }

  // Open active database read-only to calculate diffs
  const activeDbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
  const activeDb = new DatabaseSync(activeDbPath, { readOnly: true } as any);

  // Open candidate database in temporary sandbox file
  const tmpCandidatePath = path.join(os.tmpdir(), `plan_cand_${Date.now()}_${crypto.randomUUID().substring(0, 8)}.db`);
  fs.writeFileSync(tmpCandidatePath, validation.extractedDbBuffer);
  const candidateDb = new DatabaseSync(tmpCandidatePath, { readOnly: true } as any);

  const diffEntities = [
    { name: 'Users', table: 'users' },
    { name: 'Sites', table: 'sites' },
    { name: 'Worker Attendance Logs', table: 'attendance_records' },
    { name: 'Financial Transactions', table: 'financial_transactions' },
    { name: 'Work Roles', table: 'work_roles' },
    { name: 'Work Categories', table: 'work_categories' },
    { name: 'Audit Trail Records', table: 'audit_logs' },
  ];

  for (const ent of diffEntities) {
    const curRow = activeDb.prepare(`SELECT count(*) as count FROM ${ent.table}`).get() as { count: number };
    const resRow = candidateDb.prepare(`SELECT count(*) as count FROM ${ent.table}`).get() as { count: number };

    const curCount = curRow?.count || 0;
    const resCount = resRow?.count || 0;
    const delta = resCount - curCount;

    let action: 'INCREASE' | 'DECREASE' | 'UNCHANGED' = 'UNCHANGED';
    if (delta > 0) action = 'INCREASE';
    else if (delta < 0) action = 'DECREASE';

    recordDiff.push({
      entityName: ent.name,
      currentCount: curCount,
      restoredCount: resCount,
      delta,
      action,
    });
  }

  // Warning checks:
  // Check if active database has sites that are missing in the incoming backup
  const activeSites = activeDb.prepare('SELECT id, name FROM sites').all() as Array<{ id: string; name: string }>;
  const backupSites = candidateDb.prepare('SELECT id FROM sites').all() as Array<{ id: string }>;
  const backupSiteSet = new Set(backupSites.map((s) => s.id));

  const missingSites = activeSites.filter((s) => !backupSiteSet.has(s.id));
  if (missingSites.length > 0) {
    conflicts.push({
      code: 'ACTIVE_SITES_NOT_IN_BACKUP',
      title: 'Active Sites Will Be Removed',
      description: `The active database contains ${missingSites.length} project site(s) [${missingSites.map((s) => s.name).join(', ')}] that do not exist in this backup. Restoring will replace the site registry.`,
      severity: 'WARNING',
      details: { missingSites },
    });
  }

  // Check if active database has newer audit records
  const curAudit = activeDb.prepare('SELECT count(*) as count FROM audit_logs').get() as { count: number };
  const resAudit = candidateDb.prepare('SELECT count(*) as count FROM audit_logs').get() as { count: number };
  if ((curAudit?.count || 0) > (resAudit?.count || 0)) {
    conflicts.push({
      code: 'NEWER_AUDIT_TRAIL_REPLACED',
      title: 'Historical Audit Trail Notice',
      description: `The active database has ${curAudit.count} audit entries, while the backup has ${resAudit.count}. Restoration will restore the audit table to the backup timestamp (full restore history is permanently preserved in the Recovery Journal sidecar).`,
      severity: 'WARNING',
    });
  }

  activeDb.close();
  candidateDb.close();
  try {
    if (fs.existsSync(tmpCandidatePath)) fs.unlinkSync(tmpCandidatePath);
  } catch {}

  const hasBlocking = conflicts.some((c) => c.severity === 'BLOCKING');
  const hasWarnings = conflicts.some((c) => c.severity === 'WARNING');

  return {
    backupId: validation.manifest.backupId,
    backupTimestamp: validation.manifest.backupTimestamp,
    scope: validation.manifest.scope,
    siteName: validation.manifest.siteName || undefined,
    restorableAsDatabase: validation.manifest.restorableAsDatabase && !hasBlocking,
    canExecuteRestore: !hasBlocking,
    conflicts,
    hasBlockingConflicts: hasBlocking,
    hasWarnings,
    recordDiff,
    preRestoreSafetyBackupRequired: true,
  };
}
