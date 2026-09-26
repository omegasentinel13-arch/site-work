import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { calculateBufferSha256, parseChecksumsFile } from '../lib/backup/checksum-service';
import { UserSession } from '../lib/auth/session';

describe('Task 2: Enterprise Backup Packaging & Dataset Isolation', () => {
  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    role: 'ADMIN',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  test('SYSTEM + ALL_DATA: Produces complete standalone restorable database package', async () => {
    const result = await createEnterpriseBackup(
      {
        scope: 'SYSTEM',
        period: 'ALL_DATA',
        includePdf: true,
        includeExcel: true,
      },
      adminSession
    );

    const zip = await JSZip.loadAsync(result.zipBuffer);

    // 1. Mandatory top-level files
    assert.ok(zip.file('manifest.json'), 'manifest.json must exist');
    assert.ok(zip.file('checksums.sha256'), 'checksums.sha256 must exist');
    assert.ok(zip.file('README.txt'), 'README.txt must exist');
    assert.ok(zip.file('data/site_work.db'), 'data/site_work.db must exist');
    assert.ok(zip.file('data/master_export.json'), 'data/master_export.json must exist');
    assert.ok(zip.file('reports/consolidated_report.pdf'), 'consolidated_report.pdf must exist');
    assert.ok(zip.file('reports/consolidated_report.xlsx'), 'consolidated_report.xlsx must exist');

    // 2. Checksum verification
    const checksumText = await zip.file('checksums.sha256')!.async('string');
    const checksumMap = parseChecksumsFile(checksumText);

    for (const [filePath, expectedSha] of checksumMap.entries()) {
      const fileEntry = zip.file(filePath);
      assert.ok(fileEntry, `File ${filePath} declared in checksums.sha256 must exist`);
      const fileBuf = await fileEntry.async('nodebuffer');
      const actualSha = calculateBufferSha256(fileBuf);
      assert.equal(actualSha, expectedSha, `SHA-256 for ${filePath} must match checksum catalog`);
    }

    // 3. Database snapshot integrity
    const dbBuf = await zip.file('data/site_work.db')!.async('nodebuffer');
    const tmpPath = path.join(os.tmpdir(), `test_pkg_verify_${Date.now()}.db`);
    fs.writeFileSync(tmpPath, dbBuf);
    const sandboxDb = new DatabaseSync(tmpPath, { readOnly: true } as any);

    const integrity = sandboxDb.prepare('PRAGMA integrity_check').all() as any;
    assert.equal(integrity[0]?.integrity_check, 'ok');

    const fkViolations = sandboxDb.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkViolations.length, 0, 'Foreign key violations must be 0');

    // Admin user existence
    const adminCheck = sandboxDb.prepare("SELECT count(*) as count FROM users WHERE role = 'ADMIN'").get() as any;
    assert.ok(adminCheck.count > 0, 'Restorable snapshot must contain at least 1 Admin user');

    sandboxDb.close();
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  });

  test('SITE Scope: STRICT SITE ISOLATION — data/site_work.db is completely absent', async () => {
    const result = await createEnterpriseBackup(
      {
        scope: 'SITE',
        siteId: 'site-1',
        period: 'ALL_DATA',
        includePdf: true,
        includeExcel: true,
      },
      adminSession
    );

    const zip = await JSZip.loadAsync(result.zipBuffer);

    // CRITICAL SECURITY INVARIANT: site_work.db must NEVER be present
    assert.equal(zip.file('data/site_work.db'), null, 'data/site_work.db MUST NEVER exist in site backups');
    assert.equal(result.manifest.restorableAsDatabase, false);
    assert.equal(result.manifest.database, undefined);

    // Verify logical datasets exist
    assert.ok(zip.file('data/site_profile.json'), 'site_profile.json must exist');
    assert.ok(zip.file('data/attendance_records.json'), 'attendance_records.json must exist');
    assert.ok(zip.file('data/financial_transactions.json'), 'financial_transactions.json must exist');
    assert.ok(zip.file('data/utilized_roles.json'), 'utilized_roles.json must exist');
    assert.ok(zip.file('data/site_role_rates.json'), 'site_role_rates.json must exist');
    assert.ok(zip.file('data/site_audit_logs.json'), 'site_audit_logs.json must exist');

    // Verify site attendance dataset only contains site-1 data
    const attText = await zip.file('data/attendance_records.json')!.async('string');
    const attRecords = JSON.parse(attText);
    for (const r of attRecords) {
      assert.equal(r.site_id, 'site-1', 'Attendance record site_id must be site-1');
    }

    // Verify site finance dataset only contains site-1 transactions
    const finText = await zip.file('data/financial_transactions.json')!.async('string');
    const finRecords = JSON.parse(finText);
    for (const f of finRecords) {
      assert.equal(f.site_id, 'site-1', 'Finance record site_id must be site-1');
    }
  });
});
