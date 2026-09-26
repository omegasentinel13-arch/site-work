process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { GET as getPermissions } from '../app/api/permissions/route';
import { GET as getEffectivePermissions } from '../app/api/permissions/effective/route';
import { PUT as putUserOverride, DELETE as deleteUserOverride } from '../app/api/permissions/user/route';
import { PUT as putRolePermission, DELETE as deleteRolePermission } from '../app/api/permissions/role/route';
import { GET as getSites, POST as postSiteAssignment, DELETE as deleteSiteAssignment } from '../app/api/permissions/sites/route';
import { UserSession } from '../lib/auth/session';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2C: Permission Management API (15 Mandated API Tests)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Ensure test users exist in data/test_site_work.db
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Operational Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1),
      ('usr-target-test', 'targetuser', 'hash', 'Target User', 'SITE_MANAGER', 'STANDARD', 1, 1)
  `).run();

  // Explicitly ensure usr-admin-1 is SUPERIOR_PRIME
  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();

  // Test principals
  const superiorPrimeSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Superior Prime',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const clientPrimeSession: UserSession = {
    userId: 'usr-client-prime-1',
    username: 'clientprime',
    fullName: 'Client Prime',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const standardAdminSession: UserSession = {
    userId: 'usr-std-admin-1',
    username: 'stdadmin',
    fullName: 'Standard Admin',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const operationalEngineerSession: UserSession = {
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Operational Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 1,
  };

  // ---------------------------------------------------------------------------
  // 1. Prime can inspect permissions (GET /api/permissions)
  // ---------------------------------------------------------------------------
  await t.test('1. Prime can inspect permissions', async () => {
    setTestSession(superiorPrimeSession);
    const req = new Request('http://localhost:3001/api/permissions');
    const res = await getPermissions(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.definitions), 'definitions must be an array');
    assert.ok(data.definitions.length > 0, 'definitions must not be empty');
    assert.ok(Array.isArray(data.roleBaselines), 'roleBaselines must be an array');
  });

  // ---------------------------------------------------------------------------
  // 2. Client Prime can manage lower user
  // ---------------------------------------------------------------------------
  await t.test('2. Client Prime can manage lower user', async () => {
    setTestSession(clientPrimeSession);
    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-create',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.id);
  });

  // ---------------------------------------------------------------------------
  // 3. Client Prime cannot access Superior Prime
  // ---------------------------------------------------------------------------
  await t.test('3. Client Prime cannot access Superior Prime', async () => {
    setTestSession(clientPrimeSession);

    // Attempt to inspect Superior Prime's permissions
    const getReq = new Request('http://localhost:3001/api/permissions?userId=usr-admin-1');
    const getRes = await getPermissions(getReq);
    assert.equal(getRes.status, 404, 'Superior Prime must be 404 invisible to Client Prime');

    // Attempt to inspect Superior Prime effective permission
    const effReq = new Request('http://localhost:3001/api/permissions/effective?userId=usr-admin-1&page=PAGE_SETUP_USERS&action=VIEW');
    const effRes = await getEffectivePermissions(effReq);
    assert.equal(effRes.status, 404, 'Superior Prime effective check must be 404');

    // Attempt to modify Superior Prime
    const putReq = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-admin-1',
        permissionId: 'perm-dash-view',
        effect: 'DENY',
      }),
    });
    const putRes = await putUserOverride(putReq);
    assert.equal(putRes.status, 404, 'Modifying Superior Prime must return 404');
  });

  // ---------------------------------------------------------------------------
  // 4. Standard Admin cannot manage Prime
  // ---------------------------------------------------------------------------
  await t.test('4. Standard Admin cannot manage Prime', async () => {
    setTestSession(standardAdminSession);

    // Attempt to modify Client Prime
    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-client-prime-1',
        permissionId: 'perm-dash-view',
        effect: 'DENY',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 403, 'Standard Admin modifying Client Prime must be 403 Forbidden');
  });

  // ---------------------------------------------------------------------------
  // 5. Standard user cannot manage permissions
  // ---------------------------------------------------------------------------
  await t.test('5. Standard user cannot manage permissions', async () => {
    setTestSession(operationalEngineerSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-create',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 403, 'Engineer modifying permissions must be 403 Forbidden');
  });

  // ---------------------------------------------------------------------------
  // 6. Unknown permission denied
  // ---------------------------------------------------------------------------
  await t.test('6. Unknown permission denied', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-nonexistent-xyz',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 400, 'Unknown permissionId must be 400 Bad Request');
  });

  // ---------------------------------------------------------------------------
  // 7. Unknown user denied
  // ---------------------------------------------------------------------------
  await t.test('7. Unknown user denied', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-fake-ghost-id',
        permissionId: 'perm-dash-view',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 404, 'Unknown userId must be 404 Not Found');
  });

  // ---------------------------------------------------------------------------
  // 8. Unknown site denied
  // ---------------------------------------------------------------------------
  await t.test('8. Unknown site denied', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-create',
        siteId: 'site-unknown-999',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 404, 'Unknown siteId must be 404 Not Found');
  });

  // ---------------------------------------------------------------------------
  // 9. Invalid scope denied
  // ---------------------------------------------------------------------------
  await t.test('9. Invalid scope denied', async () => {
    setTestSession(clientPrimeSession);

    // Global permission (perm-dash-view) supplied with siteId
    const userReq = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-dash-view',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const userRes = await putUserOverride(userReq);
    assert.equal(userRes.status, 400, 'Global permission with siteId must fail 400');

    // Role baseline with invalid scopeType
    const roleReq = new Request('http://localhost:3001/api/permissions/role', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'SITE_MANAGER',
        permissionId: 'perm-att-daily-create',
        scopeType: 'INVALID_SCOPE_NAME',
      }),
    });
    const roleRes = await putRolePermission(roleReq);
    assert.equal(roleRes.status, 400, 'Invalid scopeType must fail 400');
  });

  // ---------------------------------------------------------------------------
  // 10. User ALLOW creation
  // ---------------------------------------------------------------------------
  await t.test('10. User ALLOW creation', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-delete',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 200);

    // Check effective evaluation
    const effReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=DELETE&siteId=site-1'
    );
    const effRes = await getEffectivePermissions(effReq);
    assert.equal(effRes.status, 200);
    const effData = await effRes.json();
    assert.equal(effData.allowed, true);
    assert.equal(effData.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');
  });

  // ---------------------------------------------------------------------------
  // 11. User DENY creation
  // ---------------------------------------------------------------------------
  await t.test('11. User DENY creation', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-create',
        siteId: 'site-1',
        effect: 'DENY',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 200);

    // Check effective evaluation
    const effReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=CREATE&siteId=site-1'
    );
    const effRes = await getEffectivePermissions(effReq);
    assert.equal(effRes.status, 200);
    const effData = await effRes.json();
    assert.equal(effData.allowed, false);
    assert.equal(effData.ruleSource, 'USER_SITE_EXPLICIT_DENY');
  });

  // ---------------------------------------------------------------------------
  // 12. Override removal
  // ---------------------------------------------------------------------------
  await t.test('12. Override removal', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-create',
        siteId: 'site-1',
      }),
    });
    const res = await deleteUserOverride(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.removed, true);

    // Override is gone, effective permission returns to role/legacy allow
    const effReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=CREATE&siteId=site-1'
    );
    const effRes = await getEffectivePermissions(effReq);
    const effData = await effRes.json();
    assert.equal(effData.allowed, true);
  });

  // ---------------------------------------------------------------------------
  // 13. Role permission update
  // ---------------------------------------------------------------------------
  await t.test('13. Role permission update', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/role', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'SITE_MANAGER',
        permissionId: 'perm-rep-site-view',
        scopeType: 'ASSIGNED_SITES',
      }),
    });
    const res = await putRolePermission(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.id);
  });

  // ---------------------------------------------------------------------------
  // 14. Site assignment uses site_users
  // ---------------------------------------------------------------------------
  await t.test('14. Site assignment uses site_users', async () => {
    setTestSession(clientPrimeSession);

    // Remove site-2 first if present to start clean
    db.prepare(`DELETE FROM site_users WHERE user_id = ? AND site_id = ?`).run('usr-target-test', 'site-2');

    // Assign usr-target-test to site-2
    const assignReq = new Request('http://localhost:3001/api/permissions/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        siteId: 'site-2',
      }),
    });
    const assignRes = await postSiteAssignment(assignReq);
    assert.equal(assignRes.status, 200);

    // Verify record directly in SQLite site_users table
    const checkRow = db.prepare(`
      SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?
    `).get('usr-target-test', 'site-2');
    assert.ok(checkRow, 'site_users must contain the newly assigned site');

    // Remove site-2 assignment
    const removeReq = new Request('http://localhost:3001/api/permissions/sites', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        siteId: 'site-2',
      }),
    });
    const removeRes = await deleteSiteAssignment(removeReq);
    assert.equal(removeRes.status, 200);

    const afterRow = db.prepare(`
      SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?
    `).get('usr-target-test', 'site-2');
    assert.equal(afterRow, undefined, 'site_users must no longer have site-2');
  });

  // ---------------------------------------------------------------------------
  // 15. permission_version increments atomically
  // ---------------------------------------------------------------------------
  await t.test('15. permission_version increments atomically', async () => {
    setTestSession(clientPrimeSession);

    const initialVersion = PermissionRepository.getPermissionVersion('usr-target-test');

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-edit',
        siteId: 'site-1',
        effect: 'DENY',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 200);

    const afterVersion = PermissionRepository.getPermissionVersion('usr-target-test');
    assert.equal(afterVersion, initialVersion + 1, 'permission_version must increment by exactly 1');
  });

  // Cleanup test state
  setTestSession(null);
});
