import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const BASE_URL = 'http://localhost:3000';

async function runLiveBackupQA() {
  console.log('====================================================');
  console.log('STARTING TASK 2 LIVE END-TO-END QA ON LOCALHOST:3000');
  console.log('====================================================\n');

  // Load session secret from environment or database
  const sessionSecret = process.env.SESSION_SECRET || 'dev_session_secret_for_site_work_app_min_32_chars!';
  const secretKey = new TextEncoder().encode(sessionSecret);

  // Inspect users in DB to get current token versions
  const db = new DatabaseSync('data/site_work.db');
  const adminUser = db.prepare("SELECT * FROM users WHERE role = 'ADMIN'").get() as any;
  const engUser = db.prepare("SELECT * FROM users WHERE role = 'SITE_MANAGER'").get() as any;
  const viewUser = db.prepare("SELECT * FROM users WHERE role = 'VIEWER'").get() as any;
  db.close();

  assert.ok(adminUser, 'Admin user must exist in DB');
  assert.ok(engUser, 'Engineer user must exist in DB');
  assert.ok(viewUser, 'Viewer user must exist in DB');

  async function makeToken(userId: string, username: string, role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER', assignedSites: string[], tokenVersion: number) {
    return await new SignJWT({
      userId,
      username,
      fullName: 'Test User',
      role,
      assignedSiteIds: assignedSites,
      tokenVersion,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);
  }

  const adminToken = await makeToken(adminUser.id, adminUser.username, 'ADMIN', [], adminUser.token_version || 1);
  const engToken = await makeToken(engUser.id, engUser.username, 'SITE_MANAGER', ['site-2'], engUser.token_version || 1);
  const viewToken = await makeToken(viewUser.id, viewUser.username, 'VIEWER', ['site-2'], viewUser.token_version || 1);

  const adminCookie = `site_work_session=${adminToken}`;
  const engCookie = `site_work_session=${engToken}`;
  const viewCookie = `site_work_session=${viewToken}`;

  // 1. RECOVERY STATUS API
  console.log('--- TEST 1: RECOVERY STATUS & SIDECAR JOURNAL API ---');
  const unauthStatus = await fetch(`${BASE_URL}/api/backup/recovery/status`);
  assert.equal(unauthStatus.status, 401, 'Unauthenticated recovery status must return 401');

  const viewStatus = await fetch(`${BASE_URL}/api/backup/recovery/status`, { headers: { cookie: viewCookie } });
  assert.equal(viewStatus.status, 403, 'Viewer recovery status must return 403');

  const engStatus = await fetch(`${BASE_URL}/api/backup/recovery/status`, { headers: { cookie: engCookie } });
  assert.equal(engStatus.status, 403, 'Site Manager recovery status must return 403');
  const engBody = await engStatus.json();
  assert.equal(engBody.journalEntries, undefined, 'Site Manager must not receive journal entries');
  assert.equal(engBody.lockState, undefined, 'Site Manager must not receive lock state');

  const adminStatus = await fetch(`${BASE_URL}/api/backup/recovery/status`, { headers: { cookie: adminCookie } });
  assert.equal(adminStatus.status, 200, 'Admin recovery status must return 200');
  const statusBody = await adminStatus.json();
  assert.equal(statusBody.isLocked, false);
  assert.equal(statusBody.lockState, 'IDLE');
  assert.ok(Array.isArray(statusBody.journalEntries));
  console.log(`✔ Recovery engine online. Lock: ${statusBody.lockState}, Sidecar Journal entries: ${statusBody.journalEntries.length}`);

  // 2. BACKUP LISTING API
  console.log('\n--- TEST 2: BACKUP STORAGE REGISTRY & ACL ---');
  const unauthList = await fetch(`${BASE_URL}/api/backup`);
  assert.equal(unauthList.status, 401, 'Unauthenticated backup list must return 401');

  const viewList = await fetch(`${BASE_URL}/api/backup`, { headers: { cookie: viewCookie } });
  assert.equal(viewList.status, 403, 'Viewer backup list must return 403');

  const adminList = await fetch(`${BASE_URL}/api/backup`, { headers: { cookie: adminCookie } });
  assert.equal(adminList.status, 200, 'Admin backup list must return 200');
  const adminListData = await adminList.json();
  console.log(`✔ Admin sees ${adminListData.backups.length} archives in storage registry`);

  // 3. BACKUP CREATION RBAC
  console.log('\n--- TEST 3: BACKUP CREATION RBAC & DATASET ISOLATION ---');
  // Engineer blocked from SYSTEM backup
  const engSystemCreate = await fetch(`${BASE_URL}/api/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: engCookie },
    body: JSON.stringify({ scope: 'SYSTEM', period: 'ALL_DATA' }),
  });
  assert.equal(engSystemCreate.status, 403, 'Engineer must be blocked from SYSTEM backup');
  console.log('✔ Engineer blocked from creating System-Wide backup (HTTP 403)');

  // Engineer blocked from unassigned site
  const engUnassignedCreate = await fetch(`${BASE_URL}/api/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: engCookie },
    body: JSON.stringify({ scope: 'SITE', siteId: 'site-1', period: 'ALL_DATA' }),
  });
  assert.equal(engUnassignedCreate.status, 403, 'Engineer must be blocked from unassigned site');
  console.log('✔ Engineer blocked from unassigned site-1 backup (HTTP 403)');

  // Engineer authorized for assigned site (site-2)
  const engSiteCreate = await fetch(`${BASE_URL}/api/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: engCookie },
    body: JSON.stringify({ scope: 'SITE', siteId: 'site-2', period: 'ALL_DATA', includePdf: false, includeExcel: false }),
  });
  assert.equal(engSiteCreate.status, 200, 'Engineer can create assigned site backup');
  const engSiteData = await engSiteCreate.json();
  assert.equal(engSiteData.backup.manifest.scope, 'SITE');
  assert.equal(engSiteData.backup.manifest.restorableAsDatabase, false);
  console.log(`✔ Engineer successfully generated site-2 logical backup (${engSiteData.backup.backupId})`);

  // Admin creates SYSTEM + ALL_DATA backup
  const adminSysCreate = await fetch(`${BASE_URL}/api/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false }),
  });
  assert.equal(adminSysCreate.status, 200, 'Admin can create SYSTEM backup');
  const adminSysData = await adminSysCreate.json();
  const sysBackupId = adminSysData.backup.backupId;
  assert.equal(adminSysData.backup.manifest.scope, 'SYSTEM');
  assert.equal(adminSysData.backup.manifest.restorableAsDatabase, true);
  console.log(`✔ Admin successfully generated full system backup with restorable DB (${sysBackupId})`);

  // 4. DOWNLOAD BACKUP
  console.log('\n--- TEST 4: DOWNLOAD ARCHIVE WITH ACL ENFORCEMENT ---');
  // Engineer blocked from downloading SYSTEM backup
  const engDownloadSys = await fetch(`${BASE_URL}/api/backup/${sysBackupId}`, { headers: { cookie: engCookie } });
  assert.equal(engDownloadSys.status, 403, 'Engineer must be blocked from downloading system backup');
  console.log('✔ Engineer blocked from downloading System backup (HTTP 403)');

  // Admin downloads SYSTEM backup
  const adminDownloadSys = await fetch(`${BASE_URL}/api/backup/${sysBackupId}`, { headers: { cookie: adminCookie } });
  assert.equal(adminDownloadSys.status, 200, 'Admin can download system backup');
  assert.equal(adminDownloadSys.headers.get('content-type'), 'application/zip');
  const zipBuf = await adminDownloadSys.arrayBuffer();
  assert.ok(zipBuf.byteLength > 0);
  console.log(`✔ Admin downloaded system backup archive (${(zipBuf.byteLength / 1024).toFixed(1)} KB)`);

  // 5. VALIDATION API
  console.log('\n--- TEST 5: DEEP SANDBOX VALIDATION API ---');
  const valRes = await fetch(`${BASE_URL}/api/backup/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ backupId: sysBackupId }),
  });
  assert.equal(valRes.status, 200);
  const valData = await valRes.json();
  assert.equal(valData.isValid, true);
  assert.equal(valData.hasBlockingIssues, false);
  assert.equal(valData.manifest.restorableAsDatabase, true);
  console.log('✔ Sandbox validation succeeded with 0 blocking issues');

  // 6. RESTORE SIMULATION API
  console.log('\n--- TEST 6: RESTORE SIMULATION & RECORD DIFF API ---');
  // Engineer blocked from simulate
  const engSim = await fetch(`${BASE_URL}/api/backup/restore/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: engCookie },
    body: JSON.stringify({ backupId: sysBackupId }),
  });
  assert.equal(engSim.status, 403, 'Engineer blocked from restore simulation');
  console.log('✔ Engineer blocked from restore simulation (HTTP 403)');

  // Admin simulates restore
  const adminSim = await fetch(`${BASE_URL}/api/backup/restore/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ backupId: sysBackupId }),
  });
  assert.equal(adminSim.status, 200);
  const simData = await adminSim.json();
  assert.equal(simData.plan.canExecuteRestore, true);
  assert.ok(simData.plan.recordDiff.length > 0);
  console.log(`✔ Restore simulation generated diff for ${simData.plan.recordDiff.length} tables. canExecuteRestore: true`);

  // 7. CLEANUP ARCHIVES
  console.log('\n--- TEST 7: ARCHIVE DELETION API ---');
  const delSys = await fetch(`${BASE_URL}/api/backup/${sysBackupId}`, {
    method: 'DELETE',
    headers: { cookie: adminCookie },
  });
  assert.equal(delSys.status, 200);

  const delEng = await fetch(`${BASE_URL}/api/backup/${engSiteData.backup.backupId}`, {
    method: 'DELETE',
    headers: { cookie: adminCookie },
  });
  assert.equal(delEng.status, 200);
  console.log('✔ Test backup archives cleaned up from storage registry');

  // 8. WEB UI ROUTE ACCESSIBILITY
  console.log('\n--- TEST 8: WEB UI ROUTE HTTP 200 ACCESSIBILITY ---');
  const adminPage = await fetch(`${BASE_URL}/admin/backup`, { headers: { cookie: adminCookie } });
  assert.equal(adminPage.status, 200, 'Admin page responds 200');

  const engPage = await fetch(`${BASE_URL}/admin/backup`, { headers: { cookie: engCookie } });
  assert.equal(engPage.status, 200, 'Engineer page responds 200');

  const viewPage = await fetch(`${BASE_URL}/admin/backup`, { headers: { cookie: viewCookie } });
  assert.equal(viewPage.status, 200, 'Viewer page responds 200 (shows Access Denied)');
  console.log('✔ Web UI /admin/backup responds HTTP 200 for all authenticated roles');

  console.log('\n====================================================');
  console.log('ALL TASK 2 LIVE END-TO-END QA CHECKS PASSED (8/8)');
  console.log('====================================================');
}

runLiveBackupQA().catch((err) => {
  console.error('\n❌ LIVE QA FAILED:', err);
  process.exit(1);
});
