import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { calculateBufferSha256, parseChecksumsFile } from '../lib/backup/checksum-service';
import { classifyPackage } from '../lib/packages/classifier';
import { listStoredBackups, getBackupFilePathById, deleteBackupFromStorage } from '../lib/backup/storage-registry';
import { UserSession } from '../lib/auth/session';

describe('TASK 4 — STEP 3: MASTER BACKUP + SITE BACKUP + BACKUP HISTORY FOUNDATION', () => {
  const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
  const testDbPath = path.join(process.cwd(), 'data', 'test_site_work.db');
  let baselineCounts: Record<string, number> = {};

  // Point to test database for isolation
  process.env.DATABASE_PATH = testDbPath;

  // Import orchestrator after setting DATABASE_PATH
  const { createEnterpriseBackup } = require('../lib/backup/orchestrator');

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

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    role: 'VIEWER',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  // Helper to get table counts from a database file
  function getTableCounts(dbFilePath: string) {
    const db = new DatabaseSync(dbFilePath, { readOnly: true } as any);
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
      'recovery_tokens',
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
    // 1. Assert production database baseline
    baselineCounts = getTableCounts(prodDbPath);
    console.log('--- PRODUCTION DB PRE-TEST BASELINE ---');
    console.log(baselineCounts);
    assert.equal(baselineCounts.users, 6, 'Baseline users must be 6');
    assert.equal(baselineCounts.sites, 6, 'Baseline sites must be 6');
    assert.equal(baselineCounts.audit_logs, 462, 'Baseline audit_logs must be 462');

    // 2. Clone to isolated test database for test runs
    fs.copyFileSync(prodDbPath, testDbPath);
  });

  after(() => {
    // 1. Clean up test database
    try {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      const wal = `${testDbPath}-wal`;
      const shm = `${testDbPath}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {}

    // 2. Assert zero mutations to production database
    const postCounts = getTableCounts(prodDbPath);
    console.log('--- PRODUCTION DB POST-TEST BASELINE ---');
    console.log(postCounts);
    for (const [table, count] of Object.entries(baselineCounts)) {
      assert.equal(
        postCounts[table],
        count,
        `ZERO-MUTATION VIOLATION: Table ${table} count changed from ${count} to ${postCounts[table]}`
      );
    }
  });

  let createdSystemBackupId: string;
  let createdSiteBackupId: string;
  let systemZipBuffer: Buffer;
  let siteZipBuffer: Buffer;

  test('1. SYSTEM BACKUP: Creates complete recovery package without PDF/Excel and with sanitized credentials', async () => {
    const result = await createEnterpriseBackup(
      {
        scope: 'SYSTEM',
        period: 'ALL_DATA',
      },
      adminSession
    );

    createdSystemBackupId = result.backupId;
    systemZipBuffer = result.zipBuffer;

    assert.ok(result.backupId, 'Must return backupId');
    assert.ok(result.fileName.includes('SYSTEM'), 'FileName must indicate SYSTEM');
    assert.ok(result.sizeBytes > 0, 'SizeBytes must be greater than 0');
    assert.ok(result.zipSha256, 'Must calculate SHA-256');
    assert.equal(result.manifest.scope, 'SYSTEM');
    assert.equal(result.manifest.restorableAsDatabase, true);

    const zip = await JSZip.loadAsync(result.zipBuffer);

    // Assert mandatory recovery files
    assert.ok(zip.file('manifest.json'), 'manifest.json must exist');
    assert.ok(zip.file('README.txt'), 'README.txt must exist');
    assert.ok(zip.file('checksums.sha256'), 'checksums.sha256 must exist');
    assert.ok(zip.file('data/site_work.db'), 'data/site_work.db must exist for restorable system backup');
    assert.ok(zip.file('data/system_state.json'), 'data/system_state.json must exist');
    assert.ok(zip.file('data/master_export.json'), 'data/master_export.json must exist');
    assert.ok(zip.file('data/users.json'), 'data/users.json must exist');
    assert.ok(zip.file('data/sites.json'), 'data/sites.json must exist');
    assert.ok(zip.file('data/attendance_records.json'), 'data/attendance_records.json must exist');
    assert.ok(zip.file('data/financial_transactions.json'), 'data/financial_transactions.json must exist');
    assert.ok(zip.file('data/work_roles.json'), 'data/work_roles.json must exist');
    assert.ok(zip.file('data/work_categories.json'), 'data/work_categories.json must exist');
    assert.ok(zip.file('data/site_role_rates.json'), 'data/site_role_rates.json must exist');
    assert.ok(zip.file('data/investors.json'), 'data/investors.json must exist');
    assert.ok(zip.file('data/audit_logs.json'), 'data/audit_logs.json must exist');

    // NON-NEGOTIABLE CONSTRAINT: ZERO PDF, ZERO EXCEL inside backup archives
    assert.equal(zip.file('reports/consolidated_report.pdf'), null, 'NO PDF report in backup archive');
    assert.equal(zip.file('reports/consolidated_report.xlsx'), null, 'NO Excel report in backup archive');
    const allFiles = Object.keys(zip.files);
    assert.ok(!allFiles.some((f) => f.toLowerCase().endsWith('.pdf')), 'Archive must contain zero PDF files');
    assert.ok(!allFiles.some((f) => f.toLowerCase().endsWith('.xlsx')), 'Archive must contain zero Excel files');

    // Checksum verification
    const checksumText = await zip.file('checksums.sha256')!.async('string');
    const checksumMap = parseChecksumsFile(checksumText);
    for (const [filePath, expectedSha] of checksumMap.entries()) {
      const fileEntry = zip.file(filePath);
      assert.ok(fileEntry, `Declared file ${filePath} must exist in archive`);
      const fileBuf = await fileEntry.async('nodebuffer');
      const actualSha = calculateBufferSha256(fileBuf);
      assert.equal(actualSha, expectedSha, `SHA-256 for ${filePath} must match checksum catalog`);
    }

    // Security Verification: users.json must NOT contain password_hash, recovery_email, or recovery_tokens
    const usersJsonText = await zip.file('data/users.json')!.async('string');
    const usersList = JSON.parse(usersJsonText);
    assert.ok(Array.isArray(usersList) && usersList.length > 0, 'Users array must be present');
    for (const u of usersList) {
      assert.equal(u.password_hash, undefined, 'password_hash must be excluded from exported users');
      assert.equal(u.recovery_email, undefined, 'recovery_email must be excluded from exported users');
      assert.equal(u.token_hash, undefined, 'token_hash must be excluded from exported users');
      assert.ok(u.id && u.username && u.role, 'Sanitized fields id, username, role must exist');
    }

    // Database binary verification in isolated sandbox
    const dbBuf = await zip.file('data/site_work.db')!.async('nodebuffer');
    const tmpPath = path.join(os.tmpdir(), `test_step3_db_${Date.now()}.db`);
    fs.writeFileSync(tmpPath, dbBuf);

    const sandboxDb = new DatabaseSync(tmpPath, { readOnly: true } as any);
    const integrity = sandboxDb.prepare('PRAGMA integrity_check').all() as any;
    assert.equal(integrity[0]?.integrity_check, 'ok', 'Database integrity check must be ok');

    const fkViolations = sandboxDb.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkViolations.length, 0, 'Foreign key violations must be 0');

    // Recovery tokens must be 0 in the snapshot binary
    const tokenCount = sandboxDb.prepare('SELECT count(*) as count FROM recovery_tokens').get() as any;
    assert.equal(tokenCount.count, 0, 'recovery_tokens must be purged in snapshot binary');

    sandboxDb.close();
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  });

  test('2. SITE BACKUP: Creates isolated single-site package with utilized dependencies and STRICT site isolation', async () => {
    const result = await createEnterpriseBackup(
      {
        scope: 'SITE',
        siteId: 'site-1',
        period: 'ALL_DATA',
      },
      adminSession
    );

    createdSiteBackupId = result.backupId;
    siteZipBuffer = result.zipBuffer;

    assert.ok(result.backupId, 'Must return backupId');
    assert.ok(result.fileName.includes('SITE') || result.fileName.includes('site'), 'FileName must indicate site');
    assert.equal(result.manifest.scope, 'SITE');
    assert.equal(result.manifest.siteId, 'site-1');
    assert.equal(result.manifest.restorableAsDatabase, false);
    assert.equal(result.manifest.database, undefined);

    const zip = await JSZip.loadAsync(result.zipBuffer);

    // CRITICAL SECURITY INVARIANT: site_work.db must NEVER be present in site backups
    assert.equal(zip.file('data/site_work.db'), null, 'data/site_work.db MUST NEVER exist in site backups');

    // Assert site logical datasets exist
    assert.ok(zip.file('manifest.json'), 'manifest.json must exist');
    assert.ok(zip.file('README.txt'), 'README.txt must exist');
    assert.ok(zip.file('checksums.sha256'), 'checksums.sha256 must exist');
    assert.ok(zip.file('data/site_profile.json'), 'site_profile.json must exist');
    assert.ok(zip.file('data/site_users.json'), 'site_users.json must exist');
    assert.ok(zip.file('data/attendance_records.json'), 'attendance_records.json must exist');
    assert.ok(zip.file('data/financial_transactions.json'), 'financial_transactions.json must exist');
    assert.ok(zip.file('data/utilized_roles.json'), 'utilized_roles.json must exist');
    assert.ok(zip.file('data/utilized_categories.json'), 'utilized_categories.json must exist');
    assert.ok(zip.file('data/site_role_rates.json'), 'site_role_rates.json must exist');
    assert.ok(zip.file('data/supply_items.json'), 'supply_items.json must exist');
    assert.ok(zip.file('data/site_lifecycle_records.json'), 'site_lifecycle_records.json must exist');
    assert.ok(zip.file('data/site_audit_logs.json'), 'site_audit_logs.json must exist');

    // NO PDF, NO Excel
    const allFiles = Object.keys(zip.files);
    assert.ok(!allFiles.some((f) => f.toLowerCase().endsWith('.pdf')), 'Site backup must contain zero PDF files');
    assert.ok(!allFiles.some((f) => f.toLowerCase().endsWith('.xlsx')), 'Site backup must contain zero Excel files');

    // Verify site attendance dataset only contains site-1 records
    const attText = await zip.file('data/attendance_records.json')!.async('string');
    const attRecords = JSON.parse(attText);
    for (const r of attRecords) {
      assert.equal(r.site_id, 'site-1', 'Attendance record site_id must be site-1');
    }

    // Verify site finance dataset only contains site-1 records
    const finText = await zip.file('data/financial_transactions.json')!.async('string');
    const finRecords = JSON.parse(finText);
    for (const f of finRecords) {
      assert.equal(f.site_id, 'site-1', 'Finance record site_id must be site-1');
    }

    // Checksums check
    const checksumText = await zip.file('checksums.sha256')!.async('string');
    const checksumMap = parseChecksumsFile(checksumText);
    for (const [filePath, expectedSha] of checksumMap.entries()) {
      const fileEntry = zip.file(filePath);
      assert.ok(fileEntry, `Declared file ${filePath} must exist in site backup`);
      const fileBuf = await fileEntry.async('nodebuffer');
      const actualSha = calculateBufferSha256(fileBuf);
      assert.equal(actualSha, expectedSha, `SHA-256 for ${filePath} must match checksums.sha256`);
    }
  });

  test('3. PACKAGE CLASSIFIER: Correctly classifies System and Site recovery archives', async () => {
    // Classify System Backup
    const systemClassification = await classifyPackage(systemZipBuffer);
    assert.equal(systemClassification.isValid, true, 'System backup must be valid');
    assert.equal(systemClassification.classification, 'SYSTEM_RECOVERY_BACKUP');
    assert.equal(systemClassification.scope, 'SYSTEM');
    assert.equal(systemClassification.isRestorableAsDatabase, true);
    assert.equal(systemClassification.contentsSummary.hasDatabaseSnapshot, true);
    assert.equal(systemClassification.contentsSummary.hasPdf, false);
    assert.equal(systemClassification.contentsSummary.hasExcel, false);
    assert.equal(systemClassification.rejectionReasons.length, 0);

    // Classify Site Backup
    const siteClassification = await classifyPackage(siteZipBuffer);
    assert.equal(siteClassification.isValid, true, 'Site backup must be valid');
    assert.equal(siteClassification.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(siteClassification.scope, 'SITE');
    assert.equal(siteClassification.siteId, 'site-1');
    assert.equal(siteClassification.isRestorableAsDatabase, false);
    assert.equal(siteClassification.contentsSummary.hasDatabaseSnapshot, false);
    assert.equal(siteClassification.contentsSummary.hasPdf, false);
    assert.equal(siteClassification.contentsSummary.hasExcel, false);
    assert.equal(siteClassification.rejectionReasons.length, 0);
  });

  test('4. BACKUP STORAGE REGISTRY: Lists, locates, and preserves stored backups with isolation', async () => {
    // Admin sees all backups
    const adminList = await listStoredBackups(adminSession);
    assert.ok(adminList.length >= 2, 'Admin must see at least the 2 newly created backups');
    const foundSystem = adminList.find((b) => b.id === createdSystemBackupId);
    assert.ok(foundSystem, 'System backup must be found in registry');
    assert.equal(foundSystem.manifest.scope, 'SYSTEM');

    // Site Manager only sees assigned site backups (never system backups)
    const smList = await listStoredBackups(siteManagerSession);
    assert.ok(!smList.some((b) => b.manifest.scope === 'SYSTEM'), 'Site Manager must NEVER see SYSTEM backups');
    const foundSiteForSm = smList.find((b) => b.id === createdSiteBackupId);
    assert.ok(foundSiteForSm, 'Site Manager must see assigned site-1 backup');

    // Viewer sees zero backups
    const viewerList = await listStoredBackups(viewerSession);
    assert.equal(viewerList.length, 0, 'Viewer must see empty backup list');

    // File path lookup
    const resolvedPath = await getBackupFilePathById(createdSystemBackupId);
    assert.ok(resolvedPath && fs.existsSync(resolvedPath), 'Backup file must exist on disk');
  });

  test('5. RBAC BOUNDARY ENFORCEMENT: System Backup and Site Backup authority checks', async () => {
    // Non-Admin cannot create SYSTEM backup
    await assert.rejects(
      async () => {
        await createEnterpriseBackup({ scope: 'SYSTEM' }, siteManagerSession);
      },
      /Access denied: System-wide backup requires Administrator privileges/
    );

    // Site Manager cannot create backup for unassigned site
    await assert.rejects(
      async () => {
        await createEnterpriseBackup({ scope: 'SITE', siteId: 'site-2' }, siteManagerSession);
      },
      /Access denied: You are not authorized to access site site-2/
    );

    // Site Manager CAN create backup for assigned site
    const smResult = await createEnterpriseBackup(
      { scope: 'SITE', siteId: 'site-1' },
      siteManagerSession
    );
    assert.ok(smResult.backupId, 'Site Manager successfully created assigned site backup');

    // Clean up smResult
    await deleteBackupFromStorage(smResult.backupId);

    // Viewer cannot create ANY backup
    await assert.rejects(
      async () => {
        await createEnterpriseBackup({ scope: 'SYSTEM' }, viewerSession);
      },
      /Access denied: Viewers cannot generate backup archives/
    );

    await assert.rejects(
      async () => {
        await createEnterpriseBackup({ scope: 'SITE', siteId: 'site-1' }, viewerSession);
      },
      /Access denied: Viewers cannot generate backup archives/
    );
  });

  test('6. CLEANUP & SAFETY SNAPSHOT PROTECTION', async () => {
    // Delete test generated backups from storage
    if (createdSystemBackupId) {
      await deleteBackupFromStorage(createdSystemBackupId);
    }
    if (createdSiteBackupId) {
      await deleteBackupFromStorage(createdSiteBackupId);
    }

    // Attempting to delete a pre-restore safety backup must fail
    await assert.rejects(
      async () => {
        await deleteBackupFromStorage('safety-pre-restore-123');
      },
      /PROTECTED_SAFETY_SNAPSHOT/
    );

    await assert.rejects(
      async () => {
        await deleteBackupFromStorage('pre-restore-safety_2026-09-22.zip');
      },
      /PROTECTED_SAFETY_SNAPSHOT/
    );
  });
});
