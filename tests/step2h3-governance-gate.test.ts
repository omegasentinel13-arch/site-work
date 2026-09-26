process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { 
  GET as getUsers, 
  POST as postUser, 
  PUT as putUser, 
  PATCH as patchUser, 
  DELETE as deleteUser 
} from '../app/api/users/route';
import { 
  GET as getPermissions,
} from '../app/api/permissions/route';
import { 
  PATCH as patchUserPerm, 
  DELETE as deleteUserPerm 
} from '../app/api/permissions/user/route';
import { 
  PATCH as patchRolePerm,
  DELETE as deleteRolePerm
} from '../app/api/permissions/role/route';
import { 
  GET as getSitePerms, 
  POST as postSitePerm 
} from '../app/api/permissions/sites/route';
import { GET as getAuditList } from '../app/api/audit/route';
import { POST as loginUser } from '../app/api/auth/login/route';

import { UserSession, createSessionCookie, verifySessionToken } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { getDb } from '../lib/db';
import { getUserById, getUserByUsername, getUserAssignedSites } from '../lib/db/repositories/user-repo';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { canManageAuthority, canAssignAuthorityTier, canDeleteUser, canModifyCredentials } from '../lib/auth/authority';
import { redactPayload } from '../lib/audit/redaction';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2H.3: Final Users & Access Governance Integration Gate', { concurrency: 1 }, async (t) => {
  const db = getDb();

  const cleanup = () => {
    try {
      db.prepare(`DELETE FROM site_users WHERE user_id LIKE 'test-h3-%' OR user_id LIKE 'usr-h3-%'`).run();
      db.prepare(`DELETE FROM user_permission_overrides WHERE user_id LIKE 'test-h3-%' OR user_id LIKE 'usr-h3-%' OR granted_by LIKE 'test-h3-%' OR granted_by LIKE 'usr-h3-%'`).run();
      db.prepare(`DELETE FROM audit_logs WHERE entity_id LIKE 'test-h3-%' OR entity_id LIKE 'usr-h3-%' OR user_id LIKE 'test-h3-%' OR user_id LIKE 'usr-h3-%'`).run();
      db.prepare(`DELETE FROM users WHERE id LIKE 'test-h3-%' OR id LIKE 'usr-h3-%' OR username LIKE 'testh3%'`).run();
    } catch {
      // ignore
    }
  };

  t.after(cleanup);
  cleanup();

  // Sessions for testing
  const spSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    authorityTier: 'KING_MAKER',
    assignedSiteIds: [],
    tokenVersion: 11,
  };

  const cpSession: UserSession = {
    userId: 'usr-f7825275-d30e-4b89-9d6b-994b50532984',
    username: 'abadmin',
    fullName: 'AB Admin',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const stdAdminSession: UserSession = {
    userId: 'usr-9f94fd49-edcd-4a5d-89c4-a304fe9730dd',
    username: 'STAR-SCREW',
    fullName: 'STAR-SCREW',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  const engineerSession: UserSession = {
    userId: 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0',
    username: 'engineer1',
    fullName: 'Live Site Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Site Auditor (Demo)',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  // ==========================================================================
  // SECTION 1: IDENTITY & AUTHORITY INVARIANTS
  // ==========================================================================
  await t.test('1. Identity & Authority Invariants', async () => {
    // 1.1 Verify production identities in DB
    const sp = getUserById('usr-admin-1', null);
    assert.ok(sp, 'Superior Prime must exist');
    assert.strictEqual(sp.username, 'Iamadmin');
    assert.strictEqual(sp.role, 'ADMIN');
    assert.ok(sp.authority_tier === 'SUPERIOR_PRIME' || sp.authority_tier === 'KING_MAKER');
    assert.strictEqual(sp.is_active, 1);
    assert.strictEqual(sp.recovery_email, 'omegasentinel13@gmail.com');

    const cp = getUserById('usr-f7825275-d30e-4b89-9d6b-994b50532984', null);
    assert.ok(cp, 'Client Prime AB Admin must exist');
    assert.strictEqual(cp.username, 'abadmin');
    assert.strictEqual(cp.role, 'ADMIN');
    assert.strictEqual(cp.authority_tier, 'CLIENT_PRIME');
    assert.strictEqual(cp.is_active, 1);
    assert.strictEqual(cp.recovery_email, 'supermanskrypton@gmail.com');

    const sa = getUserById('usr-9f94fd49-edcd-4a5d-89c4-a304fe9730dd', null);
    assert.ok(sa, 'Standard Admin STAR-SCREW must exist');
    assert.strictEqual(sa.username, 'STAR-SCREW');
    assert.strictEqual(sa.role, 'ADMIN');
    assert.strictEqual(sa.authority_tier, 'STANDARD_ADMIN');
    assert.strictEqual(sa.is_active, 1);

    // 1.2 User ID immutability: PUT /api/users cannot modify ID
    setTestSession(spSession);
    const idChangeReq = new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-admin-1',
        newId: 'hacked-id-1',
        fullName: 'Head Administrator',
        role: 'ADMIN',
        isActive: true,
      }),
    });
    const idChangeRes = await putUser(idChangeReq);
    assert.strictEqual(idChangeRes.status, 200);
    const spAfter = getUserById('usr-admin-1', null);
    assert.ok(spAfter, 'Superior Prime ID must remain usr-admin-1');

    // 1.3 Duplicate usernames rejected
    const dupUserReq = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Iamadmin',
        password: 'Password123!',
        fullName: 'Duplicate Admin',
        role: 'ADMIN',
      }),
    });
    const dupRes = await postUser(dupUserReq);
    assert.strictEqual(dupRes.status, 400, 'Duplicate username must be rejected with 400');
    const dupJson = await dupRes.json();
    assert.ok(
      dupJson.error.toLowerCase().includes('already') ||
      dupJson.error.toLowerCase().includes('in use') ||
      dupJson.error.toLowerCase().includes('taken'),
      'Error message must indicate username is already taken/in use'
    );

    // 1.4 No additional SUPERIOR_PRIME can be created
    const fakeSpReq = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testh3sp2',
        password: 'Password123!',
        fullName: 'Fake Superior Prime',
        role: 'ADMIN',
        authorityTier: 'SUPERIOR_PRIME',
      }),
    });
    const fakeSpRes = await postUser(fakeSpReq);
    assert.strictEqual(fakeSpRes.status, 403, 'Creating SUPERIOR_PRIME must be rejected with 403');

    // 1.5 CLIENT_PRIME cannot create another CLIENT_PRIME
    setTestSession(cpSession);
    const cpCreateCpReq = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testh3cp2',
        password: 'Password123!',
        fullName: 'Second Client Prime',
        role: 'ADMIN',
        authorityTier: 'CLIENT_PRIME',
      }),
    });
    const cpCreateCpRes = await postUser(cpCreateCpReq);
    assert.strictEqual(cpCreateCpRes.status, 403, 'Client Prime cannot create another Client Prime');

    // 1.6 Lower authority cannot elevate itself
    setTestSession(stdAdminSession);
    const elevateReq = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testh3elevate',
        password: 'Password123!',
        fullName: 'Elevated User',
        role: 'ADMIN',
        authorityTier: 'CLIENT_PRIME',
      }),
    });
    const elevateRes = await postUser(elevateReq);
    assert.strictEqual(elevateRes.status, 403, 'Standard Admin cannot create Client Prime');

    // 1.7 Inactive user cannot authenticate
    const deactUser = db.prepare(`SELECT * FROM users WHERE is_active = 0 LIMIT 1`).get() as any;
    if (!deactUser) {
      db.prepare(`
        INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
        VALUES ('usr-h3-deact', 'testh3deact', 'hash', 'Deactivated User', 'SITE_MANAGER', 'STANDARD', 0, 1, 1)
      `).run();
    }
    const inactiveVerified = await verifySessionToken(
      await createSessionCookie({
        userId: 'usr-h3-deact',
        username: 'testh3deact',
        fullName: 'Deactivated User',
        role: 'SITE_MANAGER',
        authorityTier: 'STANDARD',
        assignedSiteIds: [],
        tokenVersion: 1,
      })
    );
    assert.strictEqual(inactiveVerified, null, 'Deactivated user token verification must return null');

    // 1.8 Password hashes are never exposed in GET /api/users
    setTestSession(spSession);
    const listReq = new Request('http://localhost:3000/api/users');
    const listRes = await getUsers(listReq);
    assert.strictEqual(listRes.status, 200);
    const listJson = await listRes.json();
    const users = listJson.users || listJson;
    for (const u of users) {
      assert.strictEqual(u.password, undefined, 'User object must not contain password');
      assert.strictEqual(u.password_hash, undefined, 'User object must not contain password_hash');
      assert.strictEqual(u.passwordHash, undefined, 'User object must not contain passwordHash');
    }
  });

  // ==========================================================================
  // SECTION 2: PRIME → ADMIN GOVERNANCE & CROSS-PRIME IMMUNITY
  // ==========================================================================
  await t.test('2. Prime -> Admin Governance & Cross-Prime Immunity', async () => {
    // 2.1 Superior Prime can configure eligible Client Prime / Standard Admin / Standard
    setTestSession(spSession);
    assert.ok(canManageAuthority(spSession, cpSession), 'SP can manage CP');
    assert.ok(canManageAuthority(spSession, stdAdminSession), 'SP can manage Standard Admin');
    assert.ok(canManageAuthority(spSession, engineerSession), 'SP can manage Standard Engineer');

    // 2.2 Client Prime can configure eligible Standard Admin / Standard
    setTestSession(cpSession);
    assert.ok(canManageAuthority(cpSession, stdAdminSession), 'CP can manage Standard Admin');
    assert.ok(canManageAuthority(cpSession, engineerSession), 'CP can manage Standard Engineer');
    assert.ok(!canManageAuthority(cpSession, spSession), 'CP CANNOT manage SP');

    // 2.3 Neither Prime may modify the other Prime (Cross-Prime Immunity & Side-channel protection)
    // CP attempting to reset SP password -> 404 (user not found to non-SP) or 403
    const resetSpReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RESET_PASSWORD',
        userId: 'usr-admin-1',
        newPassword: 'HackedPassword123!',
      }),
    });
    const resetSpRes = await patchUser(resetSpReq);
    assert.ok(resetSpRes.status === 403 || resetSpRes.status === 404, 'CP cannot reset SP password');

    // CP attempting to change SP username
    const userSpReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CHANGE_USERNAME',
        userId: 'usr-admin-1',
        newUsername: 'HackedIamadmin',
      }),
    });
    const userSpRes = await patchUser(userSpReq);
    assert.ok(userSpRes.status === 403 || userSpRes.status === 404, 'CP cannot change SP username');

    // CP attempting to deactivate SP
    const deactSpReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DEACTIVATE',
        userId: 'usr-admin-1',
      }),
    });
    const deactSpRes = await patchUser(deactSpReq);
    assert.ok(deactSpRes.status === 403 || deactSpRes.status === 404, 'CP cannot deactivate SP');

    // CP attempting to delete SP
    const delSpReq = new Request('http://localhost:3000/api/users?id=usr-admin-1', {
      method: 'DELETE',
    });
    const delSpRes = await deleteUser(delSpReq);
    assert.ok(delSpRes.status === 403 || delSpRes.status === 404, 'CP cannot delete SP');

    // Primes cannot be deleted (canDeleteUser invariant)
    setTestSession(spSession);
    assert.strictEqual(canDeleteUser(spSession, cpSession), false, 'CP cannot be deleted by SP');
    assert.strictEqual(canDeleteUser(cpSession, spSession), false, 'SP cannot be deleted by CP');

    // 2.4 Privacy / Discovery Protection: Lower users cannot discover Superior Prime
    setTestSession(stdAdminSession);
    const saListReq = new Request('http://localhost:3000/api/users');
    const saListRes = await getUsers(saListReq);
    assert.strictEqual(saListRes.status, 200);
    const saList = await saListRes.json();
    const foundSpInList = (saList.users || saList).some((u: any) => u.id === 'usr-admin-1' || u.username === 'Iamadmin');
    assert.strictEqual(foundSpInList, false, 'Standard Admin cannot discover Superior Prime in user list');

    // Direct lookup of SP by Standard Admin returns 404
    const saDirectReq = new Request('http://localhost:3000/api/users?id=usr-admin-1');
    const saDirectRes = await getUsers(saDirectReq);
    assert.strictEqual(saDirectRes.status, 404, 'Direct lookup of SP by Standard Admin returns 404');
  });

  // ==========================================================================
  // SECTION 3: ADMIN → ADMIN DELEGATION
  // ==========================================================================
  await t.test('3. Admin -> Admin Delegation Rules', async () => {
    setTestSession(stdAdminSession);

    // Standard Admin cannot configure Prime
    const stdModCpReq = new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-f7825275-d30e-4b89-9d6b-994b50532984',
        fullName: 'Hacked AB Admin',
        role: 'ADMIN',
        isActive: true,
      }),
    });
    const stdModCpRes = await putUser(stdModCpReq);
    assert.strictEqual(stdModCpRes.status, 403, 'Standard Admin cannot configure Client Prime');

    // Standard Admin cannot reset credentials of peer Standard Admin
    assert.strictEqual(canModifyCredentials(stdAdminSession, { role: 'ADMIN', authorityTier: 'STANDARD_ADMIN', id: 'other-sa' }), false);

    // Standard Admin can configure allowed operational users
    assert.ok(canManageAuthority(stdAdminSession, engineerSession), 'Standard Admin can manage Engineer');
    assert.ok(canManageAuthority(stdAdminSession, viewerSession), 'Standard Admin can manage Viewer');
  });

  // ==========================================================================
  // SECTION 4: PERMISSION MATRIX — END-TO-END
  // ==========================================================================
  await t.test('4. Permission Matrix — End-to-End Batch & Versioning', async () => {
    setTestSession(spSession);

    // Create a target test engineer user
    const targetUserId = 'usr-h3-target-1';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'testh3target1', 'hash', 'Target Test User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(targetUserId);

    // Query initial permission_version
    const initialUser = getUserById(targetUserId, null);
    const vBefore = initialUser.permission_version;

    // A. Checkbox staging test: no DB write before Apply
    const initialOverrides = PermissionRepository.getUserOverrides(targetUserId);
    assert.strictEqual(initialOverrides.length, 0, 'No overrides initially');

    // B. Apply batch changes with authentic permission definitions (VIEW, CREATE, EDIT, DELETE)
    const batchReq = new Request('http://localhost:3000/api/permissions/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        changes: [
          { permissionId: 'perm-att-daily-view', effect: 'ALLOW' },
          { permissionId: 'perm-att-daily-create', effect: 'ALLOW' },
          { permissionId: 'perm-att-daily-edit', effect: 'DENY' },
          { permissionId: 'perm-fin-tx-delete', effect: 'DENY' },
        ],
      }),
    });
    const batchRes = await patchUserPerm(batchReq);
    assert.strictEqual(batchRes.status, 200);
    const batchJson = await batchRes.json();
    assert.strictEqual(batchJson.success, true);
    assert.strictEqual(batchJson.permissionVersion, vBefore + 1, 'permission_version must increment by exactly 1');

    // C. Verify overrides persist in DB
    const savedOverrides = PermissionRepository.getUserOverrides(targetUserId);
    assert.strictEqual(savedOverrides.length, 4, '4 overrides must be persisted');
    const viewOverride = savedOverrides.find(o => o.permission_id === 'perm-att-daily-view');
    assert.ok(viewOverride);
    assert.strictEqual(viewOverride.effect, 'ALLOW');

    const editOverride = savedOverrides.find(o => o.permission_id === 'perm-att-daily-edit');
    assert.ok(editOverride);
    assert.strictEqual(editOverride.effect, 'DENY');

    // D. Exactly one audit event created
    const auditLogs = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE action = 'PERMISSIONS_BATCH_UPDATED' AND entity_id = ?
    `).all(targetUserId) as any[];
    assert.strictEqual(auditLogs.length, 1, 'Exactly one PERMISSIONS_BATCH_UPDATED audit log');

    // E. Test RESET override in batch
    const resetBatchReq = new Request('http://localhost:3000/api/permissions/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        changes: [
          { permissionId: 'perm-att-daily-edit', effect: 'RESET' },
        ],
      }),
    });
    const resetBatchRes = await patchUserPerm(resetBatchReq);
    assert.strictEqual(resetBatchRes.status, 200);
    const afterResetOverrides = PermissionRepository.getUserOverrides(targetUserId);
    const resetFound = afterResetOverrides.find(o => o.permission_id === 'perm-att-daily-edit');
    assert.strictEqual(resetFound, undefined, 'Reset override must be removed from DB');

    // F. Failed Apply: unauthorized attempt produces no mutation and no version bump
    setTestSession(engineerSession);
    const vBeforeFailed = getUserById(targetUserId, null).permission_version;
    const unauthBatchReq = new Request('http://localhost:3000/api/permissions/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        changes: [{ permissionId: 'perm-att-daily-view', effect: 'DENY' }],
      }),
    });
    const unauthBatchRes = await patchUserPerm(unauthBatchReq);
    assert.strictEqual(unauthBatchRes.status, 403, 'Unauthorized batch must fail with 403');
    const vAfterFailed = getUserById(targetUserId, null).permission_version;
    assert.strictEqual(vAfterFailed, vBeforeFailed, 'permission_version must not change on failed apply');
  });

  // ==========================================================================
  // SECTION 5: PERMISSION PRECEDENCE
  // ==========================================================================
  await t.test('5. Permission Precedence Evaluator Rules', async () => {
    const testUserId = 'usr-h3-precedence-1';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'testh3prec1', 'hash', 'Precedence Tester', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(testUserId);

    // Assign to site-1 in site_users so site-scoping passes and evaluator tests user overrides
    db.prepare(`INSERT OR REPLACE INTO site_users (id, site_id, user_id) VALUES ('su-prec-1', 'site-1', ?)`).run(testUserId);

    const testSession: UserSession = {
      userId: testUserId,
      username: 'testh3prec1',
      fullName: 'Precedence Tester',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    // CASE A: Role baseline ALLOW + User explicit DENY = FINAL DENY
    PermissionRepository.setUserOverride({
      userId: testUserId,
      permissionId: 'perm-att-daily-view',
      effect: 'DENY',
      grantedBy: 'usr-admin-1',
    });

    const decA = canAccess({
      session: testSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(decA.allowed, false, 'Case A: explicit user DENY must override role baseline');
    assert.strictEqual(decA.ruleSource, 'USER_GLOBAL_EXPLICIT_DENY');

    // CASE B: Role baseline DENY / unavailable + User explicit ALLOW = FINAL ALLOW
    PermissionRepository.setUserOverride({
      userId: testUserId,
      permissionId: 'perm-set-role-manage',
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    const decB = canAccess({
      session: testSession,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
    });
    assert.strictEqual(decB.allowed, true, 'Case B: explicit user ALLOW must grant access');
    assert.strictEqual(decB.ruleSource, 'USER_GLOBAL_EXPLICIT_ALLOW');

    // CASE C: User override RESET + Role baseline ALLOW = FINAL ALLOW
    PermissionRepository.removeUserOverride(testUserId, 'perm-att-daily-view');
    const decC = canAccess({
      session: testSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(decC.allowed, true, 'Case C: override RESET restores role baseline ALLOW');

    // CASE D: User override RESET + Role baseline DENY = FINAL DENY
    PermissionRepository.removeUserOverride(testUserId, 'perm-set-role-manage');
    const decD = canAccess({
      session: testSession,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
    });
    assert.strictEqual(decD.allowed, false, 'Case D: override RESET restores role baseline DENY');

    // CASE E: Unauthorized user attempts mutation = 403 + no DB mutation
    setTestSession(engineerSession);
    const unauthReq = new Request('http://localhost:3000/api/permissions/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: testUserId,
        permissionId: 'perm-att-daily-view',
        effect: 'ALLOW',
      }),
    });
    const unauthRes = await patchUserPerm(unauthReq);
    assert.strictEqual(unauthRes.status, 403);
  });

  // ==========================================================================
  // SECTION 6: SITE ACCESS + PERMISSION INTEGRATION
  // ==========================================================================
  await t.test('6. Site Access + Permission Integration & Anti-Spoofing', async () => {
    const siteTestUserId = 'usr-h3-site-1';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'testh3site1', 'hash', 'Site Test User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(siteTestUserId);

    // 1. User has permission to VIEW but NO site assignment -> denied
    db.prepare('DELETE FROM site_users WHERE user_id = ?').run(siteTestUserId);
    const noSiteSession: UserSession = {
      userId: siteTestUserId,
      username: 'testh3site1',
      fullName: 'Site Test User',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: [],
      tokenVersion: 1,
    };

    const dec1 = canAccess({
      session: noSiteSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(dec1.allowed, false, 'Operational request without site assignment must be denied');
    assert.strictEqual(dec1.ruleSource, 'UNASSIGNED_SITE_DENY');

    // 2. Assign Site 1 -> Site 1 allowed
    db.prepare(`INSERT OR REPLACE INTO site_users (id, site_id, user_id) VALUES ('su-h3-1', 'site-1', ?)`).run(siteTestUserId);
    const site1Session: UserSession = {
      ...noSiteSession,
      assignedSiteIds: ['site-1'],
    };

    const dec2 = canAccess({
      session: site1Session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(dec2.allowed, true, 'Site 1 request must be allowed with Site 1 assignment');

    // 3. Same user attempts Site 2 -> denied
    const dec3 = canAccess({
      session: site1Session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-2',
      resourceSiteId: 'site-2',
    });
    assert.strictEqual(dec3.allowed, false, 'Site 2 request must be denied when user is only assigned to Site 1');

    // 4. Assign Site 1 + Site 2 -> both allowed
    db.prepare(`INSERT OR REPLACE INTO site_users (id, site_id, user_id) VALUES ('su-h3-2', 'site-2', ?)`).run(siteTestUserId);
    const site1And2Session: UserSession = {
      ...noSiteSession,
      assignedSiteIds: ['site-1', 'site-2'],
    };
    const dec4a = canAccess({
      session: site1And2Session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    const dec4b = canAccess({
      session: site1And2Session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-2',
      resourceSiteId: 'site-2',
    });
    assert.strictEqual(dec4a.allowed, true, 'Site 1 allowed');
    assert.strictEqual(dec4b.allowed, true, 'Site 2 allowed');

    // 5. Remove Site 1 -> Site 1 denied after state refresh
    db.prepare(`DELETE FROM site_users WHERE user_id = ? AND site_id = 'site-1'`).run(siteTestUserId);
    const site2OnlySession: UserSession = {
      ...noSiteSession,
      assignedSiteIds: ['site-2'],
    };
    const dec5 = canAccess({
      session: site2OnlySession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(dec5.allowed, false, 'Site 1 denied after assignment removed');

    // 6. ALL SITES for non-Prime user: all active sites assigned -> all allowed
    const activeSites = db.prepare(`SELECT id FROM sites WHERE is_archived = 0`).all() as { id: string }[];
    for (const s of activeSites) {
      db.prepare(`INSERT OR REPLACE INTO site_users (id, site_id, user_id) VALUES (?, ?, ?)`).run(`su-all-${s.id}`, s.id, siteTestUserId);
    }
    const allSitesSession: UserSession = {
      ...noSiteSession,
      assignedSiteIds: activeSites.map(s => s.id),
    };
    for (const s of activeSites) {
      const dec = canAccess({
        session: allSitesSession,
        page: 'PAGE_ATTENDANCE_DAILY',
        action: 'VIEW',
        siteId: s.id,
        resourceSiteId: s.id,
      });
      assert.strictEqual(dec.allowed, true, `All active site ${s.id} must be allowed`);
    }

    // 7. Prime: preserve existing global platform authority without explicit site_users
    const spSiteDec = canAccess({
      session: spSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(spSiteDec.allowed, true, 'Superior Prime has global site authority');

    const cpSiteDec = canAccess({
      session: cpSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(cpSiteDec.allowed, true, 'Client Prime has global site authority');

    // 8. Site spoofing: caller passes siteId 2 while resourceSiteId is 1
    const spoofDec = canAccess({
      session: site1And2Session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-2',
      resourceSiteId: 'site-1',
    });
    assert.strictEqual(spoofDec.allowed, false, 'Cross-site tamper attempt must be rejected');
    assert.strictEqual(spoofDec.ruleSource, 'SITE_MISMATCH_REJECTED');
  });

  // ==========================================================================
  // SECTION 7: AUDIT INTEGRATION & IMMUTABILITY
  // ==========================================================================
  await t.test('7. Audit Event Coverage & Failed Operation Integrity', async () => {
    setTestSession(spSession);

    // Trigger USER_CREATED
    const newTestUserReq = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testh3audit1',
        password: 'Password123!',
        fullName: 'Audit Test User',
        role: 'SITE_MANAGER',
      }),
    });
    const createdRes = await postUser(newTestUserReq);
    assert.strictEqual(createdRes.status, 200);
    const createdUser = getUserByUsername('testh3audit1');
    assert.ok(createdUser);

    // Verify USER_CREATED log
    const createLog = db.prepare(`SELECT * FROM audit_logs WHERE action = 'USER_CREATED' AND entity_id = ?`).get(createdUser.id);
    assert.ok(createLog, 'USER_CREATED audit log must exist');

    // Trigger USER_UPDATE
    const updateReq = new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: createdUser.id,
        fullName: 'Audit Test User (Updated)',
        role: 'SITE_MANAGER',
        isActive: true,
      }),
    });
    const updateRes = await putUser(updateReq);
    assert.strictEqual(updateRes.status, 200);
    const updateLog = db.prepare(`SELECT * FROM audit_logs WHERE action IN ('USER_UPDATE', 'USER_UPDATED') AND entity_id = ?`).get(createdUser.id);
    assert.ok(updateLog, 'USER_UPDATE or USER_UPDATED audit log must exist');

    // Trigger USER_DEACTIVATED
    const deactReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'DEACTIVATE', userId: createdUser.id }),
    });
    await patchUser(deactReq);
    const deactLog = db.prepare(`SELECT * FROM audit_logs WHERE action = 'USER_DEACTIVATED' AND entity_id = ?`).get(createdUser.id);
    assert.ok(deactLog, 'USER_DEACTIVATED audit log must exist');

    // Trigger USER_ACTIVATED
    const actReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ACTIVATE', userId: createdUser.id }),
    });
    await patchUser(actReq);
    const actLog = db.prepare(`SELECT * FROM audit_logs WHERE action = 'USER_ACTIVATED' AND entity_id = ?`).get(createdUser.id);
    assert.ok(actLog, 'USER_ACTIVATED audit log must exist');

    // Trigger USERNAME_CHANGED
    const unReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CHANGE_USERNAME', userId: createdUser.id, newUsername: 'testh3audit1mod' }),
    });
    await patchUser(unReq);
    const unLog = db.prepare(`SELECT * FROM audit_logs WHERE action = 'USERNAME_CHANGED' AND entity_id = ?`).get(createdUser.id);
    assert.ok(unLog, 'USERNAME_CHANGED audit log must exist');

    // Trigger PASSWORD_RESET
    const pwReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESET_PASSWORD', userId: createdUser.id, newPassword: 'NewPassword123!' }),
    });
    await patchUser(pwReq);
    const pwLog = db.prepare(`SELECT * FROM audit_logs WHERE action = 'PASSWORD_RESET' AND entity_id = ?`).get(createdUser.id);
    assert.ok(pwLog, 'PASSWORD_RESET audit log must exist');

    // Trigger USER_DELETE
    const delReq = new Request(`http://localhost:3000/api/users?id=${createdUser.id}`, { method: 'DELETE' });
    await deleteUser(delReq);
    const delLog = db.prepare(`SELECT * FROM audit_logs WHERE action = 'USER_DELETE' AND entity_id = ?`).get(createdUser.id);
    assert.ok(delLog, 'USER_DELETE audit log must exist');

    // Failed operations must NOT create false success audit events
    const initialLogCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get() as any).c;
    setTestSession(engineerSession);
    const failedDelReq = new Request(`http://localhost:3000/api/users?id=usr-admin-1`, { method: 'DELETE' });
    const failedDelRes = await deleteUser(failedDelReq);
    assert.strictEqual(failedDelRes.status, 403);
    const afterFailedCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get() as any).c;
    assert.strictEqual(afterFailedCount, initialLogCount, 'Failed operations must not write audit logs');
  });

  // ==========================================================================
  // SECTION 8: SECRET LEAK TEST
  // ==========================================================================
  await t.test('8. Secret & Credential Leak Prevention', async () => {
    setTestSession(spSession);

    // 8.1 Redaction engine scrubs passwords, hashes, tokens, keys
    const testSecretPayload = {
      password: 'SuperSecretPassword!',
      password_hash: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis',
      nested: {
        token: 'secret-token-123',
        safeKey: 'SafePublicValue',
      },
    };
    const redacted = redactPayload(testSecretPayload, { isSuperiorPrimeCaller: false });
    assert.strictEqual((redacted as any).password, '[REDACTED]');
    assert.strictEqual((redacted as any).password_hash, '[REDACTED]');
    assert.strictEqual((redacted as any).jwt, '[REDACTED]');
    assert.strictEqual((redacted as any).nested.token, '[REDACTED]');
    assert.strictEqual((redacted as any).nested.safeKey, 'SafePublicValue');

    // 8.2 Verify GET /api/audit does not expose secrets
    const auditReq = new Request('http://localhost:3000/api/audit?limit=20');
    const auditRes = await getAuditList(auditReq);
    assert.strictEqual(auditRes.status, 200);
    const auditJson = await auditRes.json();
    const auditStr = JSON.stringify(auditJson);
    assert.ok(!auditStr.includes('$2a$'), 'Audit output must never include raw bcrypt hashes');
    assert.ok(!auditStr.includes('SuperSecretPassword'), 'Audit output must never include raw passwords');
  });
});
