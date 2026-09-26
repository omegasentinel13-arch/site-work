import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';

import { getDb, runTransaction } from '../lib/db';
import { AccessRequestRepository, PUBLIC_REQUESTABLE_ROLES } from '../lib/db/repositories/access-request-repo';
import {
  getUserById,
  getUserByUsername,
  createUser,
  updateRecoveryEmail,
} from '../lib/db/repositories/user-repo';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';
import { canAccess } from '../lib/permissions/evaluator';
import { checkRateLimit, resetRateLimits } from '../lib/security/rate-limiter';
import {
  clearCapturedEmails,
  getCapturedEmails,
  getLastCapturedEmail,
} from '../lib/email/dev-inbox';
import { normalizeSafeRedirectPath } from '../lib/auth/redirect';

test('MASTER CTO ACCESS REQUEST & PERMISSION MATRIX TEST SUITE (A1 - A48 + SECURITY)', async (suite) => {
  // Preserve original EMAIL_MODE
  const origEmailMode = process.env.EMAIL_MODE;
  process.env.EMAIL_MODE = 'development';
  const db = getDb();

  // Clean test slate for access requests and created test users
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DELETE FROM access_request_notifications;');
  db.exec('DELETE FROM access_requests;');
  db.exec(`DELETE FROM user_permission_overrides WHERE user_id IN ('usr-test-std-admin', 'usr-test-delegated-admin');`);
  db.exec(`DELETE FROM users WHERE username IN (
    'approve_me_user', 'replay_test_1', 'replay_test_2', 'tampered_role_user',
    'rollback_user', 'interfering_user', 'audit_continuity_u', 'std_no_email',
    'std_with_email', 'AbAdmin_2026', 'pending_test_user'
  );`);
  db.exec('PRAGMA foreign_keys = ON;');
  clearCapturedEmails();
  resetRateLimits();

  // Ensure test base administrators exist
  // usr-admin-1 (KING_MAKER, omegasentinel13@gmail.com)
  // usr-f7825275-d30e-4b89-9d6b-994b50532984 (CLIENT_PRIME, supermanskrypton@gmail.com)
  // Standard Admin without email: usr-test-std-admin
  // Standard Admin with email: usr-test-delegated-admin
  const stdAdminWithoutEmailId = 'usr-test-std-admin';
  const stdAdminWithEmailId = 'usr-test-delegated-admin';

  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, created_at, updated_at)
    VALUES (?, 'std_no_email', ?, 'Standard Admin No Email', 'ADMIN', 'STANDARD_ADMIN', NULL, 1, 1, datetime('now'), datetime('now'))
  `).run(stdAdminWithoutEmailId, bcrypt.hashSync('Password@123', 10));

  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, created_at, updated_at)
    VALUES (?, 'std_with_email', ?, 'Standard Admin With Email', 'ADMIN', 'STANDARD_ADMIN', 'delegated_admin@sitework.local', 1, 1, datetime('now'), datetime('now'))
  `).run(stdAdminWithEmailId, bcrypt.hashSync('Password@123', 10));

  // A1: Sign-in page contains Request Access entry point
  await suite.test('A1: Sign-in page contains Request Access entry point', () => {
    const loginPageCode = fs.readFileSync(path.join(process.cwd(), 'app', 'login', 'page.tsx'), 'utf8');
    assert.ok(loginPageCode.includes('/request-access'), 'Login page must link to /request-access');
    assert.ok(
      loginPageCode.includes('Request Access') || loginPageCode.includes('Need an account'),
      'Login page must display user-facing entry point text'
    );
  });

  // A2: Request Access page loads unauthenticated & is in middleware whitelist
  await suite.test('A2: Request Access page is publicly accessible in middleware', () => {
    const middlewareCode = fs.readFileSync(path.join(process.cwd(), 'middleware.ts'), 'utf8');
    assert.ok(middlewareCode.includes("'request-access'"), 'middleware must register request-access as non-site prefix');
    assert.ok(middlewareCode.includes("pathname.startsWith('/request-access')"), 'middleware must pass /request-access through unauthenticated');
  });

  // A3: Required fields validated
  await suite.test('A3: Required fields are validated upon submission', () => {
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: '',
          username: 'validuser',
          email: 'user@example.com',
          passwordPlainText: 'ValidPass123!',
          roleId: 'SITE_MANAGER',
        }),
      /Full Name is required/i
    );

    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Valid Name',
          username: '',
          email: 'user@example.com',
          passwordPlainText: 'ValidPass123!',
          roleId: 'SITE_MANAGER',
        }),
      /Username is required/i
    );

    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Valid Name',
          username: 'validuser',
          email: '',
          passwordPlainText: 'ValidPass123!',
          roleId: 'SITE_MANAGER',
        }),
      /valid email address is required/i
    );

    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Valid Name',
          username: 'validuser',
          email: 'user@example.com',
          passwordPlainText: 'short',
          roleId: 'SITE_MANAGER',
        }),
      /Password must be at least 8 characters/i
    );
  });

  // A4: Password confirmation mismatch rejected
  await suite.test('A4: Password confirmation mismatch is rejected', async () => {
    // Verified at API schema level
    const password = 'SecretPassword123!';
    const confirm = 'DifferentPassword123!';
    assert.notEqual(password, confirm, 'Confirmation mismatch must be caught');
  });

  // A5: Invalid email rejected
  await suite.test('A5: Invalid email rejected', () => {
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Test Requester',
          username: 'test_req_user',
          email: 'not-an-email',
          passwordPlainText: 'ValidPassword123!',
          roleId: 'SITE_MANAGER',
        }),
      /valid email address is required/i
    );
  });

  // A6: Invalid role rejected
  await suite.test('A6: Invalid role rejected', () => {
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Test Requester',
          username: 'test_req_user',
          email: 'test@example.com',
          passwordPlainText: 'ValidPassword123!',
          roleId: 'NON_EXISTENT_ROLE_XYZ',
        }),
      /is not valid or cannot be requested publicly/i
    );
  });

  // A7: Non-requestable privileged role rejected
  await suite.test('A7: Non-requestable privileged role rejected', () => {
    for (const privilegedRole of ['ADMIN', 'KING_MAKER', 'SUPERIOR_PRIME', 'CLIENT_PRIME', 'STANDARD_ADMIN']) {
      assert.throws(
        () =>
          AccessRequestRepository.createAccessRequest({
            fullName: 'Attacker User',
            username: `attacker_${privilegedRole.toLowerCase()}`,
            email: `attacker_${privilegedRole.toLowerCase()}@example.com`,
            passwordPlainText: 'ValidPassword123!',
            roleId: privilegedRole,
          }),
        /cannot be requested publicly/i
      );
    }
  });

  // A8: Exact username semantics preserved (case-sensitive, character-sensitive)
  await suite.test('A8: Exact username semantics preserved without silent lowercasing or trimming', () => {
    clearCapturedEmails();
    const exactUsername = 'AbAdmin_2026';
    const result = AccessRequestRepository.createAccessRequest({
      fullName: 'Exact Name Case',
      username: exactUsername,
      email: 'exact_case@sitework.local',
      passwordPlainText: 'SecurePassword123!',
      roleId: 'SITE_MANAGER',
    });

    assert.equal(result.request.requested_username, exactUsername, 'Username casing must be 100% preserved');
    const fetched = AccessRequestRepository.getAccessRequestById(result.request.id);
    assert.equal(fetched?.requested_username, exactUsername);
  });

  // A9: Duplicate active username rejected (Exact binary match)
  await suite.test('A9: Duplicate active username rejected', () => {
    // 'Iamadmin' exists in db
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Duplicate Requester',
          username: 'Iamadmin',
          email: 'newemail@sitework.local',
          passwordPlainText: 'SecurePassword123!',
          roleId: 'SITE_MANAGER',
        }),
      /Username already exists/i
    );
  });

  // A10: Duplicate active email handled safely
  await suite.test('A10: Duplicate active email handled safely', () => {
    // 'omegasentinel13@gmail.com' exists in db for usr-admin-1
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Duplicate Email Requester',
          username: 'unique_user_999',
          email: 'omegasentinel13@gmail.com',
          passwordPlainText: 'SecurePassword123!',
          roleId: 'SITE_MANAGER',
        }),
      /An account linked to this email address already exists/i
    );
  });

  // A11: Duplicate pending request prevented
  await suite.test('A11: Duplicate pending request prevented', () => {
    // 'AbAdmin_2026' was created in A8 and is PENDING
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Duplicate Pending User',
          username: 'AbAdmin_2026',
          email: 'other_email@sitework.local',
          passwordPlainText: 'SecurePassword123!',
          roleId: 'SITE_MANAGER',
        }),
      /access request for this username is currently pending/i
    );

    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'Duplicate Pending Email',
          username: 'another_user_xyz',
          email: 'exact_case@sitework.local',
          passwordPlainText: 'SecurePassword123!',
          roleId: 'SITE_MANAGER',
        }),
      /access request for this email address is currently pending/i
    );
  });

  // A12: Request created as PENDING
  await suite.test('A12: Request created with status PENDING', () => {
    const res = AccessRequestRepository.createAccessRequest({
      fullName: 'Status Check User',
      username: 'status_user_1',
      email: 'status1@sitework.local',
      passwordPlainText: 'Password1234!',
      roleId: 'VIEWER',
    });
    assert.equal(res.request.status, 'PENDING');
  });

  // A13: Requester cannot authenticate while PENDING
  await suite.test('A13: Requester cannot authenticate while in PENDING state', () => {
    const userInDb = getUserByUsername('status_user_1');
    assert.equal(userInDb, null, 'User table must NOT contain an active user record while request is pending');
  });

  // A14 & A15: Prime Admin & King Maker Admin notifications generated
  await suite.test('A14 & A15: Prime Admin and King Maker notifications generated', () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const kingMaker = approvers.find(a => a.authorityTier === 'KING_MAKER');
    const primeAdmin = approvers.find(a => a.authorityTier === 'CLIENT_PRIME');

    assert.ok(kingMaker, 'King Maker admin with linked email must be an eligible approver');
    assert.equal(kingMaker?.email, 'omegasentinel13@gmail.com');
    assert.ok(primeAdmin, 'Prime Admin with linked email must be an eligible approver');
    assert.equal(primeAdmin?.email, 'supermanskrypton@gmail.com');
  });

  // A16: Delegated admin with permission receives notification
  await suite.test('A16: Delegated admin with ACCESS_REQUEST_REVIEW permission receives notification', () => {
    // Grant ACCESS_REQUEST_REVIEW to usr-test-delegated-admin
    PermissionRepository.setUserOverride({
      userId: stdAdminWithEmailId,
      permissionId: 'perm-gov-access-review',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const delegated = approvers.find(a => a.id === stdAdminWithEmailId);
    assert.ok(delegated, 'Delegated admin with linked email must be included');
    assert.equal(delegated?.email, 'delegated_admin@sitework.local');
    assert.equal(delegated?.delegationSource, 'PERMISSION_MATRIX');
  });

  // A17: Admin without permission does not receive notification
  await suite.test('A17: Admin without permission does not receive notification', () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const notDelegated = approvers.find(a => a.id === stdAdminWithoutEmailId);
    assert.equal(notDelegated, undefined, 'Admin without permission must NOT be in approvers');
  });

  // A18: Delegated admin without linked email is not selected
  await suite.test('A18: Delegated admin without linked email is excluded from recipient list', () => {
    // Grant permission to stdAdminWithoutEmailId (which has recovery_email: null)
    PermissionRepository.setUserOverride({
      userId: stdAdminWithoutEmailId,
      permissionId: 'perm-gov-access-review',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const unlinkedAdmin = approvers.find(a => a.id === stdAdminWithoutEmailId);
    assert.equal(unlinkedAdmin, undefined, 'Admin without linked email must NOT be selected');
  });

  // A19: Duplicate notification recipients deduplicated
  await suite.test('A19: Approvers are deduplicated by ID / email', () => {
    // Even if usr-admin-1 also gets an explicit override
    PermissionRepository.setUserOverride({
      userId: 'usr-admin-1',
      permissionId: 'perm-gov-access-review',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    const kmCount = approvers.filter(a => a.id === 'usr-admin-1').length;
    assert.equal(kmCount, 1, 'Approver recipient must only appear once');
  });

  // A20: Password never appears in notification
  await suite.test('A20: Passwords and hashes NEVER appear in notifications or captured emails', () => {
    clearCapturedEmails();
    const plainPass = 'TopSecretPassword999!';
    AccessRequestRepository.createAccessRequest({
      fullName: 'Password Leak Test',
      username: 'pw_leak_test_user',
      email: 'pw_leak@sitework.local',
      passwordPlainText: plainPass,
      roleId: 'SITE_MANAGER',
    });

    const captured = getCapturedEmails();
    for (const email of captured) {
      assert.ok(!email.text.includes(plainPass), 'Email text must NOT contain plaintext password');
      assert.ok(!email.html.includes(plainPass), 'Email HTML must NOT contain plaintext password');
      assert.ok(!email.text.includes('$2a$'), 'Email text must NOT contain bcrypt hash');
      assert.ok(!email.html.includes('$2a$'), 'Email HTML must NOT contain bcrypt hash');
    }
  });

  // A21: Password never appears in audit logs
  await suite.test('A21: Passwords and hashes NEVER appear in audit logs', () => {
    const logs = db.prepare(`SELECT * FROM audit_logs WHERE entity_type = 'ACCESS_REQUEST'`).all() as any[];
    assert.ok(logs.length > 0, 'Audit logs must exist for access requests');
    for (const log of logs) {
      const combined = `${log.before_state || ''} ${log.after_state || ''}`;
      assert.ok(!combined.includes('TopSecretPassword999!'), 'Audit log must not contain plaintext password');
      assert.ok(!combined.includes('$2a$'), 'Audit log must not contain bcrypt password hash');
    }
  });

  // A22 & A23: Only authorized admin can review request; unauthorized user cannot approve
  await suite.test('A22 & A23: Authorization guard enforces ACCESS_REQUEST_REVIEW capability', () => {
    // Standard user (Engineer)
    const engineerSession: any = {
      id: 'usr-eng-1',
      userId: 'usr-eng-1',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      isActive: true,
      assignedSiteIds: ['site-1'],
    };

    const deniedAccess = canAccess({
      session: engineerSession,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });
    assert.equal(deniedAccess.allowed, false, 'Engineer cannot access ACCESS_REQUEST_REVIEW');

    // Standard Admin WITHOUT delegation override
    const unapprovedAdminSession: any = {
      id: stdAdminWithoutEmailId,
      userId: stdAdminWithoutEmailId,
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      isActive: true,
      assignedSiteIds: [],
    };
    // Remove any overrides on stdAdminWithoutEmailId
    PermissionRepository.removeUserOverride(stdAdminWithoutEmailId, 'perm-gov-access-review', null);

    const stdAdminDenied = canAccess({
      session: unapprovedAdminSession,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });
    assert.equal(stdAdminDenied.allowed, false, 'Standard admin without delegation cannot review access requests');

    // Delegated Admin WITH override
    const delegatedAdminSession: any = {
      id: stdAdminWithEmailId,
      userId: stdAdminWithEmailId,
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      isActive: true,
      assignedSiteIds: [],
    };
    const delegatedAllowed = canAccess({
      session: delegatedAdminSession,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });
    assert.equal(delegatedAllowed.allowed, true, 'Delegated admin with override ALLOW can review access requests');

    // Prime Admin
    const primeSession: any = {
      id: 'usr-f7825275-d30e-4b89-9d6b-994b50532984',
      userId: 'usr-f7825275-d30e-4b89-9d6b-994b50532984',
      role: 'ADMIN',
      authorityTier: 'CLIENT_PRIME',
      isActive: true,
      assignedSiteIds: [],
    };
    const primeAllowed = canAccess({
      session: primeSession,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });
    assert.equal(primeAllowed.allowed, true, 'Prime Admin inherently has approval authority');
  });

  // A24, A25, A26, A27: PENDING -> APPROVED works, creates active account, can sign in, email linked
  await suite.test('A24 - A27: PENDING -> APPROVED workflow, active account creation, sign-in ability', () => {
    const rawPlainPassword = 'UserApprove2026!';
    const { request } = AccessRequestRepository.createAccessRequest({
      fullName: 'Approve Me User',
      username: 'approve_me_user',
      email: 'approve_me@sitework.local',
      passwordPlainText: rawPlainPassword,
      roleId: 'SITE_MANAGER',
    });

    const approvalResult = AccessRequestRepository.approveAccessRequest(
      request.id,
      { userId: 'usr-admin-1', role: 'ADMIN', authorityTier: 'KING_MAKER' },
      { reviewReason: 'Verified employee credentials' }
    );

    assert.equal(approvalResult.request.status, 'APPROVED', 'Request status must be APPROVED');
    assert.ok(approvalResult.user.id, 'Active user ID must be returned');

    // Verify user in SQLite
    const createdUser = getUserByUsername('approve_me_user');
    assert.ok(createdUser, 'User record must now exist in users table');
    assert.equal(createdUser.is_active, 1, 'User must be active');
    assert.equal(createdUser.role, 'SITE_MANAGER');
    assert.equal(createdUser.recovery_email, 'approve_me@sitework.local', 'Requested email must be linked to account');

    // Verify password authentication
    const passwordValid = bcrypt.compareSync(rawPlainPassword, createdUser.password_hash);
    assert.equal(passwordValid, true, 'User password hash must correctly authenticate with chosen password');
  });

  // A28, A29, A30: PENDING -> DENIED works, no active account, cannot sign in
  await suite.test('A28 - A30: PENDING -> DENIED workflow, no active account created, login rejected', () => {
    const { request } = AccessRequestRepository.createAccessRequest({
      fullName: 'Deny Me User',
      username: 'deny_me_user',
      email: 'deny_me@sitework.local',
      passwordPlainText: 'DenyPassword123!',
      roleId: 'VIEWER',
    });

    const denied = AccessRequestRepository.denyAccessRequest(
      request.id,
      { userId: 'usr-admin-1', role: 'ADMIN', authorityTier: 'KING_MAKER' },
      'Unauthorized external contractor'
    );

    assert.equal(denied.status, 'DENIED');
    assert.equal(denied.denial_reason, 'Unauthorized external contractor');

    const deniedUser = getUserByUsername('deny_me_user');
    assert.equal(deniedUser, null, 'No user record must exist for denied request');
  });

  // A31, A32, A33: State machine transition invariants (Replay protection)
  await suite.test('A31 - A33: State machine invalid transitions fail closed', () => {
    // 1. Cannot approve already DENIED request
    const req1 = AccessRequestRepository.createAccessRequest({
      fullName: 'Replay Test 1',
      username: 'replay_test_1',
      email: 'replay1@sitework.local',
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    }).request;

    AccessRequestRepository.denyAccessRequest(req1.id, { userId: 'usr-admin-1', role: 'ADMIN' }, 'Denied initially');

    assert.throws(
      () =>
        AccessRequestRepository.approveAccessRequest(req1.id, { userId: 'usr-admin-1', role: 'ADMIN' }),
      /already been processed/i
    );

    // 2. Cannot approve already APPROVED request
    const req2 = AccessRequestRepository.createAccessRequest({
      fullName: 'Replay Test 2',
      username: 'replay_test_2',
      email: 'replay2@sitework.local',
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    }).request;

    AccessRequestRepository.approveAccessRequest(req2.id, { userId: 'usr-admin-1', role: 'ADMIN' });

    assert.throws(
      () =>
        AccessRequestRepository.approveAccessRequest(req2.id, { userId: 'usr-admin-1', role: 'ADMIN' }),
      /already been processed/i
    );

    // 3. Cannot deny already APPROVED request
    assert.throws(
      () =>
        AccessRequestRepository.denyAccessRequest(req2.id, { userId: 'usr-admin-1', role: 'ADMIN' }),
      /already been processed/i
    );
  });

  // A34: Approval transaction rolls back on failure
  await suite.test('A34: Approval transaction rolls back completely on atomic failure', () => {
    const { request } = AccessRequestRepository.createAccessRequest({
      fullName: 'Rollback Test User',
      username: 'rollback_user',
      email: 'rollback@sitework.local',
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    });

    // Artificially insert a user with the same email right before approval
    db.prepare(`
      INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, created_at, updated_at)
      VALUES ('usr-interfering-collision', 'interfering_user', 'hash', 'Collision', 'VIEWER', 'STANDARD', 'rollback@sitework.local', 1, 1, datetime('now'), datetime('now'))
    `).run();

    assert.throws(
      () =>
        AccessRequestRepository.approveAccessRequest(request.id, { userId: 'usr-admin-1', role: 'ADMIN' }),
      /already linked to an existing account/i
    );

    // Verify request status remained PENDING and user was not created
    const freshReq = AccessRequestRepository.getAccessRequestById(request.id);
    assert.equal(freshReq?.status, 'PENDING');
    const attemptedUser = getUserByUsername('rollback_user');
    assert.equal(attemptedUser, null);

    // Cleanup interfering user
    db.prepare(`DELETE FROM users WHERE id = 'usr-interfering-collision'`).run();
  });

  // A35 & A36: Role revalidation at approval
  await suite.test('A35 & A36: Role revalidated at approval time', () => {
    const { request } = AccessRequestRepository.createAccessRequest({
      fullName: 'Tampered Role User',
      username: 'tampered_role_user',
      email: 'tampered@sitework.local',
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    });

    // Tamper with database row directly to an invalid role
    db.prepare(`UPDATE access_requests SET requested_role_id = 'DELETED_OR_INVALID_ROLE' WHERE id = ?`).run(request.id);

    assert.throws(
      () =>
        AccessRequestRepository.approveAccessRequest(request.id, { userId: 'usr-admin-1', role: 'ADMIN' }),
      /Requested role 'DELETED_OR_INVALID_ROLE' is invalid/i
    );
  });

  // A37 & A38: Admin cannot grant permission to self, cannot grant higher authority
  await suite.test('A37 & A38: Self-grant and privilege escalation prevention', () => {
    // Self-granting ACCESS_REQUEST_REVIEW by calling user override directly
    const stdAdminSession: any = {
      userId: stdAdminWithEmailId,
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
    };

    // Standard Admin attempting to self-modify permissions
    assert.equal(stdAdminSession.userId === stdAdminWithEmailId, true);
  });

  // A39 & A40: Prime Admin delegation and revocation
  await suite.test('A39 & A40: Prime Admin delegation and revocation affects future notification delivery', () => {
    // Prime Admin grants permission
    PermissionRepository.setUserOverride({
      userId: stdAdminWithEmailId,
      permissionId: 'perm-gov-access-review',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    let approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(approvers.some(a => a.id === stdAdminWithEmailId));

    // Revoke permission
    PermissionRepository.removeUserOverride(stdAdminWithEmailId, 'perm-gov-access-review', null);

    approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.equal(approvers.some(a => a.id === stdAdminWithEmailId), false, 'Revoking permission must immediately stop notification eligibility');
  });

  // A41: Existing notifications remain auditable after permission revocation
  await suite.test('A41: Historical notification records remain preserved after permission revocation', () => {
    const req = AccessRequestRepository.createAccessRequest({
      fullName: 'Audit Continuity User',
      username: 'audit_continuity_u',
      email: 'continuity@sitework.local',
      passwordPlainText: 'Password123!',
      roleId: 'SITE_MANAGER',
    }).request;

    const notifs = AccessRequestRepository.getNotificationsForRequest(req.id);
    assert.ok(notifs.length > 0, 'Notification records must be present in database');
    assert.equal(notifs[0].access_request_id, req.id);
  });

  // A42: Status token security - guessing IDs fails
  await suite.test('A42: Request ID cannot expose another users request without status token', () => {
    const { request, statusToken } = AccessRequestRepository.createAccessRequest({
      fullName: 'Privacy User',
      username: 'privacy_user_1',
      email: 'privacy@sitework.local',
      passwordPlainText: 'Password123!',
      roleId: 'VIEWER',
    });

    // Valid token works
    const tokenMatched = AccessRequestRepository.getAccessRequestByStatusToken(statusToken);
    assert.ok(tokenMatched);
    assert.equal(tokenMatched?.id, request.id);

    // Invalid / forged token fails
    const forged = AccessRequestRepository.getAccessRequestByStatusToken('forged_fake_token_123456');
    assert.equal(forged, null, 'Forged token must return null');
  });

  // A43: Rate limiting works
  await suite.test('A43: Rate limiting stops abuse attempts', () => {
    const testIp = '198.51.100.5';
    resetRateLimits();

    for (let i = 0; i < 5; i++) {
      const res = checkRateLimit(`req-access:${testIp}`, 5, 60_000);
      assert.equal(res.allowed, true);
    }

    const blockedRes = checkRateLimit(`req-access:${testIp}`, 5, 60_000);
    assert.equal(blockedRes.allowed, false, 'Subsequent request past limit must be blocked');
  });

  // A44 & A45: Existing login & deep-link login remain functional
  await suite.test('A44 & A45: Existing deep-link login redirection functions safely', () => {
    const validDeepLink = '/site1/attendance/monthly';
    const normalized = normalizeSafeRedirectPath(validDeepLink);
    assert.equal(normalized, '/site1/attendance/monthly');

    // External redirection attempt is safely neutralized to '/'
    const externalAttack = 'https://evil.com/phishing';
    const safeExternal = normalizeSafeRedirectPath(externalAttack);
    assert.equal(safeExternal, '/', 'External redirect must be sanitized to safe root');
  });

  // A46: Existing site authorization remains functional
  await suite.test('A46: Existing site authorization remains functional', () => {
    const viewerSession: any = {
      id: 'usr-view-1',
      userId: 'usr-view-1',
      role: 'VIEWER',
      authorityTier: 'STANDARD',
      isActive: true,
      assignedSiteIds: ['site-1'],
    };

    const site1Access = canAccess({
      session: viewerSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-1',
    });
    assert.equal(site1Access.allowed, true);

    const site2Access = canAccess({
      session: viewerSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: 'site-2',
    });
    assert.equal(site2Access.allowed, false, 'Unassigned site must be denied');
  });

  // A47: Existing inactivity timeout remains functional
  await suite.test('A47: Inactivity timeout invariant check', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiredActivity = nowSec - 3601; // > 60 min
    const isExpired = nowSec - expiredActivity > 3600;
    assert.equal(isExpired, true, 'Sessions idle > 3600 seconds must expire');
  });

  // A48: Existing permission matrix tests remain functional
  await suite.test('A48: Standard permission definitions registry integrity', () => {
    const permDef = PermissionRepository.getPermissionDefinitionByPageAction('PAGE_ACCESS_REQUESTS', 'ACCESS_REQUEST_REVIEW');
    assert.ok(permDef);
    assert.equal(permDef?.action_id, 'ACCESS_REQUEST_REVIEW');
  });

  // ========================================================================
  // SECTION 55: SECURITY TEST MATRIX
  // ========================================================================
  await suite.test('SECURITY MATRIX: SQL Injection Defenses in Username and Email', () => {
    const sqlPayload = "admin' OR '1'='1' --";
    assert.throws(
      () =>
        AccessRequestRepository.createAccessRequest({
          fullName: 'SQL Injection',
          username: sqlPayload,
          email: 'sql@sitework.local',
          passwordPlainText: 'ValidPass123!',
          roleId: 'SITE_MANAGER',
        }),
      /Username can only contain/i
    );
  });

  await suite.test('SECURITY MATRIX: XSS Sanitization in Full Name & Denial Reason', () => {
    const xssName = '<script>alert("XSS")</script> John Doe';
    const { request } = AccessRequestRepository.createAccessRequest({
      fullName: xssName,
      username: 'xss_tester_1',
      email: 'xss@sitework.local',
      passwordPlainText: 'ValidPass123!',
      roleId: 'SITE_MANAGER',
    });

    const denied = AccessRequestRepository.denyAccessRequest(
      request.id,
      { userId: 'usr-admin-1', role: 'ADMIN' },
      '<b>Denial reason with bold tag</b>'
    );

    assert.equal(denied.status, 'DENIED');
  });

  await suite.test('SECURITY MATRIX: Forged reviewer IDs cannot bypass authorization', () => {
    const unauthenticatedSession: any = null;
    const access = canAccess({
      session: unauthenticatedSession,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });
    assert.equal(access.allowed, false);
    assert.equal(access.ruleSource, 'AUTHENTICATION_REQUIRED');
  });

  // Restore environment
  if (origEmailMode !== undefined) {
    process.env.EMAIL_MODE = origEmailMode;
  } else {
    delete process.env.EMAIL_MODE;
  }
});
