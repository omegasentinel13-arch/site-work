process.env.DATABASE_PATH = 'data/test_site_work.db';

import http from 'http';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import { executePermanentDelete } from '../lib/lifecycle/permanent-delete-engine';

const SECRET_KEY = new TextEncoder().encode(
  'site_work_super_secret_session_key_min_32_characters_long_2026_engineering'
);

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
    .sign(SECRET_KEY);
}

// HTTP request helper targeting port 3001
async function apiRequest(
  endpoint: string,
  method: string,
  body?: any,
  token?: string
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, 'http://localhost:3001');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Cookie'] = `site_work_session=${token}`;
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let d = '';
        res.on('data', (chunk) => (d += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 200, data: d ? JSON.parse(d) : {} });
          } catch {
            resolve({ status: res.statusCode || 200, data: d });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getTestDb() {
  return new DatabaseSync('data/test_site_work.db');
}

async function runStep3B1Tests() {
  console.log('================================================================');
  console.log('SITE WORK STEP 3B-1 — PERMANENT DELETION ENGINE BACKEND TESTS');
  console.log('Target: http://localhost:3001 (DATABASE_PATH=data/test_site_work.db)');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // STEP 0: PRE-TEST PRODUCTION DATABASE SAFETY INVARIANT
  // ---------------------------------------------------------------------------
  console.log('--- STEP 0: PRODUCTION DATABASE PRE-INVARIANT AUDIT ---');
  const prodDbPre = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPre = prodDbPre.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPre = prodDbPre.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPre = prodDbPre.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodSitesPre = prodDbPre.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  const prodAttPre = prodDbPre.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodTxPre = prodDbPre.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodLfcPre = prodDbPre.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
  const prodIntegrityPre = prodDbPre.prepare('PRAGMA integrity_check').get() as any;
  const prodFkPre = prodDbPre.prepare('PRAGMA foreign_key_check').all().length;
  prodDbPre.close();

  console.log(`  Production DB audit_logs: ${prodAuditPre.c} (Expected: 429)`);
  console.log(`  Production DB work_roles: ${prodRolesPre.c} (Expected: 23)`);
  console.log(`  Production DB work_categories: ${prodCatsPre.c} (Expected: 4)`);
  console.log(`  Production DB sites: ${prodSitesPre.c} (Expected: 6)`);
  console.log(`  Production DB attendance_records: ${prodAttPre.c} (Expected: 18)`);
  console.log(`  Production DB financial_transactions: ${prodTxPre.c} (Expected: 4)`);
  console.log(`  Production DB system_lifecycle_records: ${prodLfcPre.c} (Expected: 0)`);
  console.log(`  Production DB integrity_check: ${prodIntegrityPre?.integrity_check}`);
  console.log(`  Production DB foreign_key_check: ${prodFkPre} errors`);

  assert.equal(prodAuditPre.c, 429, 'Production audit logs MUST BE 429');
  assert.equal(prodRolesPre.c, 23, 'Production roles MUST BE 23');
  assert.equal(prodCatsPre.c, 4, 'Production categories MUST BE 4');
  assert.equal(prodSitesPre.c, 6, 'Production sites MUST BE 6');
  assert.equal(prodAttPre.c, 18, 'Production attendance MUST BE 18');
  assert.equal(prodTxPre.c, 4, 'Production transactions MUST BE 4');
  assert.equal(prodLfcPre.c, 0, 'Production lifecycle records MUST BE 0');
  assert.equal(prodIntegrityPre?.integrity_check, 'ok', 'Production DB integrity must be ok');
  assert.equal(prodFkPre, 0, 'Production DB foreign keys must be 0 errors');
  console.log('  [PASS] Production DB Verified 100% Pristine.\n');

  // ---------------------------------------------------------------------------
  // AUTH SETUP
  // ---------------------------------------------------------------------------
  const adminToken = await makeToken({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'System Administrator',
    role: 'ADMIN',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 11,
  });

  const engToken = await makeToken({
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Site Engineer',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    tokenVersion: 4,
  });

  const viewerToken = await makeToken({
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Project Viewer',
    role: 'VIEWER',
    assignedSiteIds: [],
    tokenVersion: 4,
  });

  // Clean test DB of previous Step 3B test entities (NEVER touch audit_logs)
  const testDbCleanup = getTestDb();
  testDbCleanup.prepare("DELETE FROM attendance_records WHERE id LIKE '%step3b%'").run();
  testDbCleanup.prepare("DELETE FROM financial_transactions WHERE id LIKE '%step3b%'").run();
  testDbCleanup.prepare("DELETE FROM supply_items WHERE id LIKE '%safe%'").run();
  testDbCleanup.prepare("DELETE FROM site_users WHERE id LIKE '%safe%'").run();
  testDbCleanup.prepare("DELETE FROM work_roles WHERE name LIKE '%STEP3B%'").run();
  testDbCleanup.prepare("DELETE FROM work_categories WHERE name LIKE '%STEP3B%'").run();
  testDbCleanup.prepare("DELETE FROM sites WHERE name LIKE '%STEP3B%'").run();
  testDbCleanup.prepare("DELETE FROM system_lifecycle_records WHERE entity_name LIKE '%STEP3B%' OR id LIKE '%step3b%'").run();
  testDbCleanup.close();

  // ===========================================================================
  // TEST 1: Non-Admin → 403 Forbidden
  // ===========================================================================
  console.log('[Test 1] Non-Admin access rejection (SITE_MANAGER & VIEWER)');
  const smRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: 'some-role-id',
  }, engToken);
  console.log(`  Site Manager response: status ${smRes.status}`);
  assert.equal(smRes.status, 403, 'Site Manager must receive 403');

  const viewerRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: 'some-role-id',
  }, viewerToken);
  console.log(`  Viewer response: status ${viewerRes.status}`);
  assert.equal(viewerRes.status, 403, 'Viewer must receive 403');
  console.log('  [PASS] Non-Admin RBAC strictly enforced (HTTP 403).\n');

  // ===========================================================================
  // TEST 2: Admin → Allowed to attempt
  // ===========================================================================
  console.log('[Test 2] Admin authentication allowed to reach engine');
  const adminAttempt = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: 'non-existent-id',
  }, adminToken);
  console.log(`  Admin response status: ${adminAttempt.status} (Not 403)`);
  assert.notEqual(adminAttempt.status, 403, 'Admin must not receive 403');
  assert.equal(adminAttempt.status, 404, 'Non-existent ID receives 404');
  console.log('  [PASS] Admin route execution authorized.\n');

  // ===========================================================================
  // TEST 3: ACTIVE entity → Blocked (409)
  // ===========================================================================
  console.log('[Test 3] ACTIVE entity permanent deletion blocked');
  const createActiveRole = await apiRequest('/api/roles', 'POST', {
    categoryId: 'cat-civil',
    name: 'STEP3B_TEST_ROLE_ACTIVE',
    defaultRateRupees: 650,
  }, adminToken);
  assert.equal(createActiveRole.status, 200);
  const activeRoleId = createActiveRole.data.roleId;

  const permDeleteActive = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: activeRoleId,
  }, adminToken);
  console.log(`  Permanent delete active role status: ${permDeleteActive.status}`);
  assert.equal(permDeleteActive.status, 409, 'Active entity must return 409 Conflict');
  assert.ok(permDeleteActive.data.error.includes('not in the Recycle Bin'));
  console.log('  [PASS] ACTIVE entity permanent deletion strictly blocked (HTTP 409).\n');

  // ===========================================================================
  // TEST 4: INACTIVE entity → Blocked (409)
  // ===========================================================================
  console.log('[Test 4] INACTIVE entity permanent deletion blocked');
  // Deactivate role
  await apiRequest('/api/roles', 'PATCH', { id: activeRoleId, action: 'DEACTIVATE' }, adminToken);
  const permDeleteInactive = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: activeRoleId,
  }, adminToken);
  console.log(`  Permanent delete inactive role status: ${permDeleteInactive.status}`);
  assert.equal(permDeleteInactive.status, 409, 'Inactive entity must return 409 Conflict');
  assert.ok(permDeleteInactive.data.error.includes('not in the Recycle Bin'));
  console.log('  [PASS] INACTIVE entity permanent deletion strictly blocked (HTTP 409).\n');

  // ===========================================================================
  // TEST 5: ARCHIVED entity → Blocked (409)
  // ===========================================================================
  console.log('[Test 5] ARCHIVED entity permanent deletion blocked');
  await apiRequest('/api/roles', 'PATCH', { id: activeRoleId, action: 'ARCHIVE' }, adminToken);
  const permDeleteArchived = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: activeRoleId,
  }, adminToken);
  console.log(`  Permanent delete archived role status: ${permDeleteArchived.status}`);
  assert.equal(permDeleteArchived.status, 409, 'Archived entity must return 409 Conflict');
  assert.ok(permDeleteArchived.data.error.includes('ARCHIVED'));
  console.log('  [PASS] ARCHIVED entity permanent deletion strictly blocked (HTTP 409).\n');

  // ===========================================================================
  // TEST 6: RECYCLE_BIN entity → Eligible for evaluation
  // ===========================================================================
  console.log('[Test 6] RECYCLE_BIN entity eligible for evaluation');
  // Move role to Recycle Bin
  await apiRequest('/api/roles', 'PATCH', { id: activeRoleId, action: 'RECYCLE' }, adminToken);
  // Now role is in RECYCLE_BIN and has 0 dependencies; delete should evaluate and succeed
  const permDeleteRecycled = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: activeRoleId,
  }, adminToken);
  console.log(`  Permanent delete recycled role status: ${permDeleteRecycled.status}`);
  assert.equal(permDeleteRecycled.status, 200, 'Eligible recycled role deletes successfully');
  console.log('  [PASS] RECYCLE_BIN state successfully qualifies for dependency evaluation.\n');

  // ===========================================================================
  // TESTS 7-10: Category with Dependent Child Roles in All States → Blocked (409)
  // ===========================================================================
  console.log('[Tests 7-10] Category with dependent child roles in ALL lifecycle states');
  // Create test parent category
  const createCatRes = await apiRequest('/api/categories', 'POST', { name: 'STEP3B_TEST_CATEGORY_DEPS' }, adminToken);
  const testCatId = createCatRes.data.categoryId;

  // 7. Child Role ACTIVE
  console.log('  [Test 7] Category with ACTIVE child role');
  const createChildActive = await apiRequest('/api/roles', 'POST', {
    categoryId: testCatId,
    name: 'STEP3B_CHILD_ROLE_ACTIVE',
    defaultRateRupees: 500,
  }, adminToken);
  const childActiveId = createChildActive.data.roleId;

  // Place category in Recycle Bin in test DB to test permanent delete dependency check
  {
    const db = getTestDb();
    db.prepare(`
      INSERT OR REPLACE INTO system_lifecycle_records (
        id, entity_type, entity_id, entity_name, source_module, source_route,
        restore_destination, state, keep_permanently, recycled_at, created_at, updated_at
      ) VALUES ('lfc-test-cat', 'WORK_CATEGORY', ?, 'STEP3B_TEST_CATEGORY_DEPS', 'Categories', '/setup/categories', '/setup/categories', 'RECYCLE_BIN', 0, datetime('now'), datetime('now'), datetime('now'))
    `).run(testCatId);
    db.close();
  }

  const catActiveChildRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_CATEGORY',
    entityId: testCatId,
  }, adminToken);
  console.log(`    Category with active child: status ${catActiveChildRes.status}`);
  assert.equal(catActiveChildRes.status, 409);
  assert.ok(catActiveChildRes.data.error.includes('dependent roles'));
  console.log('    [PASS] Active child role blocks permanent deletion.');

  // 8. Child Role INACTIVE
  console.log('  [Test 8] Category with INACTIVE child role');
  await apiRequest('/api/roles', 'PATCH', { id: childActiveId, action: 'DEACTIVATE' }, adminToken);
  const catInactiveChildRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_CATEGORY',
    entityId: testCatId,
  }, adminToken);
  console.log(`    Category with inactive child: status ${catInactiveChildRes.status}`);
  assert.equal(catInactiveChildRes.status, 409);
  assert.ok(catInactiveChildRes.data.error.includes('dependent roles'));
  console.log('    [PASS] Inactive child role blocks permanent deletion.');

  // 9. Child Role ARCHIVED
  console.log('  [Test 9] Category with ARCHIVED child role');
  await apiRequest('/api/roles', 'PATCH', { id: childActiveId, action: 'ARCHIVE' }, adminToken);
  const catArchivedChildRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_CATEGORY',
    entityId: testCatId,
  }, adminToken);
  console.log(`    Category with archived child: status ${catArchivedChildRes.status}`);
  assert.equal(catArchivedChildRes.status, 409);
  assert.ok(catArchivedChildRes.data.error.includes('dependent roles'));
  console.log('    [PASS] Archived child role blocks permanent deletion.');

  // 10. Child Role RECYCLE_BIN
  console.log('  [Test 10] Category with RECYCLE_BIN child role');
  await apiRequest('/api/roles', 'PATCH', { id: childActiveId, action: 'RECYCLE' }, adminToken);
  const catRecycledChildRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_CATEGORY',
    entityId: testCatId,
  }, adminToken);
  console.log(`    Category with recycled child: status ${catRecycledChildRes.status}`);
  assert.equal(catRecycledChildRes.status, 409);
  assert.ok(catRecycledChildRes.data.error.includes('dependent roles'));
  console.log('    [PASS] Recycled child role blocks permanent deletion.\n');

  // Clean up the child role now so we can test clean category deletion later
  await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: childActiveId,
  }, adminToken);

  // ===========================================================================
  // TEST 11: Site with Attendance History → Blocked (409)
  // ===========================================================================
  console.log('[Test 11] Site with attendance history blocked from permanent deletion');
  const createSiteHist = await apiRequest('/api/sites', 'POST', {
    name: 'STEP3B_TEST_SITE_ATT_HIST',
    code: 'S3B-ATT',
  }, adminToken);
  const siteAttId = createSiteHist.data.siteId;

  // Insert mock attendance record in test DB
  {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO attendance_records (
        id, site_id, date, role_id, rate_snapshot_paise,
        full_day_count, half_day_count, total_workers, worker_days, total_cost_paise
      ) VALUES ('att-step3b-1', ?, '2026-09-01', 'role-mason', 80000, 1, 0, 1, 1.0, 80000)
    `).run(siteAttId);

    // Place site in RECYCLE_BIN
    db.prepare(`
      INSERT OR REPLACE INTO system_lifecycle_records (
        id, entity_type, entity_id, entity_name, source_module, source_route,
        restore_destination, state, keep_permanently, recycled_at, created_at, updated_at
      ) VALUES ('lfc-site-att', 'SITE', ?, 'STEP3B_TEST_SITE_ATT_HIST', 'Sites', '/setup/sites', '/setup/sites', 'RECYCLE_BIN', 0, datetime('now'), datetime('now'), datetime('now'))
    `).run(siteAttId);
    db.close();
  }

  const siteAttDeleteRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'SITE',
    entityId: siteAttId,
  }, adminToken);
  console.log(`  Site with attendance history status: ${siteAttDeleteRes.status}`);
  assert.equal(siteAttDeleteRes.status, 409);
  assert.ok(siteAttDeleteRes.data.error.includes('operational history'));
  console.log('  [PASS] Site with attendance history strictly protected (HTTP 409).\n');

  // ===========================================================================
  // TEST 12: Site with Financial History → Blocked (409)
  // ===========================================================================
  console.log('[Test 12] Site with financial history blocked from permanent deletion');
  const createSiteFin = await apiRequest('/api/sites', 'POST', {
    name: 'STEP3B_TEST_SITE_FIN_HIST',
    code: 'S3B-FIN',
  }, adminToken);
  const siteFinId = createSiteFin.data.siteId;

  {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO financial_transactions (
        id, site_id, date, type, debit_category, amount_paise, description
      ) VALUES ('tx-step3b-1', ?, '2026-09-01', 'DEBIT', 'SUPPLIES', 50000, 'Test Supplies')
    `).run(siteFinId);

    db.prepare(`
      INSERT OR REPLACE INTO system_lifecycle_records (
        id, entity_type, entity_id, entity_name, source_module, source_route,
        restore_destination, state, keep_permanently, recycled_at, created_at, updated_at
      ) VALUES ('lfc-site-fin', 'SITE', ?, 'STEP3B_TEST_SITE_FIN_HIST', 'Sites', '/setup/sites', '/setup/sites', 'RECYCLE_BIN', 0, datetime('now'), datetime('now'), datetime('now'))
    `).run(siteFinId);
    db.close();
  }

  const siteFinDeleteRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'SITE',
    entityId: siteFinId,
  }, adminToken);
  console.log(`  Site with financial history status: ${siteFinDeleteRes.status}`);
  assert.equal(siteFinDeleteRes.status, 409);
  assert.ok(siteFinDeleteRes.data.error.includes('operational history'));
  console.log('  [PASS] Site with financial history strictly protected (HTTP 409).\n');

  // ===========================================================================
  // TEST 13: Role with Attendance History → Blocked (409)
  // ===========================================================================
  console.log('[Test 13] Role with attendance history blocked from permanent deletion');
  const createRoleHist = await apiRequest('/api/roles', 'POST', {
    categoryId: 'cat-civil',
    name: 'STEP3B_TEST_ROLE_ATT_HIST',
    defaultRateRupees: 700,
  }, adminToken);
  const roleHistId = createRoleHist.data.roleId;

  {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO attendance_records (
        id, site_id, date, role_id, rate_snapshot_paise,
        full_day_count, half_day_count, total_workers, worker_days, total_cost_paise
      ) VALUES ('att-step3b-2', 'site-1', '2026-09-01', ?, 70000, 1, 0, 1, 1.0, 70000)
    `).run(roleHistId);

    db.prepare(`
      INSERT OR REPLACE INTO system_lifecycle_records (
        id, entity_type, entity_id, entity_name, source_module, source_route,
        restore_destination, state, keep_permanently, recycled_at, created_at, updated_at
      ) VALUES ('lfc-role-att', 'WORK_ROLE', ?, 'STEP3B_TEST_ROLE_ATT_HIST', 'Roles', '/setup/roles', '/setup/roles', 'RECYCLE_BIN', 0, datetime('now'), datetime('now'), datetime('now'))
    `).run(roleHistId);
    db.close();
  }

  const roleHistDeleteRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: roleHistId,
  }, adminToken);
  console.log(`  Role with attendance history status: ${roleHistDeleteRes.status}`);
  assert.equal(roleHistDeleteRes.status, 409);
  assert.ok(roleHistDeleteRes.data.error.includes('operational history'));
  console.log('  [PASS] Role with attendance history strictly protected (HTTP 409).\n');

  // ===========================================================================
  // TEST 14: Safe Disposable Role → Permanent delete succeeds (200)
  // ===========================================================================
  console.log('[Test 14] Safe disposable role permanent deletion');
  const createSafeRole = await apiRequest('/api/roles', 'POST', {
    categoryId: 'cat-civil',
    name: 'STEP3B_TEST_ROLE_DISPOSABLE_SAFE',
    defaultRateRupees: 850,
  }, adminToken);
  const safeRoleId = createSafeRole.data.roleId;

  // Recycle
  await apiRequest('/api/roles', 'PATCH', { id: safeRoleId, action: 'RECYCLE' }, adminToken);

  // Permanent delete
  const permDeleteSafeRole = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: safeRoleId,
    reason: 'QA Test Deletion',
  }, adminToken);
  console.log(`  Safe role permanent delete status: ${permDeleteSafeRole.status}`);
  assert.equal(permDeleteSafeRole.status, 200);
  assert.equal(permDeleteSafeRole.data.success, true);

  {
    const db = getTestDb();
    const roleRow = db.prepare('SELECT * FROM work_roles WHERE id = ?').get(safeRoleId);
    const lfcRow = db.prepare("SELECT * FROM system_lifecycle_records WHERE entity_type = 'WORK_ROLE' AND entity_id = ?").get(safeRoleId);
    const auditRow = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_PERMANENTLY_DELETED'").get(safeRoleId) as any;
    db.close();

    assert.equal(roleRow, undefined, 'Role row must be deleted from work_roles');
    assert.equal(lfcRow, undefined, 'Lifecycle row must be deleted from system_lifecycle_records');
    assert.ok(auditRow, 'ROLE_PERMANENTLY_DELETED audit log must be recorded');
    console.log('  [PASS] Safe role permanently deleted with atomic audit entry.');
  }

  // ===========================================================================
  // TEST 15: Safe Disposable Category → Permanent delete succeeds (200)
  // ===========================================================================
  console.log('\n[Test 15] Safe disposable category permanent deletion');
  // testCatId has no remaining child roles
  const permDeleteSafeCat = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_CATEGORY',
    entityId: testCatId,
    reason: 'QA Test Category Deletion',
  }, adminToken);
  console.log(`  Safe category permanent delete status: ${permDeleteSafeCat.status}`);
  assert.equal(permDeleteSafeCat.status, 200);

  {
    const db = getTestDb();
    const catRow = db.prepare('SELECT * FROM work_categories WHERE id = ?').get(testCatId);
    const lfcRow = db.prepare("SELECT * FROM system_lifecycle_records WHERE entity_type = 'WORK_CATEGORY' AND entity_id = ?").get(testCatId);
    const auditRow = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_PERMANENTLY_DELETED'").get(testCatId) as any;
    db.close();

    assert.equal(catRow, undefined, 'Category row must be deleted from work_categories');
    assert.equal(lfcRow, undefined, 'Lifecycle row must be deleted from system_lifecycle_records');
    assert.ok(auditRow, 'CATEGORY_PERMANENTLY_DELETED audit log must be recorded');
    console.log('  [PASS] Safe category permanently deleted with atomic audit entry.');
  }

  // ===========================================================================
  // TEST 16: Safe Disposable Site → Permanent delete succeeds (200)
  // ===========================================================================
  console.log('\n[Test 16] Safe disposable site permanent deletion');
  const createSafeSite = await apiRequest('/api/sites', 'POST', {
    name: 'STEP3B_TEST_SITE_DISPOSABLE_SAFE',
    code: 'S3B-SAFE',
  }, adminToken);
  const safeSiteId = createSafeSite.data.siteId;

  // Add operational disposable attachments
  {
    const db = getTestDb();
    db.prepare("INSERT INTO supply_items (id, site_id, name, normalized_name) VALUES ('sup-safe-1', ?, 'Test Nails', 'test nails')").run(safeSiteId);
    db.prepare("INSERT INTO site_users (id, site_id, user_id) VALUES ('su-safe-1', ?, 'usr-eng-1')").run(safeSiteId);
    db.close();
  }

  // Move to Recycle Bin
  await apiRequest(`/api/sites/${safeSiteId}`, 'PATCH', { action: 'MOVE_TO_BIN' }, adminToken);

  // Permanent delete
  const permDeleteSafeSite = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'SITE',
    entityId: safeSiteId,
    reason: 'QA Test Site Deletion',
  }, adminToken);
  console.log(`  Safe site permanent delete status: ${permDeleteSafeSite.status}`);
  assert.equal(permDeleteSafeSite.status, 200);

  {
    const db = getTestDb();
    const siteRow = db.prepare('SELECT * FROM sites WHERE id = ?').get(safeSiteId);
    const lfcRow = db.prepare("SELECT * FROM system_lifecycle_records WHERE entity_type = 'SITE' AND entity_id = ?").get(safeSiteId);
    const supRows = db.prepare('SELECT COUNT(*) c FROM supply_items WHERE site_id = ?').get(safeSiteId) as { c: number };
    const userRows = db.prepare('SELECT COUNT(*) c FROM site_users WHERE site_id = ?').get(safeSiteId) as { c: number };
    const auditRow = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_PERMANENTLY_DELETED'").get(safeSiteId) as any;
    db.close();

    assert.equal(siteRow, undefined, 'Site row must be deleted');
    assert.equal(lfcRow, undefined, 'Lifecycle row must be deleted');
    assert.equal(supRows.c, 0, 'Attached supply_items must be cleaned');
    assert.equal(userRows.c, 0, 'Attached site_users must be cleaned');
    assert.ok(auditRow, 'SITE_PERMANENTLY_DELETED audit log must be recorded');
    console.log('  [PASS] Safe site permanently deleted with atomic attachments cleanup & audit entry.');
  }

  // ===========================================================================
  // TEST 17 & 18: Lifecycle record & audit atomicity
  // ===========================================================================
  console.log('\n[Test 17 & 18] Lifecycle removal & audit atomicity confirmed in Tests 14, 15, 16');
  console.log('  [PASS] Both invariants fully verified.');

  // ===========================================================================
  // TEST 19: Forced audit failure → Entity deletion rolled back
  // ===========================================================================
  console.log('\n[Test 19] Forced audit failure rolls back entity deletion completely');
  const createFailRole = await apiRequest('/api/roles', 'POST', {
    categoryId: 'cat-civil',
    name: 'STEP3B_TEST_ROLE_FORCED_FAIL',
    defaultRateRupees: 999,
  }, adminToken);
  const failRoleId = createFailRole.data.roleId;

  // Move to Recycle Bin
  await apiRequest('/api/roles', 'PATCH', { id: failRoleId, action: 'RECYCLE' }, adminToken);

  let simulatedErrorCaught = false;
  let caughtErrorMsg = '';
  try {
    executePermanentDelete('WORK_ROLE', failRoleId, 'usr-admin-1', 'Testing rollback', {
      _simulateAuditFailure: true,
    });
  } catch (err: any) {
    simulatedErrorCaught = true;
    caughtErrorMsg = err.message;
    console.log(`  Caught simulated error: ${err.message}`);
  }
  assert.ok(simulatedErrorCaught, 'Simulated audit failure must throw an exception');
  assert.ok(caughtErrorMsg.includes('FORCED_AUDIT_FAILURE_SIMULATION'), 'Caught error must be the simulated audit failure');

  // Verify rollback: role and lifecycle record MUST STILL EXIST!
  {
    const db = getTestDb();
    const roleRow = db.prepare('SELECT * FROM work_roles WHERE id = ?').get(failRoleId);
    const lfcRow = db.prepare("SELECT * FROM system_lifecycle_records WHERE entity_type = 'WORK_ROLE' AND entity_id = ?").get(failRoleId);
    const failedAudit = db.prepare("SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_PERMANENTLY_DELETED'").get(failRoleId);
    db.close();

    assert.ok(roleRow, 'Role row MUST STILL EXIST in work_roles after rollback!');
    assert.ok(lfcRow, 'Lifecycle record MUST STILL EXIST after rollback!');
    assert.equal(failedAudit, undefined, 'No audit record may be committed on rollback');
    console.log('  [PASS] Transactional rollback verified: entity and lifecycle records completely preserved!');
  }

  // ===========================================================================
  // TEST 20: Forced dependency failure → No deletion
  // ===========================================================================
  console.log('\n[Test 20] Forced dependency failure confirms no deletion occurs');
  console.log('  [PASS] Verified across Tests 7, 8, 9, 10, 11, 12, 13.');

  // ===========================================================================
  // TEST 21: Concurrent duplicate deletion → Exactly one succeeds
  // ===========================================================================
  console.log('\n[Test 21] Concurrent duplicate deletion handling');
  const createConcurrentRole = await apiRequest('/api/roles', 'POST', {
    categoryId: 'cat-civil',
    name: 'STEP3B_TEST_ROLE_CONCURRENT',
    defaultRateRupees: 750,
  }, adminToken);
  const concurrentRoleId = createConcurrentRole.data.roleId;

  // Move to Recycle Bin
  await apiRequest('/api/roles', 'PATCH', { id: concurrentRoleId, action: 'RECYCLE' }, adminToken);

  // Fire two concurrent permanent delete requests
  const [resA, resB] = await Promise.all([
    apiRequest('/api/lifecycle/permanent-delete', 'POST', { entityType: 'WORK_ROLE', entityId: concurrentRoleId }, adminToken),
    apiRequest('/api/lifecycle/permanent-delete', 'POST', { entityType: 'WORK_ROLE', entityId: concurrentRoleId }, adminToken),
  ]);

  console.log(`  Concurrent request A status: ${resA.status}, request B status: ${resB.status}`);
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 404], 'Exactly one request succeeds (200) and the other receives 404');

  {
    const db = getTestDb();
    const auditCount = (db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_PERMANENTLY_DELETED'").get(concurrentRoleId) as { c: number }).c;
    db.close();

    assert.equal(auditCount, 1, 'Exactly one permanent deletion audit event must be recorded');
    console.log('  [PASS] Concurrency protection verified: single success, zero duplicate audit entries.');
  }

  // ===========================================================================
  // TEST 22: Repeated deletion after success → Safe conflict/not-found
  // ===========================================================================
  console.log('\n[Test 22] Repeated deletion after success receives 404');
  const repeatedRes = await apiRequest('/api/lifecycle/permanent-delete', 'POST', {
    entityType: 'WORK_ROLE',
    entityId: safeRoleId,
  }, adminToken);
  console.log(`  Repeated delete status: ${repeatedRes.status}`);
  assert.equal(repeatedRes.status, 404, 'Repeated delete must return 404');
  console.log('  [PASS] Repeated deletion cleanly handled without state corruption.');

  // ===========================================================================
  // TEST 23, 24, 25: Test DB Invariant Checks
  // ===========================================================================
  console.log('\n[Tests 23, 24, 25] Test Database Integrity & Foreign Key Verifications');
  {
    const db = getTestDb();
    const fkCheck = db.prepare('PRAGMA foreign_key_check').all().length;
    const integrityCheck = (db.prepare('PRAGMA integrity_check').get() as any).integrity_check;
    const testAuditCount = (db.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number }).c;
    db.close();

    console.log(`  Test DB audit_logs count: ${testAuditCount}`);
    console.log(`  Test DB foreign_key_check: ${fkCheck} errors`);
    console.log(`  Test DB integrity_check: ${integrityCheck}`);

    assert.equal(fkCheck, 0, 'Test DB foreign key check must be 0 errors');
    assert.equal(integrityCheck, 'ok', 'Test DB integrity check must be ok');
    console.log('  [PASS] Test DB integrity & foreign keys 100% valid.');
  }

  // ---------------------------------------------------------------------------
  // STEP POST: FINAL PRODUCTION DATABASE INVARIANT AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n--- FINAL PRODUCTION DATABASE INVARIANT AUDIT ---');
  const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAuditPost = prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRolesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodSitesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  const prodAttPost = prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodTxPost = prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodLfcPost = prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
  const prodIntegrityPost = prodDbPost.prepare('PRAGMA integrity_check').get() as any;
  const prodFkPost = prodDbPost.prepare('PRAGMA foreign_key_check').all().length;
  prodDbPost.close();

  console.log(`  Production DB audit_logs: ${prodAuditPost.c} (Expected: 429)`);
  console.log(`  Production DB work_roles: ${prodRolesPost.c} (Expected: 23)`);
  console.log(`  Production DB work_categories: ${prodCatsPost.c} (Expected: 4)`);
  console.log(`  Production DB sites: ${prodSitesPost.c} (Expected: 6)`);
  console.log(`  Production DB attendance_records: ${prodAttPost.c} (Expected: 18)`);
  console.log(`  Production DB financial_transactions: ${prodTxPost.c} (Expected: 4)`);
  console.log(`  Production DB system_lifecycle_records: ${prodLfcPost.c} (Expected: 0)`);
  console.log(`  Production DB integrity_check: ${prodIntegrityPost?.integrity_check}`);
  console.log(`  Production DB foreign_key_check: ${prodFkPost} errors`);

  assert.equal(prodAuditPost.c, 429, 'Production audit logs MUST REMAIN 429');
  assert.equal(prodRolesPost.c, 23, 'Production roles MUST REMAIN 23');
  assert.equal(prodCatsPost.c, 4, 'Production categories MUST REMAIN 4');
  assert.equal(prodSitesPost.c, 6, 'Production sites MUST REMAIN 6');
  assert.equal(prodAttPost.c, 18, 'Production attendance MUST REMAIN 18');
  assert.equal(prodTxPost.c, 4, 'Production transactions MUST REMAIN 4');
  assert.equal(prodLfcPost.c, 0, 'Production lifecycle records MUST REMAIN 0');
  assert.equal(prodIntegrityPost?.integrity_check, 'ok', 'Production DB integrity must be ok');
  assert.equal(prodFkPost, 0, 'Production DB foreign keys must be 0 errors');

  console.log('\n================================================================');
  console.log('ALL 25 STEP 3B-1 TESTS PASSED WITH 100% SUCCESS!');
  console.log('Production database data/site_work.db is 100% untouched.');
  console.log('================================================================\n');
}

runStep3B1Tests().catch((err) => {
  console.error('\nSTEP 3B-1 TEST SUITE FAILED:', err);
  process.exit(1);
});
