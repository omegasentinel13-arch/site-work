import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { deepValidateBackupArchive } from '../lib/restore/deep-validator';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { UserSession } from '../lib/auth/session';

describe('Task 2: Deep Sandbox Validation & Restoration Invariants', () => {
  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    role: 'ADMIN',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  test('Valid SYSTEM + ALL_DATA backup passes deep validation with 0 blocking issues', async () => {
    const backup = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    const validation = await deepValidateBackupArchive(backup.zipBuffer);
    assert.equal(validation.isValid, true);
    assert.equal(validation.hasBlockingIssues, false);
    assert.ok(validation.extractedDbBuffer);
    assert.equal(validation.dbMetrics?.integrityCheck, 'ok');
    assert.equal(validation.dbMetrics?.foreignKeyViolations, 0);
    assert.ok(validation.dbMetrics?.tableCounts.users! > 0);
  });

  test('REJECT: Site-scoped backup is blocked from database restoration', async () => {
    const siteBackup = await createEnterpriseBackup(
      { scope: 'SITE', siteId: 'site-1', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    const validation = await deepValidateBackupArchive(siteBackup.zipBuffer);
    assert.equal(validation.isValid, false);
    assert.equal(validation.hasBlockingIssues, true);
    assert.ok(
      validation.conflicts.some((c) => c.code === 'SITE_SCOPE_RESTORE_BLOCKED'),
      'Must contain SITE_SCOPE_RESTORE_BLOCKED conflict'
    );
  });

  test('REJECT: Checksum mismatch detects tampered file', async () => {
    const backup = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    // Tamper with master_export.json inside ZIP
    const zip = await JSZip.loadAsync(backup.zipBuffer);
    zip.file('data/master_export.json', JSON.stringify({ tampered: true }));
    const tamperedZipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    const validation = await deepValidateBackupArchive(tamperedZipBuf);
    assert.equal(validation.isValid, false);
    assert.equal(validation.hasBlockingIssues, true);
    assert.ok(
      validation.conflicts.some((c) => c.code === 'CHECKSUM_MISMATCH'),
      'Must detect CHECKSUM_MISMATCH'
    );
  });

  test('REJECT: Corrupted SQLite binary is caught in sandbox', async () => {
    const backup = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    // Tamper with SQLite bytes (write garbage)
    const zip = await JSZip.loadAsync(backup.zipBuffer);
    zip.file('data/site_work.db', Buffer.from('NOT A VALID SQLITE DATABASE BINARY'));
    const badDbZipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    const validation = await deepValidateBackupArchive(badDbZipBuf);
    assert.equal(validation.isValid, false);
    assert.equal(validation.hasBlockingIssues, true);
  });

  test('REJECT: Missing manifest.json triggers blocking conflict', async () => {
    const zip = new JSZip();
    zip.file('data/test.txt', 'hello');
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    const validation = await deepValidateBackupArchive(zipBuf);
    assert.equal(validation.isValid, false);
    assert.equal(validation.hasBlockingIssues, true);
    assert.ok(validation.conflicts.some((c) => c.code === 'MISSING_MANIFEST'));
  });
});
