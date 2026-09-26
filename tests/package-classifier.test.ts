import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { DatabaseSync } from 'node:sqlite';
import { classifyPackage } from '../lib/packages/classifier';
import { PACKAGE_SECURITY_LIMITS } from '../lib/packages/types';

// Helper to create valid dummy SQLite database buffer (SQLite format 3 header)
function createDummySqliteBuffer(): Buffer {
  const buf = Buffer.alloc(4096);
  buf.write('SQLite format 3\0', 0, 16, 'utf-8');
  return buf;
}

// Helper to assemble in-memory ZIP buffer
async function buildZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content);
  }
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('Task 3: Universal Package Contract & Classifier Matrix', () => {

  // A. Valid REPORT_EXPORT
  test('A. Valid REPORT_EXPORT is classified correctly with safe actions', async () => {
    const reportManifest = {
      application: 'AB_CONSTRUCTIONS_SITE_WORK',
      exportVersion: 1,
      exportType: 'COMPLETE_SITE',
      generatedAt: '2026-09-06T10:00:00.000Z',
      generatedBy: { id: 'usr-1', username: 'engineer1', role: 'SITE_MANAGER' },
      scope: { type: 'SITE', siteId: 'site-1', siteName: 'Downtown Tower' },
      period: { preset: 'THIS_MONTH', from: '2026-09-01', to: '2026-09-30', label: 'September 2026' },
      formatsIncluded: ['PDF', 'EXCEL', 'JSON'],
      recordCounts: { attendanceRecords: 10, financialTransactions: 5, workRoles: 4, workCategories: 2, sites: 1 },
      files: [
        { path: 'data/report.json', format: 'JSON', bytes: 1024 },
        { path: 'pdf/report.pdf', format: 'PDF', bytes: 2048 },
      ],
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(reportManifest, null, 2),
      'data/report.json': JSON.stringify({ summary: 'ok' }),
      'pdf/report.pdf': Buffer.from('%PDF-1.4 dummy pdf content'),
      'README.txt': 'Report export readme',
    });

    const result = await classifyPackage(zipBuf, 'site_report_export.zip');

    assert.equal(result.classification, 'REPORT_EXPORT');
    assert.equal(result.isValid, true);
    assert.equal(result.isRestorableAsDatabase, false);
    assert.equal(result.scope, 'SITE');
    assert.equal(result.siteId, 'site-1');
    assert.equal(result.siteName, 'Downtown Tower');
    assert.equal(result.contentsSummary.hasDatabaseSnapshot, false);
    assert.equal(result.contentsSummary.hasPdf, true);
    assert.equal(result.contentsSummary.hasJson, true);
    assert.deepEqual(result.availableActions, ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES']);
    assert.equal(result.rejectionReasons.length, 0);
  });

  // B. Valid SITE_LOGICAL_BACKUP
  test('B. Valid SITE_LOGICAL_BACKUP is classified correctly without DB restore actions', async () => {
    const siteBackupManifest = {
      manifestVersion: '1.0',
      backupId: 'bak-site-12345',
      backupTimestamp: '2026-09-06T10:30:00.000Z',
      projectName: 'SITE WORK',
      applicationVersion: '1.0.0',
      schemaVersion: '1.0.0',
      scope: 'SITE',
      siteId: 'site-2',
      siteName: 'Riverside Complex',
      periodPreset: 'ALL_DATA',
      isUnbounded: true,
      dateRange: { startDate: '2026-08-01', endDate: '2026-09-05' },
      restorableAsDatabase: false,
      createdBy: { userId: 'usr-eng', username: 'engineer1', role: 'SITE_MANAGER' },
      files: [{ path: 'data/site_profile.json', format: 'JSON', sizeBytes: 500, sha256: 'abc' }],
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(siteBackupManifest, null, 2),
      'data/site_profile.json': JSON.stringify({ id: 'site-2', name: 'Riverside Complex' }),
      'data/attendance_records.json': JSON.stringify([{ id: 'att-1' }]),
      'data/financial_transactions.json': JSON.stringify([{ id: 'fin-1' }]),
      'checksums.sha256': 'abc  data/site_profile.json\n',
      'README.txt': 'Site backup readme',
    });

    const result = await classifyPackage(zipBuf, 'riverside_backup.zip');

    assert.equal(result.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(result.isValid, true);
    assert.equal(result.isRestorableAsDatabase, false);
    assert.equal(result.scope, 'SITE');
    assert.equal(result.siteId, 'site-2');
    assert.equal(result.contentsSummary.hasDatabaseSnapshot, false);
    assert.deepEqual(result.availableActions, ['PREVIEW_LOGICAL_DATA', 'DIFF_WITH_ACTIVE_SITE']);
    assert.equal(result.rejectionReasons.length, 0);
  });

  // C. Valid SYSTEM_RECOVERY_BACKUP
  test('C. Valid SYSTEM_RECOVERY_BACKUP satisfies all invariants and qualifies for DB restore', async () => {
    const sqliteBuf = createDummySqliteBuffer();

    const systemRecoveryManifest = {
      manifestVersion: '1.0',
      backupId: 'bak-system-recovery-999',
      backupTimestamp: '2026-09-06T11:00:00.000Z',
      projectName: 'SITE WORK',
      applicationVersion: '1.0.0',
      schemaVersion: '1.0.0',
      scope: 'SYSTEM',
      periodPreset: 'ALL_DATA',
      isUnbounded: true,
      dateRange: { startDate: null, endDate: null },
      restorableAsDatabase: true,
      createdBy: { userId: 'usr-admin', username: 'Iamadmin', role: 'ADMIN' },
      database: {
        included: true,
        isStandalone: true,
        sizeBytes: sqliteBuf.length,
        sha256: 'dummy-sha256',
        integrityCheck: 'ok',
        tableCounts: { users: 4, sites: 6 },
      },
      files: [{ path: 'data/site_work.db', format: 'SQLITE', sizeBytes: sqliteBuf.length, sha256: 'dummy' }],
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(systemRecoveryManifest, null, 2),
      'data/site_work.db': sqliteBuf,
      'data/master_export.json': JSON.stringify({ system: true }),
      'checksums.sha256': 'dummy  data/site_work.db\n',
      'README.txt': 'System recovery readme',
    });

    const result = await classifyPackage(zipBuf, 'enterprise_disaster_recovery.zip');

    assert.equal(result.classification, 'SYSTEM_RECOVERY_BACKUP');
    assert.equal(result.isValid, true);
    assert.equal(result.isRestorableAsDatabase, true);
    assert.equal(result.scope, 'SYSTEM');
    assert.equal(result.contentsSummary.hasDatabaseSnapshot, true);
    assert.deepEqual(result.availableActions, ['SIMULATE_DATABASE_RESTORE', 'EXECUTE_DATABASE_RESTORE']);
    assert.equal(result.rejectionReasons.length, 0);
  });

  // D. Missing Manifest
  test('D. Missing manifest returns CORRUPT_OR_UNRECOGNIZED', async () => {
    const zipBuf = await buildZipBuffer({
      'data/some_file.json': JSON.stringify({ a: 1 }),
      'README.txt': 'Missing manifest',
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.isValid, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('missing required root manifest.json')));
    assert.deepEqual(result.availableActions, []);
  });

  // E. Malformed Manifest JSON
  test('E. Malformed manifest JSON returns CORRUPT_OR_UNRECOGNIZED', async () => {
    const zipBuf = await buildZipBuffer({
      'manifest.json': '{ bad_json: invalid syntax... ',
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.isValid, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('Malformed manifest.json')));
  });

  // F. SYSTEM metadata but missing DB
  test('F. Anti-Spoofing: SYSTEM claims restorable recovery backup but DB is missing', async () => {
    const fakeManifest = {
      manifestVersion: '1.0',
      scope: 'SYSTEM',
      periodPreset: 'ALL_DATA',
      isUnbounded: true,
      restorableAsDatabase: true,
      database: { isStandalone: true },
      files: [],
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(fakeManifest),
      'data/other_data.json': '{}',
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.isValid, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('data/site_work.db is absent')));
  });

  // G. SITE metadata + DB present
  test('G. Anti-Spoofing: SITE backup contains DB snapshot (Site Isolation Violation)', async () => {
    const fakeSiteManifest = {
      manifestVersion: '1.0',
      scope: 'SITE',
      siteId: 'site-1',
      restorableAsDatabase: false,
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(fakeSiteManifest),
      'data/site_work.db': createDummySqliteBuffer(),
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.isValid, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('SITE_LOGICAL_BACKUP must never contain physical SQLite database')));
  });

  // H. SYSTEM + date-filtered + DB present
  test('H. Anti-Spoofing: SYSTEM + date-filtered + DB is rejected as non-restorable/corrupt', async () => {
    const dateFilteredManifest = {
      manifestVersion: '1.0',
      scope: 'SYSTEM',
      periodPreset: 'LAST_30_DAYS',
      isUnbounded: false,
      restorableAsDatabase: true, // Contradiction: partial date claiming restorable
      database: { isStandalone: true },
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(dateFilteredManifest),
      'data/site_work.db': createDummySqliteBuffer(),
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.isValid, false);
    assert.ok(result.rejectionReasons.some((r) => r.toLowerCase().includes('date-filtered')));
  });

  // I. restorableAsDatabase=true + SITE scope
  test('I. Anti-Spoofing: restorableAsDatabase=true with SITE scope is rejected', async () => {
    const invalidSiteManifest = {
      manifestVersion: '1.0',
      scope: 'SITE',
      siteId: 'site-1',
      restorableAsDatabase: true, // Contradiction
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(invalidSiteManifest),
      'data/site_profile.json': '{}',
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.isValid, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('SITE_LOGICAL_BACKUP cannot be restorable')));
  });

  // J. Filename Spoofing: Internal content wins
  test('J. Filename Spoofing: Name says SYSTEM_RECOVERY but content is REPORT_EXPORT', async () => {
    const reportManifest = {
      exportType: 'COMPLETE_SYSTEM',
      exportVersion: 1,
      scope: { type: 'SYSTEM' },
      period: { preset: 'ALL_DATA', label: 'All Data' },
      generatedAt: '2026-09-06T10:00:00.000Z',
      generatedBy: { username: 'admin', role: 'ADMIN' },
    };

    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify(reportManifest),
      'data/master.json': '{}',
      'pdf/report.pdf': '%PDF-1.4',
    });

    // Caller provides deceptive filename hint:
    const result = await classifyPackage(zipBuf, 'SYSTEM_RECOVERY_DISASTER_BACKUP_2026.zip');

    // Classifier MUST disregard filename and inspect content:
    assert.equal(result.classification, 'REPORT_EXPORT');
    assert.equal(result.isRestorableAsDatabase, false);
    assert.deepEqual(result.availableActions, ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES']);
  });

  // K. Path Traversal
  test('K. Security: Path traversal in ZIP entries is strictly rejected', async () => {
    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify({ exportType: 'COMPLETE_SITE', scope: { type: 'SITE' } }),
      '../../etc/passwd': 'malicious content',
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.security.pathTraversalSafe, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('path traversal')));
  });

  // L. ZIP Bomb / Exceeding uncompressed limit
  test('L. Security: Exceeding max uncompressed size boundary is rejected', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ manifestVersion: '1.0' }));
    zip.file('bomb_file.dat', 'payload');

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    // Patch central directory entry (signature 0x02014b50) at offset + 24 to declare 600 MB uncompressed
    const cdIdx = zipBuf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(cdIdx > 0, 'Central directory header must be found');
    const modBuf = Buffer.from(zipBuf);
    modBuf.writeUInt32LE(600 * 1024 * 1024, cdIdx + 24);

    const result = await classifyPackage(modBuf);

    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.security.uncompressedSizeWithinLimits, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('exceeds')));
  });

  // M. Excessive Entry Count
  test('M. Security: Exceeding maximum file count limit (>1000) is rejected', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', '{}');
    for (let i = 0; i < 1005; i++) {
      zip.file(`entries/file_${i}.txt`, 'content');
    }

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await classifyPackage(zipBuf);

    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(result.security.fileCountWithinLimits, false);
    assert.ok(result.rejectionReasons.some((r) => r.includes('excessive files') || r.includes('limit: 1000')));
  });

  // N. Duplicate Suspicious Entries
  test('N. Security: Duplicate case-insensitive entries are rejected', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', '{}');
    zip.file('data/report.json', '{}');
    zip.file('DATA/REPORT.JSON', '{}'); // Duplicate case-insensitive collision

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await classifyPackage(zipBuf);

    assert.equal(result.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.ok(result.rejectionReasons.some((r) => r.includes('Duplicate case-insensitive entry')));
  });

  // O. Valid Package with Checksum Metadata
  test('O. Checksum Metadata: Noted in contentsSummary but not falsely marked cryptographically verified', async () => {
    const zipBuf = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        manifestVersion: '1.0',
        scope: 'SITE',
        siteId: 'site-1',
        restorableAsDatabase: false,
      }),
      'data/site_profile.json': '{}',
      'checksums.sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  data/site_profile.json\n',
    });

    const result = await classifyPackage(zipBuf);
    assert.equal(result.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(result.contentsSummary.checksumsFilePresent, true);
    // Classifier only classifies; deep validation is left to deep-validator
    assert.equal(result.isRestorableAsDatabase, false);
  });

  // P. Classifier Does NOT Mutate Database
  test('P. Database Safety: Classifier execution performs 0 database writes', async () => {
    const db = new DatabaseSync('data/site_work.db', { readOnly: true });
    const getCounts = () => {
      const counts: Record<string, number> = {};
      const tables = ['users', 'sites', 'site_users', 'work_categories', 'work_roles', 'attendance_records', 'financial_transactions', 'audit_logs'];
      for (const t of tables) {
        counts[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any).c;
      }
      return counts;
    };

    const countsBefore = getCounts();

    // Execute classifier multiple times across all package types
    const dummyZip = await buildZipBuffer({ 'manifest.json': '{}' });
    await classifyPackage(dummyZip);
    await classifyPackage(dummyZip, 'fake.zip');

    const countsAfter = getCounts();
    db.close();

    assert.deepEqual(countsBefore, countsAfter, 'Database row counts must be 100% identical before and after classifier execution');
  });

  // Q. Action List Verification for Each Classification
  test('Q. Action List Matrix: Correct action mappings for all classifications', async () => {
    // 1. REPORT_EXPORT actions
    const reportZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({ exportType: 'COMPLETE_SITE', scope: { type: 'SITE' } }),
      'data/test.json': '{}',
    });
    const r1 = await classifyPackage(reportZip);
    assert.deepEqual(r1.availableActions, ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES']);

    // 2. SITE_LOGICAL_BACKUP actions
    const siteZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({ manifestVersion: '1.0', scope: 'SITE', siteId: 's1', restorableAsDatabase: false }),
      'data/site_profile.json': '{}',
    });
    const r2 = await classifyPackage(siteZip);
    assert.deepEqual(r2.availableActions, ['PREVIEW_LOGICAL_DATA', 'DIFF_WITH_ACTIVE_SITE']);

    // 3. SYSTEM_RECOVERY_BACKUP actions
    const sysZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        manifestVersion: '1.0',
        scope: 'SYSTEM',
        periodPreset: 'ALL_DATA',
        isUnbounded: true,
        restorableAsDatabase: true,
        database: { isStandalone: true },
      }),
      'data/site_work.db': createDummySqliteBuffer(),
    });
    const r3 = await classifyPackage(sysZip);
    assert.deepEqual(r3.availableActions, ['SIMULATE_DATABASE_RESTORE', 'EXECUTE_DATABASE_RESTORE']);

    // 4. CORRUPT_OR_UNRECOGNIZED actions
    const badZip = await buildZipBuffer({ 'other.txt': 'no manifest' });
    const r4 = await classifyPackage(badZip);
    assert.deepEqual(r4.availableActions, []);
  });

});
