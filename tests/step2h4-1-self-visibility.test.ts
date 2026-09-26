import { prepareTestDatabase } from './prepare-test-db';
prepareTestDatabase();

process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';

import { 
  GET as getUsers, 
  PUT as putUser, 
  PATCH as patchUser, 
  DELETE as deleteUser 
} from '../app/api/users/route';
import { 
  PUT as putSitePerm 
} from '../app/api/permissions/sites/route';
import { 
  PATCH as patchUserPerm 
} from '../app/api/permissions/user/route';

import { UserSession } from '../lib/auth/session';
import { getDb } from '../lib/db';
import { 
  getUserById, 
  getUserByUsername, 
  getAllUsers, 
  countActiveAdmins,
  updateUser,
  setUserActiveState,
  deleteUser as repoDeleteUser
} from '../lib/db/repositories/user-repo';
import { canManageAuthority, canDeleteUser, canAssignAuthorityTier } from '../lib/auth/authority';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2H.4.1: King Maker Self-Visibility & Protection Gate', { concurrency: 1 }, async (t) => {
  const db = getDb();

  // Ensure test database has King Maker
  db.exec("UPDATE users SET authority_tier = 'KING_MAKER', updated_at = datetime('now') WHERE id = 'usr-admin-1';");

  const kmRow = db.prepare("SELECT * FROM users WHERE id = 'usr-admin-1'").get() as any;
  assert.ok(kmRow);
  assert.equal(kmRow.authority_tier, 'KING_MAKER');

  const primeRow = db.prepare("SELECT * FROM users WHERE username = 'abadmin'").get() as any;
  assert.ok(primeRow);

  const stdAdminRow = db.prepare("SELECT * FROM users WHERE username = 'STAR-SCREW'").get() as any;
  assert.ok(stdAdminRow);

  const stdRow = db.prepare("SELECT * FROM users WHERE username = 'engineer1'").get() as any;
  assert.ok(stdRow);

  const kmSession: UserSession = {
    userId: kmRow.id,
    username: kmRow.username,
    fullName: kmRow.full_name,
    role: 'ADMIN',
    authorityTier: 'KING_MAKER',
    isActive: true,
    assignedSiteIds: [],
    tokenVersion: kmRow.token_version,
  };

  const primeSession: UserSession = {
    userId: primeRow.id,
    username: primeRow.username,
    fullName: primeRow.full_name,
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    isActive: true,
    assignedSiteIds: [],
    tokenVersion: primeRow.token_version,
  };

  const stdAdminSession: UserSession = {
    userId: stdAdminRow.id,
    username: stdAdminRow.username,
    fullName: stdAdminRow.full_name,
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    isActive: true,
    assignedSiteIds: [],
    tokenVersion: stdAdminRow.token_version,
  };

  const stdSession: UserSession = {
    userId: stdRow.id,
    username: stdRow.username,
    fullName: stdRow.full_name,
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    isActive: true,
    assignedSiteIds: ['site-1'],
    tokenVersion: stdRow.token_version,
  };

  await t.test('1. Repository-Level Self-Visibility & Dynamic Counts', async () => {
    // 1.1 King Maker caller: includes King Maker self
    const kmVisibleUsers = getAllUsers(kmSession);
    const hasKmSelf = kmVisibleUsers.some((u) => u.id === 'usr-admin-1' && u.authority_tier === 'KING_MAKER');
    assert.equal(hasKmSelf, true, 'King Maker must see its own account in directory listing');
    assert.equal(kmVisibleUsers.length, 6, 'King Maker sees 6 total active users dynamically');

    // 1.2 Lower authority callers: exclude King Maker completely
    const primeVisibleUsers = getAllUsers(primeSession);
    assert.equal(primeVisibleUsers.some((u) => u.id === 'usr-admin-1'), false, 'Client Prime must NEVER see King Maker in directory');
    assert.equal(primeVisibleUsers.length, 5, 'Client Prime sees exactly 5 users dynamically');

    const adminVisibleUsers = getAllUsers(stdAdminSession);
    assert.equal(adminVisibleUsers.some((u) => u.id === 'usr-admin-1'), false, 'Standard Admin must NEVER see King Maker in directory');
    assert.equal(adminVisibleUsers.length, 5, 'Standard Admin sees exactly 5 users dynamically');

    const stdVisibleUsers = getAllUsers(stdSession);
    assert.equal(stdVisibleUsers.some((u) => u.id === 'usr-admin-1'), false, 'Standard user must NEVER see King Maker in directory');
    assert.equal(stdVisibleUsers.length, 5, 'Standard user sees exactly 5 users dynamically');
  });

  await t.test('2. Direct ID & Username Lookup Access Control', async () => {
    // King Maker caller can retrieve itself by ID and username
    const kmSelfById = getUserById('usr-admin-1', kmSession);
    assert.ok(kmSelfById, 'King Maker must be able to lookup itself by ID');
    assert.equal(kmSelfById.authority_tier, 'KING_MAKER');

    const kmSelfByUsername = getUserByUsername('Iamadmin', kmSession);
    assert.ok(kmSelfByUsername, 'King Maker must be able to lookup itself by Username');
    assert.equal(kmSelfByUsername.id, 'usr-admin-1');

    // Prime caller receives null (404) for King Maker ID and username
    assert.equal(getUserById('usr-admin-1', primeSession), null, 'Prime lookup by ID must return null');
    assert.equal(getUserByUsername('Iamadmin', primeSession), null, 'Prime lookup by Username must return null');

    // Standard Admin caller receives null (404)
    assert.equal(getUserById('usr-admin-1', stdAdminSession), null, 'Standard Admin lookup by ID must return null');
    assert.equal(getUserByUsername('Iamadmin', stdAdminSession), null, 'Standard Admin lookup by Username must return null');

    // Standard caller receives null (404)
    assert.equal(getUserById('usr-admin-1', stdSession), null, 'Standard user lookup by ID must return null');
    assert.equal(getUserByUsername('Iamadmin', stdSession), null, 'Standard user lookup by Username must return null');
  });

  await t.test('3. API Endpoint Verification (/api/users)', async () => {
    // 3.1 King Maker GET /api/users
    setTestSession(kmSession);
    const kmRes = await getUsers(new Request('http://localhost:3000/api/users'));
    assert.equal(kmRes.status, 200);
    const kmData = await kmRes.json();
    assert.equal(kmData.users.length, 6, 'King Maker API returns 6 users');
    const kmInApi = kmData.users.find((u: any) => u.id === 'usr-admin-1');
    assert.ok(kmInApi, 'King Maker self record present in API response');
    assert.equal(kmInApi.authorityTier, 'KING_MAKER');

    // 3.2 Prime GET /api/users
    setTestSession(primeSession);
    const primeRes = await getUsers(new Request('http://localhost:3000/api/users'));
    assert.equal(primeRes.status, 200);
    const primeData = await primeRes.json();
    assert.equal(primeData.users.length, 5, 'Prime API returns exactly 5 users');
    assert.equal(primeData.users.some((u: any) => u.id === 'usr-admin-1'), false);

    // 3.3 Direct ID query via API
    setTestSession(kmSession);
    const kmDirectIdRes = await getUsers(new Request('http://localhost:3000/api/users?id=usr-admin-1'));
    assert.equal(kmDirectIdRes.status, 200);
    const kmDirectIdData = await kmDirectIdRes.json();
    assert.equal(kmDirectIdData.user?.username, 'Iamadmin');

    setTestSession(primeSession);
    const primeDirectIdRes = await getUsers(new Request('http://localhost:3000/api/users?id=usr-admin-1'));
    assert.equal(primeDirectIdRes.status, 404, 'Prime direct ID query must return 404');

    // 3.4 Direct Username query via API
    setTestSession(kmSession);
    const kmDirectUserRes = await getUsers(new Request('http://localhost:3000/api/users?username=Iamadmin'));
    assert.equal(kmDirectUserRes.status, 200);
    const kmDirectUserData = await kmDirectUserRes.json();
    assert.equal(kmDirectUserData.user?.id, 'usr-admin-1');

    setTestSession(primeSession);
    const primeDirectUserRes = await getUsers(new Request('http://localhost:3000/api/users?username=Iamadmin'));
    assert.equal(primeDirectUserRes.status, 404, 'Prime direct Username query must return 404');
  });

  await t.test('4. King Maker Self-Protection Invariants', async () => {
    setTestSession(kmSession);

    // 4.1 King Maker cannot self-deactivate via PUT
    const deactPutRes = await putUser(new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-admin-1',
        fullName: 'Head Administrator',
        role: 'ADMIN',
        authorityTier: 'KING_MAKER',
        isActive: false,
      }),
    }));
    assert.equal(deactPutRes.status, 400);
    const deactPutData = await deactPutRes.json();
    assert.match(deactPutData.error, /cannot deactivate/i);

    // 4.2 King Maker cannot self-deactivate via PATCH
    const deactPatchRes = await patchUser(new Request('http://localhost:3000/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-admin-1',
        action: 'DEACTIVATE',
      }),
    }));
    assert.equal(deactPatchRes.status, 400);

    // 4.3 King Maker cannot downgrade own authority tier
    const downgradePutRes = await putUser(new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-admin-1',
        fullName: 'Head Administrator',
        role: 'ADMIN',
        authorityTier: 'STANDARD_ADMIN',
        isActive: true,
      }),
    }));
    assert.ok(downgradePutRes.status === 400 || downgradePutRes.status === 403);
    const downgradeData = await downgradePutRes.json();
    assert.match(downgradeData.error, /cannot be altered or downgraded/i);

    // 4.4 King Maker cannot self-delete
    const deleteRes = await deleteUser(new Request('http://localhost:3000/api/users?id=usr-admin-1', {
      method: 'DELETE',
    }));
    assert.ok(deleteRes.status === 400 || deleteRes.status === 403);
  });

  await t.test('5. King Maker Still Controls Prime (abadmin)', async () => {
    setTestSession(kmSession);

    // King Maker can update Prime's full name
    const updatePrimeRes = await putUser(new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: primeRow.id,
        fullName: 'AB Admin Updated By KM',
        role: 'ADMIN',
        authorityTier: 'CLIENT_PRIME',
        isActive: true,
        recoveryEmail: 'supermanskrypton@gmail.com',
      }),
    }));
    assert.equal(updatePrimeRes.status, 200);

    // King Maker can toggle permission overrides on Prime
    const permPatchRes = await patchUserPerm(new Request('http://localhost:3000/api/permissions/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: primeRow.id,
        changes: [
          { permissionId: 'perm-fin-tx-delete', siteId: null, effect: 'DENY' }
        ],
      }),
    }));
    assert.equal(permPatchRes.status, 200);

    // Restore Prime's full name and clean up override
    await putUser(new Request('http://localhost:3000/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: primeRow.id,
        fullName: 'AB Admin',
        role: 'ADMIN',
        authorityTier: 'CLIENT_PRIME',
        isActive: true,
        recoveryEmail: 'supermanskrypton@gmail.com',
      }),
    }));

    db.prepare("DELETE FROM user_permission_overrides WHERE user_id = ?").run(primeRow.id);
  });

  await t.test('6. Single King Maker Invariant Verification', async () => {
    const kmCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE authority_tier = 'KING_MAKER'").get() as { count: number };
    assert.equal(kmCount.count, 1, 'Exactly one KING_MAKER must exist in the database');
  });

  setTestSession(null);
});
