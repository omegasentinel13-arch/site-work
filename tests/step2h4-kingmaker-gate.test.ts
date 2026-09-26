import { prepareTestDatabase } from './prepare-test-db';
prepareTestDatabase();

process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

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
  POST as postUserPerm,
  PUT as putUserPerm,
  DELETE as deleteUserPerm 
} from '../app/api/permissions/user/route';
import { 
  GET as getSitePerms, 
  POST as postSitePerm,
  PUT as putSitePerm,
  DELETE as deleteSitePerm 
} from '../app/api/permissions/sites/route';
import { GET as getAuditList } from '../app/api/audit/route';
import { GET as getAuditById } from '../app/api/audit/[id]/route';

import { UserSession, createSessionCookie, verifySessionToken } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { getDb } from '../lib/db';
import { 
  getUserById, 
  getUserByUsername, 
  getAllUsers, 
  countActiveAdmins,
  createUser,
  deleteUser as repoDeleteUser
} from '../lib/db/repositories/user-repo';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { 
  isKingMaker,
  isSuperiorPrime,
  isClientPrime,
  canManageAuthority, 
  canAssignAuthorityTier, 
  canDeleteUser, 
  canModifyCredentials 
} from '../lib/auth/authority';
import { redactPayload } from '../lib/audit/redaction';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2H.4: King Maker / Hidden Platform Authority Integration Gate', { concurrency: 1 }, async (t) => {
  const db = getDb();

  // Baseline records
  const initialAdmin = db.prepare("SELECT * FROM users WHERE id = 'usr-admin-1'").get() as any;
  assert.ok(initialAdmin, 'usr-admin-1 must exist in test DB');

  // Mutate usr-admin-1 to KING_MAKER in test DB
  db.exec("UPDATE users SET authority_tier = 'KING_MAKER', updated_at = datetime('now') WHERE id = 'usr-admin-1';");

  const kingMakerRow = db.prepare("SELECT * FROM users WHERE id = 'usr-admin-1'").get() as any;
  assert.equal(kingMakerRow.authority_tier, 'KING_MAKER');
  assert.equal(kingMakerRow.id, initialAdmin.id);
  assert.equal(kingMakerRow.username, initialAdmin.username);
  assert.equal(kingMakerRow.password_hash, initialAdmin.password_hash);
  assert.equal(kingMakerRow.recovery_email, initialAdmin.recovery_email);
  assert.equal(kingMakerRow.created_at, initialAdmin.created_at);

  const kingMakerSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: kingMakerRow.full_name,
    role: 'ADMIN',
    authorityTier: 'KING_MAKER',
    isActive: true,
    tokenVersion: kingMakerRow.token_version,
  };

  const primeRow = db.prepare("SELECT * FROM users WHERE username = 'abadmin'").get() as any;
  assert.ok(primeRow, 'abadmin must exist in test DB');
  const primeSession: UserSession = {
    userId: primeRow.id,
    username: primeRow.username,
    fullName: primeRow.full_name,
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    isActive: true,
    tokenVersion: primeRow.token_version,
  };

  const stdAdminRow = db.prepare("SELECT * FROM users WHERE username = 'STAR-SCREW'").get() as any;
  assert.ok(stdAdminRow, 'STAR-SCREW must exist in test DB');
  const stdAdminSession: UserSession = {
    userId: stdAdminRow.id,
    username: stdAdminRow.username,
    fullName: stdAdminRow.full_name,
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    isActive: true,
    tokenVersion: stdAdminRow.token_version,
  };

  const viewerRow = db.prepare("SELECT * FROM users WHERE username = 'viewer1'").get() as any;
  assert.ok(viewerRow, 'viewer1 must exist in test DB');
  const viewerSession: UserSession = {
    userId: viewerRow.id,
    username: viewerRow.username,
    fullName: viewerRow.full_name,
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    isActive: true,
    tokenVersion: viewerRow.token_version,
  };

  await t.test('1. Identity & Single King Maker Invariant', async () => {
    // Exactly 1 King Maker
    const kmList = db.prepare("SELECT * FROM users WHERE authority_tier = 'KING_MAKER'").all() as any[];
    assert.equal(kmList.length, 1);
    assert.equal(kmList[0].id, 'usr-admin-1');
    assert.equal(kmList[0].username, 'Iamadmin');

    // Startup invariant check
    const kingMakers = db.prepare("SELECT id, username FROM users WHERE authority_tier = 'KING_MAKER'").all() as { id: string; username: string }[];
    assert.equal(kingMakers.length, 1);
    assert.equal(kingMakers[0].id, 'usr-admin-1');

    // API / UI cannot create KING_MAKER
    assert.equal(canAssignAuthorityTier(kingMakerSession, 'KING_MAKER'), false);
    assert.equal(canAssignAuthorityTier(primeSession, 'KING_MAKER'), false);
    assert.equal(canAssignAuthorityTier(stdAdminSession, 'KING_MAKER'), false);

    setTestSession(kingMakerSession);
    const createReq = new Request('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'fakeking',
        password: 'Password123!',
        fullName: 'Fake King',
        role: 'ADMIN',
        authorityTier: 'KING_MAKER',
      }),
    });
    const createRes = await postUser(createReq);
    assert.equal(createRes.status, 403);
    const createData = await createRes.json();
    assert.match(createData.error, /Insufficient authority/);
  });

  await t.test('2. Visibility & Discovery Protection', async () => {
    // getAllUsers excludes King Maker across all callers
    const usersForPrime = getAllUsers(primeSession);
    assert.ok(!usersForPrime.some(u => u.id === 'usr-admin-1' || u.username === 'Iamadmin'));
    assert.equal(usersForPrime.length, 5);

    const usersForStdAdmin = getAllUsers(stdAdminSession);
    assert.ok(!usersForStdAdmin.some(u => u.id === 'usr-admin-1'));
    assert.equal(usersForStdAdmin.length, 5);

    const usersForKM = getAllUsers(kingMakerSession);
    assert.ok(usersForKM.some(u => u.id === 'usr-admin-1'));
    assert.equal(usersForKM.length, 6);

    // Active admins count is 2 (abadmin, STAR-SCREW)
    assert.equal(countActiveAdmins(kingMakerSession), 2);
    assert.equal(countActiveAdmins(primeSession), 2);
    assert.equal(countActiveAdmins(stdAdminSession), 2);

    // Direct queries: getUserById / getUserByUsername
    // Prime query for King Maker -> null
    assert.equal(getUserById('usr-admin-1', primeSession), null);
    assert.equal(getUserByUsername('Iamadmin', primeSession), null);

    // Standard admin query for King Maker -> null
    assert.equal(getUserById('usr-admin-1', stdAdminSession), null);
    assert.equal(getUserByUsername('Iamadmin', stdAdminSession), null);

    // King Maker self-query -> returns record
    const selfById = getUserById('usr-admin-1', kingMakerSession);
    assert.ok(selfById);
    assert.equal(selfById.id, 'usr-admin-1');

    const selfByUsername = getUserByUsername('Iamadmin', kingMakerSession);
    assert.ok(selfByUsername);
    assert.equal(selfByUsername.username, 'Iamadmin');

    // API route GET /api/users?id=usr-admin-1
    setTestSession(primeSession);
    const primeQueryReq = new Request('http://localhost:3000/api/users?id=usr-admin-1');
    const primeQueryRes = await getUsers(primeQueryReq);
    assert.equal(primeQueryRes.status, 404);

    setTestSession(kingMakerSession);
    const kmQueryReq = new Request('http://localhost:3000/api/users?id=usr-admin-1');
    const kmQueryRes = await getUsers(kmQueryReq);
    assert.equal(kmQueryRes.status, 200);
    const kmData = await kmQueryRes.json();
    assert.equal(kmData.user.username, 'Iamadmin');
  });

  await t.test('3. Authority Hierarchy & Protection of King Maker', async () => {
    const kmPrincipal = { id: 'usr-admin-1', role: 'ADMIN' as const, authorityTier: 'KING_MAKER' as const };
    const primePrincipal = { id: primeRow.id, role: 'ADMIN' as const, authorityTier: 'CLIENT_PRIME' as const };
    const stdAdminPrincipal = { id: stdAdminRow.id, role: 'ADMIN' as const, authorityTier: 'STANDARD_ADMIN' as const };

    // Hierarchy checks
    assert.equal(canManageAuthority(kmPrincipal, primePrincipal), true);
    assert.equal(canManageAuthority(kmPrincipal, stdAdminPrincipal), true);
    assert.equal(canManageAuthority(primePrincipal, kmPrincipal), false);
    assert.equal(canManageAuthority(primePrincipal, primePrincipal), false); // Cannot manage peer Prime
    assert.equal(canManageAuthority(stdAdminPrincipal, kmPrincipal), false);

    // Credentials checks
    assert.equal(canModifyCredentials(kmPrincipal, primePrincipal), true);
    assert.equal(canModifyCredentials(primePrincipal, kmPrincipal), false);
    assert.equal(canModifyCredentials(stdAdminPrincipal, kmPrincipal), false);

    // King Maker can NEVER be deleted
    assert.equal(canDeleteUser(kmPrincipal, kmPrincipal), false);
    assert.equal(canDeleteUser(primePrincipal, kmPrincipal), false);
    assert.equal(canDeleteUser(stdAdminPrincipal, kmPrincipal), false);

    // Attempting delete via repo throws
    assert.throws(() => {
      repoDeleteUser('usr-admin-1', primeSession);
    }, /King Maker and Prime identities cannot be deleted/);

    // Attempting delete via API fails 404 (discovery protection) or 403
    setTestSession(primeSession);
    const delReq = new Request('http://localhost:3000/api/users?id=usr-admin-1', { method: 'DELETE' });
    const delRes = await deleteUser(delReq);
    assert.ok(delRes.status === 404 || delRes.status === 403);
  });

  await t.test('4. King Maker Controls Prime: Account & Security', async () => {
    setTestSession(kingMakerSession);

    // 4A: Update Prime profile (Full Name)
    const originalFullName = primeRow.full_name;
    const putReq = new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: primeRow.id,
        fullName: 'AB Admin Updated By King Maker',
        role: 'ADMIN',
        isActive: true,
      }),
    });
    const putRes = await putUser(putReq);
    assert.equal(putRes.status, 200);

    const updatedPrime = db.prepare('SELECT * FROM users WHERE id = ?').get(primeRow.id) as any;
    assert.equal(updatedPrime.full_name, 'AB Admin Updated By King Maker');

    // Restore full name
    db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(originalFullName, primeRow.id);

    // 4B: Password Reset for Prime by King Maker
    const resetReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: primeRow.id,
        action: 'RESET_PASSWORD',
        newPassword: 'NewSecurePassword123!',
        confirmPassword: 'NewSecurePassword123!',
      }),
    });
    const resetRes = await patchUser(resetReq);
    assert.equal(resetRes.status, 200);

    // Verify token_version was incremented
    const postResetPrime = db.prepare('SELECT * FROM users WHERE id = ?').get(primeRow.id) as any;
    assert.ok(postResetPrime.token_version > primeRow.token_version);

    // 4C: Deactivate Prime by King Maker
    const deactReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: primeRow.id,
        action: 'DEACTIVATE',
      }),
    });
    const deactRes = await patchUser(deactReq);
    assert.equal(deactRes.status, 200);

    const deactPrime = db.prepare('SELECT is_active FROM users WHERE id = ?').get(primeRow.id) as any;
    assert.equal(deactPrime.is_active, 0);

    // Reactivate Prime
    const actReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: primeRow.id,
        action: 'ACTIVATE',
      }),
    });
    const actRes = await patchUser(actReq);
    assert.equal(actRes.status, 200);

    const actPrime = db.prepare('SELECT is_active FROM users WHERE id = ?').get(primeRow.id) as any;
    assert.equal(actPrime.is_active, 1);

    // Prime attempts to modify King Maker credentials -> 404 / 403
    setTestSession(primeSession);
    const attackResetReq = new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-admin-1',
        action: 'RESET_PASSWORD',
        newPassword: 'HackedPassword123!',
        confirmPassword: 'HackedPassword123!',
      }),
    });
    const attackResetRes = await patchUser(attackResetReq);
    assert.ok(attackResetRes.status === 404 || attackResetRes.status === 403);
  });

  await t.test('5. King Maker Controls Prime: Permission Matrix & Overrides', async () => {
    setTestSession(kingMakerSession);

    // Fetch permission definitions
    const permDef = PermissionRepository.getPermissionDefinitionByPageAction('PAGE_FINANCE_TRANSACTIONS', 'DELETE');
    assert.ok(permDef, 'PAGE_FINANCE_TRANSACTIONS DELETE definition must exist');

    // Before override: Prime canAccess PAGE_FINANCE_TRANSACTIONS DELETE is allowed
    const baselineDecision = canAccess({
      session: primeSession,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
    });
    assert.equal(baselineDecision.allowed, true);

    // King Maker sets DENY override on Prime
    const overrideReq = new Request('http://localhost:3000/api/permissions/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: primeRow.id,
        permissionId: permDef.id,
        effect: 'DENY',
      }),
    });
    const overrideRes = await postUserPerm(overrideReq);
    assert.equal(overrideRes.status, 200);

    // Now Prime canAccess PAGE_FINANCE_TRANSACTIONS DELETE is DENIED via USER_GLOBAL_EXPLICIT_DENY
    const deniedDecision = canAccess({
      session: primeSession,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
    });
    assert.equal(deniedDecision.allowed, false);
    assert.equal(deniedDecision.ruleSource, 'USER_GLOBAL_EXPLICIT_DENY');

    // King Maker retains unrestricted access at all times
    const kmDecision = canAccess({
      session: kingMakerSession,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
    });
    assert.equal(kmDecision.allowed, true);
    assert.equal(kmDecision.ruleSource, 'KING_MAKER_PLATFORM_AUTHORITY');

    // Clean up override
    PermissionRepository.removeUserOverride(primeRow.id, permDef.id, null);
  });

  await t.test('6. King Maker Controls Prime: Site Access & Restricting Prime', async () => {
    setTestSession(kingMakerSession);

    const sites = db.prepare('SELECT id FROM sites').all() as { id: string }[];
    assert.ok(sites.length >= 2, 'Need at least 2 sites for testing');
    const siteA = sites[0].id;
    const siteB = sites[1].id;

    // By default: Prime has inherent global site scope
    assert.equal(PermissionRepository.isPrimeSiteRestricted(primeRow.id), false);
    const preDecision = canAccess({
      session: primeSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteA,
    });
    assert.equal(preDecision.allowed, true);

    // King Maker restricts Prime to siteA only
    const sitePutReq = new Request('http://localhost:3000/api/permissions/sites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: primeRow.id,
        siteIds: [siteA],
        allSites: false,
      }),
    });
    const sitePutRes = await putSitePerm(sitePutReq);
    assert.equal(sitePutRes.status, 200);

    // Now Prime is site restricted!
    assert.equal(PermissionRepository.isPrimeSiteRestricted(primeRow.id), true);

    // Prime can access siteA
    const allowedSiteDec = canAccess({
      session: primeSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteA,
    });
    assert.equal(allowedSiteDec.allowed, true);

    // Prime CANNOT access siteB (UNASSIGNED_SITE_DENY)
    const deniedSiteDec = canAccess({
      session: primeSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteB,
    });
    assert.equal(deniedSiteDec.allowed, false);
    assert.equal(deniedSiteDec.ruleSource, 'UNASSIGNED_SITE_DENY');

    // King Maker can access siteB with zero restriction
    const kmSiteBDec = canAccess({
      session: kingMakerSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteB,
    });
    assert.equal(kmSiteBDec.allowed, true);
    assert.equal(kmSiteBDec.ruleSource, 'KING_MAKER_PLATFORM_AUTHORITY');

    // Clean up site restrictions for Prime
    db.prepare('DELETE FROM site_users WHERE user_id = ?').run(primeRow.id);
    db.prepare("DELETE FROM audit_logs WHERE user_id = ? AND action = 'SITE_ACCESS_CHANGED'").run(primeRow.id);
  });

  await t.test('7. Audit Redaction & Privacy Invariant', async () => {
    // Redaction for lower callers
    const rawPayload = {
      actorId: 'usr-admin-1',
      actorUsername: 'Iamadmin',
      target: 'abadmin',
      note: 'Operation performed by Iamadmin at C:\\Users\\Admin\\data.db',
    };

    const redactedForPrime = redactPayload(rawPayload, {
      isSuperiorPrimeCaller: false,
      superiorPrimeIdentifiers: new Set(['usr-admin-1', 'Iamadmin']),
    }) as any;

    assert.equal(redactedForPrime.actorId, '[REDACTED]');
    assert.equal(redactedForPrime.actorUsername, '[REDACTED]');
    assert.ok(!redactedForPrime.note.includes('Iamadmin'));
    assert.ok(redactedForPrime.note.includes('[REDACTED]'));
    assert.ok(redactedForPrime.note.includes('[REDACTED_PATH]'));

    // Unredacted for King Maker
    const unredactedForKM = redactPayload(rawPayload, {
      isSuperiorPrimeCaller: true,
      superiorPrimeIdentifiers: new Set(['usr-admin-1', 'Iamadmin']),
    }) as any;
    assert.equal(unredactedForKM.actorUsername, 'Iamadmin');
  });

  // Restore initial state in test DB
  db.prepare('UPDATE users SET authority_tier = ?, full_name = ?, updated_at = ? WHERE id = ?').run(
    initialAdmin.authority_tier,
    initialAdmin.full_name,
    initialAdmin.updated_at,
    initialAdmin.id
  );
});
