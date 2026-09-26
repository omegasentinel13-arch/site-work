import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { SignJWT } from 'jose';

const BASE_URL = 'http://localhost:3000';

function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026';
  return new TextEncoder().encode(secret);
}

async function makeToken(payload: {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  assignedSiteIds: string[];
  tokenVersion: number;
}): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecretKey());
}

async function runLiveCompleteExportQA() {
  console.log('====================================================');
  console.log('STARTING LIVE COMPLETE EXPORT API & RBAC QA');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('====================================================\n');

  // 1. Authenticate Sessions
  console.log('--- 1. AUTHENTICATION OF ROLES ---');
  const db = (await import('../lib/db')).getDb();
  const adminUser = db.prepare('SELECT * FROM users WHERE username = ?').get('Iamadmin') as any;
  const engUser = db.prepare('SELECT * FROM users WHERE username = ?').get('engineer2') as any;
  const viewUser = db.prepare('SELECT * FROM users WHERE username = ?').get('viewer1') as any;

  const adminToken = await makeToken({
    userId: adminUser.id,
    username: adminUser.username,
    fullName: adminUser.full_name,
    role: adminUser.role,
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: adminUser.token_version,
  });
  const adminCookie = `site_work_session=${adminToken}`;
  console.log('✔ Admin authenticated (JWT)');

  const engToken = await makeToken({
    userId: engUser.id,
    username: engUser.username,
    fullName: engUser.full_name,
    role: engUser.role,
    assignedSiteIds: ['site-1'],
    tokenVersion: engUser.token_version,
  });
  const engCookie = `site_work_session=${engToken}`;
  const engAssignedSiteId = 'site-1';
  console.log(`✔ Engineer authenticated (Assigned site: ${engAssignedSiteId})`);

  const viewToken = await makeToken({
    userId: viewUser.id,
    username: viewUser.username,
    fullName: viewUser.full_name,
    role: viewUser.role,
    assignedSiteIds: ['site-1'],
    tokenVersion: viewUser.token_version,
  });
  const viewCookie = `site_work_session=${viewToken}`;
  console.log('✔ Viewer authenticated');

  // 2. Unauthenticated Export Request -> 401
  console.log('\n--- 2. UNAUTHENTICATED GUARD QA ---');
  const unauthRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: 'SYSTEM', period: 'ALL_DATA' }),
  });
  assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401');
  console.log('✔ HTTP 401 Unauthorized enforced for missing session');

  // 3. Viewer Request -> 403 Forbidden
  console.log('\n--- 3. VIEWER RESTRICTION QA ---');
  const viewerRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: viewCookie,
    },
    body: JSON.stringify({ scope: 'SITE', siteId: engAssignedSiteId, period: 'ALL_DATA' }),
  });
  assert.equal(viewerRes.status, 403, 'Viewer must be blocked with 403');
  const viewerErr = await viewerRes.json();
  assert.ok(viewerErr.error.includes('restricted to Administrators and Engineers'));
  console.log('✔ HTTP 403 Forbidden enforced for Viewer role');

  // 4. Engineer Requesting System Export -> 403 Forbidden
  console.log('\n--- 4. ENGINEER RBAC ENFORCEMENT QA ---');
  const engSysRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: engCookie,
    },
    body: JSON.stringify({ scope: 'SYSTEM', period: 'ALL_DATA' }),
  });
  assert.equal(engSysRes.status, 403, 'Engineer requesting SYSTEM scope must return 403');
  const engSysErr = await engSysRes.json();
  assert.ok(engSysErr.error.includes('Administrator privileges'));
  console.log('✔ HTTP 403 Forbidden: Engineer cannot export SYSTEM scope');

  // 5. Engineer Requesting Unassigned Site -> 403 Forbidden
  // 5. Engineer Requesting Unassigned Site -> 403 Forbidden
  console.log('\n--- 5. ENGINEER UNASSIGNED SITE GUARD QA ---');
  const engUnassignedRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: engCookie,
    },
    body: JSON.stringify({ scope: 'SITE', siteId: 'site-1', period: 'ALL_DATA' }),
  });
  assert.equal(engUnassignedRes.status, 403, 'Engineer cannot export unassigned site');
  console.log('✔ HTTP 403 Forbidden: Engineer blocked from unassigned site (site-1)');

  // 6. Engineer Authorized Site ZIP Export -> 200 OK
  console.log('\n--- 6. ENGINEER AUTHORIZED SITE ZIP EXPORT QA ---');
  const engZipRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: engCookie,
    },
    body: JSON.stringify({
      scope: 'SITE',
      siteId: 'site-2',
      period: 'ALL_DATA',
      format: 'ZIP',
    }),
  });
  assert.equal(engZipRes.status, 200, 'Engineer authorized site export must succeed');
  assert.equal(engZipRes.headers.get('content-type'), 'application/zip');
  const engCd = engZipRes.headers.get('content-disposition') || '';
  assert.ok(engCd.includes('attachment; filename='));
  assert.ok(engCd.includes('.zip'));

  const engZipBuf = Buffer.from(await engZipRes.arrayBuffer());
  assert.ok(engZipBuf.length > 5000, 'ZIP payload must be non-empty');
  const engZip = await JSZip.loadAsync(engZipBuf);
  assert.ok(engZip.file('manifest.json'), 'ZIP must contain manifest.json');
  assert.ok(engZip.file('README.txt'), 'ZIP must contain README.txt');

  const engManifestStr = await engZip.file('manifest.json')!.async('text');
  const engManifest = JSON.parse(engManifestStr);
  assert.equal(engManifest.exportType, 'COMPLETE_SITE');
  assert.equal(engManifest.scope.siteId, 'site-2');
  console.log(`✔ HTTP 200 OK: Engineer successfully downloaded site ZIP package (${engZipBuf.length} bytes)`);

  // 7. Admin Enterprise System-Wide Complete ZIP Export -> 200 OK
  console.log('\n--- 7. ADMIN SYSTEM-WIDE COMPLETE ZIP EXPORT QA ---');
  const adminSysRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      scope: 'SYSTEM',
      period: 'ALL_DATA',
      format: 'ZIP',
      formats: ['PDF', 'EXCEL', 'JSON'],
    }),
  });
  assert.equal(adminSysRes.status, 200, 'Admin system export must succeed');
  assert.equal(adminSysRes.headers.get('content-type'), 'application/zip');

  const adminSysBuf = Buffer.from(await adminSysRes.arrayBuffer());
  assert.ok(adminSysBuf.length > 5000);
  const adminSysZip = await JSZip.loadAsync(adminSysBuf);
  assert.ok(adminSysZip.file('manifest.json'));
  assert.ok(adminSysZip.file('README.txt'));

  const adminManifestStr = await adminSysZip.file('manifest.json')!.async('text');
  const adminManifest = JSON.parse(adminManifestStr);
  assert.equal(adminManifest.exportType, 'COMPLETE_SYSTEM');
  assert.equal(adminManifest.scope.type, 'SYSTEM');
  assert.ok(adminManifest.scope.totalSites >= 1);
  console.log(`✔ HTTP 200 OK: Admin successfully downloaded Enterprise System ZIP (${adminSysBuf.length} bytes, ${adminManifest.scope.totalSites} sites)`);

  // 8. Admin Standalone PDF Export -> 200 OK
  console.log('\n--- 8. ADMIN STANDALONE CONSOLIDATED PDF QA ---');
  const adminPdfRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      scope: 'SITE',
      siteId: 'site-1',
      period: 'ALL_DATA',
      format: 'PDF',
    }),
  });
  assert.equal(adminPdfRes.status, 200);
  assert.equal(adminPdfRes.headers.get('content-type'), 'application/pdf');
  const adminPdfBuf = Buffer.from(await adminPdfRes.arrayBuffer());
  assert.equal(adminPdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');
  console.log(`✔ HTTP 200 OK: Standalone Consolidated PDF generated (${adminPdfBuf.length} bytes)`);

  // 9. Admin Standalone Multi-Sheet Excel Export -> 200 OK
  console.log('\n--- 8. ADMIN STANDALONE MULTI-SHEET EXCEL QA ---');
  const adminExcelRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      scope: 'SITE',
      siteId: 'site-1',
      period: 'ALL_DATA',
      format: 'EXCEL',
    }),
  });
  assert.equal(adminExcelRes.status, 200);
  assert.equal(
    adminExcelRes.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const adminExcelBuf = Buffer.from(await adminExcelRes.arrayBuffer());
  assert.equal(adminExcelBuf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  console.log(`✔ HTTP 200 OK: Standalone Multi-Sheet Excel generated (${adminExcelBuf.length} bytes)`);

  // 10. Admin Standalone Structured JSON Export -> 200 OK
  console.log('\n--- 9. ADMIN STANDALONE STRUCTURED JSON QA ---');
  const adminJsonRes = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      scope: 'SYSTEM',
      period: 'ALL_DATA',
      format: 'JSON',
    }),
  });
  assert.equal(adminJsonRes.status, 200);
  assert.equal(adminJsonRes.headers.get('content-type'), 'application/json');
  const adminJsonData = await adminJsonRes.json();
  assert.equal(adminJsonData.exportType, 'COMPLETE_SYSTEM');
  console.log(`✔ HTTP 200 OK: Standalone Structured JSON generated (Total sites: ${adminJsonData.aggregatedSummary.totalSites})`);

  // 11. UI Route Accessibility QA
  console.log('\n--- 10. UI ROUTE ACCESSIBILITY QA ---');
  const uiAdminRes = await fetch(`${BASE_URL}/reports/complete-export`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(uiAdminRes.status, 200, '/reports/complete-export must render for Admin');
  const uiAdminHtml = await uiAdminRes.text();
  assert.ok(uiAdminHtml.includes('Complete') || uiAdminHtml.includes('Export'), 'Page should render export title');
  console.log('✔ HTTP 200 OK: /reports/complete-export page successfully rendered for Admin');

  const uiEngRes = await fetch(`${BASE_URL}/reports/complete-export`, {
    headers: { Cookie: engCookie },
  });
  assert.equal(uiEngRes.status, 200, '/reports/complete-export must render for Engineer');
  console.log('✔ HTTP 200 OK: /reports/complete-export page successfully rendered for Engineer');

  console.log('\n====================================================');
  console.log('ALL LIVE COMPLETE EXPORT QA TESTS PASSED CLEANLY (10/10)');
  console.log('====================================================');
}

runLiveCompleteExportQA().catch((err) => {
  console.error('LIVE QA FAILED:', err);
  process.exit(1);
});
