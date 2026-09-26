import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { analyzeBackupPackage, executeLogicalRecovery } from '../lib/backup/import';

describe('SUITE 4: GOLDEN RECOVERY DUAL METRICS (DISPOSABLE QA DBS)', () => {
  const sourceDbPath = path.join(os.tmpdir(), `qa_source_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const targetDbPath = path.join(os.tmpdir(), `qa_target_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const originalEnvDb = process.env.DATABASE_PATH;
  let sourceDb: DatabaseSync;
  let targetDb: DatabaseSync;

  before(() => {
    // 1. Initialize Source DB from production database copy
    const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
    fs.copyFileSync(prodDbPath, sourceDbPath);

    // 2. Initialize Target DB with blank schema
    targetDb = new DatabaseSync(targetDbPath);
    sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true } as any);

    // Copy schema from source to target
    const tables = sourceDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all() as any[];
    for (const t of tables) {
      targetDb.exec(t.sql);
    }

    // Target DB gets only the King Maker admin
    targetDb.prepare(`
      INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, created_at, updated_at)
      VALUES ('usr-admin-1', 'admin', 'PRIME_ADMIN_HASH', 'System Administrator', 'ADMIN', 'KING_MAKER', 1, datetime('now'), datetime('now'))
    `).run();
  });

  after(() => {
    process.env.DATABASE_PATH = originalEnvDb;
    try {
      sourceDb.close();
      targetDb.close();
      if (fs.existsSync(sourceDbPath)) fs.unlinkSync(sourceDbPath);
      if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);
    } catch {}
  });

  test('executes golden recovery and validates Dual Metrics A and B', async () => {
    // 1. Create Backup Package from Source DB
    process.env.DATABASE_PATH = sourceDbPath;
    const adminSession = {
      userId: 'usr-admin-1',
      username: 'admin',
      role: 'ADMIN' as const,
      assignedSiteIds: [],
      requiresPasswordReset: false,
    };

    const backupResult = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA' },
      adminSession
    );

    assert.ok(backupResult.zipBuffer.length > 0);

    // 2. Analyze backup against Target DB
    const analysis = await analyzeBackupPackage(backupResult.zipBuffer, { db: targetDb });
    assert.strictEqual(analysis.isTampered, false);
    assert.ok(analysis.totalNewRecords > 0, 'Must have new records to insert');

    // 3. Execute INSERT-ONLY recovery into Target DB
    const recoveryResult = await executeLogicalRecovery(analysis, {
      db: targetDb,
      actor: adminSession,
    });

    assert.strictEqual(recoveryResult.success, true);
    assert.ok(recoveryResult.totalInserted > 0);

    // ─────────────────────────────────────────────────────────────
    // METRIC A: RECOVERABLE DATASET EQUALITY
    // ─────────────────────────────────────────────────────────────
    // 1. Zero Foreign Key Violations
    const fkViolations = targetDb.prepare('PRAGMA foreign_key_check').all();
    assert.strictEqual(fkViolations.length, 0, `FK Check failed: ${JSON.stringify(fkViolations)}`);

    // 2. Database Integrity Check
    const integrityRow = targetDb.prepare('PRAGMA integrity_check').get() as any;
    assert.strictEqual(integrityRow.integrity_check, 'ok');

    // 3. Core entity counts match source DB
    const sourceSites = (sourceDb.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c;
    const targetSites = (targetDb.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c;
    assert.strictEqual(targetSites, sourceSites, 'Recovered sites count must match source');

    const sourceCategories = (sourceDb.prepare('SELECT COUNT(*) as c FROM work_categories').get() as any).c;
    const targetCategories = (targetDb.prepare('SELECT COUNT(*) as c FROM work_categories').get() as any).c;
    assert.strictEqual(targetCategories, sourceCategories, 'Recovered work_categories must match');

    const sourceRoles = (sourceDb.prepare('SELECT COUNT(*) as c FROM work_roles').get() as any).c;
    const targetRoles = (targetDb.prepare('SELECT COUNT(*) as c FROM work_roles').get() as any).c;
    assert.strictEqual(targetRoles, sourceRoles, 'Recovered work_roles must match');

    const sourceAttendance = (sourceDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c;
    const targetAttendance = (targetDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c;
    assert.strictEqual(targetAttendance, sourceAttendance, 'Recovered attendance_records must match');

    const sourceFinance = (sourceDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;
    const targetFinance = (targetDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;
    assert.strictEqual(targetFinance, sourceFinance, 'Recovered financial_transactions must match');

    // ─────────────────────────────────────────────────────────────
    // METRIC B: SECURITY EXCLUSION & AUTHORITY IMMUTABILITY
    // ─────────────────────────────────────────────────────────────
    // 1. King Maker Prime Admin MUST remain untouched
    const primeAdmin = targetDb.prepare("SELECT * FROM users WHERE id = 'usr-admin-1'").get() as any;
    assert.strictEqual(primeAdmin.password_hash, 'PRIME_ADMIN_HASH', 'King Maker password hash must NOT be overwritten');
    assert.strictEqual(primeAdmin.authority_tier, 'KING_MAKER', 'King Maker authority tier must remain KING_MAKER');

    // 2. All newly imported users MUST have quarantined disabled hash and be inactive
    const importedUsers = targetDb.prepare("SELECT * FROM users WHERE id != 'usr-admin-1'").all() as any[];
    for (const u of importedUsers) {
      assert.ok(u.password_hash.startsWith('QUARANTINED_'), `Imported user ${u.username} must have quarantined hash`);
      assert.strictEqual(u.is_active, 0, `Imported user ${u.username} must be quarantined inactive`);
      assert.strictEqual(u.authority_tier, 'STANDARD', `Imported user ${u.username} must have STANDARD authority tier`);
    }

    // 3. Zero recovery tokens
    const tokens = (targetDb.prepare('SELECT COUNT(*) as c FROM recovery_tokens').get() as any).c;
    assert.strictEqual(tokens, 0, 'Target DB must have 0 recovery tokens');
  });
});
