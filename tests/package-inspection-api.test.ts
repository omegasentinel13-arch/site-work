import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const BASE_URL = 'http://localhost:3000';
const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'site_work_super_secret_session_key_min_32_characters_long_2026_engineering'
);

function createDummySqliteBuffer(): Buffer {
  const buf = Buffer.alloc(4096);
  buf.write('SQLite format 3\0', 0, 16, 'utf-8');
  return buf;
}

async function buildZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.file(filePath, content);
  }
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function makeToken(userId: string, username: string, role: string, assignedSiteIds: string[], tokenVersion: number = 1) {
  return await new SignJWT({
    userId,
    username,
    fullName: username,
    role,
    assignedSiteIds,
    tokenVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(SECRET);
}

describe('Task 3 — Step 2C: Universal Package Inspection Gateway API (/api/packages/inspect)', () => {
  let adminCookie: string;
  let engSite1Cookie: string;
  let engSite2Cookie: string;
  let viewCookie: string;

  let validReportExportZip: Buffer;
  let validSite1LogicalZip: Buffer;
  let validSite2LogicalZip: Buffer;
  let validSystemRecoveryZip: Buffer;
  let corruptZip: Buffer;
  let truncatedZip: Buffer;
  let unrecognizedZip: Buffer;

  let storedSystemBackupId: string;
  let storedSite1BackupId: string;

  test('Setup: Prepare authentication tokens, test fixtures, and inspect storage registry', async () => {
    // 1. Read real database users in read-only mode
    const db = new DatabaseSync('data/site_work.db', { readOnly: true });
    const adminUser = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND is_active = 1 LIMIT 1").get() as any;
    const engUser1 = db.prepare("SELECT u.* FROM users u JOIN site_users su ON u.id = su.user_id WHERE u.role = 'SITE_MANAGER' AND su.site_id = 'site-1' AND u.is_active = 1 LIMIT 1").get() as any;
    const engUser2 = db.prepare("SELECT u.* FROM users u JOIN site_users su ON u.id = su.user_id WHERE u.role = 'SITE_MANAGER' AND su.site_id = 'site-2' AND u.is_active = 1 LIMIT 1").get() as any;
    const viewUser = db.prepare("SELECT * FROM users WHERE role = 'VIEWER' AND is_active = 1 LIMIT 1").get() as any;
    db.close();

    assert.ok(adminUser, 'Admin user must exist in database');
    assert.ok(engUser1, 'Site manager 1 user must exist in database');
    assert.ok(engUser2, 'Site manager 2 user must exist in database');
    assert.ok(viewUser, 'Viewer user must exist in database');

    const adminToken = await makeToken(adminUser.id, adminUser.username, 'ADMIN', [], adminUser.token_version);
    const engSite1Token = await makeToken(engUser1.id, engUser1.username, 'SITE_MANAGER', ['site-1'], engUser1.token_version);
    const engSite2Token = await makeToken(engUser2.id, engUser2.username, 'SITE_MANAGER', ['site-2'], engUser2.token_version);
    const viewToken = await makeToken(viewUser.id, viewUser.username, 'VIEWER', ['site-1'], viewUser.token_version);

    adminCookie = `site_work_session=${adminToken}`;
    engSite1Cookie = `site_work_session=${engSite1Token}`;
    engSite2Cookie = `site_work_session=${engSite2Token}`;
    viewCookie = `site_work_session=${viewToken}`;

    // 2. Build test fixtures
    // Fixture 1: Valid REPORT_EXPORT (site-1)
    validReportExportZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        application: 'AB_CONSTRUCTIONS_SITE_WORK',
        exportVersion: 1,
        exportType: 'COMPLETE_SITE',
        generatedAt: '2026-09-06T10:00:00.000Z',
        generatedBy: { id: 'usr-1', username: 'engineer1', role: 'SITE_MANAGER' },
        scope: { type: 'SITE', siteId: 'site-1', siteName: 'Site Alpha' },
        period: { preset: 'ALL_DATA', label: 'All Data' },
        formatsIncluded: ['PDF', 'JSON'],
        files: [{ path: 'data/report.json', format: 'JSON', bytes: 50 }],
      }),
      'data/report.json': JSON.stringify({ status: 'ok' }),
      'pdf/report.pdf': '%PDF-1.4 dummy',
      'README.txt': 'Report Readme',
    });

    // Fixture 2: Valid SITE_LOGICAL_BACKUP for site-1
    validSite1LogicalZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        manifestVersion: '1.0',
        backupId: 'bak-site-1-test',
        backupTimestamp: '2026-09-06T10:00:00.000Z',
        projectName: 'SITE WORK',
        applicationVersion: '1.0.0',
        schemaVersion: '1.0.0',
        scope: 'SITE',
        siteId: 'site-1',
        siteName: 'Site Alpha',
        periodPreset: 'ALL_DATA',
        isUnbounded: true,
        restorableAsDatabase: false,
        createdBy: { userId: 'usr-1', username: 'engineer1', role: 'SITE_MANAGER' },
        files: [{ path: 'data/site_profile.json', format: 'JSON', sizeBytes: 50, sha256: 'abc' }],
      }),
      'data/site_profile.json': JSON.stringify({ id: 'site-1', name: 'Site Alpha' }),
      'data/attendance_records.json': '[]',
      'data/financial_transactions.json': '[]',
      'checksums.sha256': 'abc  data/site_profile.json\n',
      'README.txt': 'Site Backup Readme',
    });

    // Fixture 3: Valid SITE_LOGICAL_BACKUP for site-2
    validSite2LogicalZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        manifestVersion: '1.0',
        backupId: 'bak-site-2-test',
        backupTimestamp: '2026-09-06T10:00:00.000Z',
        projectName: 'SITE WORK',
        applicationVersion: '1.0.0',
        schemaVersion: '1.0.0',
        scope: 'SITE',
        siteId: 'site-2',
        siteName: 'Site Beta',
        periodPreset: 'ALL_DATA',
        isUnbounded: true,
        restorableAsDatabase: false,
        createdBy: { userId: 'usr-1', username: 'engineer1', role: 'SITE_MANAGER' },
        files: [{ path: 'data/site_profile.json', format: 'JSON', sizeBytes: 50, sha256: 'abc' }],
      }),
      'data/site_profile.json': JSON.stringify({ id: 'site-2', name: 'Site Beta' }),
      'data/attendance_records.json': '[]',
      'data/financial_transactions.json': '[]',
      'checksums.sha256': 'abc  data/site_profile.json\n',
      'README.txt': 'Site Backup Readme',
    });

    // Fixture 4: Valid SYSTEM_RECOVERY_BACKUP
    const dbBuf = createDummySqliteBuffer();
    validSystemRecoveryZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        manifestVersion: '1.0',
        backupId: 'bak-system-recovery-test',
        backupTimestamp: '2026-09-06T10:00:00.000Z',
        projectName: 'SITE WORK',
        applicationVersion: '1.0.0',
        schemaVersion: '1.0.0',
        scope: 'SYSTEM',
        periodPreset: 'ALL_DATA',
        isUnbounded: true,
        restorableAsDatabase: true,
        createdBy: { userId: 'usr-admin', username: 'admin', role: 'ADMIN' },
        database: { included: true, isStandalone: true, sizeBytes: dbBuf.length, sha256: 'xyz', integrityCheck: 'ok' },
        files: [{ path: 'data/site_work.db', format: 'SQLITE', sizeBytes: dbBuf.length, sha256: 'xyz' }],
      }),
      'data/site_work.db': dbBuf,
      'data/master_export.json': '{}',
      'checksums.sha256': 'xyz  data/site_work.db\n',
      'README.txt': 'System Recovery Readme',
    });

    // Fixture 5: Corrupt ZIP (missing manifest)
    corruptZip = await buildZipBuffer({
      'data/file.txt': 'no manifest',
    });

    // Fixture 6: Truncated ZIP (valid PK header but truncated central directory)
    truncatedZip = validReportExportZip.subarray(0, 80);

    // Fixture 7: Unrecognized valid ZIP (valid ZIP with unsupported manifest schema)
    unrecognizedZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({ customApp: 'other_system', version: '2.0' }),
      'data/unknown.json': '{}',
    });

    // 3. Locate existing stored backups in data/backups
    const storageFiles = fs.readdirSync(path.join(process.cwd(), 'data', 'backups'));
    const sysFile = storageFiles.find((f) => f.includes('SYSTEM') && f.endsWith('.zip'));
    const s01File = storageFiles.find((f) => f.includes('S-01') && f.endsWith('.zip'));

    assert.ok(sysFile, 'A stored SYSTEM backup must exist in data/backups');
    assert.ok(s01File, 'A stored S-01 (site-1) backup must exist in data/backups');

    storedSystemBackupId = sysFile.replace(/\.zip$/, '');
    storedSite1BackupId = s01File.replace(/\.zip$/, '');
  });

  // Test 1: Unauthenticated upload -> 401
  test('1. Unauthenticated upload returns 401 Unauthorized', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validReportExportZip], { type: 'application/zip' }), 'report.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, { method: 'POST', body: formData });
    assert.equal(res.status, 401);
  });

  // Test 2: VIEWER upload -> 403
  test('2. VIEWER upload returns 403 Forbidden', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validReportExportZip], { type: 'application/zip' }), 'report.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: viewCookie },
      body: formData,
    });
    assert.equal(res.status, 403);
  });

  // Test 3: ADMIN valid REPORT_EXPORT -> 200
  test('3. ADMIN inspecting valid REPORT_EXPORT returns 200 with report actions', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validReportExportZip], { type: 'application/zip' }), 'report.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'REPORT_EXPORT');
    assert.equal(data.isValid, true);
    assert.equal(data.isRestorableAsDatabase, false);
    assert.deepEqual(data.availableActions, ['VIEW_REPORT_PREVIEW', 'DOWNLOAD_EXTRACTED_FILES']);
  });

  // Test 4: ADMIN valid SITE_LOGICAL_BACKUP -> 200
  test('4. ADMIN inspecting valid SITE_LOGICAL_BACKUP returns 200 with logical actions', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validSite1LogicalZip], { type: 'application/zip' }), 'site1.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(data.isValid, true);
    assert.equal(data.isRestorableAsDatabase, false);
    assert.deepEqual(data.availableActions, ['PREVIEW_LOGICAL_DATA', 'DIFF_WITH_ACTIVE_SITE']);
  });

  // Test 5: ADMIN valid SYSTEM_RECOVERY_BACKUP -> 200
  test('5. ADMIN inspecting valid SYSTEM_RECOVERY_BACKUP returns 200 with restore actions', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validSystemRecoveryZip], { type: 'application/zip' }), 'system.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'SYSTEM_RECOVERY_BACKUP');
    assert.equal(data.isValid, true);
    assert.equal(data.isRestorableAsDatabase, true);
    assert.deepEqual(data.availableActions, ['SIMULATE_DATABASE_RESTORE', 'EXECUTE_DATABASE_RESTORE']);
  });

  // Test 6: SITE_MANAGER assigned SITE REPORT_EXPORT -> 200
  test('6. SITE_MANAGER inspecting assigned SITE REPORT_EXPORT returns 200', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validReportExportZip], { type: 'application/zip' }), 'report.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'REPORT_EXPORT');
    assert.equal(data.siteId, 'site-1');
  });

  // Test 7: SITE_MANAGER unassigned SITE REPORT_EXPORT -> 403
  test('7. SITE_MANAGER inspecting unassigned SITE REPORT_EXPORT returns 403', async () => {
    const formData = new FormData();
    // validReportExportZip is for site-1, but engSite2Cookie is only assigned to site-2
    formData.append('file', new Blob([validReportExportZip], { type: 'application/zip' }), 'report.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite2Cookie },
      body: formData,
    });
    assert.equal(res.status, 403);
  });

  // Test 8: SITE_MANAGER SYSTEM REPORT_EXPORT -> 403
  test('8. SITE_MANAGER inspecting SYSTEM REPORT_EXPORT returns 403', async () => {
    const sysReportZip = await buildZipBuffer({
      'manifest.json': JSON.stringify({
        application: 'AB_CONSTRUCTIONS_SITE_WORK',
        exportVersion: 1,
        exportType: 'COMPLETE_SYSTEM',
        scope: { type: 'SYSTEM' },
        period: { preset: 'ALL_DATA', label: 'All Data' },
        files: [],
      }),
      'data/report.json': '{}',
    });

    const formData = new FormData();
    formData.append('file', new Blob([sysReportZip], { type: 'application/zip' }), 'sys_report.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 403);
  });

  // Test 9: SITE_MANAGER assigned SITE_LOGICAL_BACKUP -> 200
  test('9. SITE_MANAGER inspecting assigned SITE_LOGICAL_BACKUP returns 200 without restore actions', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validSite1LogicalZip], { type: 'application/zip' }), 'site1.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'SITE_LOGICAL_BACKUP');
    assert.deepEqual(data.availableActions, ['PREVIEW_LOGICAL_DATA', 'DIFF_WITH_ACTIVE_SITE']);
  });

  // Test 10: SITE_MANAGER unassigned SITE_LOGICAL_BACKUP -> 403
  test('10. SITE_MANAGER inspecting unassigned SITE_LOGICAL_BACKUP returns 403', async () => {
    const formData = new FormData();
    // validSite2LogicalZip is site-2, but engSite1Cookie is assigned only to site-1
    formData.append('file', new Blob([validSite2LogicalZip], { type: 'application/zip' }), 'site2.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 403);
  });

  // Test 11: SITE_MANAGER SYSTEM_RECOVERY_BACKUP -> 403
  test('11. SITE_MANAGER uploading SYSTEM_RECOVERY_BACKUP returns 403', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validSystemRecoveryZip], { type: 'application/zip' }), 'system.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 403);
  });

  // Test 12: SITE_MANAGER response leaks no DB/recovery metadata
  test('12. Leakage Prevention: SITE_MANAGER 403 response body leaks 0 database or recovery metadata', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validSystemRecoveryZip], { type: 'application/zip' }), 'system.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.ok(!text.includes('tableCounts'));
    assert.ok(!text.includes('site_work.db'));
    assert.ok(!text.includes('integrityCheck'));
    assert.ok(!text.includes('recovery_journal'));
  });

  // Test 13: ADMIN uploads corrupt/unrecognized package -> 200 + CORRUPT_OR_UNRECOGNIZED + []
  test('13. Corrupt package returns HTTP 200 with CORRUPT_OR_UNRECOGNIZED and empty actions', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([corruptZip], { type: 'application/zip' }), 'corrupt.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(data.isValid, false);
    assert.equal(data.scope, 'UNKNOWN');
    assert.equal(data.siteId, null);
    assert.deepEqual(data.availableActions, []);
    assert.ok(data.rejectionReasons.length > 0);
  });

  // Test 13a: Finding B-1 Fix - SITE_MANAGER uploads corrupt ZIP -> HTTP 200 (no misleading 403 "not assigned")
  test('13a. SITE_MANAGER uploads corrupt ZIP returns HTTP 200 diagnostic result', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([corruptZip], { type: 'application/zip' }), 'corrupt.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(data.isValid, false);
    assert.equal(data.scope, 'UNKNOWN');
    assert.equal(data.siteId, null);
    assert.deepEqual(data.availableActions, []);
    assert.ok(data.rejectionReasons.length > 0);
    assert.ok(!JSON.stringify(data).toLowerCase().includes('not assigned'));
  });

  // Test 13b: Finding B-1 Fix - SITE_MANAGER uploads truncated ZIP -> HTTP 200 diagnostic result
  test('13b. SITE_MANAGER uploads truncated ZIP returns HTTP 200 diagnostic result', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([truncatedZip], { type: 'application/zip' }), 'truncated.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(data.isValid, false);
    assert.equal(data.scope, 'UNKNOWN');
    assert.equal(data.siteId, null);
    assert.deepEqual(data.availableActions, []);
  });

  // Test 13c: Finding B-1 Fix - SITE_MANAGER uploads unrecognized valid ZIP -> HTTP 200 diagnostic result
  test('13c. SITE_MANAGER uploads unrecognized valid ZIP returns HTTP 200 diagnostic result', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([unrecognizedZip], { type: 'application/zip' }), 'unrecognized.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'CORRUPT_OR_UNRECOGNIZED');
    assert.equal(data.isValid, false);
    assert.equal(data.scope, 'UNKNOWN');
    assert.equal(data.siteId, null);
    assert.deepEqual(data.availableActions, []);
    assert.ok(data.rejectionReasons.some((r: string) => r.includes('Unrecognized archive structure')));
  });

  // Test 13d: VIEWER uploads corrupt package -> HTTP 403 Forbidden before package inspection
  test('13d. VIEWER uploads corrupt package returns HTTP 403 before package inspection', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([corruptZip], { type: 'application/zip' }), 'corrupt.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: viewCookie },
      body: formData,
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.match(data.error, /viewers cannot inspect packages/i);
  });

  // Test 14: Missing file -> 400
  test('14. Missing file in multipart form upload returns HTTP 400 Bad Request', async () => {
    const formData = new FormData();
    formData.append('unrelated_field', 'hello');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: formData,
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /no package file provided/i);
  });

  // Test 15: Non-ZIP content -> 415
  test('15. Non-ZIP content upload returns HTTP 415 Unsupported Media Type', async () => {
    const formData = new FormData();
    formData.append('file', new Blob(['plain text content'], { type: 'text/plain' }), 'document.txt');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: adminCookie },
      body: formData,
    });
    assert.equal(res.status, 415);
    const data = await res.json();
    assert.match(data.error, /must be a \.zip archive/i);
  });

  // Test 16: >100MB upload -> 413
  test('16. Oversized upload (>100MB) returns HTTP 413 Payload Too Large', async () => {
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(`${BASE_URL}/api/packages/inspect`);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: {
            cookie: adminCookie,
            'content-length': (105 * 1024 * 1024).toString(),
            'content-type': 'application/zip',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        }
      );
      req.on('error', reject);
      req.end();
    });

    assert.equal(res.status, 413);
    const data = JSON.parse(res.body);
    assert.match(data.error, /exceeds maximum 100 MB/i);
  });

  // Test 17: Unknown backupId -> 404
  test('17. Unknown backupId in JSON body returns HTTP 404 Not Found', async () => {
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ backupId: 'nonexistent-backup-id-12345' }),
    });
    assert.equal(res.status, 404);
  });

  // Test 18: backupId path traversal string cannot escape storage registry -> 400
  test('18. Path traversal attempt in backupId is rejected with HTTP 400', async () => {
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ backupId: '../../etc/passwd' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /invalid backupId format/i);
  });

  // Test 19: ADMIN stored SYSTEM backup inspection -> 200
  test('19. ADMIN inspecting stored SYSTEM backup via backupId returns 200', async () => {
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ backupId: storedSystemBackupId }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'SYSTEM_RECOVERY_BACKUP');
    assert.equal(data.scope, 'SYSTEM');
    assert.equal(data.isRestorableAsDatabase, true);
  });

  // Test 20: SITE_MANAGER stored SYSTEM backup -> 403
  test('20. SITE_MANAGER inspecting stored SYSTEM backup via backupId returns 403', async () => {
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: engSite1Cookie },
      body: JSON.stringify({ backupId: storedSystemBackupId }),
    });
    assert.equal(res.status, 403);
  });

  // Test 21: SITE_MANAGER stored assigned-site backup -> 200
  test('21. SITE_MANAGER inspecting stored assigned-site backup returns 200', async () => {
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: engSite1Cookie },
      body: JSON.stringify({ backupId: storedSite1BackupId }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.classification, 'SITE_LOGICAL_BACKUP');
    assert.equal(data.siteId, 'site-1');
  });

  // Test 22: SITE_MANAGER stored unassigned-site backup -> 403
  test('22. SITE_MANAGER inspecting stored unassigned-site backup returns 403', async () => {
    // storedSite1BackupId is site-1, but engSite2Cookie is assigned only to site-2
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: engSite2Cookie },
      body: JSON.stringify({ backupId: storedSite1BackupId }),
    });
    assert.equal(res.status, 403);
  });

  // Test 23: Action lists are RBAC filtered correctly
  test('23. RBAC Action Filter: SITE_MANAGER never receives database restore actions', async () => {
    const formData = new FormData();
    formData.append('file', new Blob([validSite1LogicalZip], { type: 'application/zip' }), 'site1.zip');
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { cookie: engSite1Cookie },
      body: formData,
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(!data.availableActions.includes('SIMULATE_DATABASE_RESTORE'));
    assert.ok(!data.availableActions.includes('EXECUTE_DATABASE_RESTORE'));
  });

  // Test 24: No raw DB bytes or secrets in JSON response
  test('24. Secret Scrubbing: Response body contains zero password hashes, secrets, or raw bytes', async () => {
    const res = await fetch(`${BASE_URL}/api/packages/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ backupId: storedSystemBackupId }),
    });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('password_hash'));
    assert.ok(!text.includes('recovery_tokens'));
    assert.ok(!text.includes('SESSION_SECRET'));
    assert.ok(!text.includes('SMTP_'));
  });

  // Test 25: Active database untouched
  test('25. Database Immutability: Active database row counts remain 100% untouched', async () => {
    const db = new DatabaseSync('data/site_work.db', { readOnly: true });
    const getCounts = () => {
      const counts: Record<string, number> = {};
      const tables = ['users', 'sites', 'site_users', 'work_categories', 'work_roles', 'attendance_records', 'financial_transactions'];
      for (const t of tables) {
        counts[t] = (db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any).c;
      }
      return counts;
    };

    const counts = getCounts();
    db.close();

    assert.equal(counts.users, 4);
    assert.equal(counts.sites, 6);
    assert.equal(counts.site_users, 3);
    assert.equal(counts.work_categories, 4);
    assert.equal(counts.work_roles, 23);
    assert.equal(counts.attendance_records, 11);
    assert.equal(counts.financial_transactions, 4);
  });
});
