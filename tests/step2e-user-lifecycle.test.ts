process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

import { 
  GET as getUsers, 
  POST as postUser, 
  PUT as putUser, 
  PATCH as patchUser, 
  DELETE as deleteUser 
} from '../app/api/users/route';
import { POST as loginUser } from '../app/api/auth/login/route';
import { UserSession } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { getUserById, countActiveAdmins } from '../lib/db/repositories/user-repo';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2E: User Lifecycle & Account Management (20 Mandated Security Proofs)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Clean up any previous test artifacts in test DB
  const testUserFilter = `SELECT id FROM users WHERE username LIKE 'test.lifecycle%' OR username = 'test.prime.created' OR username LIKE 'test.renamed%'`;
  db.prepare(`DELETE FROM attendance_records WHERE id LIKE 'att-test-hist%' OR created_by IN (${testUserFilter})`).run();
  db.prepare(`DELETE FROM financial_transactions WHERE id LIKE 'fin-test-hist%' OR created_by IN (${testUserFilter})`).run();
  db.prepare(`DELETE FROM audit_logs WHERE user_id IN (${testUserFilter}) OR entity_id IN (${testUserFilter})`).run();
  db.prepare(`DELETE FROM user_permission_overrides WHERE user_id IN (${testUserFilter}) OR granted_by IN (${testUserFilter})`).run();
  db.prepare(`DELETE FROM site_users WHERE user_id IN (${testUserFilter})`).run();
  db.prepare(`DELETE FROM users WHERE username LIKE 'test.lifecycle%' OR username = 'test.prime.created' OR username LIKE 'test.renamed%'`).run();

  // Initialize test principals in data/test_site_work.db
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Operational Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-target-test', 'targetuser', 'hash', 'Target User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-view-1', 'viewer1', 'hash', 'Viewer User', 'VIEWER', 'STANDARD', 1, 1, 1)
  `).run();

  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'CLIENT_PRIME' WHERE id = 'usr-client-prime-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE id = 'usr-std-admin-1'`).run();

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
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  const operationalViewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Operational Viewer',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  let createdUserId = '';

  // ===========================================================================
  // 1. Authorized Prime creates user
  // ===========================================================================
  await t.test('1. authorized Prime creates user', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.lifecycle1',
        password: 'Password123!',
        fullName: 'Test Lifecycle User',
        role: 'SITE_MANAGER',
        recoveryEmail: 'test.lifecycle1@example.com',
        siteIds: ['site-1'],
      }),
    });

    const res = await postUser(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.userId);
    createdUserId = data.userId;

    const user = getUserById(createdUserId);
    assert.ok(user);
    assert.equal(user.username, 'test.lifecycle1');
    assert.equal(user.full_name, 'Test Lifecycle User');
    assert.equal(user.role, 'SITE_MANAGER');
    assert.equal(user.authority_tier, 'STANDARD');
    assert.equal(user.is_active, 1);
    assert.equal(user.token_version, 1);
    assert.equal((user as any).permission_version || 1, 1);

    // Verify site assignment in canonical site_users
    const assigned = db.prepare(`SELECT site_id FROM site_users WHERE user_id = ?`).all(createdUserId) as { site_id: string }[];
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].site_id, 'site-1');

    // Verify audit event
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_CREATED'`).get(createdUserId) as any;
    assert.ok(audit, 'USER_CREATED audit event must exist');
    assert.equal(audit.user_id, clientPrimeSession.userId);
  });

  // ===========================================================================
  // 2. Unauthorized role cannot create user
  // ===========================================================================
  await t.test('2. unauthorized role cannot create user', async () => {
    // 2.1 Engineer cannot create user
    setTestSession(operationalEngineerSession);
    const engReq = new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.unauth1',
        password: 'Password123!',
        fullName: 'Unauth User',
        role: 'SITE_MANAGER',
      }),
    });
    const engRes = await postUser(engReq);
    assert.equal(engRes.status, 403, 'SITE_MANAGER cannot create users');

    // 2.2 Viewer cannot create user
    setTestSession(operationalViewerSession);
    const viewReq = new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.unauth2',
        password: 'Password123!',
        fullName: 'Unauth User 2',
        role: 'VIEWER',
      }),
    });
    const viewRes = await postUser(viewReq);
    assert.equal(viewRes.status, 403, 'VIEWER cannot create users');

    // 2.3 Standard Admin cannot create an Administrator account
    setTestSession(standardAdminSession);
    const adminEscReq = new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.admin.esc',
        password: 'Password123!',
        fullName: 'Admin Escalation Attempt',
        role: 'ADMIN',
      }),
    });
    const adminEscRes = await postUser(adminEscReq);
    assert.equal(adminEscRes.status, 403, 'Standard Admin cannot create ADMIN accounts');
  });

  // ===========================================================================
  // 3. Duplicate username rejected
  // ===========================================================================
  await t.test('3. duplicate username rejected', async () => {
    setTestSession(clientPrimeSession);

    const dupReq = new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.lifecycle1', // already created
        password: 'Password123!',
        fullName: 'Duplicate User',
        role: 'VIEWER',
      }),
    });
    const dupRes = await postUser(dupReq);
    assert.equal(dupRes.status, 400, 'Duplicate username must be rejected with 400');
    const data = await dupRes.json();
    assert.ok(data.error.includes('already in use'));
  });

  // ===========================================================================
  // 4. Username case collision rejected
  // ===========================================================================
  await t.test('4. username case collision rejected', async () => {
    setTestSession(clientPrimeSession);

    const caseReq = new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'TEST.LIFECYCLE1', // case variation of test.lifecycle1
        password: 'Password123!',
        fullName: 'Case Collision User',
        role: 'VIEWER',
      }),
    });
    const caseRes = await postUser(caseReq);
    assert.equal(caseRes.status, 400, 'Case variation of existing username must be rejected');
    const data = await caseRes.json();
    assert.ok(data.error.includes('already in use'));
  });

  // ===========================================================================
  // 5. Authorized role change succeeds
  // ===========================================================================
  await t.test('5. authorized role change succeeds', async () => {
    setTestSession(clientPrimeSession);

    const permVersionBefore = getUserById(createdUserId)?.permission_version || 1;

    const roleReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'CHANGE_ROLE',
        newRole: 'VIEWER',
      }),
    });

    const roleRes = await patchUser(roleReq);
    assert.equal(roleRes.status, 200);

    const updatedUser = getUserById(createdUserId);
    assert.equal(updatedUser?.role, 'VIEWER');
    assert.ok((updatedUser?.permission_version || 0) > permVersionBefore, 'permission_version must increment');

    // Audit verification
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_CHANGED'`).get(createdUserId) as any;
    assert.ok(audit, 'ROLE_CHANGED audit event must exist');
  });

  // ===========================================================================
  // 6. Unauthorized role escalation rejected
  // ===========================================================================
  await t.test('6. unauthorized role escalation rejected', async () => {
    setTestSession(standardAdminSession);

    const escReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'CHANGE_ROLE',
        newRole: 'ADMIN',
      }),
    });

    const escRes = await patchUser(escReq);
    assert.equal(escRes.status, 403, 'Standard admin cannot escalate lower user to ADMIN');
  });

  // ===========================================================================
  // 7. Deactivate blocks login
  // ===========================================================================
  await t.test('7. deactivate blocks login', async () => {
    setTestSession(clientPrimeSession);

    const deactReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'DEACTIVATE',
      }),
    });

    const deactRes = await patchUser(deactReq);
    assert.equal(deactRes.status, 200);

    const user = getUserById(createdUserId);
    assert.equal(user?.is_active, 0, 'User is_active must be 0');

    // Verify login is blocked
    const loginReq = new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.lifecycle1',
        password: 'Password123!',
      }),
    });
    const loginRes = await loginUser(loginReq);
    assert.equal(loginRes.status, 403, 'Login for deactivated account must return 403');
    const loginData = await loginRes.json();
    assert.ok(loginData.error.includes('disabled'));

    // Verify evaluator blocks access
    const deactSession: UserSession = {
      userId: createdUserId,
      username: 'test.lifecycle1',
      fullName: 'Test User',
      role: 'VIEWER',
      isActive: false,
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };
    const access = canAccess({
      session: deactSession,
      page: 'PAGE_DASHBOARD',
      action: 'VIEW',
    });
    assert.equal(access.allowed, false);
    assert.equal(access.ruleSource, 'ACCOUNT_INACTIVE');

    // Audit verification
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_DEACTIVATED'`).get(createdUserId) as any;
    assert.ok(audit, 'USER_DEACTIVATED audit event must exist');
  });

  // ===========================================================================
  // 8. Activate restores login
  // ===========================================================================
  await t.test('8. activate restores login', async () => {
    setTestSession(clientPrimeSession);

    const actReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'ACTIVATE',
      }),
    });

    const actRes = await patchUser(actReq);
    assert.equal(actRes.status, 200);

    const user = getUserById(createdUserId);
    assert.equal(user?.is_active, 1, 'User is_active must be restored to 1');

    // Verify login is restored
    const loginReq = new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.lifecycle1',
        password: 'Password123!',
      }),
    });
    const loginRes = await loginUser(loginReq);
    assert.equal(loginRes.status, 200, 'Login must succeed once reactivated');

    // Audit verification
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_ACTIVATED'`).get(createdUserId) as any;
    assert.ok(audit, 'USER_ACTIVATED audit event must exist');
  });

  // ===========================================================================
  // 9. Deactivation preserves history
  // ===========================================================================
  await t.test('9. deactivation preserves history', async () => {
    // Seed attendance and finance records authored by createdUserId
    db.prepare(`
      INSERT OR IGNORE INTO attendance_records (id, site_id, role_id, date, rate_snapshot_paise, total_workers, worker_days, total_cost_paise, created_by, updated_by)
      VALUES ('att-test-hist-1', 'site-1', 'role-mason', '2026-09-19', 50000, 1, 1.0, 50000, ?, ?)
    `).run(createdUserId, createdUserId);

    db.prepare(`
      INSERT OR IGNORE INTO financial_transactions (id, site_id, date, type, amount_paise, description, created_by, updated_by)
      VALUES ('fin-test-hist-1', 'site-1', '2026-09-19', 'CREDIT', 100000, 'Test credit', ?, ?)
    `).run(createdUserId, createdUserId);

    // Deactivate user
    setTestSession(clientPrimeSession);
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'DEACTIVATE' }),
    }));

    // Verify records remain 100% intact
    const att = db.prepare(`SELECT * FROM attendance_records WHERE id = 'att-test-hist-1'`).get() as any;
    assert.ok(att);
    assert.equal(att.created_by, createdUserId);

    const fin = db.prepare(`SELECT * FROM financial_transactions WHERE id = 'fin-test-hist-1'`).get() as any;
    assert.ok(fin);
    assert.equal(fin.created_by, createdUserId);

    // Reactivate for further tests
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'ACTIVATE' }),
    }));
  });

  // ===========================================================================
  // 10. Password reset invalidates old session/token
  // ===========================================================================
  await t.test('10. password reset invalidates old session/token', async () => {
    setTestSession(clientPrimeSession);

    const userBefore = getUserById(createdUserId)!;
    const oldTokenVersion = userBefore.token_version;
    const oldPasswordHash = userBefore.password_hash;

    const resetReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'RESET_PASSWORD',
        newPassword: 'BrandNewPassword123!',
        confirmPassword: 'BrandNewPassword123!',
      }),
    });

    const resetRes = await patchUser(resetReq);
    assert.equal(resetRes.status, 200);

    const userAfter = getUserById(createdUserId)!;
    assert.ok(userAfter.token_version > oldTokenVersion, 'token_version must increment');
    assert.notEqual(userAfter.password_hash, oldPasswordHash, 'password_hash must change');

    // Login with old password fails
    const oldLoginRes = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.lifecycle1',
        password: 'Password123!',
      }),
    }));
    assert.equal(oldLoginRes.status, 401, 'Old password must be rejected');

    // Login with new password succeeds
    const newLoginRes = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'test.lifecycle1',
        password: 'BrandNewPassword123!',
      }),
    }));
    assert.equal(newLoginRes.status, 200, 'New password must succeed');

    // Audit verification
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'PASSWORD_RESET'`).get(createdUserId) as any;
    assert.ok(audit, 'PASSWORD_RESET audit event must exist');
  });

  // ===========================================================================
  // 11. Recovery email change is protected
  // ===========================================================================
  await t.test('11. recovery email change is protected', async () => {
    // Standard Admin cannot change Client Prime recovery email
    setTestSession(standardAdminSession);
    const unauthReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-client-prime-1',
        action: 'CHANGE_RECOVERY_EMAIL',
        newRecoveryEmail: 'tamper@evil.com',
      }),
    });
    const unauthRes = await patchUser(unauthReq);
    assert.equal(unauthRes.status, 403, 'Standard Admin cannot change Prime recovery email');

    // Authorized Prime changes recovery email
    setTestSession(clientPrimeSession);
    const authReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'CHANGE_RECOVERY_EMAIL',
        newRecoveryEmail: 'new.secure.email@example.com',
      }),
    });
    const authRes = await patchUser(authReq);
    assert.equal(authRes.status, 200);

    const user = getUserById(createdUserId);
    assert.equal(user?.recovery_email, 'new.secure.email@example.com');

    // Invalid email rejected
    const invalidEmailReq = new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'CHANGE_RECOVERY_EMAIL',
        newRecoveryEmail: 'not-an-email',
      }),
    });
    const invalidEmailRes = await patchUser(invalidEmailReq);
    assert.equal(invalidEmailRes.status, 400);

    // Audit verification
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'RECOVERY_EMAIL_CHANGED'`).get(createdUserId) as any;
    assert.ok(audit, 'RECOVERY_EMAIL_CHANGED audit event must exist');
  });

  // ===========================================================================
  // 12. Client Prime cannot modify Superior Prime
  // ===========================================================================
  await t.test('12. Client Prime cannot modify Superior Prime', async () => {
    setTestSession(clientPrimeSession);

    // 12.1 PUT
    const putRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-admin-1',
        fullName: 'Hacked Superior Prime',
        role: 'ADMIN',
      }),
    }));
    assert.equal(putRes.status, 404, 'Superior Prime must be 404 for Client Prime');

    // 12.2 PATCH Password
    const patchPassRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-admin-1',
        action: 'RESET_PASSWORD',
        newPassword: 'HackedPassword123!',
      }),
    }));
    assert.equal(patchPassRes.status, 404);

    // 12.3 PATCH Deactivate
    const patchDeactRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-admin-1',
        action: 'DEACTIVATE',
      }),
    }));
    assert.equal(patchDeactRes.status, 404);

    // 12.4 DELETE
    const delRes = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-admin-1', {
      method: 'DELETE',
    }));
    assert.equal(delRes.status, 404);
  });

  // ===========================================================================
  // 13. Standard Admin cannot modify Prime
  // ===========================================================================
  await t.test('13. Standard Admin cannot modify Prime', async () => {
    setTestSession(standardAdminSession);

    // Modifying Client Prime returns 403
    const putRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-client-prime-1',
        fullName: 'Hacked Client Prime',
        role: 'ADMIN',
      }),
    }));
    assert.equal(putRes.status, 403, 'Standard Admin modifying Prime returns 403');

    // Modifying Superior Prime returns 404 (hidden)
    const supRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'usr-admin-1',
        fullName: 'Hacked Superior Prime',
        role: 'ADMIN',
      }),
    }));
    assert.equal(supRes.status, 404, 'Superior Prime is hidden from Standard Admin');
  });

  // ===========================================================================
  // 14. Engineer cannot mutate users
  // ===========================================================================
  await t.test('14. Engineer cannot mutate users', async () => {
    setTestSession(operationalEngineerSession);

    const putRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: createdUserId, fullName: 'Eng Mutate', role: 'VIEWER' }),
    }));
    assert.equal(putRes.status, 403);

    const patchRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'DEACTIVATE' }),
    }));
    assert.equal(patchRes.status, 403);

    const delRes = await deleteUser(new Request(`http://localhost:3001/api/users?id=${createdUserId}`, {
      method: 'DELETE',
    }));
    assert.equal(delRes.status, 403);
  });

  // ===========================================================================
  // 15. Viewer cannot mutate users
  // ===========================================================================
  await t.test('15. Viewer cannot mutate users', async () => {
    setTestSession(operationalViewerSession);

    const putRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: createdUserId, fullName: 'Viewer Mutate', role: 'VIEWER' }),
    }));
    assert.equal(putRes.status, 403);

    const patchRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'DEACTIVATE' }),
    }));
    assert.equal(patchRes.status, 403);

    const delRes = await deleteUser(new Request(`http://localhost:3001/api/users?id=${createdUserId}`, {
      method: 'DELETE',
    }));
    assert.equal(delRes.status, 403);
  });

  // ===========================================================================
  // 16. User ID remains unchanged after edits
  // ===========================================================================
  await t.test('16. user ID remains unchanged after edits', async () => {
    setTestSession(clientPrimeSession);

    const current = getUserById(createdUserId)!;

    // Edit full name (role unchanged -> logs USER_UPDATED)
    const updateRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: createdUserId,
        fullName: 'Final Renovated User Name',
        role: current.role,
      }),
    }));
    assert.equal(updateRes.status, 200);

    // Change username
    const patchRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'CHANGE_USERNAME',
        newUsername: 'test.renamed1',
      }),
    }));
    const patchData = await patchRes.json();
    assert.equal(patchRes.status, 200, `PATCH username failed: ${JSON.stringify(patchData)}`);

    // Verify user ID is still createdUserId
    const userById = getUserById(createdUserId);
    assert.ok(userById);
    assert.equal(userById.id, createdUserId, 'User ID must remain strictly identical');
    assert.equal(userById.username, 'test.renamed1');
    assert.equal(userById.full_name, 'Final Renovated User Name');

    // Audit verification
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USERNAME_CHANGED'`).get(createdUserId) as any;
    assert.ok(audit, 'USERNAME_CHANGED audit event must exist');
  });

  // ===========================================================================
  // 17. Site memberships preserved after role change
  // ===========================================================================
  await t.test('17. site memberships preserved after role change', async () => {
    setTestSession(clientPrimeSession);

    // Verify site-1 is assigned initially
    const initialSites = db.prepare(`SELECT site_id FROM site_users WHERE user_id = ?`).all(createdUserId) as { site_id: string }[];
    assert.equal(initialSites.length, 1);
    assert.equal(initialSites[0].site_id, 'site-1');

    // Change role SITE_MANAGER -> VIEWER without providing siteIds
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: createdUserId,
        action: 'CHANGE_ROLE',
        newRole: 'VIEWER',
      }),
    }));

    // Verify site-1 is STILL assigned in site_users
    const afterSites = db.prepare(`SELECT site_id FROM site_users WHERE user_id = ?`).all(createdUserId) as { site_id: string }[];
    assert.equal(afterSites.length, 1, 'Site assignments must be preserved across role changes');
    assert.equal(afterSites[0].site_id, 'site-1');
  });

  // ===========================================================================
  // 18. Permission_version updates correctly
  // ===========================================================================
  await t.test('18. permission_version updates correctly', async () => {
    setTestSession(clientPrimeSession);

    const v0 = (getUserById(createdUserId) as any)?.permission_version || 1;

    // 1. Role change increments version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'CHANGE_ROLE', newRole: 'SITE_MANAGER' }),
    }));
    const v1 = (getUserById(createdUserId) as any)?.permission_version;
    assert.ok(v1 > v0, `v1 (${v1}) must be > v0 (${v0})`);

    // 2. Deactivate increments version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'DEACTIVATE' }),
    }));
    const v2 = (getUserById(createdUserId) as any)?.permission_version;
    assert.ok(v2 > v1, `v2 (${v2}) must be > v1 (${v1})`);

    // 3. Activate increments version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: createdUserId, action: 'ACTIVATE' }),
    }));
    const v3 = (getUserById(createdUserId) as any)?.permission_version;
    assert.ok(v3 > v2, `v3 (${v3}) must be > v2 (${v2})`);
  });

  // ===========================================================================
  // 19. Audit events created correctly
  // ===========================================================================
  await t.test('19. audit events created correctly', async () => {
    const requiredActions = [
      'USER_CREATED',
      'USER_UPDATED',
      'USER_ACTIVATED',
      'USER_DEACTIVATED',
      'USERNAME_CHANGED',
      'ROLE_CHANGED',
      'RECOVERY_EMAIL_CHANGED',
      'PASSWORD_RESET',
    ];

    for (const act of requiredActions) {
      const row = db.prepare(`SELECT id, entity_id, action FROM audit_logs WHERE action = ?`).get(act) as any;
      assert.ok(row, `Mandated audit event '${act}' must exist in audit_logs`);
    }
  });

  // ===========================================================================
  // 20. No secret leakage in audit logs / API responses
  // ===========================================================================
  await t.test('20. no secret leakage in audit logs/API responses', async () => {
    setTestSession(clientPrimeSession);

    // 1. Audit logs check
    const recentAudits = db.prepare(`
      SELECT before_state, after_state FROM audit_logs 
      WHERE entity_id = ? 
      ORDER BY created_at DESC LIMIT 20
    `).all(createdUserId) as { before_state: string; after_state: string }[];

    for (const log of recentAudits) {
      const b = (log.before_state || '').toLowerCase();
      const a = (log.after_state || '').toLowerCase();

      assert.equal(b.includes('passwordplaintext'), false, 'No plaintext password in before_state');
      assert.equal(a.includes('passwordplaintext'), false, 'No plaintext password in after_state');
      assert.equal(b.includes('password_hash'), false, 'No password_hash in before_state');
      assert.equal(a.includes('password_hash'), false, 'No password_hash in after_state');
      assert.equal(b.includes('token_hash'), false, 'No token_hash in before_state');
      assert.equal(a.includes('token_hash'), false, 'No token_hash in after_state');
    }

    // 2. GET /api/users listing check
    const getRes = await getUsers(new Request('http://localhost:3001/api/users'));
    assert.equal(getRes.status, 200);
    const bodyText = await getRes.text();
    assert.equal(bodyText.includes('password_hash'), false, 'Listing must never leak password_hash');
    assert.equal(bodyText.includes('passwordHash'), false, 'Listing must never leak passwordHash');

    // 3. GET /api/users?id=... detail check
    const detailRes = await getUsers(new Request(`http://localhost:3001/api/users?id=${createdUserId}`));
    assert.equal(detailRes.status, 200);
    const detailText = await detailRes.text();
    assert.equal(detailText.includes('password_hash'), false, 'Detail must never leak password_hash');
    assert.equal(detailText.includes('passwordHash'), false, 'Detail must never leak passwordHash');
  });
});
