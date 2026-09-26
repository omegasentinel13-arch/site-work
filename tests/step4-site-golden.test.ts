import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { analyzeBackupPackage, executeLogicalRecovery } from '../lib/backup/import';

describe('SUITE 5: SITE BACKUP GOLDEN TEST & ISOLATION', () => {
  const sourceDbPath = path.join(os.tmpdir(), `qa_site_src_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const targetDbPath = path.join(os.tmpdir(), `qa_site_tgt_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
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

  test('validates site isolation in backup and selective site recovery', async () => {
    process.env.DATABASE_PATH = sourceDbPath;
    const targetSiteId = 'site-1';

    const adminSession = {
      userId: 'usr-admin-1',
      username: 'admin',
      role: 'ADMIN' as const,
      assignedSiteIds: [targetSiteId],
      requiresPasswordReset: false,
    };

    // 1. Create site-scoped backup
    const backupResult = await createEnterpriseBackup(
      { scope: 'SITE', siteId: targetSiteId, period: 'ALL_DATA' },
      adminSession
    );

    const zip = await JSZip.loadAsync(backupResult.zipBuffer);

    // 2. Strict Site Isolation: Under no circumstances is site_work.db included
    assert.strictEqual(zip.file('data/site_work.db'), null, 'Site backup must NEVER include site_work.db');

    // 3. Check attendance records in site backup
    const attFile = zip.file('data/attendance_records.json');
    if (attFile) {
      const atts = JSON.parse(await attFile.async('text'));
      for (const a of atts) {
        assert.strictEqual(a.site_id, targetSiteId, 'All attendance records must belong to target site');
      }
    }

    // 4. Recover site backup into clean target DB
    const analysis = await analyzeBackupPackage(backupResult.zipBuffer, { db: targetDb });
    assert.strictEqual(analysis.isTampered, false);
    assert.strictEqual(analysis.scope, 'SITE');

    const result = await executeLogicalRecovery(analysis, {
      db: targetDb,
      actor: adminSession,
    });

    assert.strictEqual(result.success, true);

    // Verify 0 FK check violations
    const fkViolations = targetDb.prepare('PRAGMA foreign_key_check').all();
    assert.strictEqual(fkViolations.length, 0);
  });
});
