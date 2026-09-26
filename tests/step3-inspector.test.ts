import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { deleteBackupFromStorage } from '../lib/backup/storage-registry';
import { UserSession } from '../lib/auth/session';
import { classifyPackage } from '../lib/packages/classifier';

describe('TASK 4 — STEP 3: PACKAGE INSPECTOR & API INTEGRATION', () => {
  const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
  const testDbPath = path.join(process.cwd(), 'data', 'test_site_work.db');
  let baselineCounts: Record<string, number> = {};

  process.env.DATABASE_PATH = testDbPath;

  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    role: 'ADMIN',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  const siteManagerSession: UserSession = {
    userId: 'usr-eng-1',
    username: 'engineer2',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    requiresPasswordReset: false,
  };

  function getTableCounts(dbFilePath: string) {
    const db = new DatabaseSync(dbFilePath, { readOnly: true } as any);
    const tables = [
      'users', 'sites', 'site_users', 'work_categories', 'work_roles',
      'site_role_rates', 'attendance_records', 'financial_transactions',
      'investors', 'supply_items', 'system_lifecycle_records',
      'permission_definitions', 'role_permissions', 'user_permission_overrides',
      'audit_logs', 'recovery_tokens'
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const row = db.prepare(`SELECT count(*) as count FROM ${t}`).get() as { count: number };
        counts[t] = row?.count || 0;
      } catch {
        counts[t] = 0;
      }
    }
    db.close();
    return counts;
  }

  before(() => {
    baselineCounts = getTableCounts(prodDbPath);
    fs.copyFileSync(prodDbPath, testDbPath);
  });

  after(() => {
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      const wal = `${testDbPath}-wal`;
      const shm = `${testDbPath}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}

    const postCounts = getTableCounts(prodDbPath);
    for (const [table, count] of Object.entries(baselineCounts)) {
      assert.equal(postCounts[table], count, `Post-test mismatch on ${table}`);
    }
  });

  let systemBackupId: string;
  let siteBackupId: string;
  let systemBuffer: Buffer;
  let siteBuffer: Buffer;

  test('1. Setup: Generate System and Site backups in storage', async () => {
    const sysResult = await createEnterpriseBackup({ scope: 'SYSTEM', period: 'ALL_DATA' }, adminSession);
    systemBackupId = sysResult.backupId;
    systemBuffer = sysResult.zipBuffer;

    const siteResult = await createEnterpriseBackup({ scope: 'SITE', siteId: 'site-1', period: 'ALL_DATA' }, adminSession);
    siteBackupId = siteResult.backupId;
    siteBuffer = siteResult.zipBuffer;

    assert.ok(systemBackupId);
    assert.ok(siteBackupId);
  });

  test('2. Inspector Classifier verifies System Recovery Package structure', async () => {
    const inspection = await classifyPackage(systemBuffer, 'SITE_WORK_BACKUP_SYSTEM.zip');
    assert.equal(inspection.isValid, true);
    assert.equal(inspection.classification, 'SYSTEM_RECOVERY_BACKUP');
    assert.equal(inspection.scope, 'SYSTEM');
    assert.equal(inspection.isRestorableAsDatabase, true);
    assert.equal(inspection.contentsSummary.hasDatabaseSnapshot, true);
    assert.equal(inspection.contentsSummary.hasPdf, false);
    assert.equal(inspection.contentsSummary.hasExcel, false);
    assert.ok(inspection.contentsSummary.totalFiles >= 10);
    assert.equal(inspection.security.pathTraversalSafe, true);
    assert.equal(inspection.security.fileCountWithinLimits, true);
  });

  test('3. Inspector Classifier verifies Site Logical Package structure', async () => {
    const inspection = await classifyPackage(siteBuffer, 'SITE_WORK_BACKUP_SITE_site-1.zip');
    assert.equal(inspection.isValid, true);
    assert.equal(inspection.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(inspection.scope, 'SITE');
    assert.equal(inspection.siteId, 'site-1');
    assert.equal(inspection.isRestorableAsDatabase, false);
    assert.equal(inspection.contentsSummary.hasDatabaseSnapshot, false);
    assert.equal(inspection.contentsSummary.hasPdf, false);
    assert.equal(inspection.contentsSummary.hasExcel, false);
    assert.ok(inspection.contentsSummary.totalFiles >= 8);
    assert.equal(inspection.security.pathTraversalSafe, true);
  });

  test('4. Anti-spoofing defense: Reject modified archive declaring restorable without DB', async () => {
    const zip = await JSZip.loadAsync(siteBuffer);
    // Tamper manifest to fraudulently claim restorableAsDatabase
    const manifestText = await zip.file('manifest.json')!.async('string');
    const manifest = JSON.parse(manifestText);
    manifest.restorableAsDatabase = true;
    zip.file('manifest.json', JSON.stringify(manifest));

    const tamperedBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const inspection = await classifyPackage(tamperedBuf, 'tampered.zip');
    assert.equal(inspection.isValid, false);
    assert.equal(inspection.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.ok(inspection.rejectionReasons.some((r) => r.includes('cannot be restorable as full application database')));
  });

  test('5. Path traversal defense: Reject archive with malicious paths', async () => {
    const zip = await JSZip.loadAsync(siteBuffer);
    zip.file('../../../etc/passwd', 'malicious content');
    const traversalBuf = await zip.generateAsync({ type: 'nodebuffer' });

    const inspection = await classifyPackage(traversalBuf, 'traversal.zip');
    assert.equal(inspection.isValid, false);
    assert.equal(inspection.security.pathTraversalSafe, false);
    assert.ok(inspection.rejectionReasons.some((r) => r.includes('path traversal')));
  });

  test('6. Cleanup created test backups from storage', async () => {
    if (systemBackupId) await deleteBackupFromStorage(systemBackupId);
    if (siteBackupId) await deleteBackupFromStorage(siteBackupId);
  });
});
