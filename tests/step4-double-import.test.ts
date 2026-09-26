import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { analyzeBackupPackage, executeLogicalRecovery } from '../lib/backup/import';

describe('SUITE 6: DOUBLE-IMPORT IDEMPOTENCY (DISPOSABLE QA DB)', () => {
  const sourceDbPath = path.join(os.tmpdir(), `qa_idem_src_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const targetDbPath = path.join(os.tmpdir(), `qa_idem_tgt_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const originalEnvDb = process.env.DATABASE_PATH;
  let sourceDb: DatabaseSync;
  let targetDb: DatabaseSync;

  before(() => {
    const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
    fs.copyFileSync(prodDbPath, sourceDbPath);

    targetDb = new DatabaseSync(targetDbPath);
    sourceDb = new DatabaseSync(sourceDbPath, { readOnly: true } as any);

    const tables = sourceDb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all() as any[];
    for (const t of tables) {
      targetDb.exec(t.sql);
    }

    targetDb.prepare(`
      INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, created_at, updated_at)
      VALUES ('usr-admin-1', 'admin', 'HASH', 'Admin', 'ADMIN', 'KING_MAKER', 1, datetime('now'), datetime('now'))
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

  test('validates that importing the same package twice results in 0 insertions on second run and no mutations', async () => {
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

    // ── RUN 1: Initial Import ────────────────────────────────────
    const analysis1 = await analyzeBackupPackage(backupResult.zipBuffer, { db: targetDb });
    const initialNewCount = analysis1.totalNewRecords;
    assert.ok(initialNewCount > 0, 'First run must detect new records');

    const result1 = await executeLogicalRecovery(analysis1, {
      db: targetDb,
      actor: adminSession,
    });
    assert.strictEqual(result1.success, true);
    assert.strictEqual(result1.totalInserted, initialNewCount);

    // Snapshot target counts after Run 1
    const sitesCountAfterRun1 = (targetDb.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c;
    const attCountAfterRun1 = (targetDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c;
    const finCountAfterRun1 = (targetDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;

    // ── RUN 2: Re-Import Same Package ────────────────────────────
    const analysis2 = await analyzeBackupPackage(backupResult.zipBuffer, { db: targetDb });
    assert.strictEqual(analysis2.totalNewRecords, 0, 'Second run must have 0 new records');
    assert.ok(analysis2.totalMatchedExact > 0, 'Second run must match existing records exactly');

    const result2 = await executeLogicalRecovery(analysis2, {
      db: targetDb,
      actor: adminSession,
    });
    assert.strictEqual(result2.success, true);
    assert.strictEqual(result2.totalInserted, 0, 'Second run must insert 0 records');

    // Verify target counts are completely unchanged after Run 2
    const sitesCountAfterRun2 = (targetDb.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c;
    const attCountAfterRun2 = (targetDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c;
    const finCountAfterRun2 = (targetDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c;

    assert.strictEqual(sitesCountAfterRun2, sitesCountAfterRun1);
    assert.strictEqual(attCountAfterRun2, attCountAfterRun1);
    assert.strictEqual(finCountAfterRun2, finCountAfterRun1);
  });
});
