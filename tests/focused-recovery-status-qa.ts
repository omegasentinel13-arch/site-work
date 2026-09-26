import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

const BASE_URL = 'http://localhost:3000';
const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026'
);

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

async function run() {
  console.log('================================================================');
  console.log('FOCUSED TEST: TASK 2 RECOVERY STATUS RBAC PATCH VERIFICATION');
  console.log('================================================================');

  // 1. Fetch valid user records from database in read-only mode
  const db = new DatabaseSync('data/site_work.db', { readOnly: true });
  const adminUser = db.prepare("SELECT * FROM users WHERE role = 'ADMIN' AND is_active = 1 LIMIT 1").get() as any;
  const engUser = db.prepare("SELECT * FROM users WHERE role = 'SITE_MANAGER' AND is_active = 1 LIMIT 1").get() as any;
  const viewUser = db.prepare("SELECT * FROM users WHERE role = 'VIEWER' AND is_active = 1 LIMIT 1").get() as any;
  db.close();

  assert.ok(adminUser, 'Active Admin user must exist');
  assert.ok(engUser, 'Active Site Manager user must exist');
  assert.ok(viewUser, 'Active Viewer user must exist');

  const adminToken = await makeToken(adminUser.id, adminUser.username, 'ADMIN', [], adminUser.token_version);
  const engToken = await makeToken(engUser.id, engUser.username, 'SITE_MANAGER', ['site-2'], engUser.token_version);
  const viewToken = await makeToken(viewUser.id, viewUser.username, 'VIEWER', ['site-2'], viewUser.token_version);

  const adminCookie = 'site_work_session=' + adminToken;
  const engCookie = 'site_work_session=' + engToken;
  const viewCookie = 'site_work_session=' + viewToken;

  // Requirement 1: Unauthenticated GET /api/backup/recovery/status -> 401
  console.log('[CHECK 1] Unauthenticated GET /api/backup/recovery/status...');
  const unauthRes = await fetch(BASE_URL + '/api/backup/recovery/status');
  assert.equal(unauthRes.status, 401, 'Unauthenticated request must return 401');
  const unauthBody = await unauthRes.json();
  assert.match(unauthBody.error, /log in to continue/i);
  console.log('    PASS: Unauthenticated receives 401 Unauthorized');

  // Requirement 2: VIEWER -> 403
  console.log('[CHECK 2] VIEWER GET /api/backup/recovery/status...');
  const viewRes = await fetch(BASE_URL + '/api/backup/recovery/status', { headers: { cookie: viewCookie } });
  assert.equal(viewRes.status, 403, 'VIEWER must return 403');
  const viewBody = await viewRes.json();
  assert.match(viewBody.error, /access denied/i);
  assert.equal(viewBody.journalEntries, undefined, 'Viewer must not receive journal entries');
  assert.equal(viewBody.lockState, undefined, 'Viewer must not receive lock state');
  console.log('    PASS: VIEWER receives 403 Forbidden with 0 journal data');

  // Requirement 3: SITE_MANAGER -> 403
  console.log('[CHECK 3] SITE_MANAGER GET /api/backup/recovery/status (RBAC Patch)...');
  const engRes = await fetch(BASE_URL + '/api/backup/recovery/status', { headers: { cookie: engCookie } });
  assert.equal(engRes.status, 403, 'SITE_MANAGER must return 403');
  const engBody = await engRes.json();
  assert.match(engBody.error, /only administrators can inspect system recovery status/i);
  console.log('    PASS: SITE_MANAGER receives 403 Forbidden (Authoritative API Boundary)');

  // Requirement 4: SITE_MANAGER cannot infer/retrieve journal information through this endpoint
  console.log('[CHECK 4] Leakage Verification: SITE_MANAGER response body contains no journal or lock data...');
  assert.equal(engBody.journalEntries, undefined, 'journalEntries must be undefined for SITE_MANAGER');
  assert.equal(engBody.lockState, undefined, 'lockState must be undefined for SITE_MANAGER');
  assert.equal(engBody.isLocked, undefined, 'isLocked must be undefined for SITE_MANAGER');
  assert.equal(engBody.isRecoveryMode, undefined, 'isRecoveryMode must be undefined for SITE_MANAGER');
  assert.equal(engBody.activeOperationId, undefined, 'activeOperationId must be undefined for SITE_MANAGER');
  console.log('    PASS: Zero recovery journal, coordinator, or maintenance data exposed to SITE_MANAGER');

  // Requirement 5: ADMIN -> 200
  console.log('[CHECK 5] ADMIN GET /api/backup/recovery/status...');
  const adminRes = await fetch(BASE_URL + '/api/backup/recovery/status', { headers: { cookie: adminCookie } });
  assert.equal(adminRes.status, 200, 'ADMIN must return 200');
  console.log('    PASS: ADMIN receives 200 OK');

  // Requirement 6: ADMIN still receives valid coordinator status
  console.log('[CHECK 6] ADMIN coordinator status validation...');
  const adminBody = await adminRes.json();
  assert.equal(typeof adminBody.isLocked, 'boolean', 'isLocked must be boolean');
  assert.equal(typeof adminBody.isRecoveryMode, 'boolean', 'isRecoveryMode must be boolean');
  assert.equal(typeof adminBody.lockState, 'string', 'lockState must be string');
  assert.equal(adminBody.lockState, 'IDLE', 'lockState must be IDLE under normal operations');
  console.log('    PASS: ADMIN receives valid coordinator status: lockState=' + adminBody.lockState + ', isLocked=' + adminBody.isLocked);

  // Requirement 7: ADMIN still receives journal information
  console.log('[CHECK 7] ADMIN recovery journal validation...');
  assert.ok(Array.isArray(adminBody.journalEntries), 'journalEntries must be an array');
  console.log('    PASS: ADMIN receives ' + adminBody.journalEntries.length + ' recovery journal entries');

  console.log('================================================================');
  console.log('ALL 7 FOCUSED RECOVERY STATUS CHECKS PASSED [7/7]');
  console.log('================================================================');
}

run().catch((err) => {
  console.error('FAIL: Focused recovery status test error:', err);
  process.exit(1);
});
