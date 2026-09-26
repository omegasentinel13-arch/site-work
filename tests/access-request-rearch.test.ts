import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db';
import { AccessRequestRepository } from '../lib/db/repositories/access-request-repo';
import { getUserById, getUserByUsername, deleteUser } from '../lib/db/repositories/user-repo';
import { canAccess } from '../lib/permissions/evaluator';
import { REGISTERED_PAGES } from '../lib/permissions/registry';

test('ENTERPRISE ACCESS REQUEST GOVERNANCE RE-ARCHITECTURE SUITE', async (suite) => {
  const db = getDb();

  await suite.test('1. Approver resolution is 100% permission-driven (Zero hardcoded tiers/accounts)', () => {
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    
    // Both Iamadmin and abadmin hold perm-gov-access-review override and must be resolved
    const abadminApprover = approvers.find((a) => a.username.toLowerCase() === 'abadmin');
    const iamadminApprover = approvers.find((a) => a.username.toLowerCase() === 'iamadmin');

    assert.ok(abadminApprover, 'abadmin must be resolved as an eligible approver');
    assert.ok(iamadminApprover, 'Iamadmin must be resolved as an eligible approver');
    assert.equal(abadminApprover.delegationSource, 'PERMISSION_MATRIX');
    assert.equal(iamadminApprover.delegationSource, 'PERMISSION_MATRIX');
  });

  await suite.test('2. Dynamic email address updates reflect immediately without code or schema changes', () => {
    // Read original abadmin email
    const originalRow = db.prepare(`SELECT recovery_email FROM users WHERE username = 'abadmin'`).get() as { recovery_email: string | null };
    const originalEmail = originalRow.recovery_email;
    assert.ok(originalEmail, 'abadmin must have an initial recovery email');

    try {
      // Update abadmin email dynamically
      const newEmail = 'abadmin.new.governance@sitework.local';
      db.prepare(`UPDATE users SET recovery_email = ? WHERE username = 'abadmin'`).run(newEmail);

      const approversAfter = AccessRequestRepository.resolveAccessRequestApprovers();
      const abadminUpdated = approversAfter.find((a) => a.username.toLowerCase() === 'abadmin');
      assert.ok(abadminUpdated, 'abadmin must still be resolved');
      assert.equal(abadminUpdated.email, newEmail.toLowerCase(), 'Email must immediately reflect newly linked address');
    } finally {
      // Revert to original email
      db.prepare(`UPDATE users SET recovery_email = ? WHERE username = 'abadmin'`).run(originalEmail);
    }

    const approversReverted = AccessRequestRepository.resolveAccessRequestApprovers();
    const abadminReverted = approversReverted.find((a) => a.username.toLowerCase() === 'abadmin');
    assert.equal(abadminReverted?.email, originalEmail?.toLowerCase(), 'Email must revert back cleanly');
  });

  await suite.test('3. Prime Admin delegation to STAR-SCREW via Permission Matrix', () => {
    const starUser = db.prepare(`SELECT id, username, recovery_email FROM users WHERE username = 'STAR-SCREW'`).get() as {
      id: string;
      username: string;
      recovery_email: string | null;
    } | undefined;

    assert.ok(starUser, 'STAR-SCREW user must exist in users table');

    // Clean any previous overrides for STAR-SCREW
    db.prepare(`DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_id = 'perm-gov-access-review'`).run(starUser.id);
    db.prepare(`UPDATE users SET recovery_email = NULL WHERE id = ?`).run(starUser.id);

    // Initial check: STAR-SCREW should NOT be an approver
    let approvers = AccessRequestRepository.resolveAccessRequestApprovers();
    assert.ok(!approvers.some((a) => a.id === starUser.id), 'STAR-SCREW must not be an approver without permission and email');

    try {
      // Step A: Give STAR-SCREW the permission override, but no email
      db.prepare(`
        INSERT INTO user_permission_overrides (id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at)
        VALUES (?, ?, 'perm-gov-access-review', NULL, 'ALLOW', 'usr-f7825275-d30e-4b89-9d6b-994b50532984', datetime('now'), datetime('now'))
      `).run(`upo-${starUser.id}-perm-gov-access-review-test`, starUser.id);

      approvers = AccessRequestRepository.resolveAccessRequestApprovers();
      assert.ok(!approvers.some((a) => a.id === starUser.id), 'STAR-SCREW still needs a valid recovery_email to receive notifications');

      // Step B: Set STAR-SCREW recovery email
      const starEmail = 'star.screw.admin@sitework.local';
      db.prepare(`UPDATE users SET recovery_email = ? WHERE id = ?`).run(starEmail, starUser.id);

      approvers = AccessRequestRepository.resolveAccessRequestApprovers();
      const starApprover = approvers.find((a) => a.id === starUser.id);
      assert.ok(starApprover, 'STAR-SCREW must now be successfully resolved as an approver');
      assert.equal(starApprover.email, starEmail.toLowerCase());
      assert.equal(starApprover.delegationSource, 'PERMISSION_MATRIX');

      // Step C: Set permission effect to DENY
      db.prepare(`UPDATE user_permission_overrides SET effect = 'DENY' WHERE id = ?`).run(`upo-${starUser.id}-perm-gov-access-review-test`);
      approvers = AccessRequestRepository.resolveAccessRequestApprovers();
      assert.ok(!approvers.some((a) => a.id === starUser.id), 'When effect is DENY, user must be excluded');
    } finally {
      // Clean up test overrides
      db.prepare(`DELETE FROM user_permission_overrides WHERE id = ?`).run(`upo-${starUser.id}-perm-gov-access-review-test`);
      db.prepare(`UPDATE users SET recovery_email = NULL WHERE id = ?`).run(starUser.id);
    }
  });

  await suite.test('4. Deactivated and deleted accounts are strictly excluded from notifications', () => {
    const testAdminId = 'usr-test-deact-approver';
    const testEmail = 'deact.approver@sitework.local';

    // Insert active test admin with override and email
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, created_at, updated_at)
      VALUES (?, 'test_deact_approver', 'hash', 'Test Deact Approver', 'ADMIN', 'STANDARD_ADMIN', ?, 1, 1, datetime('now'), datetime('now'))
    `).run(testAdminId, testEmail);

    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, site_id, effect, granted_by, created_at, updated_at)
      VALUES (?, ?, 'perm-gov-access-review', NULL, 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(`upo-${testAdminId}-perm-gov-access-review`, testAdminId);

    try {
      let approvers = AccessRequestRepository.resolveAccessRequestApprovers();
      assert.ok(approvers.some((a) => a.id === testAdminId), 'Active admin must be resolved');

      // Deactivate account
      db.prepare(`UPDATE users SET is_active = 0 WHERE id = ?`).run(testAdminId);
      approvers = AccessRequestRepository.resolveAccessRequestApprovers();
      assert.ok(!approvers.some((a) => a.id === testAdminId), 'Deactivated user MUST be excluded from approver resolution');

      // Reactivate
      db.prepare(`UPDATE users SET is_active = 1 WHERE id = ?`).run(testAdminId);
      approvers = AccessRequestRepository.resolveAccessRequestApprovers();
      assert.ok(approvers.some((a) => a.id === testAdminId), 'Reactivated user is included again');
    } finally {
      db.prepare(`DELETE FROM user_permission_overrides WHERE id = ?`).run(`upo-${testAdminId}-perm-gov-access-review`);
      db.prepare(`DELETE FROM users WHERE id = ?`).run(testAdminId);
    }
  });

  await suite.test('5. Delete User API and Business Logic Safeguards', () => {
    // 5A: Prevent Self-Deletion
    const stdAdminSession = {
      id: 'usr-test-std-admin',
      userId: 'usr-test-std-admin',
      username: 'std_no_email',
      role: 'ADMIN' as const,
      authorityTier: 'STANDARD_ADMIN' as const,
    };

    assert.throws(
      () => {
        deleteUser('usr-test-std-admin', stdAdminSession);
      },
      /cannot delete your own/i,
      'Self-deletion must be blocked'
    );

    const kingMakerSession = {
      id: 'usr-admin-1',
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      role: 'ADMIN' as const,
      authorityTier: 'KING_MAKER' as const,
    };

    // King Maker deletion must be blocked
    assert.throws(
      () => {
        deleteUser('usr-admin-1', kingMakerSession);
      },
      /cannot be deleted/i,
      'King Maker deletion must be blocked'
    );

    assert.throws(
      () => {
        deleteUser('usr-admin-1', stdAdminSession);
      },
      /cannot be deleted|authority|privileges required/i,
      'Standard Admin cannot delete King Maker'
    );

    assert.throws(
      () => {
        deleteUser('usr-f7825275-d30e-4b89-9d6b-994b50532984', stdAdminSession);
      },
      /cannot be deleted|authority|privileges required/i,
      'Standard Admin cannot delete Client Prime'
    );

    // 5C: Clean deletion of ephemeral test user
    const ephemeralId = 'usr-ephemeral-del-test';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, created_at, updated_at)
      VALUES (?, 'ephemeral_user', 'hash', 'Ephemeral User', 'SITE_MANAGER', 'STANDARD', 'ephemeral@sitework.local', 1, 1, datetime('now'), datetime('now'))
    `).run(ephemeralId);

    // Give ephemeral user a site assignment and override
    db.prepare(`INSERT OR REPLACE INTO site_users (id, site_id, user_id, created_at) VALUES ('su-ephemeral', 'site-1', ?, datetime('now'))`).run(ephemeralId);

    // Perform deleteUser
    deleteUser(ephemeralId, kingMakerSession);

    const checkUser = db.prepare(`SELECT id FROM users WHERE id = ?`).get(ephemeralId);
    assert.equal(checkUser, undefined, 'User record must be removed from users table');

    const checkSiteUsers = db.prepare(`SELECT id FROM site_users WHERE user_id = ?`).all(ephemeralId);
    assert.equal(checkSiteUsers.length, 0, 'Associated site_users memberships must be removed');
  });

  await suite.test('6. Primary navigation integrity: /admin/access-requests removed from main nav', () => {
    const navContent = fs.readFileSync(path.join(process.cwd(), 'components/layout/Navigation.tsx'), 'utf8');
    const headerContent = fs.readFileSync(path.join(process.cwd(), 'components/layout/Header.tsx'), 'utf8');

    assert.ok(!navContent.includes("'/admin/access-requests'"), 'Navigation.tsx must not contain link to /admin/access-requests');
    assert.ok(!headerContent.includes("'/admin/access-requests'"), 'Header.tsx must not contain link to /admin/access-requests');
    assert.equal(REGISTERED_PAGES.PAGE_ACCESS_REQUESTS.route, '/setup/users?accessRequests=true', 'PAGE_ACCESS_REQUESTS must route to unified Users & Access');
  });
});
