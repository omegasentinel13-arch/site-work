import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const SECRET_KEY = new TextEncoder().encode(
  'site_work_super_secret_session_key_min_32_characters_long_2026_engineering'
);

async function createToken(userId: string, username: string, role: 'ADMIN' | 'VIEWER', tokenVersion: number) {
  return new SignJWT({
    userId,
    username,
    fullName: `${role} User`,
    role,
    assignedSiteIds: [],
    tokenVersion,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET_KEY);
}

async function runStep2QA() {
  console.log('===============================================================');
  console.log('SITE WORK STEP 2 — ROLE + CATEGORY MANAGEMENT QA SUITE');
  console.log('Target: http://localhost:3001 (Isolated Test DB)');
  console.log('===============================================================\n');

  // Verify Production DB Safety first
  const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodAudit = prodDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodRoles = prodDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCats = prodDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  prodDb.close();

  console.log(`[Production DB Pre-Check] audit_logs: ${prodAudit.c}, roles: ${prodRoles.c}, categories: ${prodCats.c}`);
  assert.equal(prodAudit.c, 426, 'Production audit logs MUST be 426 before QA runs');

  // Prepare Admin and Viewer Session Headers
  const adminToken = await createToken('usr-admin-1', 'Iamadmin', 'ADMIN', 11);
  const viewerToken = await createToken('usr-view-1', 'viewer1', 'VIEWER', 1);

  const adminHeaders = {
    'Content-Type': 'application/json',
    Cookie: `site_work_session=${adminToken}`,
  };

  const viewerHeaders = {
    'Content-Type': 'application/json',
    Cookie: `site_work_session=${viewerToken}`,
  };

  // Inspect Baseline QA DB
  const testDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const testAudit = testDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const testRoles = testDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const testCats = testDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  testDb.close();

  console.log(`[Test DB Baseline] audit_logs: ${testAudit.c}, roles: ${testRoles.c}, categories: ${testCats.c}\n`);

  // =========================================================================
  // SECTION 1: CATEGORY MANAGEMENT TESTS
  // =========================================================================
  console.log('--- 1. Testing GET /api/categories (Usage Intelligence) ---');
  let res = await fetch('http://localhost:3001/api/categories?includeInactive=true', {
    headers: adminHeaders,
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.categories.length, 4, 'Must return 4 categories');

  const civilCat = data.categories.find((c: any) => c.id === 'cat-civil');
  assert(civilCat, 'CIVIL WORKS category must exist');
  assert.equal(civilCat.role_count, 13, 'CIVIL WORKS must have 13 total roles');
  assert.equal(civilCat.active_role_count, 9, 'CIVIL WORKS must have 9 active roles');
  assert.equal(civilCat.inactive_role_count, 4, 'CIVIL WORKS must have 4 inactive roles');
  console.log('✓ Category usage intelligence verified: civil works has 13 roles (9 active, 4 inactive).');

  console.log('\n--- 2. Testing POST /api/categories (Create Category) ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ name: 'SPECIALIST FABRICATION', sortOrder: 5 }),
  });
  data = await res.json();
  assert.equal(res.status, 200, `Expected 200: ${JSON.stringify(data)}`);
  assert(data.categoryId, 'Category ID must be returned');
  const newCatId = data.categoryId;
  console.log(`✓ Category created with ID: ${newCatId}`);

  console.log('\n--- 3. Testing Duplicate Category Name Prevention ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ name: 'SPECIALIST FABRICATION', sortOrder: 6 }),
  });
  data = await res.json();
  assert.equal(res.status, 409, 'Duplicate category name must return HTTP 409 Conflict');
  console.log('✓ Duplicate category name correctly blocked with 409 Conflict.');

  console.log('\n--- 4. Testing PUT /api/categories (Update Category) ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ id: newCatId, name: 'HEAVY FABRICATION', sortOrder: 8 }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  console.log('✓ Category updated successfully.');

  console.log('\n--- 5. Testing Category Deactivate & Activate ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newCatId, action: 'DEACTIVATE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  let qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  let checkCat = qDb.prepare('SELECT is_active FROM work_categories WHERE id = ?').get(newCatId) as { is_active: number };
  assert.equal(checkCat.is_active, 0, 'Category must be inactive');
  qDb.close();

  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newCatId, action: 'ACTIVATE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  checkCat = qDb.prepare('SELECT is_active FROM work_categories WHERE id = ?').get(newCatId) as { is_active: number };
  assert.equal(checkCat.is_active, 1, 'Category must be active');
  qDb.close();
  console.log('✓ Category deactivation and reactivation verified.');

  console.log('\n--- 6. Testing Category Archive & Restore ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newCatId, action: 'ARCHIVE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  let lfcCat = qDb.prepare('SELECT state FROM system_lifecycle_records WHERE entity_type = ? AND entity_id = ?').get('WORK_CATEGORY', newCatId) as { state: string };
  assert.equal(lfcCat.state, 'ARCHIVED');
  qDb.close();

  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newCatId, action: 'RESTORE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  lfcCat = qDb.prepare('SELECT state FROM system_lifecycle_records WHERE entity_type = ? AND entity_id = ?').get('WORK_CATEGORY', newCatId) as any;
  assert.equal(lfcCat, undefined, 'Lifecycle record must be removed on restore');
  qDb.close();
  console.log('✓ Category archive and restore verified.');

  console.log('\n--- 7. Testing Category Deletion Safety Blocking (With Child Roles) ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: 'cat-civil', action: 'RECYCLE' }),
  });
  data = await res.json();
  assert.equal(res.status, 409, 'Category with child roles must be blocked with HTTP 409');
  assert(
    data.error.includes('role(s) depend on it') || data.error.includes('dependent roles') || data.error.includes('child roles'),
    `Error must mention dependent roles: ${data.error}`
  );
  console.log(`✓ Category deletion blocked safely as expected: "${data.error}"`);

  console.log('\n--- 8. Testing Category Move to Recycle Bin (Childless Category) ---');
  res = await fetch('http://localhost:3001/api/categories', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newCatId, action: 'RECYCLE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  let binCat = qDb.prepare('SELECT state FROM system_lifecycle_records WHERE entity_type = ? AND entity_id = ?').get('WORK_CATEGORY', newCatId) as { state: string };
  assert.equal(binCat.state, 'RECYCLE_BIN');
  let lastAudit = qDb.prepare('SELECT action FROM audit_logs ORDER BY rowid DESC LIMIT 1').get() as { action: string };
  assert.equal(lastAudit.action, 'CATEGORY_DELETED_TO_RECYCLE_BIN');
  qDb.close();
  console.log('✓ Childless category moved to Recycle Bin with CATEGORY_DELETED_TO_RECYCLE_BIN audit event.');

  // =========================================================================
  // SECTION 2: ROLE MANAGEMENT TESTS
  // =========================================================================
  console.log('\n--- 9. Testing GET /api/roles (Usage Intelligence) ---');
  res = await fetch('http://localhost:3001/api/roles?includeInactive=true', {
    headers: adminHeaders,
  });
  data = await res.json();
  assert.equal(res.status, 200);

  const masonRole = data.roles.find((r: any) => r.id === 'role-mason');
  assert(masonRole, 'Mason role must exist');
  assert.equal(masonRole.attendance_count, 5, 'Mason must have 5 attendance records');
  assert.equal(masonRole.total_worker_days, 33, 'Mason must have 33 total worker days');
  assert.equal(masonRole.sites_used_count, 1, 'Mason must have 1 site used');
  assert.equal(masonRole.site_override_count, 1, 'Mason must have 1 site rate override');
  console.log('✓ Role usage intelligence verified: Mason has 5 recs, 33 worker-days, 1 site override.');

  console.log('\n--- 10. Testing POST /api/roles (Create Role) ---');
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      categoryId: 'cat-civil',
      name: 'Senior Lead Structural Mason',
      defaultRateRupees: 1850,
      sortOrder: 25,
    }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  assert(data.roleId, 'Role ID must be returned');
  const newRoleId = data.roleId;

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  let checkRole = qDb.prepare('SELECT * FROM work_roles WHERE id = ?').get(newRoleId) as { name: string; default_rate_paise: number };
  assert.equal(checkRole.name, 'Senior Lead Structural Mason');
  assert.equal(checkRole.default_rate_paise, 185000);
  qDb.close();
  console.log(`✓ Role created with ID: ${newRoleId}, rate ₹1,850.`);

  console.log('\n--- 11. Testing PUT /api/roles (Update Role & Category) ---');
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({
      id: newRoleId,
      name: 'Master Structural Specialist',
      categoryId: 'cat-finishing',
      defaultRateRupees: 1950,
      sortOrder: 26,
    }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  checkRole = qDb.prepare('SELECT * FROM work_roles WHERE id = ?').get(newRoleId) as any;
  assert.equal(checkRole.name, 'Master Structural Specialist');
  assert.equal(checkRole.default_rate_paise, 195000);
  assert.equal((checkRole as any).category_id, 'cat-finishing');
  qDb.close();
  console.log('✓ Role updated successfully: name, category, and rate modified.');

  console.log('\n--- 12. Testing Role Deactivate & Reactivate ---');
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newRoleId, action: 'DEACTIVATE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newRoleId, action: 'ACTIVATE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  console.log('✓ Role deactivation and reactivation verified.');

  console.log('\n--- 13. Testing Role Archive & Restore ---');
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newRoleId, action: 'ARCHIVE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  let lfcRole = qDb.prepare('SELECT state FROM system_lifecycle_records WHERE entity_type = ? AND entity_id = ?').get('WORK_ROLE', newRoleId) as { state: string };
  assert.equal(lfcRole.state, 'ARCHIVED');
  qDb.close();

  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newRoleId, action: 'RESTORE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  lfcRole = qDb.prepare('SELECT state FROM system_lifecycle_records WHERE entity_type = ? AND entity_id = ?').get('WORK_ROLE', newRoleId) as any;
  assert.equal(lfcRole, undefined, 'Lifecycle record must be removed on restore');
  qDb.close();
  console.log('✓ Role archive and restore verified.');

  console.log('\n--- 14. Testing Role Move to Recycle Bin ---');
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: newRoleId, action: 'RECYCLE' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  qDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  let binRole = qDb.prepare('SELECT state FROM system_lifecycle_records WHERE entity_type = ? AND entity_id = ?').get('WORK_ROLE', newRoleId) as { state: string };
  assert.equal(binRole.state, 'RECYCLE_BIN');
  let roleAudit = qDb.prepare('SELECT action FROM audit_logs ORDER BY rowid DESC LIMIT 1').get() as { action: string };
  assert.equal(roleAudit.action, 'ROLE_DELETED_TO_RECYCLE_BIN');
  qDb.close();
  console.log('✓ Role moved to Recycle Bin with ROLE_DELETED_TO_RECYCLE_BIN audit event.');

  // =========================================================================
  // SECTION 3: DAILY ATTENDANCE REGRESSION TEST
  // =========================================================================
  console.log('\n--- 15. Testing Daily Attendance Inactive Role Visibility ---');
  // First, deactivate role-mason temporarily
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: 'role-mason', action: 'DEACTIVATE' }),
  });
  assert.equal(res.status, 200);

  // Query historical date with existing records (2026-09-02)
  res = await fetch('http://localhost:3001/api/attendance/daily?siteId=site-1&date=2026-09-02', {
    headers: adminHeaders,
  });
  data = await res.json();
  assert.equal(res.status, 200);

  const returnedMason = data.roles.find((r: any) => r.roleId === 'role-mason');
  assert(returnedMason, 'Deactivated role-mason MUST still appear on historical date with records!');
  assert.equal(returnedMason.hasRecord, true);
  assert.equal(returnedMason.isActive, false);
  assert.equal(returnedMason.rateInPaise, 150000, 'Snapshot rate must remain intact');
  assert.equal(returnedMason.totalCostPaise, 900000, 'Historical total cost must remain intact');
  console.log('✓ Historical attendance regression check PASSED: inactive role displayed with intact rate & cost.');

  // Query future / new date without records (2026-09-30)
  res = await fetch('http://localhost:3001/api/attendance/daily?siteId=site-1&date=2026-09-30', {
    headers: adminHeaders,
  });
  data = await res.json();
  assert.equal(res.status, 200);

  const returnedMasonNewDate = data.roles.find((r: any) => r.roleId === 'role-mason');
  assert.equal(returnedMasonNewDate, undefined, 'Deactivated role-mason must NOT appear on new date without records!');
  console.log('✓ New date attendance check PASSED: inactive role correctly excluded from empty date form.');

  // Reactivate role-mason
  res = await fetch('http://localhost:3001/api/roles', {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ id: 'role-mason', action: 'ACTIVATE' }),
  });
  assert.equal(res.status, 200);
  console.log('✓ role-mason reactivated.');

  // =========================================================================
  // SECTION 4: PAGE ROUTE RENDERING TESTS
  // =========================================================================
  console.log('\n--- 16. Testing Page Route: GET /setup/roles ---');
  res = await fetch('http://localhost:3001/setup/roles', {
    headers: { Cookie: `site_work_session=${adminToken}` },
  });
  assert.equal(res.status, 200);
  let html = await res.text();
  assert(html.includes('ROLES'), 'Page must contain heading ROLES');
  console.log('✓ /setup/roles route renders successfully with HTTP 200 OK.');

  console.log('\n--- 17. Testing Page Route: GET /setup/categories ---');
  res = await fetch('http://localhost:3001/setup/categories', {
    headers: { Cookie: `site_work_session=${adminToken}` },
  });
  assert.equal(res.status, 200);
  html = await res.text();
  assert(html.includes('CATEGORIES'), 'Page must contain heading CATEGORIES');
  console.log('✓ /setup/categories route renders successfully with HTTP 200 OK.');

  // =========================================================================
  // SECTION 5: FINAL PRODUCTION DATABASE SAFETY CHECK
  // =========================================================================
  console.log('\n--- 18. Final Production Database Verification ---');
  const finalProdDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const finalProdAudit = finalProdDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const finalProdRoles = finalProdDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const finalProdCats = finalProdDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodIntegrity = finalProdDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  const prodFk = finalProdDb.prepare('PRAGMA foreign_key_check').all();
  finalProdDb.close();

  console.log(`[Production DB Post-Check] audit_logs: ${finalProdAudit.c}, roles: ${finalProdRoles.c}, categories: ${finalProdCats.c}`);
  assert.equal(finalProdAudit.c, 426, 'Production audit logs MUST BE EXACTLY 426!');
  assert.equal(finalProdRoles.c, 23, 'Production roles MUST BE EXACTLY 23!');
  assert.equal(finalProdCats.c, 4, 'Production categories MUST BE EXACTLY 4!');
  assert.equal(prodIntegrity.integrity_check, 'ok', 'Production integrity must be OK');
  assert.equal(prodFk.length, 0, 'Production foreign key check must be clean');
  console.log('✓ PRODUCTION DATABASE IS 100% UNTOUCHED, PRISTINE, AND HEALTHY!');

  console.log('\n===============================================================');
  console.log('ALL STEP 2 QA TEST VERIFICATIONS PASSED (18/18)!');
  console.log('===============================================================\n');
}

runStep2QA().catch((err) => {
  console.error('\n❌ STEP 2 QA FAILED:', err);
  process.exit(1);
});
