import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { analyzeBackupPackage, executeLogicalRecovery } from '../lib/backup/import';

describe('SUITE 7: CORRUPTION & TAMPERING DETECTION', () => {
  const tmpDbPath = path.join(os.tmpdir(), `qa_corrupt_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const originalEnvDb = process.env.DATABASE_PATH;

  before(() => {
    const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
    fs.copyFileSync(prodDbPath, tmpDbPath);
    process.env.DATABASE_PATH = tmpDbPath;
  });

  after(() => {
    process.env.DATABASE_PATH = originalEnvDb;
    try {
      if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
    } catch {}
  });

  test('detects tampered files via checksum validation and refuses execution', async () => {
    const adminSession = {
      userId: 'usr-admin-1',
      username: 'admin',
      role: 'ADMIN' as const,
      assignedSiteIds: [],
      requiresPasswordReset: false,
    };

    // 1. Generate valid backup
    const backupResult = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA' },
      adminSession
    );

    // 2. Tamper with one file inside the ZIP
    const zip = await JSZip.loadAsync(backupResult.zipBuffer);
    const sitesFile = zip.file('data/sites.json');
    assert.ok(sitesFile, 'data/sites.json must exist');

    // Corrupt the content
    zip.file('data/sites.json', '[{"id":"tampered-site","name":"Hacked Site"}]');

    const tamperedZipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // 3. Analyze tampered package
    const analysis = await analyzeBackupPackage(tamperedZipBuffer);

    assert.strictEqual(analysis.isTampered, true, 'Analyzer must detect tampered package');
    assert.ok(analysis.tamperDetails && analysis.tamperDetails.length > 0);
    assert.ok(analysis.tamperDetails[0].includes('Checksum mismatch in data/sites.json'));

    // 4. Attempt to execute recovery on tampered package -> MUST throw RECOVERY_REFUSED
    await assert.rejects(
      async () => {
        await executeLogicalRecovery(analysis, { actor: adminSession });
      },
      /RECOVERY_REFUSED/
    );
  });
});
