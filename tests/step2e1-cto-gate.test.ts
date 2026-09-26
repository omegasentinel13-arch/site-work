process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

import { 
  GET as getUsers, 
  POST as postUser, 
  PUT as putUser, 
  PATCH as patchUser, 
  DELETE as deleteUser 
} from '../app/api/users/route';
import { POST as loginUser } from '../app/api/auth/login/route';
import { UserSession, createSessionCookie, verifySessionToken } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { getUserById, getUserByUsername, countActiveAdmins } from '../lib/db/repositories/user-repo';
import { canManageAuthority, canAssignAuthorityTier, canDeleteUser } from '../lib/auth/authority';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2E.1: Targeted User Lifecycle Security Gate (CTO Final Freeze Check)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Clean up any existing test entities in test DB
  const filter = `SELECT id FROM users WHERE username LIKE 'gate.test%' OR username LIKE 'gate.qa%' OR username = 'gate.del.target'`;
  db.prepare(`DELETE FROM attendance_records WHERE id LIKE 'att-gate%' OR created_by IN (${filter})`).run();
  db.prepare(`DELETE FROM financial_transactions WHERE id LIKE 'fin-gate%' OR created_by IN (${filter})`).run();
  db.prepare(`DELETE FROM audit_logs WHERE user_id IN (${filter}) OR entity_id IN (${filter})`).run();
  db.prepare(`DELETE FROM user_permission_overrides WHERE user_id IN (${filter}) OR granted_by IN (${filter})`).run();
  db.prepare(`DELETE FROM site_users WHERE user_id IN (${filter})`).run();
  db.prepare(`DELETE FROM users WHERE username LIKE 'gate.test%' OR username LIKE 'gate.qa%' OR username = 'gate.del.target'`).run();

  // Ensure standard authority principals exist
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Operational Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
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

  // ===========================================================================
  // 1. PASSWORD RESET SECURITY
  // ===========================================================================
  await t.test('1. Password Reset Security: API responses, DB, audit logs, and session invalidation', async () => {
    setTestSession(clientPrimeSession);

    const plainOriginalPass = 'InitialPass2026!';
    const plainNewPass = 'NewSecurePass2026!';

    // Create target user
    const createRes = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate.test.pass',
        password: plainOriginalPass,
        fullName: 'Password Gate User',
        role: 'SITE_MANAGER',
        recoveryEmail: 'gate.pass@example.com',
        siteIds: ['site-1'],
      }),
    }));
    assert.equal(createRes.status, 200);
    const createdData = await createRes.json();
    const targetUserId = createdData.userId;

    // Verify initial login works
    const initLoginRes = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate.test.pass', password: plainOriginalPass }),
    }));
    assert.equal(initLoginRes.status, 200);

    const userBefore = getUserById(targetUserId)!;
    const tokenVersionBefore = userBefore.token_version;

    // Issue valid JWT token for target user
    const preResetToken = await createSessionCookie({
      userId: targetUserId,
      username: 'gate.test.pass',
      fullName: 'Password Gate User',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: tokenVersionBefore,
    });

    // Verify preResetToken is valid right now
    const verifiedBefore = await verifySessionToken(preResetToken);
    assert.ok(verifiedBefore, 'Pre-reset session token must be valid initially');

    // Perform Password Reset via API
    setTestSession(clientPrimeSession);
    const resetRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        action: 'RESET_PASSWORD',
        newPassword: plainNewPass,
        confirmPassword: plainNewPass,
      }),
    }));
    assert.equal(resetRes.status, 200);
    const resetData = await resetRes.json();
    const resetResponseStr = JSON.stringify(resetData);

    // 1. API response checks: No password, no password_hash, no reset token
    assert.ok(!resetResponseStr.includes(plainNewPass), 'Password must never be returned in API response');
    assert.ok(!resetResponseStr.includes('hash'), 'Hash keywords must not be exposed');
    assert.ok(!resetResponseStr.includes('$2a$') && !resetResponseStr.includes('$2b$'), 'Bcrypt hash must not be returned');
    assert.equal(resetData.password, undefined);
    assert.equal(resetData.password_hash, undefined);
    assert.equal(resetData.token, undefined);

    // 2. DB checks: Password not stored in plaintext, password_hash is valid bcrypt
    const rawRow = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(targetUserId) as { password_hash: string };
    assert.notEqual(rawRow.password_hash, plainNewPass, 'Password must NEVER be stored in plaintext');
    assert.ok(rawRow.password_hash.startsWith('$2'), 'Must be stored as bcrypt hash');
    assert.ok(bcrypt.compareSync(plainNewPass, rawRow.password_hash), 'Bcrypt hash must verify new password');

    // 3. Audit log checks: No password, no password_hash, no tokens
    const auditRow = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE entity_id = ? AND action = 'PASSWORD_RESET' 
      ORDER BY created_at DESC LIMIT 1
    `).get(targetUserId) as any;
    assert.ok(auditRow, 'PASSWORD_RESET audit log must be created');
    const auditStr = JSON.stringify(auditRow);
    assert.ok(!auditStr.includes(plainNewPass), 'Plain password must never be in audit log');
    assert.ok(!auditStr.includes(rawRow.password_hash), 'Password hash must never be in audit log');
    assert.ok(!auditStr.includes('$2a$') && !auditStr.includes('$2b$'), 'Bcrypt hash pattern must not be in audit log');

    // 4. Session invalidation: token_version incremented, old token fails verification
    const userAfter = getUserById(targetUserId)!;
    assert.ok(userAfter.token_version > tokenVersionBefore, 'token_version must increment upon password reset');

    const verifiedAfter = await verifySessionToken(preResetToken);
    assert.equal(verifiedAfter, null, 'Old authentication token must become INVALID after password reset');

    // 5. New password works, old password no longer works
    const oldLoginFail = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate.test.pass', password: plainOriginalPass }),
    }));
    assert.equal(oldLoginFail.status, 401, 'Old password must no longer work');

    const newLoginSuccess = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate.test.pass', password: plainNewPass }),
    }));
    assert.equal(newLoginSuccess.status, 200, 'New password must work after reset');
  });

  // ===========================================================================
  // 2. DEACTIVATION SESSION REVOCATION
  // ===========================================================================
  await t.test('2. Deactivation Session Revocation: Instant lockout, persistent invalidation, and reactivation requirement', async () => {
    setTestSession(clientPrimeSession);

    // Create QA user
    const qaPass = 'QaPassword2026!';
    const createRes = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate.qa.deact',
        password: qaPass,
        fullName: 'QA Deactivation User',
        role: 'SITE_MANAGER',
        recoveryEmail: 'qa.deact@example.com',
        siteIds: ['site-1'],
      }),
    }));
    assert.equal(createRes.status, 200);
    const qaUserId = (await createRes.json()).userId;

    const qaUserBefore = getUserById(qaUserId)!;
    const tokenVersionInitial = qaUserBefore.token_version;

    // Issue valid authenticated session token
    const capturedToken = await createSessionCookie({
      userId: qaUserId,
      username: 'gate.qa.deact',
      fullName: 'QA Deactivation User',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: tokenVersionInitial,
    });

    const activeSession = await verifySessionToken(capturedToken);
    assert.ok(activeSession, 'Captured session must be active before deactivation');

    // Deactivate user from authorized Client Prime account
    setTestSession(clientPrimeSession);
    const deactRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: qaUserId,
        action: 'DEACTIVATE',
      }),
    }));
    assert.equal(deactRes.status, 200);

    // Immediately verify with previously captured session:
    // A. verifySessionToken fails (is_active is 0 and token_version incremented)
    const deactVerified = await verifySessionToken(capturedToken);
    assert.equal(deactVerified, null, 'Captured session must be immediately rejected when user is deactivated');

    // B. Evaluator blocks access with ACCOUNT_INACTIVE
    const evalResult = canAccess({
      session: {
        userId: qaUserId,
        username: 'gate.qa.deact',
        fullName: 'QA Deactivation User',
        role: 'SITE_MANAGER',
        isActive: false,
        assignedSiteIds: ['site-1'],
        tokenVersion: tokenVersionInitial,
      },
      page: 'PAGE_DASHBOARD',
      action: 'VIEW',
    });
    assert.equal(evalResult.allowed, false);
    assert.equal(evalResult.ruleSource, 'ACCOUNT_INACTIVE');

    // C. Login attempt is blocked
    const deactLogin = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate.qa.deact', password: qaPass }),
    }));
    assert.equal(deactLogin.status, 403, 'Login must be blocked while deactivated');

    // Reactivate user from authorized Prime
    setTestSession(clientPrimeSession);
    const reactRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: qaUserId,
        action: 'ACTIVATE',
      }),
    }));
    assert.equal(reactRes.status, 200);

    // D. Verify old session does NOT automatically regain authorization
    const oldSessionAfterReactivation = await verifySessionToken(capturedToken);
    assert.equal(oldSessionAfterReactivation, null, 'Old session must NOT regain authorization because token_version was incremented');

    // E. New login succeeds and creates fresh, valid session
    const newLoginRes = await loginUser(new Request('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gate.qa.deact', password: qaPass }),
    }));
    assert.equal(newLoginRes.status, 200, 'Reactivated user must be able to log in anew');
  });

  // ===========================================================================
  // 3. DELETE /api/users SAFETY AUDIT (Cases A through E + Hierarchy Protection)
  // ===========================================================================
  await t.test('3. DELETE /api/users Safety Audit: Lifecycle protection, audit retention, and hierarchy bounds', async () => {
    // Setup target user with history
    const targetUserId = 'gate-del-target-user';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'gate.del.target', 'hash', 'Delete Audit User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(targetUserId);

    // Case A: User with attendance history -> DELETE blocked
    db.prepare(`
      INSERT INTO attendance_records (id, site_id, date, role_id, rate_snapshot_paise, full_day_count, half_day_count, total_workers, worker_days, total_cost_paise, created_by, created_at)
      VALUES ('att-gate-1', 'site-1', '2026-12-01', 'role-mason', 50000, 1, 0, 1, 1.0, 50000, ?, datetime('now'))
    `).run(targetUserId);

    setTestSession(superiorPrimeSession);
    const delCaseARes = await deleteUser(new Request(`http://localhost:3001/api/users?id=${targetUserId}`, { method: 'DELETE' }));
    assert.equal(delCaseARes.status, 400);
    const dataA = await delCaseARes.json();
    assert.ok(dataA.error && dataA.error.includes('attendance'), `Case A expected attendance error, got: ${JSON.stringify(dataA)}`);

    // Clean up attendance record
    db.prepare(`DELETE FROM attendance_records WHERE id = 'att-gate-1'`).run();

    // Case B: User with finance history -> DELETE blocked
    db.prepare(`
      INSERT INTO financial_transactions (id, site_id, date, type, amount_paise, description, created_by, created_at)
      VALUES ('fin-gate-1', 'site-1', '2026-12-01', 'CREDIT', 10000, 'Gate test expense', ?, datetime('now'))
    `).run(targetUserId);

    const delCaseBRes = await deleteUser(new Request(`http://localhost:3001/api/users?id=${targetUserId}`, { method: 'DELETE' }));
    assert.equal(delCaseBRes.status, 400);
    const dataB = await delCaseBRes.json();
    assert.ok(dataB.error.includes('financial'), 'Must block deleting user with financial history');

    // Clean up finance record
    db.prepare(`DELETE FROM financial_transactions WHERE id = 'fin-gate-1'`).run();

    // Case C: User with site membership -> verify site assignment cleanup & user deletion
    db.prepare(`INSERT OR REPLACE INTO site_users (id, site_id, user_id, created_at) VALUES ('su-gate-1', 'site-1', ?, datetime('now'))`).run(targetUserId);
    assert.equal((db.prepare(`SELECT count(*) as c FROM site_users WHERE user_id = ?`).get(targetUserId) as any).c, 1);

    // Case D: User with audit references -> historical audit logs retained with user_id disassociated to NULL
    db.prepare(`
      INSERT OR REPLACE INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES ('audit-gate-hist-1', 'SECURITY', ?, 'USER_UPDATED', NULL, ?, '{}', '{}', datetime('now'))
    `).run(targetUserId, targetUserId);

    // Case E: User with no remaining operational records (attendance/finance) -> Successful safe deletion
    const delCaseERes = await deleteUser(new Request(`http://localhost:3001/api/users?id=${targetUserId}`, { method: 'DELETE' }));
    const dataE = await delCaseERes.json();
    assert.equal(delCaseERes.status, 200, `Case E delete failed: ${JSON.stringify(dataE)}`);

    // Verify user record is gone
    assert.equal(getUserById(targetUserId), null);

    // Verify site_users was cleaned up and not orphaned
    assert.equal((db.prepare(`SELECT count(*) as c FROM site_users WHERE user_id = ?`).get(targetUserId) as any).c, 0);

    // Verify historical audit log was PRESERVED and NOT deleted, with user_id safely set to NULL
    const histAudit = db.prepare(`SELECT * FROM audit_logs WHERE id = 'audit-gate-hist-1'`).get() as any;
    assert.ok(histAudit, 'Audit log must be preserved');
    assert.equal(histAudit.user_id, null, 'Audit log user_id must be set to NULL');
    assert.equal(histAudit.entity_id, targetUserId, 'Audit log entity_id must remain preserved');

    // Verify USER_DELETE audit record was recorded
    const delAudit = db.prepare(`SELECT * FROM audit_logs WHERE action = 'USER_DELETE' AND entity_id = ?`).get(targetUserId) as any;
    assert.ok(delAudit, 'USER_DELETE audit event must be logged');

    // Hierarchy boundary checks on DELETE:
    // 1. Client Prime cannot delete Superior Prime (404)
    setTestSession(clientPrimeSession);
    const cpDelSup = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-admin-1', { method: 'DELETE' }));
    assert.equal(cpDelSup.status, 404, 'Client Prime cannot delete Superior Prime');

    // 2. Standard Admin cannot delete Client Prime (403)
    setTestSession(standardAdminSession);
    const saDelCp = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-client-prime-1', { method: 'DELETE' }));
    assert.equal(saDelCp.status, 403, 'Standard Admin cannot delete Client Prime');

    // 3. Engineer cannot use DELETE (403)
    setTestSession(operationalEngineerSession);
    const engDel = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-view-1', { method: 'DELETE' }));
    assert.equal(engDel.status, 403, 'Engineer cannot delete users');

    // 4. Viewer cannot use DELETE (403)
    setTestSession(operationalViewerSession);
    const viewDel = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-eng-1', { method: 'DELETE' }));
    assert.equal(viewDel.status, 403, 'Viewer cannot delete users');
  });

  // ===========================================================================
  // 4. USER IDENTITY INVARIANTS
  // ===========================================================================
  await t.test('4. User Identity Invariants: user.id, ownership, and history remain immutable across lifecycle edits', async () => {
    setTestSession(clientPrimeSession);

    // Create user
    const createRes = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate.test.invar',
        password: 'Password123!',
        fullName: 'Original Invariant Name',
        role: 'SITE_MANAGER',
        recoveryEmail: 'invar.orig@example.com',
        siteIds: ['site-1'],
      }),
    }));
    assert.equal(createRes.status, 200);
    const targetUserId = (await createRes.json()).userId;

    // Attach attendance, financial, and audit records
    db.prepare(`
      INSERT INTO attendance_records (id, site_id, date, role_id, rate_snapshot_paise, full_day_count, half_day_count, total_workers, worker_days, total_cost_paise, created_by, created_at)
      VALUES ('att-gate-invar', 'site-1', '2026-12-02', 'role-mason', 50000, 1, 0, 1, 1.0, 50000, ?, datetime('now'))
    `).run(targetUserId);

    db.prepare(`
      INSERT INTO financial_transactions (id, site_id, date, type, amount_paise, description, created_by, created_at)
      VALUES ('fin-gate-invar', 'site-1', '2026-12-02', 'CREDIT', 25000, 'Invariant verification expense', ?, datetime('now'))
    `).run(targetUserId);

    // 1. Full-name change
    await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetUserId, fullName: 'Renamed Invariant Name', role: 'SITE_MANAGER' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);

    // 2. Username change
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId, action: 'CHANGE_USERNAME', newUsername: 'gate.test.invar2' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);
    assert.equal(getUserById(targetUserId)?.username, 'gate.test.invar2');

    // 3. Role change
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId, action: 'CHANGE_ROLE', newRole: 'VIEWER' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);

    // 4. Recovery email change
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId, action: 'CHANGE_RECOVERY_EMAIL', newRecoveryEmail: 'invar.updated@example.com' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);

    // 5. Deactivation
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId, action: 'DEACTIVATE' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);

    // 6. Activation
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId, action: 'ACTIVATE' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);

    // 7. Password reset
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId, action: 'RESET_PASSWORD', newPassword: 'BrandNewPass2026!' }),
    }));
    assert.equal(getUserById(targetUserId)?.id, targetUserId);

    // Verify ownership records remain 100% unchanged
    const attRow = db.prepare(`SELECT created_by FROM attendance_records WHERE id = 'att-gate-invar'`).get() as any;
    assert.equal(attRow.created_by, targetUserId);

    const finRow = db.prepare(`SELECT created_by FROM financial_transactions WHERE id = 'fin-gate-invar'`).get() as any;
    assert.equal(finRow.created_by, targetUserId);

    const siteUserRows = db.prepare(`SELECT site_id FROM site_users WHERE user_id = ?`).all(targetUserId) as any[];
    assert.equal(siteUserRows.length, 1);
    assert.equal(siteUserRows[0].site_id, 'site-1');
  });

  // ===========================================================================
  // 5. PERMISSION VERSION BEHAVIOR
  // ===========================================================================
  await t.test('5. Permission Version Behavior: Intentional cache invalidation and preservation', async () => {
    setTestSession(clientPrimeSession);

    // Create user
    const createRes = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate.test.permver',
        password: 'Password123!',
        fullName: 'Perm Version User',
        role: 'SITE_MANAGER',
        recoveryEmail: 'permver@example.com',
        siteIds: ['site-1'],
      }),
    }));
    const targetUserId = (await createRes.json()).userId;

    const v0 = (getUserById(targetUserId) as any).permission_version;

    // A. Full-name-only change must NOT increment permission_version
    await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: targetUserId,
        fullName: 'Perm Version User Renamed',
        role: 'SITE_MANAGER',
      }),
    }));
    const vAfterName = (getUserById(targetUserId) as any).permission_version;
    assert.equal(vAfterName, v0, 'Full-name-only change must NOT invalidate permission cache');

    // B. Username-only change must NOT increment permission_version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        action: 'CHANGE_USERNAME',
        newUsername: 'gate.test.permver2',
      }),
    }));
    const vAfterUsername = (getUserById(targetUserId) as any).permission_version;
    assert.equal(vAfterUsername, v0, 'Username-only change must NOT invalidate permission cache');

    // C. Role change MUST increment permission_version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        action: 'CHANGE_ROLE',
        newRole: 'VIEWER',
      }),
    }));
    const vAfterRole = (getUserById(targetUserId) as any).permission_version;
    assert.ok(vAfterRole > v0, 'Role change MUST increment permission_version');

    // D. Site assignment change MUST increment permission_version
    await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: targetUserId,
        fullName: 'Perm Version User Renamed',
        role: 'VIEWER',
        siteIds: ['site-1', 'site-2'],
      }),
    }));
    const vAfterSites = (getUserById(targetUserId) as any).permission_version;
    assert.ok(vAfterSites > vAfterRole, 'Site assignment change MUST increment permission_version');

    // E. Deactivation MUST increment permission_version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        action: 'DEACTIVATE',
      }),
    }));
    const vAfterDeact = (getUserById(targetUserId) as any).permission_version;
    assert.ok(vAfterDeact > vAfterSites, 'Deactivation MUST increment permission_version');

    // F. Activation MUST increment permission_version
    await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: targetUserId,
        action: 'ACTIVATE',
      }),
    }));
    const vAfterAct = (getUserById(targetUserId) as any).permission_version;
    assert.ok(vAfterAct > vAfterDeact, 'Activation MUST increment permission_version');
  });

  // ===========================================================================
  // 6. PRIME SECURITY & HIERARCHY IMMUTABILITY
  // ===========================================================================
  await t.test('6. Prime Security: Complete immunity of Superior Prime and tier boundaries', async () => {
    // 1. Client Prime direct API attempts against Superior Prime
    setTestSession(clientPrimeSession);

    // Discovery attempt: GET /api/users
    const listRes = await getUsers(new Request('http://localhost:3001/api/users'));
    assert.equal(listRes.status, 200);
    const usersList = (await listRes.json()).users as any[];
    assert.ok(!usersList.some(u => u.id === 'usr-admin-1' || u.username === 'Iamadmin'), 'Superior Prime must NOT be discovered in listing');

    // Query attempt: GET /api/users?id=usr-admin-1
    const singleRes = await getUsers(new Request('http://localhost:3001/api/users?id=usr-admin-1'));
    assert.equal(singleRes.status, 404, 'Superior Prime direct query must return 404');

    // Modify attempt: PUT
    const putRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'usr-admin-1', fullName: 'Hacked Sup Name', role: 'ADMIN' }),
    }));
    assert.equal(putRes.status, 404);

    // Change username attempt
    const patchUserRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-admin-1', action: 'CHANGE_USERNAME', newUsername: 'hacked.sup' }),
    }));
    assert.equal(patchUserRes.status, 404);

    // Change recovery email attempt
    const patchEmailRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-admin-1', action: 'CHANGE_RECOVERY_EMAIL', newRecoveryEmail: 'hacked@sup.com' }),
    }));
    assert.equal(patchEmailRes.status, 404);

    // Reset password attempt
    const patchPassRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-admin-1', action: 'RESET_PASSWORD', newPassword: 'HackedPass2026!' }),
    }));
    assert.equal(patchPassRes.status, 404);

    // Change role attempt
    const patchRoleRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-admin-1', action: 'CHANGE_ROLE', newRole: 'VIEWER' }),
    }));
    assert.equal(patchRoleRes.status, 404);

    // Deactivate attempt
    const patchDeactRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'usr-admin-1', action: 'DEACTIVATE' }),
    }));
    assert.equal(patchDeactRes.status, 404);

    // Delete attempt
    const delRes = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-admin-1', { method: 'DELETE' }));
    assert.equal(delRes.status, 404);

    // 2. Standard Admin hierarchy bounds
    setTestSession(standardAdminSession);

    // Modifying Client Prime returns 403
    const stdModCp = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'usr-client-prime-1', fullName: 'Hacked CP', role: 'ADMIN' }),
    }));
    assert.equal(stdModCp.status, 403);

    // Self-promotion to Client Prime returns 403
    const stdPromote = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'usr-std-admin-1', fullName: 'Standard Admin', role: 'ADMIN', authorityTier: 'CLIENT_PRIME' }),
    }));
    assert.equal(stdPromote.status, 403);

    // Creating Prime user returns 403
    const stdCreatePrime = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate.fake.prime',
        password: 'Password123!',
        fullName: 'Fake Prime',
        role: 'ADMIN',
        authorityTier: 'CLIENT_PRIME',
      }),
    }));
    assert.equal(stdCreatePrime.status, 403);

    // 3. Site Manager & Viewer have zero mutation capability
    for (const testSession of [operationalEngineerSession, operationalViewerSession]) {
      setTestSession(testSession);

      const pRes = await postUser(new Request('http://localhost:3001/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'gate.fail', password: 'Password123!', fullName: 'Fail', role: 'VIEWER' }),
      }));
      assert.equal(pRes.status, 403);

      const uRes = await putUser(new Request('http://localhost:3001/api/users', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'usr-view-1', fullName: 'Fail', role: 'VIEWER' }),
      }));
      assert.equal(uRes.status, 403);

      const dRes = await deleteUser(new Request('http://localhost:3001/api/users?id=usr-view-1', { method: 'DELETE' }));
      assert.equal(dRes.status, 403);
    }
  });

  // ===========================================================================
  // 7. SECRET LEAKAGE VERIFICATION (All endpoints and audit logs)
  // ===========================================================================
  await t.test('7. Secret Leakage Verification: Zero passwords, hashes, tokens, or JWTs in responses or audit', async () => {
    setTestSession(clientPrimeSession);

    const checkNoSecrets = (str: string, label: string) => {
      assert.ok(!str.includes('password_hash'), `${label} must not leak 'password_hash' key`);
      assert.ok(!str.includes('$2a$') && !str.includes('$2b$'), `${label} must not leak bcrypt hash strings`);
      assert.ok(!str.includes('SuperSecret123!'), `${label} must not leak plaintext password`);
      assert.ok(!str.includes('reset_token'), `${label} must not leak reset tokens`);
      assert.ok(!str.includes('jwt') && !str.includes('Bearer'), `${label} must not leak JWT or bearer secrets`);
    };

    // 1. GET /api/users
    const getList = await getUsers(new Request('http://localhost:3001/api/users'));
    const listJsonStr = JSON.stringify(await getList.json());
    checkNoSecrets(listJsonStr, 'GET /api/users');

    // 2. GET /api/users?id=usr-client-prime-1
    const getSingle = await getUsers(new Request('http://localhost:3001/api/users?id=usr-client-prime-1'));
    const singleJsonStr = JSON.stringify(await getSingle.json());
    checkNoSecrets(singleJsonStr, 'GET /api/users?id=...');

    // 3. POST /api/users
    const postRes = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate.test.leak',
        password: 'SuperSecret123!',
        fullName: 'Secret Leak Test User',
        role: 'SITE_MANAGER',
      }),
    }));
    const postJsonStr = JSON.stringify(await postRes.json());
    checkNoSecrets(postJsonStr, 'POST /api/users');
    const leakUserId = (JSON.parse(postJsonStr)).userId;

    // 4. PUT /api/users
    const putRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: leakUserId, fullName: 'Updated Leak Test User', role: 'SITE_MANAGER' }),
    }));
    const putJsonStr = JSON.stringify(await putRes.json());
    checkNoSecrets(putJsonStr, 'PUT /api/users');

    // 5. PATCH /api/users
    const patchRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: leakUserId, action: 'CHANGE_USERNAME', newUsername: 'gate.test.leak2' }),
    }));
    const patchJsonStr = JSON.stringify(await patchRes.json());
    checkNoSecrets(patchJsonStr, 'PATCH /api/users');

    // 6. Inspect recent audit_logs for leakUserId
    const auditRows = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ?`).all(leakUserId) as any[];
    assert.ok(auditRows.length >= 2, 'Audit records must exist');
    for (const row of auditRows) {
      const rowStr = JSON.stringify(row);
      checkNoSecrets(rowStr, `audit_log id=${row.id}`);
    }
  });
});
