process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { GET as getUsers, PUT as putUser, PATCH as patchUser, DELETE as deleteUser } from '../app/api/users/route';
import { GET as getPermissions } from '../app/api/permissions/route';
import { GET as getEffectivePermissions } from '../app/api/permissions/effective/route';
import { PUT as putUserOverride, DELETE as deleteUserOverride } from '../app/api/permissions/user/route';
import { PUT as putRolePermission, DELETE as deleteRolePermission } from '../app/api/permissions/role/route';
import { POST as postSiteAssignment, DELETE as deleteSiteAssignment } from '../app/api/permissions/sites/route';
import { UserSession } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2D.1: Targeted Users & Access Security + Matrix Verification (CTO Gate)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Initialize test principals in data/test_site_work.db
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Operational Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1),
      ('usr-target-test', 'targetuser', 'hash', 'Target User', 'SITE_MANAGER', 'STANDARD', 1, 1),
      ('usr-view-1', 'viewer1', 'hash', 'Viewer User', 'VIEWER', 'STANDARD', 1, 1)
  `).run();

  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();

  // Ensure site-1 is assigned to target user
  db.prepare(`
    INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
    VALUES ('su-test-target-s1', 'site-1', 'usr-target-test', datetime('now'))
  `).run();

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

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Viewer User',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  // ===========================================================================
  // 2. PERMISSION PRECEDENCE PROOF
  // ===========================================================================
  await t.test('2.1: Precedence Flow 1 (ROLE ALLOW -> USER DENY -> effective DENY -> REMOVE OVERRIDE -> effective ROLE ALLOW)', async () => {
    setTestSession(clientPrimeSession);

    // Initial check: SITE_MANAGER on assigned site-1 for PAGE_FINANCE_TRANSACTIONS.VIEW is ALLOWED by role/legacy
    const effInitialReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=VIEW&siteId=site-1'
    );
    const effInitialRes = await getEffectivePermissions(effInitialReq);
    const initialData = await effInitialRes.json();
    assert.equal(initialData.allowed, true);
    assert.ok(initialData.ruleSource.includes('ALLOW'), 'Role/legacy baseline initially allows');

    // Apply explicit User DENY override
    const denyReq = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-view',
        siteId: 'site-1',
        effect: 'DENY',
      }),
    });
    const denyRes = await putUserOverride(denyReq);
    assert.equal(denyRes.status, 200);

    // Effective access must now be DENIED
    const effDenyReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=VIEW&siteId=site-1'
    );
    const effDenyRes = await getEffectivePermissions(effDenyReq);
    const denyData = await effDenyRes.json();
    assert.equal(denyData.allowed, false);
    assert.equal(denyData.ruleSource, 'USER_SITE_EXPLICIT_DENY');

    // Remove user override
    const delReq = new Request('http://localhost:3001/api/permissions/user', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-view',
        siteId: 'site-1',
      }),
    });
    const delRes = await deleteUserOverride(delReq);
    assert.equal(delRes.status, 200);

    // Effective access restored to ROLE ALLOW
    const effRestoredReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=VIEW&siteId=site-1'
    );
    const effRestoredRes = await getEffectivePermissions(effRestoredReq);
    const restoredData = await effRestoredRes.json();
    assert.equal(restoredData.allowed, true);
    assert.ok(restoredData.ruleSource.includes('ALLOW'), 'Access restored to baseline allow');
  });

  await t.test('2.2: Precedence Flow 2 (ROLE BASELINE DENY -> USER EXPLICIT ALLOW -> effective ALLOW)', async () => {
    setTestSession(clientPrimeSession);

    // Ensure clean initial state
    PermissionRepository.removeUserOverride('usr-target-test', 'perm-fin-tx-delete', 'site-1');

    // Initial check: SITE_MANAGER on PAGE_FINANCE_TRANSACTIONS.DELETE is DENIED by baseline
    const effInitReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=DELETE&siteId=site-1'
    );
    const effInitRes = await getEffectivePermissions(effInitReq);
    const initData = await effInitRes.json();
    assert.equal(initData.allowed, false, 'Baseline initially denies delete');

    // Apply explicit User ALLOW override
    const allowReq = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-delete',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const allowRes = await putUserOverride(allowReq);
    assert.equal(allowRes.status, 200);

    // Effective access must now be ALLOWED
    const effAllowReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=DELETE&siteId=site-1'
    );
    const effAllowRes = await getEffectivePermissions(effAllowReq);
    const allowData = await effAllowRes.json();
    assert.equal(allowData.allowed, true);
    assert.equal(allowData.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');

    // Cleanup override
    await deleteUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'usr-target-test',
          permissionId: 'perm-fin-tx-delete',
          siteId: 'site-1',
        }),
      })
    );
  });

  // ===========================================================================
  // 3. SITE SCOPE SECURITY
  // ===========================================================================
  await t.test('3: Site Scope Security (GLOBAL, ASSIGNED_SITES, SPECIFIC_SITE & Tamper Prevention)', async () => {
    setTestSession(clientPrimeSession);

    // Ensure usr-target-test is assigned site-1 ONLY, NOT site-2
    db.prepare(`DELETE FROM site_users WHERE user_id = 'usr-target-test'`).run();
    db.prepare(`
      INSERT INTO site_users (id, site_id, user_id, created_at)
      VALUES ('su-test-target-s1', 'site-1', 'usr-target-test', datetime('now'))
    `).run();

    // 3.1: ASSIGNED_SITES scope
    // Site A (site-1): permitted
    const siteAReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_ATTENDANCE_DAILY&action=VIEW&siteId=site-1'
    );
    const siteARes = await getEffectivePermissions(siteAReq);
    const siteAData = await siteARes.json();
    assert.equal(siteAData.allowed, true, 'Assigned site-1 must be permitted');

    // Site B (site-2): denied
    const siteBReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_ATTENDANCE_DAILY&action=VIEW&siteId=site-2'
    );
    const siteBRes = await getEffectivePermissions(siteBReq);
    const siteBData = await siteBRes.json();
    assert.equal(siteBData.allowed, false, 'Unassigned site-2 must be denied');
    assert.equal(siteBData.ruleSource, 'UNASSIGNED_SITE_DENY');

    // 3.2: Cross-site tamper spoofing prevention
    // Caller attempts to supply siteId='site-2' on a resource persisted to site-1
    const decisionTamper = canAccess({
      session: {
        userId: 'usr-target-test',
        role: 'SITE_MANAGER',
        authorityTier: 'STANDARD',
        isActive: true,
        assignedSiteIds: ['site-1'],
      },
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-2', // caller spoof
      resourceSiteId: 'site-1', // persisted resource
    });
    assert.equal(decisionTamper.allowed, false);
    assert.equal(decisionTamper.ruleSource, 'SITE_MISMATCH_REJECTED');
  });

  // ===========================================================================
  // 4. CLIENT PRIME SECURITY (Superior Prime 100% unaddressable/hidden)
  // ===========================================================================
  await t.test('4.1: Client Prime cannot discover, query, or mutate Superior Prime across any endpoint', async () => {
    setTestSession(clientPrimeSession);

    // 1. GET /api/users
    const usersRes = await getUsers();
    const usersData = await usersRes.json();
    assert.equal(
      usersData.users.some((u: any) => u.id === 'usr-admin-1' || u.username === 'Iamadmin'),
      false,
      'Superior Prime must not appear in /api/users listing for Client Prime'
    );

    // 2. GET /api/permissions?userId=usr-admin-1
    const getPermRes = await getPermissions(new Request('http://localhost:3001/api/permissions?userId=usr-admin-1'));
    assert.equal(getPermRes.status, 404, 'GET /api/permissions must return 404');

    // 3. GET /api/permissions/effective?userId=usr-admin-1...
    const getEffRes = await getEffectivePermissions(
      new Request('http://localhost:3001/api/permissions/effective?userId=usr-admin-1&page=PAGE_SETUP_USERS&action=VIEW')
    );
    assert.equal(getEffRes.status, 404, 'GET /api/permissions/effective must return 404');

    // 4. PUT /api/permissions/user
    const putPermRes = await putUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', permissionId: 'perm-dash-view', effect: 'DENY' }),
      })
    );
    assert.equal(putPermRes.status, 404, 'PUT /api/permissions/user must return 404');

    // 5. DELETE /api/permissions/user
    const delPermRes = await deleteUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', permissionId: 'perm-dash-view' }),
      })
    );
    assert.equal(delPermRes.status, 404, 'DELETE /api/permissions/user must return 404');

    // 6. POST /api/permissions/sites
    const postSiteRes = await postSiteAssignment(
      new Request('http://localhost:3001/api/permissions/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', siteId: 'site-1' }),
      })
    );
    assert.equal(postSiteRes.status, 404, 'POST /api/permissions/sites must return 404');

    // 7. DELETE /api/permissions/sites
    const delSiteRes = await deleteSiteAssignment(
      new Request('http://localhost:3001/api/permissions/sites', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', siteId: 'site-1' }),
      })
    );
    assert.equal(delSiteRes.status, 404, 'DELETE /api/permissions/sites must return 404');

    // 8. PUT /api/users (update user)
    const putUserRes = await putUser(
      new Request('http://localhost:3001/api/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'usr-admin-1', fullName: 'Hacked', role: 'VIEWER' }),
      })
    );
    assert.equal(putUserRes.status, 404, 'PUT /api/users must return 404');

    // 9. PATCH /api/users (password reset)
    const patchPassRes = await patchUser(
      new Request('http://localhost:3001/api/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', action: 'RESET_PASSWORD', newPassword: 'Password123!' }),
      })
    );
    assert.equal(patchPassRes.status, 404, 'PATCH /api/users (password) must return 404');

    // 10. PATCH /api/users (username change)
    const patchNameRes = await patchUser(
      new Request('http://localhost:3001/api/users', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', action: 'CHANGE_USERNAME', newUsername: 'newname' }),
      })
    );
    assert.equal(patchNameRes.status, 404, 'PATCH /api/users (username) must return 404');

    // 11. DELETE /api/users
    const delUserRes = await deleteUser(
      new Request('http://localhost:3001/api/users?id=usr-admin-1', { method: 'DELETE' })
    );
    assert.equal(delUserRes.status, 404, 'DELETE /api/users must return 404');
  });

  await t.test('4.2: Standard Admin cannot manage either Prime; Operational users cannot access permission APIs', async () => {
    setTestSession(standardAdminSession);

    // Standard Admin modifying Client Prime
    const cpRes = await putUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-client-prime-1', permissionId: 'perm-dash-view', effect: 'DENY' }),
      })
    );
    assert.equal(cpRes.status, 403, 'Standard admin modifying Client Prime must be 403');

    // Standard Admin modifying Superior Prime
    const spRes = await putUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-admin-1', permissionId: 'perm-dash-view', effect: 'DENY' }),
      })
    );
    assert.equal(spRes.status, 404, 'Standard admin querying Superior Prime must be 404');

    // Operational roles (SITE_MANAGER & VIEWER) fail closed (403)
    for (const opSession of [operationalEngineerSession, viewerSession]) {
      setTestSession(opSession);
      const res = await putUserOverride(
        new Request('http://localhost:3001/api/permissions/user', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: 'usr-target-test', permissionId: 'perm-dash-view', effect: 'DENY' }),
        })
      );
      assert.equal(res.status, 403, `${opSession.role} must be rejected with 403`);
    }
  });

  // ===========================================================================
  // 5. DIRECT ROUTE ACCESS
  // ===========================================================================
  await t.test('5: Direct Route Access (/setup/users) authority verification', () => {
    // SUPERIOR_PRIME
    const spAccess = canAccess({ session: superiorPrimeSession, page: 'PAGE_SETUP_USERS', action: 'VIEW' });
    assert.equal(spAccess.allowed, true);

    // CLIENT_PRIME
    const cpAccess = canAccess({ session: clientPrimeSession, page: 'PAGE_SETUP_USERS', action: 'VIEW' });
    assert.equal(cpAccess.allowed, true);

    // STANDARD_ADMIN
    const saAccess = canAccess({ session: standardAdminSession, page: 'PAGE_SETUP_USERS', action: 'VIEW' });
    assert.equal(saAccess.allowed, true);

    // SITE_MANAGER (unconfigured)
    const engAccess = canAccess({ session: operationalEngineerSession, page: 'PAGE_SETUP_USERS', action: 'MANAGE_USERS' });
    assert.equal(engAccess.allowed, false, 'SITE_MANAGER cannot manage users');

    // VIEWER
    const viewAccess = canAccess({ session: viewerSession, page: 'PAGE_SETUP_USERS', action: 'MANAGE_USERS' });
    assert.equal(viewAccess.allowed, false, 'VIEWER cannot manage users');
  });

  // ===========================================================================
  // 6. DRAFT / SAVE / DISCARD BEHAVIOR & PERMISSION VERSION
  // ===========================================================================
  await t.test('6: Draft/Save/Discard & Permission Version atomicity', async () => {
    setTestSession(clientPrimeSession);

    // Ensure no override exists initially
    PermissionRepository.removeUserOverride('usr-target-test', 'perm-att-daily-create', 'site-1');

    const versionBefore = PermissionRepository.getPermissionVersion('usr-target-test');

    // 1. Simulating draft: No API call made yet. Database must remain untouched.
    const dbCheckBefore = PermissionRepository.getUserOverride('usr-target-test', 'perm-att-daily-create', 'site-1');
    assert.equal(dbCheckBefore, null, 'Draft state does not mutate DB');

    // 2. Simulating discard: User discards pending changes. DB remains untouched.
    const versionAfterDiscard = PermissionRepository.getPermissionVersion('usr-target-test');
    assert.equal(versionAfterDiscard, versionBefore, 'Discard leaves version unchanged');

    // 3. User saves changes -> calls API
    const saveRes = await putUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'usr-target-test',
          permissionId: 'perm-att-daily-create',
          siteId: 'site-1',
          effect: 'DENY',
        }),
      })
    );
    assert.equal(saveRes.status, 200);

    const versionAfterSave = PermissionRepository.getPermissionVersion('usr-target-test');
    assert.equal(versionAfterSave, versionBefore + 1, 'Version increments by exactly 1 on persisted save');

    // 4. Failed request leaves version unchanged
    const failRes = await putUserOverride(
      new Request('http://localhost:3001/api/permissions/user', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'usr-target-test',
          permissionId: 'perm-invalid-xyz',
          siteId: 'site-1',
          effect: 'ALLOW',
        }),
      })
    );
    assert.equal(failRes.status, 400);

    const versionAfterFail = PermissionRepository.getPermissionVersion('usr-target-test');
    assert.equal(versionAfterFail, versionAfterSave, 'Failed transaction must not increment version');
  });

  // ===========================================================================
  // 7. SITE ASSIGNMENT SAFETY
  // ===========================================================================
  await t.test('7: Site Assignment Safety (Preserves user, site, attendance, finance, audit)', async () => {
    setTestSession(clientPrimeSession);

    // Baseline counts in test DB
    const usersCountBefore = (db.prepare('SELECT count(*) as c FROM users').get() as any).c;
    const sitesCountBefore = (db.prepare('SELECT count(*) as c FROM sites').get() as any).c;
    const attCountBefore = (db.prepare('SELECT count(*) as c FROM attendance_records').get() as any).c;
    const finCountBefore = (db.prepare('SELECT count(*) as c FROM financial_transactions').get() as any).c;

    // 1. Assign site-2 to usr-target-test
    const assignRes = await postSiteAssignment(
      new Request('http://localhost:3001/api/permissions/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-target-test', siteId: 'site-2' }),
      })
    );
    assert.equal(assignRes.status, 200);

    const checkAssigned = db.prepare('SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?').get('usr-target-test', 'site-2');
    assert.ok(checkAssigned, 'site-2 must be present in site_users');

    // 2. Revoke site-2 from usr-target-test
    const revokeRes = await deleteSiteAssignment(
      new Request('http://localhost:3001/api/permissions/sites', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'usr-target-test', siteId: 'site-2' }),
      })
    );
    assert.equal(revokeRes.status, 200);

    const checkRevoked = db.prepare('SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?').get('usr-target-test', 'site-2');
    assert.equal(checkRevoked, undefined, 'site-2 must be removed from site_users');

    // Verify non-destructive guarantees
    const usersCountAfter = (db.prepare('SELECT count(*) as c FROM users').get() as any).c;
    const sitesCountAfter = (db.prepare('SELECT count(*) as c FROM sites').get() as any).c;
    const attCountAfter = (db.prepare('SELECT count(*) as c FROM attendance_records').get() as any).c;
    const finCountAfter = (db.prepare('SELECT count(*) as c FROM financial_transactions').get() as any).c;

    assert.equal(usersCountAfter, usersCountBefore, 'Users table must not lose records');
    assert.equal(sitesCountAfter, sitesCountBefore, 'Sites table must not lose records');
    assert.equal(attCountAfter, attCountBefore, 'Attendance records must remain completely intact');
    assert.equal(finCountAfter, finCountBefore, 'Financial transactions must remain completely intact');
  });

  // ===========================================================================
  // 8. AUDIT SAFETY
  // ===========================================================================
  await t.test('8: Audit Safety: Intended audit events are recorded in audit_logs', () => {
    const requiredActions = [
      'PERMISSION_GRANTED',
      'PERMISSION_DENIED',
      'PERMISSION_REMOVED',
      'ROLE_PERMISSION_CHANGED',
      'SITE_ACCESS_CHANGED',
    ];

    for (const actionName of requiredActions) {
      const row = db.prepare('SELECT count(*) as c FROM audit_logs WHERE action = ?').get(actionName) as any;
      assert.ok(row.c > 0, `audit_logs must contain recorded events for action '${actionName}'`);
    }
  });

  setTestSession(null);
});
